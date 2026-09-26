"""Shared admission control for bulk import endpoints."""
from fastapi import Request
from app.core.auth import CurrentUser
from app.services.idempotency_service import import_lock


async def import_submission_guard(user: CurrentUser):
    async with import_lock(user.username):
        yield


async def file_import_submission_guard(request: Request, user: CurrentUser):
    body = await request.json()
    if isinstance(body, dict) and body.get('source') in {'import', 'imported', 'package-import'}:
        async with import_lock(user.username):
            yield
    else:
        yield
