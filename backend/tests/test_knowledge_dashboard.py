"""Owner-isolated, frozen-snapshot practice freshness dashboard."""
import asyncio
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.training import PracticeSession
from app.models.user import User

NOW = datetime(2026, 10, 19, tzinfo=timezone.utc)


def snapshot(node='n1', subject='PMP', path=None):
    return {'subject': subject, 'stem': 'SECRET QUESTION', 'correctAnswer': 'SECRET ANSWER',
            'metadata': {'knowledge': {'taxonomyId': 'tax', 'primaryNodeId': node,
                                      'pathSnapshot': path or ['项目管理', '风险']}}}


def answer(days=0, **extra):
    return {'correct': True, 'submittedAt': (NOW-timedelta(days=days)).isoformat(), **extra}


def test_aggregation_counts_real_answers_and_honest_unknowns():
    from app.services.knowledge_dashboard_service import aggregate_sessions
    rows = [({'q1': answer(0), 'q2': answer(15), 'q3': answer(1, draft=True),
              'q4': answer(0, timedOut=True), 'q5': {'selectedAnswer': 'A'},
              'q6': answer(2), 'q7': answer(0), 'not-in-order': answer()},
             {'q1': snapshot(), 'q2': snapshot(), 'q3': snapshot(), 'q4': snapshot(),
              'q5': snapshot(), 'q6': {}, 'q7': snapshot(subject='ACP')})]
    result = aggregate_sessions(rows, now=NOW)
    assert result['attemptCount'] == 4
    assert result['recentAttemptCount'] == 3
    assert result['unknownAttemptCount'] == 1
    assert result['topicCount'] == 2
    pmp = next(n for n in result['nodes'] if n['subject'] == 'PMP')
    assert pmp['attemptCount'] == 2
    assert pmp['lastPracticedAt'] == NOW.isoformat()
    assert pmp['brightness'] == 1
    assert pmp['path'] == ['项目管理', '风险']
    assert 'SECRET' not in str(result)
    assert 'correct' not in str(result)


def test_elapsed_days_decay_and_pagination_never_drop_history_totals():
    from app.services.knowledge_dashboard_service import aggregate_sessions
    rows = [({'q': answer(days)}, {'q': snapshot(node=f'n{days}')}) for days in (0, 15, 30, 60)]
    first = aggregate_sessions(rows, now=NOW, page=1, page_size=2)
    second = aggregate_sessions(rows, now=NOW, page=2, page_size=2)
    assert first['attemptCount'] == second['attemptCount'] == 4
    assert first['topicCount'] == second['topicCount'] == 4
    assert first['hasMore'] is True and second['hasMore'] is False
    assert [n['brightness'] for n in first['nodes']+second['nodes']] == [1, .6, .2, .2]
    assert aggregate_sessions([], now=NOW)['lastPracticedAt'] is None
    assert aggregate_sessions([], now=NOW)['nodes'] == []


def test_frozen_path_and_taxonomy_separate_nodes_without_inventing_topics():
    from app.services.knowledge_dashboard_service import aggregate_sessions
    a, b = snapshot(), snapshot(path=[{'id': 'root', 'zh': '根'}, {'id': 'risk', 'zh': '风险'}])
    c = snapshot(node='')
    result = aggregate_sessions([({'a': answer(), 'b': answer(), 'c': answer()}, {'a': a, 'b': b, 'c': c})], now=NOW)
    assert result['topicCount'] == 2
    assert result['unknownAttemptCount'] == 1
    assert any(node['path'] == ['根', '风险'] for node in result['nodes'])


