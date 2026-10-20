"""Published catalog coverage and owner-only frozen practice overlays."""
import asyncio
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, update

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.paper_release import PaperRelease, PaperReleaseQuestion
from app.models.teaching_content import ContentSubject, ContentTaxonomy, TaxonomyNode
from app.models.training import PracticeSession
from app.models.user import User

NOW = datetime(2026, 10, 20, tzinfo=timezone.utc)
ENDPOINT = '/api/v1/learning/practice/knowledge-universe'


@pytest.fixture
def catalog(monkeypatch):
    from app.services import knowledge_dashboard_service
    monkeypatch.setattr(knowledge_dashboard_service, 'now_utc', lambda: NOW)
    token = uuid4().hex[:10]
    prefix = f'universe-{token}'
    subjects = {key: f'{prefix}-{key}' for key in ('main', 'fallback', 'inactive', 'draftonly')}
    taxonomies = {key: f'{prefix}-tax-{key}' for key in (
        'current', 'newer', 'draft', 'archived', 'fallback', 'fallback-old', 'inactive', 'draftonly')}
    owners = [f'{prefix}-a', f'{prefix}-b']

    async def seed():
        async with AsyncSessionLocal() as db:
            for owner in owners:
                db.add(User(username=owner, password_hash=hash_password('universe-pass'),
                            role='student', status='active'))
            for key, sid in subjects.items():
                pointer = taxonomies['current'] if key == 'main' else taxonomies['draft']
                db.add(ContentSubject(id=sid, code=sid, name=f'科目-{key}',
                                      status='inactive' if key == 'inactive' else 'active',
                                      content_metadata={'currentTaxonomyId': pointer}))
            await db.flush()
            for key, sid, version, status in (
                ('current', 'main', 1, 'published'), ('newer', 'main', 2, 'published'),
                ('draft', 'main', 3, 'draft'), ('archived', 'main', 4, 'archived'),
                ('fallback-old', 'fallback', 1, 'published'), ('fallback', 'fallback', 2, 'published'),
                ('inactive', 'inactive', 1, 'published'), ('draftonly', 'draftonly', 1, 'draft'),
            ):
                db.add(ContentTaxonomy(id=taxonomies[key], subject_id=subjects[sid], version=version,
                                       status=status, title=f'知识树-{key}', content_metadata={}))
            await db.flush()
            for index in range(125):
                node = 'root' if index == 0 else f'n{index}'
                db.add(TaxonomyNode(id=f'{prefix}-node-{index}', taxonomy_id=taxonomies['current'],
                                    node_id=node, parent_node_id=None if index == 0 else 'root',
                                    title='当前根' if index == 0 else f'当前节点{index}', position=index))
            for key in taxonomies:
                if key != 'current':
                    db.add(TaxonomyNode(id=f'{prefix}-node-{key}', taxonomy_id=taxonomies[key],
                                        node_id='other', title=f'仅-{key}'))
            for node, parent, status in (
                ('hidden', 'root', 'inactive'), ('missing', 'absent', 'active'),
                ('cycle-a', 'cycle-b', 'active'), ('cycle-b', 'cycle-a', 'active'),
                ('self', 'self', 'active'), ('hidden-parent', 'hidden', 'active'),
            ):
                db.add(TaxonomyNode(id=f'{prefix}-{node}', taxonomy_id=taxonomies['current'],
                                    node_id=node, parent_node_id=parent, title=node, status=status))
            await db.commit()

    async def cleanup():
        async with AsyncSessionLocal() as db:
            await db.execute(delete(PracticeSession).where(PracticeSession.owner_id.in_(owners)))
            await db.execute(delete(PaperReleaseQuestion).where(PaperReleaseQuestion.release_id == prefix))
            await db.execute(delete(PaperRelease).where(PaperRelease.id == prefix))
            await db.execute(delete(ContentTaxonomy).where(ContentTaxonomy.id.in_(taxonomies.values())))
            await db.execute(delete(ContentSubject).where(ContentSubject.id.in_(subjects.values())))
            await db.execute(delete(User).where(User.username.in_(owners)))
            await db.commit()

    asyncio.run(seed())
    try:
        yield {'subjects': subjects, 'taxonomies': taxonomies, 'owners': owners, 'prefix': prefix}
    finally:
        asyncio.run(cleanup())


