"""Explicit UAT fixtures exercise the real frozen-session knowledge overlay."""
import asyncio
import importlib
from copy import deepcopy
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select

from app.core.config import settings
from app.core.security import hash_password, verify_password
from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.teaching_content import ContentSubject, ContentTaxonomy, TaxonomyNode
from app.models.training import PracticeSession
from app.models.user import User
from app.services.knowledge_dashboard_service import get_universe


@pytest.fixture
def demo_catalog(monkeypatch):
    monkeypatch.setattr(settings, 'ENV', 'uat')
    token = uuid4().hex[:10]
    username = f'uat-knowledge-demo-{token}'
    taxonomy_id = f'uat-demo-tax-{token}'
    other = f'uat-demo-other-{token}'
    original_metadata = None

    async def seed():
        nonlocal original_metadata
        async with AsyncSessionLocal() as db:
            subject = await db.scalar(select(ContentSubject).where(ContentSubject.code == 'PMP'))
            original_metadata = deepcopy(subject.content_metadata)
            subject.content_metadata = {**(subject.content_metadata or {}), 'currentTaxonomyId': taxonomy_id}
            db.add(ContentTaxonomy(id=taxonomy_id, subject_id=subject.id,
                                  version=99999, status='published', title='UAT测试树'))
            db.add(User(username=other, password_hash=hash_password('other-pass'), role='student'))
            await db.flush()
            db.add(TaxonomyNode(id=f'{token}-root', taxonomy_id=taxonomy_id,
                                node_id='root', title='PMP'))
            for category, title in enumerate(('人', '过程', '环境')):
                parent = f'category-{category}'
                db.add(TaxonomyNode(id=f'{token}-{parent}', taxonomy_id=taxonomy_id,
                    node_id=parent, parent_node_id='root', title=title, position=category))
                for index in range(8):
                    node = f'{parent}-leaf-{index}'
                    db.add(TaxonomyNode(id=f'{token}-{node}', taxonomy_id=taxonomy_id,
                        node_id=node, parent_node_id=parent, title=f'{title}考点{index}', position=index))
            await db.commit()

    async def cleanup():
        async with AsyncSessionLocal() as db:
            subject = await db.scalar(select(ContentSubject).where(ContentSubject.code == 'PMP'))
            subject.content_metadata = original_metadata
            await db.execute(delete(PracticeSession).where(PracticeSession.owner_id.in_([username, other])))
            await db.execute(delete(User).where(User.username.in_([username, other])))
            await db.execute(delete(ContentTaxonomy).where(ContentTaxonomy.id == taxonomy_id))
            await db.commit()

    asyncio.run(seed())
    try:
        yield {'username': username, 'taxonomyId': taxonomy_id, 'other': other}
    finally:
        asyncio.run(cleanup())


def service():
    return importlib.import_module('app.services.uat_knowledge_demo_service')


def test_non_uat_and_non_demo_accounts_are_rejected_before_database_access(monkeypatch):
    module = service()
    monkeypatch.setattr(settings, 'ENV', 'production')
    with pytest.raises(ValueError, match='UAT'):
        asyncio.run(module.prepare(None, apply=True))
    monkeypatch.setattr(settings, 'ENV', 'uat')
    with pytest.raises(ValueError, match='dedicated'):
        asyncio.run(module.prepare(None, username='admin', apply=True))


def test_dry_run_does_not_create_user_or_sessions(demo_catalog):
    async def run():
        async with AsyncSessionLocal() as db:
            plan = await service().prepare(db, username=demo_catalog['username'])
            assert plan['applied'] is False and plan['sessionsToAdd'] == 18
            assert plan['attemptsToAdd'] == 156
            assert plan['attemptCounts'] == [1, 5, 20]
            assert await db.get(User, demo_catalog['username']) is None
            assert await db.scalar(select(func.count()).select_from(PracticeSession).where(
                PracticeSession.owner_id == demo_catalog['username'])) == 0
            assert 'password' not in str(plan).lower() and 'stem' not in str(plan)
    asyncio.run(run())


