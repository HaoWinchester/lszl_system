import copy
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from fastapi import HTTPException
from app.services.teacher_assistant_import import build_plan, execute_plan

@pytest.fixture
def anyio_backend():
    return 'asyncio'

ACTOR = SimpleNamespace(username='teacher', role='teacher')

def question(identifier='q1', answer='a'):
    return {'id': identifier, 'title': '题目', 'type': 'single_choice', 'stemParts': [{'type': 'text', 'text': '题干'}], 'options': [{'id': 'a', 'text': '选项A'}, {'id': 'b', 'text': '选项B'}], 'correctAnswer': answer, 'metadata': {'principleIds': [], 'original': 'preserved'}}

def source(q=None):
    return {'id': 'upload1', 'name': 'test.json', 'extracted': {'kind': 'json', 'data': {'id': 'bank1', 'name': '原题库', 'questions': [q or question()]}, 'sections': [], 'warnings': []}}

@pytest.fixture
def db():
    result = SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: []), scalar_one_or_none=lambda: None)
    return SimpleNamespace(execute=AsyncMock(return_value=result), get=AsyncMock(return_value=None), commit=AsyncMock(), refresh=AsyncMock(), rollback=AsyncMock())

@pytest.mark.anyio
async def test_json_model_cannot_rewrite_critical_fields(db):
    original = source()
    plan = await build_plan(db, ACTOR, [original], {'items': [{'uploadId': 'upload1', 'questions': [question(answer='b')]}]}, session_id='session')
    assert plan['items'][0]['questions'] == original['extracted']['data']['questions']
    assert plan['settings']['publish'] is False
    assert plan['settings']['allowedRoles'] == []
    assert 'practice_mode' not in plan['settings']['enabledModes']

@pytest.mark.anyio
async def test_missing_answer_blocks(db):
    plan = await build_plan(db, ACTOR, [source(question(answer=None))], {}, session_id='s')
    assert plan['items'][0]['blockers']

@pytest.mark.anyio
async def test_ids_stable_across_revision(db):
    first = await build_plan(db, ACTOR, [source()], {'settings': {'duplicatePolicy': 'independent'}}, session_id='s')
    second = await build_plan(db, ACTOR, [source()], {'settings': {'nameSuffix': '习题课'}}, session_id='s', previous_plan=first)
    assert first['items'][0]['id'] == second['items'][0]['id']
    assert first['items'][0]['bankPayload']['sourceId'] == second['items'][0]['bankPayload']['sourceId']

@pytest.mark.anyio
async def test_old_revision_rejected(db):
    session = SimpleNamespace(id='s', owner_id='teacher', revision=2, plan={}, receipt={})
    with pytest.raises(HTTPException) as error:
        await execute_plan(db, ACTOR, session, 1)
    assert error.value.status_code == 409

@pytest.mark.anyio
async def test_invalid_publish_scope_blocks(db):
    plan = await build_plan(db, ACTOR, [source()], {'settings': {'publish': True, 'allowedRoles': ['superuser'], 'enabledModes': ['shell'], 'accessLevel': 'free'}}, session_id='s')
    assert plan['blockers']

@pytest.mark.anyio
async def test_delete_requires_instruction(db):
    model = {'items': [{'uploadId': 'upload1', 'excludedQuestionIds': ['q1']}]}
    plan = await build_plan(db, ACTOR, [source()], model, session_id='s')
    assert len(plan['items'][0]['questions']) == 1
    model['userInstruction'] = '第1题不要'
    plan = await build_plan(db, ACTOR, [source()], model, session_id='s')
    assert plan['items'][0]['questions'] == []
    assert plan['items'][0]['blockers']

@pytest.mark.anyio
async def test_original_twenty_five_lossless(db):
    root = Path('/Users/menghao/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_d26m6zr7um9k51_e8f7/msg/file/2026-09')
    files = [root / 'PMP_财务绩效域_12题母题整理批次_PrepStudio.json', root / 'PMP_进度绩效域_13题母题整理批次_PrepStudio.json']
    if not all(path.exists() for path in files):
        pytest.skip('Original user fixtures not available on this host')
    sources = [{'id': f'u{i}', 'name': path.name, 'extracted': {'kind': 'json', 'data': json.loads(path.read_text()), 'warnings': [], 'sections': []}} for i, path in enumerate(files)]
    plan = await build_plan(db, ACTOR, sources, {'settings': {'duplicatePolicy': 'independent', 'nameSuffix': '习题课', 'accessLevel': 'free', 'allowedRoles': ['teacher', 'student'], 'enabledModes': ['deep_recall', 'multi_question_canvas']}}, session_id='real')
    assert sum(len(item['questions']) for item in plan['items']) == 25
    for item, original in zip(plan['items'], sources):
        assert item['questions'] == original['extracted']['data']['questions']
        assert '习题课' in item['name']
        assert item['bankPayload']['sourceId'] != original['extracted']['data']['id']