def login(client, owner):
    assert client.post('/api/v1/auth/login', json={
        'username': owner, 'password': 'universe-pass'}).status_code == 200


def read_universe(client):
    response = client.get(ENDPOINT)
    assert response.status_code == 200, response.text
    return response.json()


def own_nodes(body, catalog):
    return [node for node in body['nodes'] if node['subjectId'] in catalog['subjects'].values()]


def test_requires_login():
    with TestClient(app) as client:
        assert client.get(ENDPOINT).status_code == 401


def test_complete_unpracticed_catalog_uses_current_published_tree_without_limits(catalog):
    with TestClient(app) as client:
        login(client, catalog['owners'][0])
        body = read_universe(client)
        nodes = own_nodes(body, catalog)
        assert len(nodes) == 131  # 125 main nodes, five safe malformed roots, one fallback.
        assert len(body['nodes']) == body['topicCount']
        assert body['topicCount'] > 121
        assert body['practicedTopicCount'] == body['attemptCount'] == 0
        assert body['unpracticedTopicCount'] == body['topicCount']
        assert body['unknownAttemptCount'] == body['unmappedAttemptCount'] == 0
        assert body['brightnessMeaning'] == 'practice-activity'
        assert body['dimAfterDays'] == 30
        assert 'hasMore' not in body and 'page' not in body
        assert all(n['brightness'] == .12 and n['attemptCount'] == 0
                   and n['lastPracticedAt'] is None and not n['practiced'] for n in body['nodes'])
        assert {n['taxonomyId'] for n in nodes} == {
            catalog['taxonomies']['current'], catalog['taxonomies']['fallback']}
        groups = {subject['id']: subject for subject in body['subjects']}
        assert groups[catalog['subjects']['main']]['topicCount'] == 130
        assert groups[catalog['subjects']['fallback']]['topicCount'] == 1
        assert catalog['subjects']['inactive'] not in groups
        assert catalog['subjects']['draftonly'] not in groups
        root = next(n for n in nodes if n['primaryNodeId'] == 'root')
        child = next(n for n in nodes if n['primaryNodeId'] == 'n1')
        assert child['parentNodeId'] == 'root' and child['parentId'] == root['id']
        assert child['path'] == ['当前根', '当前节点1']
        assert child['title'] == '当前节点1' and child['taxonomyTitle'] == '知识树-current'
        assert child['subject'] == catalog['subjects']['main']
        async def rename_node():
            async with AsyncSessionLocal() as db:
                await db.execute(update(TaxonomyNode).where(
                    TaxonomyNode.taxonomy_id == catalog['taxonomies']['current'],
                    TaxonomyNode.node_id == 'n1').values(title='发布后的名称'))
                await db.commit()
        asyncio.run(rename_node())
        repeated = read_universe(client)
        assert {n['id'] for n in own_nodes(repeated, catalog)} == {n['id'] for n in nodes}
        renamed = next(n for n in repeated['nodes'] if n['id'] == child['id'])
        assert renamed['path'] == ['当前根', '发布后的名称']
        for node in nodes:
            if node['primaryNodeId'] in ('missing', 'cycle-a', 'cycle-b', 'self', 'hidden-parent'):
                assert node['parentId'] is None and node['parentNodeId'] is None
                assert node['path'] == [node['title']]