def test_api_requires_login_and_only_reads_current_owner_frozen_sessions():
    token = uuid4().hex[:10]
    owners = [f'dashboard-{token}-a', f'dashboard-{token}-b']
    async def seed():
        async with AsyncSessionLocal() as db:
            for owner in owners:
                db.add(User(username=owner, password_hash=hash_password('dashboard-pass'), role='student', status='active'))
            await db.flush()
            for i, owner in enumerate(owners):
                db.add(PracticeSession(id=f'dash-{token}-{i}', owner_id=owner, mode='practice', status='completed',
                    question_order=[{'questionId': 'q', 'questionSnapshot': snapshot(node=f'owner-{i}')}],
                    answers={'q': answer()}, runtime_state={}, stats={}, scoring_snapshot={}))
            await db.commit()
    async def cleanup():
        async with AsyncSessionLocal() as db:
            await db.execute(delete(User).where(User.username.in_(owners)))
            await db.commit()
    asyncio.run(seed())
    try:
        with TestClient(app) as client:
            assert client.get('/api/v1/learning/practice/knowledge-dashboard').status_code == 401
            assert client.post('/api/v1/auth/login', json={'username': owners[0], 'password': 'dashboard-pass'}).status_code == 200
            response = client.get('/api/v1/learning/practice/knowledge-dashboard')
            assert response.status_code == 200
            body = response.json()
            assert body['attemptCount'] == 1
            assert body['nodes'][0]['primaryNodeId'] == 'owner-0'
            assert 'owner-1' not in str(body)
            assert 'SECRET' not in str(body)
            assert client.get('/api/v1/learning/practice/knowledge-dashboard?pageSize=501').status_code == 422
    finally:
        asyncio.run(cleanup())


def test_api_scans_beyond_first_hundred_sessions_and_resolves_only_frozen_release():
    from app.models.paper_release import PaperRelease, PaperReleaseQuestion
    token = uuid4().hex[:10]
    owner, release_id = f'dash-history-{token}', f'dash-release-{token}'
    async def seed():
        async with AsyncSessionLocal() as db:
            db.add(User(username=owner, password_hash=hash_password('dashboard-pass'), role='student', status='active'))
            await db.flush()
            db.add(PaperRelease(id=release_id, paper_id=f'paper-{token}', version=1, status='published',
                                name='Frozen dashboard fixture', subject='PMP', publisher_id=owner))
            await db.flush()
            db.add(PaperReleaseQuestion(release_id=release_id, order_index=1, question_id='frozen-q', bank_id='absent-live-bank',
                                       snapshot=snapshot(node='frozen-only', path=['冻结路径'])))
            for index in range(105):
                db.add(PracticeSession(id=f'dash-h-{token}-{index}', owner_id=owner, mode='practice', status='completed',
                    question_order=[{'questionId': 'q', 'questionSnapshot': snapshot()}], answers={'q': answer(2)},
                    runtime_state={}, stats={}, scoring_snapshot={}))
            db.add(PracticeSession(id=f'dash-h-{token}-release', owner_id=owner, mode='practice', status='completed', release_id=release_id,
                question_order=[{'questionId': 'frozen-q'}], answers={'frozen-q': answer()}, runtime_state={}, stats={}, scoring_snapshot={}))
            await db.commit()
    async def cleanup():
        async with AsyncSessionLocal() as db:
            await db.execute(delete(PracticeSession).where(PracticeSession.owner_id == owner))
            await db.execute(delete(PaperReleaseQuestion).where(PaperReleaseQuestion.release_id == release_id))
            await db.execute(delete(PaperRelease).where(PaperRelease.id == release_id))
            await db.execute(delete(User).where(User.username == owner))
            await db.commit()
    asyncio.run(seed())
    try:
        with TestClient(app) as client:
            client.post('/api/v1/auth/login', json={'username':owner,'password':'dashboard-pass'})
            first=client.get('/api/v1/learning/practice/knowledge-dashboard?pageSize=1').json()
            second=client.get('/api/v1/learning/practice/knowledge-dashboard?pageSize=1&page=2').json()
            assert first['attemptCount'] == second['attemptCount'] == 106
            assert first['topicCount'] == 2
            assert first['nodes'][0]['primaryNodeId'] == 'frozen-only'
            assert first['nodes'][0]['title'] == '冻结路径'
            assert first['hasMore'] is True and second['hasMore'] is False
            assert second['nodes'][0]['attemptCount'] == 105
            assert 'SECRET' not in str(first)
    finally:
        asyncio.run(cleanup())
