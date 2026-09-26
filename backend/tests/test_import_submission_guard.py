import asyncio
from uuid import uuid4

import httpx
import pytest
from fastapi import HTTPException

from app.core.auth import get_current_user
from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.user import User
from app.services import idempotency_service


def import_lock(actor):
    guard = getattr(idempotency_service, 'import_lock', None)
    assert callable(guard), 'Imports need a cross-process, actor-scoped concurrency guard'
    return guard(actor)


def test_import_lock_survives_business_commit_rejects_overlap_and_releases_on_failure():
    async def scenario():
        actor = 'import-test-' + uuid4().hex
        with pytest.raises(ValueError, match='failed import'):
            async with import_lock(actor):
                async with AsyncSessionLocal() as business_db:
                    await business_db.commit()
                with pytest.raises(HTTPException) as rejected:
                    async with import_lock(actor):
                        pytest.fail('duplicate import entered the business operation')
                assert rejected.value.status_code == 409
                assert rejected.value.detail['code'] == 'IMPORT_IN_PROGRESS'
                async with import_lock(actor + '-other'):
                    pass
                raise ValueError('failed import')
        async with import_lock(actor):
            pass
    asyncio.run(scenario())


def test_bulk_import_routes_reject_overlap_before_business_work():
    actor = User(username='import-test-' + uuid4().hex, role='admin', status='active')
    async def current_user():
        return actor
    async def scenario():
        app.dependency_overrides[get_current_user] = current_user
        try:
            async with import_lock(actor.username):
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
                    for path in [
                        '/api/v1/banks/import', '/api/v1/banks/test/questions/import',
                        '/api/v1/papers/import', '/api/v1/papers/import/preflight',
                        '/api/v1/content-prep/principles/import',
                        '/api/v1/content-prep/principle-merges/preview',
                        '/api/v1/content-prep/principle-merges/apply',
                        '/api/v1/content-prep/activities/import',
                        '/api/v1/content-prep/batches', '/api/v1/users/import',
                        '/api/v1/files/import-legacy',
                        '/api/v1/content-prep/drafts/test/sync',
                    ]:
                        response = await client.post(path, json={})
                        assert response.status_code == 409, (path, response.text)
                        assert response.json()['detail']['code'] == 'IMPORT_IN_PROGRESS'
                    for path in ['/api/v1/content-prep/shared-content', '/api/v1/content-prep/recall-libraries/subject-pmp']:
                        response = await client.put(path, json={})
                        assert response.status_code == 409, (path, response.text)
                    response = await client.post('/api/v1/files', json={'source': 'package-import'})
                    assert response.status_code == 409
        finally:
            app.dependency_overrides.pop(get_current_user, None)
    asyncio.run(scenario())