def test_empty_published_catalog_reports_zero_without_fabricating_nodes(catalog):
    from app.services.knowledge_dashboard_service import get_universe

    async def read_empty():
        async with AsyncSessionLocal() as db:
            # This transaction is rolled back; other seeded catalog data stays intact.
            await db.execute(update(ContentSubject).values(status='inactive'))
            result = await get_universe(db, catalog['owners'][0])
            await db.rollback()
            return result
    body = asyncio.run(read_empty())
    assert body['nodes'] == [] and body['subjects'] == []
    assert body['topicCount'] == body['practicedTopicCount'] == body['unpracticedTopicCount'] == 0


def test_universe_scans_every_owner_session_beyond_first_hundred(catalog):
    async def seed_history():
        async with AsyncSessionLocal() as db:
            for index in range(105):
                db.add(PracticeSession(id=f"{catalog['prefix']}-history-{index}",
                    owner_id=catalog['owners'][0], mode='practice', status='completed',
                    answers={'q': {'acceptedAt': NOW.isoformat()}},
                    question_order=[{'questionId': 'q', 'questionSnapshot': {
                        'metadata': {'knowledge': {'taxonomyId': catalog['taxonomies']['current'],
                                                  'primaryNodeId': 'n1'}}}}],
                    runtime_state={}, stats={}, scoring_snapshot={}))
            await db.commit()
    asyncio.run(seed_history())
    with TestClient(app) as client:
        login(client, catalog['owners'][0])
        body = read_universe(client)
        assert body['attemptCount'] == body['recentAttemptCount'] == 105
        assert body['practicedTopicCount'] == 1
        practiced = next(n for n in body['nodes'] if n['practiced'])
        assert practiced['primaryNodeId'] == 'n1' and practiced['attemptCount'] == 105


@pytest.mark.parametrize('pointer', ['missing', 'draft', 'archived', 'cross-subject', None])
def test_invalid_current_pointer_falls_back_to_latest_published(catalog, pointer):
    async def change_pointer():
        async with AsyncSessionLocal() as db:
            subject = await db.get(ContentSubject, catalog['subjects']['main'])
            target = catalog['taxonomies'].get(pointer, 'absent')
            if pointer == 'cross-subject':
                target = catalog['taxonomies']['fallback']
            subject.content_metadata = {'currentTaxonomyId': target} if pointer else {}
            await db.commit()
    asyncio.run(change_pointer())
    with TestClient(app) as client:
        login(client, catalog['owners'][0])
        nodes = [n for n in read_universe(client)['nodes'] if n['subjectId'] == catalog['subjects']['main']]
        assert len(nodes) == 1
        assert nodes[0]['taxonomyId'] == catalog['taxonomies']['newer']
        assert nodes[0]['title'] == '仅-newer'


