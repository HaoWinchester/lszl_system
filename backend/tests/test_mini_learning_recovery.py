import asyncio

from fastapi.testclient import TestClient

from app.db.session import AsyncSessionLocal
from app.main import app
from test_practice_learning_api import _create_student, _login, _mistake_row, _name


def test_client_cannot_forge_server_replay_events():
    owner = _name('mini_event')
    _create_student(owner)
    client = TestClient(app)
    _login(client, owner)
    for event_type in ['PRACTICE_REVENGE_ANSWERED', 'PRACTICE_REMEDIATION_VERIFIED']:
        response = client.post('/api/v1/learning/events', json={
            'eventType': event_type, 'payload': {'requestId': 'forged', 'verificationId': 'foreign'},
        })
        assert response.status_code == 400  # The existing event-ingestion route uses 400 for rejected types.
    assert client.post('/api/v1/learning/events', json={'eventType': 'QUESTION_VIEWED'}).status_code == 200


def test_legacy_client_event_is_not_a_trusted_revenge_receipt():
    from app.models.training import LearningEvent
    from test_practice_learning_api import _create_public_question
    owner = _name('mini_legacy_event')
    _create_student(owner)
    source = _create_public_question(title='重试可信来源', taxonomy_id='audit-trust', node_id='audit-node')
    client = TestClient(app)
    _login(client, owner)
    wrong = client.post('/api/v1/learning/practice/answers', json={
        'questionId': source['question']['id'], 'bankId': source['bankId'], 'selectedAnswer': 'B',
    })
    assert wrong.status_code == 200
    mistake_id = wrong.json()['mistake']['id']

    async def seed_legacy_event():
        async with AsyncSessionLocal() as db:
            db.add(LearningEvent(id=_name('le'), owner_id=owner,
                event_type='PRACTICE_REVENGE_ANSWERED',
                payload={'mistakeId': mistake_id, 'requestId': 'legacy-fake', 'selection': ['B']}))
            await db.commit()
    asyncio.run(seed_legacy_event())
    result = client.post(f'/api/v1/learning/practice/mistakes/{mistake_id}/revenge-answer',
                         json={'selectedAnswer': 'B', 'requestId': 'legacy-fake'})
    assert result.status_code == 200
    assert result.json()['mistake']['revengeAttemptCount'] == 1

    async def retry_with_cached_row():
        from app.models.training import PracticeMistake
        from app.services import learning_service
        async with AsyncSessionLocal() as writer, AsyncSessionLocal() as waiting:
            cached = await waiting.get(PracticeMistake, mistake_id)
            assert cached.revenge_attempt_count == 1
            payload = {'selectedAnswer': 'B', 'requestId': 'concurrent-retry'}
            first = await learning_service.record_revenge_answer(writer, owner, mistake_id, payload)
            second = await learning_service.record_revenge_answer(waiting, owner, mistake_id, payload)
            assert first.revenge_attempt_count == 2
            assert second.revenge_attempt_count == 2
    asyncio.run(retry_with_cached_row())


def test_verification_replay_cannot_return_another_owners_record():
    from app.models.training import LearningEvent, PracticeVerification
    from test_practice_learning_api import _create_public_question
    owner, other = _name('receipt_owner'), _name('receipt_other')
    _create_student(owner)
    _create_student(other)
    source = _create_public_question(title='验证记录隔离', taxonomy_id='audit-replay', node_id='audit-node')
    qid = source['question']['id']
    mine, theirs, verification_id = _name('pm'), _name('pm'), _name('pv')

    async def seed():
        async with AsyncSessionLocal() as db:
            db.add_all([_mistake_row(mistake_id=mid, owner=user, question_id=qid, status='needs_remediation')
                        for mid, user in [(mine, owner), (theirs, other)]])
            await db.flush()
            db.add(PracticeVerification(id=verification_id, owner_id=other, mistake_id=theirs,
                                       question_id=qid, selected_answer='A', correct=True))
            # Even a malformed trusted receipt must not bypass record ownership.
            db.add(LearningEvent(id=_name('le_receipt'), owner_id=owner, event_type='PRACTICE_REMEDIATION_VERIFIED',
                payload={'mistakeId': mine, 'requestId': 'bad-reference', 'selection': ['A'],
                         'verificationQuestionId': qid, 'verificationId': verification_id, 'answerSnapshot': {}}))
            await db.commit()
    asyncio.run(seed())
    client = TestClient(app)
    _login(client, owner)
    response = client.post(f'/api/v1/learning/practice/mistakes/{mine}/verification',
                           json={'requestId': 'bad-reference', 'questionId': qid, 'selectedAnswer': 'A'})
    assert response.status_code == 422
    assert verification_id not in response.text


def test_remediation_can_resume_without_marking_reviewed_and_is_owner_scoped():
    owner, other = _name('mini_recovery'), _name('mini_other')
    _create_student(owner)
    _create_student(other)
    mistake_id, pending_id = _name('pm'), _name('pm')

    async def seed():
        async with AsyncSessionLocal() as db:
            db.add(_mistake_row(mistake_id=mistake_id, owner=owner, question_id=None, status='needs_remediation'))
            db.add(_mistake_row(mistake_id=pending_id, owner=owner, question_id=None, status='pending'))
            await db.commit()
    asyncio.run(seed())
    client = TestClient(app)
    _login(client, owner)
    response = client.get(f'/api/v1/learning/practice/mistakes/{mistake_id}/remediation')
    assert response.status_code == 200, response.text
    assert response.json()['mistake']['questionSnapshot']['correctAnswer'] == 'A'
    assert response.json()['mistake']['remediationReviewedAt'] is None
    assert client.get(f'/api/v1/learning/practice/mistakes/{pending_id}/remediation').status_code == 409
    _login(client, other)
    assert client.get(f'/api/v1/learning/practice/mistakes/{mistake_id}/remediation').status_code == 404


def test_missing_verification_knowledge_is_a_waiting_state_not_a_broken_queue():
    from app.core.security import now_utc
    owner, mistake_id = _name('mini_waiting'), _name('pm')
    _create_student(owner)

    async def seed():
        async with AsyncSessionLocal() as db:
            mistake = _mistake_row(mistake_id=mistake_id, owner=owner, question_id=None, status='needs_remediation')
            mistake.remediation_reviewed_at = now_utc()
            db.add(mistake)
            await db.commit()
    asyncio.run(seed())
    client = TestClient(app)
    _login(client, owner)
    response = client.get(f'/api/v1/learning/practice/mistakes/{mistake_id}/verification-candidate')
    assert response.status_code == 200, response.text
    assert response.json()['candidate']['available'] is False
    assert response.json()['candidate']['code'] == 'MISSING_VERIFICATION_KNOWLEDGE'