@pytest.mark.anyio
async def test_real_import_publish_and_lost_receipt_recovery():
    from uuid import uuid4
    from sqlalchemy import func, select
    from app.db.session import AsyncSessionLocal
    from app.models.user import User
    from app.models.teacher_assistant import TeacherAssistantSession
    from app.models.question import ExamPaper, QuestionBank, Question
    from app.models.paper_release import PaperRelease
    suffix = uuid4().hex[:12]
    async with AsyncSessionLocal() as database:
        actor = User(username='ta-real-' + suffix, password_hash='test', role='teacher', status='active')
        database.add(actor)
        await database.commit()
        session = TeacherAssistantSession(id='tas-' + suffix, owner_id=actor.username, revision=1)
        model = {'settings': {'duplicatePolicy': 'independent', 'publish': True, 'accessLevel': 'free', 'allowedRoles': ['teacher', 'student'], 'enabledModes': ['deep_recall', 'multi_question_canvas']}}
        session.plan = await build_plan(database, actor, [source()], model, session_id=session.id)
        assert not session.plan['blockers']
        assert not session.plan['items'][0]['blockers']
        database.add(session)
        await database.commit()
        first = await execute_plan(database, actor, session, 1)
        assert first['status'] == 'succeeded', json.dumps(first, ensure_ascii=False)
        identifiers = {key: first['items'][0][key] for key in ('bankId', 'paperId', 'releaseId')}
        # Simulate commits succeeding but no step receipt surviving.
        session.receipt = {}
        await database.commit()
        second = await execute_plan(database, actor, session, 1)
        assert second['status'] == 'succeeded', second
        assert {key: second['items'][0][key] for key in identifiers} == identifiers
        assert await database.scalar(select(func.count()).select_from(QuestionBank).where(QuestionBank.owner_id == actor.username)) == 1
        assert await database.scalar(select(func.count()).select_from(ExamPaper).where(ExamPaper.owner_id == actor.username)) == 1
        assert await database.scalar(select(func.count()).select_from(PaperRelease).where(PaperRelease.paper_id == identifiers['paperId'])) == 1
        stored = await database.get(QuestionBank, identifiers['bankId'])
        assert stored.visibility == 'private'
        release = await database.get(PaperRelease, identifiers['releaseId'])
        assert release.access_level == 'free'
        assert set(release.allowed_roles) == {'teacher', 'student'}
        assert set(release.enabled_modes) == {'deep_recall', 'multi_question_canvas'}

@pytest.mark.anyio
async def test_document_review_must_be_grounded(db):
    q = question()
    q.update(source={'location': '第 1 页'}, needsReview=True)
    document = {'id': 'u', 'name': 'x.pdf', 'extracted': {'kind': 'document', 'data': None, 'sections': [{'location': '第 1 页', 'text': '题干', 'images': []}], 'warnings': ['OCR 需核对']}}
    model = {'settings': {'duplicatePolicy': 'independent'}, 'items': [{'uploadId': 'u', 'questions': [q], 'reviewedQuestionIds': ['q1']}]}
    untrusted = await build_plan(db, ACTOR, [document], model, session_id='s')
    assert untrusted['items'][0]['blockers']
    model['userInstruction'] = '我已核对，确认答案无误'
    reviewed = await build_plan(db, ACTOR, [document], model, session_id='s')
    assert not reviewed['items'][0]['blockers']
    assert reviewed['items'][0]['reviewedQuestionIds'] == ['q1']

@pytest.mark.anyio
async def test_restore_excluded_question_without_upload(db):
    data = source()
    data['extracted']['data']['questions'].append(question('q2'))
    removed = await build_plan(db, ACTOR, [data], {'userInstruction': '第2题不要', 'items': [{'uploadId': 'upload1', 'excludedQuestionIds': ['q2']}]}, session_id='s')
    assert [q['id'] for q in removed['items'][0]['questions']] == ['q1']
    restored = await build_plan(db, ACTOR, [data], {'userInstruction': '恢复第2题', 'items': [{'uploadId': 'upload1', 'selectedQuestionIds': ['q1', 'q2']}]}, session_id='s', previous_plan=removed)
    assert [q['id'] for q in restored['items'][0]['questions']] == ['q1', 'q2']