def test_only_valid_owner_answers_overlay_exact_current_nodes_and_keep_history_counts(catalog):
    tax = catalog['taxonomies']['current']

    def snapshot(node='n1', taxonomy=tax, path=None):
        return {'subject': 'old-subject-label', 'stem': 'SECRET QUESTION', 'correctAnswer': 'SECRET ANSWER',
                'metadata': {'knowledge': {'taxonomyId': taxonomy, 'primaryNodeId': node,
                                          'pathSnapshot': path or ['旧根', '旧名称']}}}

    def answer(days=0, **extra):
        return {'correct': True, 'submittedAt': (NOW-timedelta(days=days)).isoformat(), **extra}

    async def seed_history():
        async with AsyncSessionLocal() as db:
            snapshots = {
                'new-path': snapshot(path=['新冻结名称']), 'old-path': snapshot(),
                'old-practice': snapshot('n3'), 'half-age': snapshot('n4'),
                'unmapped': snapshot('deleted'), 'old-tree': snapshot('n1', catalog['taxonomies']['newer']),
                'unknown': {}, 'draft': snapshot('n2'), 'timeout': snapshot('n2'),
                'no-time': snapshot('n2'), 'future': snapshot('n2'), 'invalid-time': snapshot('n2'),
                'wrong-type': snapshot('n2'),
            }
            answers = {key: answer() for key in snapshots}
            answers.update({'old-path': answer(60), 'old-practice': answer(60), 'half-age': answer(15),
                            'draft': answer(draft=True), 'timeout': answer(timedOut=True),
                            'no-time': {'correct': True}, 'future': answer(-1),
                            'invalid-time': {'correct': True, 'submittedAt': 'bad-date'},
                            'wrong-type': 'bad-answer', 'missing-snapshot': answer(),
                            'outside-order': answer()})
            db.add(PracticeSession(id=f"{catalog['prefix']}-a", owner_id=catalog['owners'][0],
                mode='practice', status='completed', answers=answers,
                question_order=[{'questionId': key, 'questionSnapshot': value} for key, value in snapshots.items()]
                               + [{'questionId': 'missing-snapshot'}],
                runtime_state={}, stats={}, scoring_snapshot={}))
            db.add(PracticeSession(id=f"{catalog['prefix']}-b", owner_id=catalog['owners'][1],
                mode='practice', status='completed', answers={'q': answer()},
                question_order=[{'questionId': 'q', 'questionSnapshot': snapshot('n2')}],
                runtime_state={}, stats={}, scoring_snapshot={}))
            db.add(PaperRelease(id=catalog['prefix'], paper_id=catalog['prefix'], version=1,
                                status='published', name='Frozen fixture', subject='PMP',
                                publisher_id=catalog['owners'][0]))
            await db.flush()
            db.add(PaperReleaseQuestion(release_id=catalog['prefix'], order_index=1,
                question_id='frozen-q', bank_id='absent-private-bank', snapshot=snapshot('n5')))
            db.add(PracticeSession(id=f"{catalog['prefix']}-frozen", owner_id=catalog['owners'][0],
                release_id=catalog['prefix'], mode='practice', status='completed',
                answers={'frozen-q': {'acceptedAt': NOW.isoformat()}},
                question_order=[{'questionId': 'frozen-q'}], runtime_state={}, stats={}, scoring_snapshot={}))
            await db.commit()
    asyncio.run(seed_history())
    with TestClient(app) as client:
        login(client, catalog['owners'][0])
        body = read_universe(client)
        nodes = {n['primaryNodeId']: n for n in own_nodes(body, catalog)
                 if n['taxonomyId'] == tax}
        assert body['attemptCount'] == 9
        assert body['recentAttemptCount'] == 6
        assert body['unknownAttemptCount'] == 2
        assert body['unmappedAttemptCount'] == 2
        assert body['practicedTopicCount'] == 4
        assert body['unpracticedTopicCount'] == body['topicCount'] - 4
        assert nodes['n1']['attemptCount'] == 2 and nodes['n1']['brightness'] == 1
        assert nodes['n1']['title'] == '当前节点1' and nodes['n1']['path'] == ['当前根', '当前节点1']
        assert nodes['n1']['lastPracticedAt'] == NOW.isoformat()
        assert nodes['n3']['brightness'] == .4 and nodes['n4']['brightness'] == .7
        assert nodes['n5']['practiced'] is True
        assert nodes['n2']['brightness'] == .12 and not nodes['n2']['practiced']
        assert 'SECRET' not in str(body) and 'private-bank' not in str(body)
        subject = next(s for s in body['subjects'] if s['id'] == catalog['subjects']['main'])
        assert subject['practicedTopicCount'] == 4 and subject['unpracticedTopicCount'] == 126
        history = client.get('/api/v1/learning/practice/knowledge-dashboard?pageSize=1').json()
        assert history['attemptCount'] == 9 and history['unknownAttemptCount'] == 2
        assert history['topicCount'] == 7 and len(history['nodes']) == 1
        assert history['brightnessMeaning'] == 'practice-recency' and history['hasMore'] is True
        assert 'practicedTopicCount' not in history
        login(client, catalog['owners'][1])
        other = read_universe(client)
        assert other['attemptCount'] == other['practicedTopicCount'] == 1
        assert [n['primaryNodeId'] for n in other['nodes'] if n['practiced']] == ['n2']
