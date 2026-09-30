"""Catalog filters must operate on permitted releases before pagination."""
import asyncio
from datetime import timedelta
from uuid import uuid4

from sqlalchemy import delete
from fastapi.testclient import TestClient
from app.main import app
from app.core.security import now_utc
from app.db.session import AsyncSessionLocal
from app.models.paper_release import PaperRelease
from app.models.user import User
from app.services.paper_release_service import catalog


def test_catalog_search_permissions_totals_subjects_and_membership():
    token = uuid4().hex[:12]
    subject = f'catalog-{token}'
    hidden_subject = f'private-{token}'
    async def run():
        async with AsyncSessionLocal() as db:
            owner = User(username=f'cat-{token}', password_hash='unused', role='admin', status='active')
            db.add(owner)
            await db.flush()
            for i in range(24):
                db.add(PaperRelease(id=f'{token}-{i}', paper_id=f'{token}-p{i}', version=1,
                    name=f'目录 {i}', subject=hidden_subject if i == 23 else subject,
                    description='Needle_%' if i >= 20 else '普通', publisher_id=owner.username,
                    allowed_roles=['teacher'] if i == 23 else ['student'],
                    access_level='member' if i == 22 else 'free',
                    published_at=now_utc()-timedelta(minutes=i)))
            await db.commit()
            try:
                first = await catalog(db, None, page=1, page_size=20, subject=subject)
                assert first['total'] == 23
                assert len(first['releases']) == 20
                result = await catalog(db, None, page=1, page_size=1, search='Needle_%', subject=subject)
                assert result['total'] == 3
                assert result['releases'][0]['releaseId'] == f'{token}-20'
                assert subject in result['subjects'] and hidden_subject not in result['subjects']
                member = await catalog(db, None, page=1, page_size=20, search='needle_%', subject=subject, access='member')
                assert member['total'] == 1 and member['releases'][0]['contentRestricted'] is True
                assert (await catalog(db, None, page=1, page_size=20, search=hidden_subject))['total'] == 0
                student = User(username=owner.username, role='student')
                learner = await catalog(db, student, page=1, page_size=20, search='Needle_%')
                assert learner['total'] == 3 and hidden_subject not in learner['subjects']
                assert (await catalog(db, student, page=1, page_size=20, search='目录 21'))['total'] == 1
                assert (await catalog(db, student, page=1, page_size=20, search=subject))['total'] == 23
                admin = await catalog(db, owner, page=1, page_size=20, search='Needle_%')
                assert admin['total'] == 4
                assert hidden_subject in admin['subjects']
                assert all(not row.get('contentRestricted', False) for row in admin['releases'])
                literal = await catalog(db, None, page=1, page_size=20, search='NeedleX%', subject=subject)
                assert literal['total'] == 0
                with TestClient(app) as client:
                    response = client.get('/api/v1/paper-releases/catalog', params={'search':'Needle_%','subject':subject,'access':'free','pageSize':1})
                    assert response.status_code == 200
                    assert response.json()['total'] == 2
            finally:
                await db.execute(delete(PaperRelease).where(PaperRelease.publisher_id == owner.username))
                await db.delete(owner)
                await db.commit()
    asyncio.run(run())