def test_apply_is_idempotent_owner_isolated_and_keeps_existing_password(demo_catalog):
    async def run():
        async with AsyncSessionLocal() as db:
            before_other = await get_universe(db, demo_catalog['other'])
            result = await service().prepare(db, username=demo_catalog['username'],
                password='demo-secret', apply=True)
            assert result['sessionsToAdd'] == 18 and result['attemptsToAdd'] == 156
            own = await get_universe(db, demo_catalog['username'])
            nodes = [n for n in own['nodes'] if n['taxonomyId'] == demo_catalog['taxonomyId']]
            assert own['attemptCount'] == 156 and own['unknownAttemptCount'] == own['unmappedAttemptCount'] == 0
            assert sum(n['practiced'] for n in nodes) == 18
            assert {n['attemptCount'] for n in nodes} == {0, 1, 5, 20}
            assert {n['path'][1] for n in nodes if n['practiced']} == {'人', '过程', '环境'}
            assert any(not n['practiced'] for n in nodes if len(n['path']) == 3)
            again = await service().prepare(db, username=demo_catalog['username'],
                password='must-not-reset', apply=True)
            assert again['sessionsToAdd'] == again['attemptsToAdd'] == 0
            user = await db.get(User, demo_catalog['username'])
            assert verify_password('demo-secret', user.password_hash)
            after_other = await get_universe(db, demo_catalog['other'])
            assert after_other['attemptCount'] == before_other['attemptCount'] == 0
            assert after_other['practicedTopicCount'] == before_other['practicedTopicCount'] == 0
    asyncio.run(run())
    with TestClient(app) as client:
        assert client.post('/api/v1/auth/login', json={
            'username': demo_catalog['username'], 'password': 'demo-secret'}).status_code == 200
        response = client.get('/api/v1/learning/practice/knowledge-universe')
        assert response.status_code == 200 and response.json()['attemptCount'] == 156


def test_existing_non_seed_identity_and_missing_password_are_never_overwritten(demo_catalog):
    async def run():
        async with AsyncSessionLocal() as db:
            with pytest.raises(ValueError, match='password'):
                await service().prepare(db, username=demo_catalog['username'], apply=True)
            assert await db.get(User, demo_catalog['username']) is None
            db.add(User(username=demo_catalog['username'], password_hash=hash_password('real-pass'),
                        role='student', source='self-register'))
            await db.commit()
            with pytest.raises(ValueError, match='identity'):
                await service().prepare(db, username=demo_catalog['username'], password='new-pass', apply=True)
            user = await db.get(User, demo_catalog['username'])
            assert verify_password('real-pass', user.password_hash)
            assert await db.scalar(select(func.count()).select_from(PracticeSession).where(
                PracticeSession.owner_id == demo_catalog['username'])) == 0
    asyncio.run(run())


def test_fixture_collision_is_rejected_and_completed_details_have_frozen_reports(demo_catalog):
    async def run():
        async with AsyncSessionLocal() as db:
            await service().prepare(db, username=demo_catalog['username'], password='demo-secret', apply=True)
            session = await db.scalar(select(PracticeSession).where(
                PracticeSession.owner_id == demo_catalog['username']).order_by(PracticeSession.id))
            assert session.status == 'completed' and session.release_id is None
            assert session.report_snapshot['paperName'].startswith('[UAT')
            assert len(session.report_snapshot['answers']) == len(session.question_order)
            from app.services.practice_session_service import get_report, get_session
            user = await db.get(User, demo_catalog['username'])
            assert (await get_report(db, user.username, session.id))['sessionId'] == session.id
            detail = await get_session(db, user.username, session.id)
            assert detail['status'] == 'completed' and len(detail['questions']) == len(session.question_order)
            session.answers = {}
            await db.commit()
            with pytest.raises(ValueError, match='fixture'):
                await service().prepare(db, username=demo_catalog['username'], apply=True)
    asyncio.run(run())


def test_retry_only_recreates_missing_seed_record(demo_catalog):
    async def run():
        async with AsyncSessionLocal() as db:
            await service().prepare(db, username=demo_catalog['username'], password='demo-secret', apply=True)
            row = await db.scalar(select(PracticeSession).where(
                PracticeSession.owner_id == demo_catalog['username']))
            count = len(row.answers)
            await db.delete(row)
            await db.commit()
            repaired = await service().prepare(db, username=demo_catalog['username'], apply=True)
            assert repaired['sessionsToAdd'] == 1 and repaired['attemptsToAdd'] == count
            assert (await get_universe(db, demo_catalog['username']))['attemptCount'] == 156
    asyncio.run(run())