@pytest.mark.anyio
async def test_real_twenty_five_import_preserves_answers_and_associations():
    from uuid import uuid4
    from sqlalchemy import select
    from app.db.session import AsyncSessionLocal
    from app.models.user import User
    from app.models.teacher_assistant import TeacherAssistantSession
    from app.models.content_prep import Principle
    from app.models.teaching_content import ContentSubject, RecallAssociationLibrary
    from app.models.question import Question
    from app.services import question_service, question_content_service
    root = Path('/Users/menghao/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_d26m6zr7um9k51_e8f7/msg/file/2026-09')
    files = [root / 'PMP_财务绩效域_12题母题整理批次_PrepStudio.json', root / 'PMP_进度绩效域_13题母题整理批次_PrepStudio.json']
    if not all(path.exists() for path in files):
        pytest.skip('Original user fixtures unavailable')
    sources = [{'id': f'u{i}', 'name': path.name, 'extracted': {'kind': 'json', 'data': json.loads(path.read_text()), 'warnings': [], 'sections': []}} for i, path in enumerate(files)]
    questions = [q for uploaded in sources for q in uploaded['extracted']['data']['questions']]
    principles = set()
    nodes = {}
    for q in questions:
        metadata = q.get('metadata') or {}
        principles.update(metadata.get('principleIds') or [])
        principles.update(metadata.get('stemPrincipleIds') or [])
        for values in (metadata.get('optionPrincipleMap') or {}).values():
            principles.update(values)
        for clue in q.get('clues') or []:
            if clue.get('recallNodeId'):
                nodes[clue['recallNodeId']] = {'id': clue['recallNodeId'], 'title': clue.get('text') or clue['recallNodeId']}
    suffix = uuid4().hex[:12]
    async with AsyncSessionLocal() as database:
        actor = User(username='ta-original-' + suffix, password_hash='test', role='teacher', status='active')
        database.add(actor)
        for identifier in principles:
            if await database.get(Principle, identifier) is None:
                database.add(Principle(id=identifier, name=identifier, status='active'))
        subject = ContentSubject(id='ta-subject-' + suffix, code='ta-' + suffix, name='Fixture')
        database.add(subject)
        await database.flush()
        database.add(RecallAssociationLibrary(id='ta-library-' + suffix, subject_id=subject.id, nodes=list(nodes.values()), status='published'))
        await database.commit()
        session = TeacherAssistantSession(id='tas-original-' + suffix, owner_id=actor.username, revision=1)
        settings = {'duplicatePolicy': 'independent', 'nameSuffix': '习题课', 'publish': True, 'accessLevel': 'free', 'allowedRoles': ['teacher', 'student'], 'enabledModes': ['deep_recall', 'multi_question_canvas']}
        session.plan = await build_plan(database, actor, sources, {'settings': settings}, session_id=session.id)
        assert not session.plan['blockers']
        assert all(not item['blockers'] for item in session.plan['items']), session.plan['items']
        database.add(session)
        await database.commit()
        receipt = await execute_plan(database, actor, session, 1)
        assert receipt['status'] == 'succeeded', json.dumps(receipt, ensure_ascii=False)
        imported = (await database.execute(select(Question).where(Question.bank_id.in_([item['bankId'] for item in receipt['items']])))).scalars().all()
        assert len(imported) == 25
        original_by_id = {q['id']: q for q in questions}
        for stored in imported:
            original_id = stored.content_metadata['teacherAssistantSource']['originalId']
            original = question_content_service.normalize_question_payload(original_by_id[original_id], subject='PMP')
            actual = question_service.question_to_dict(stored)
            for field in ('type', 'correctAnswer', 'correctOptionIds', 'clues', 'concepts', 'reasoningSteps', 'options', 'stemParts'):
                assert actual.get(field) == original.get(field), (original_id, field)
            for field in ('principleIds', 'stemPrincipleIds', 'optionPrincipleMap', 'origin'):
                assert actual['metadata'].get(field) == original['metadata'].get(field), (original_id, field)

@pytest.mark.anyio
async def test_partial_receipt_preserved_and_success_not_replayed(db, monkeypatch):
    from app.services import teacher_assistant_import as importer
    broken = source(question(answer=None))
    working = source()
    working['id'] = 'upload2'
    plan = await build_plan(db, ACTOR, [broken, working], {'settings': {'duplicatePolicy': 'independent'}}, session_id='s')
    session = SimpleNamespace(id='s', owner_id='teacher', revision=1, plan=plan, receipt={})
    bank_source = plan['items'][1]['bankPayload']['sourceId']
    banks = AsyncMock(return_value={'sourceBankIdMap': {bank_source: 'real-bank'}})
    papers = AsyncMock(return_value={'paper': {'id': 'real-paper'}})
    monkeypatch.setattr(importer.question_service, 'import_question_banks', banks)
    monkeypatch.setattr(importer.paper_import_service, 'preflight_package', AsyncMock(return_value={'valid': True, 'payloadHash': 'a' * 64}))
    monkeypatch.setattr(importer.paper_import_service, 'import_package', papers)
    first = await execute_plan(db, ACTOR, session, 1)
    assert first['status'] == 'partial'
    assert [item['status'] for item in first['items']] == ['blocked', 'succeeded']
    assert session.receipt['items'][1]['bankId'] == 'real-bank'
    await execute_plan(db, ACTOR, session, 1)
    assert banks.await_count == 1
    assert papers.await_count == 1

@pytest.mark.anyio
async def test_cross_teacher_execute_denied(db):
    session = SimpleNamespace(id='s', owner_id='other-teacher', revision=1, plan={}, receipt={})
    with pytest.raises(HTTPException) as error:
        await execute_plan(db, ACTOR, session, 1)
    assert error.value.status_code == 403
