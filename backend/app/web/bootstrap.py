"""Build request-scoped state before upstream synchronous scripts execute."""

from __future__ import annotations

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import ACTIVE
from app.services import user_service

PAGE_NAMESPACES = {
    "index.html": "files",
    "learning-path.html": "guided-learning",
    "guided-learning-node.html": "guided-learning",
    "guided-learning-placement-test.html": "guided-learning",
    "question-training.html": "training",
    "question-workspace.html": "workspace",
    "question-bank.html": "questions",
    "knowledge-recall.html": "recall",
    "file-manager.html": "files",
    "user-management.html": "users",
    "system-settings.html": "system",
    "paper-management.html": "papers",
    "content-prep.html": "content-prep",
    "course-admin.html": "courses",
    "content-center.html": "content",
    "teacher-workbench.html": "teacher",
    "admin-console.html": "admin",
    "admin-operations.html": "operations",
    "admin-settings.html": "admin",
    "admin-subjects.html": "subjects",
}


async def optional_user(request: Request, db: AsyncSession):
    username = request.session.get("username")
    if not username:
        return None
    user = await user_service.get_by_username(db, str(username))
    if not user or user.status != ACTIVE:
        request.session.clear()
        return None
    return user


async def build_bootstrap(
    request: Request,
    db: AsyncSession,
    *,
    page: str,
    release_version: str,
    read_only: bool = False,
) -> dict:
    user = await optional_user(request, db)
    auth_user = user_service.to_dict(user) if user else None
    storage: dict[str, str] = {}
    revision = 0
    if user:
        from app.services import runtime_state_service

        storage, revision = await runtime_state_service.get_state(
            db, user.username, user.role
        )
        storage, revision = await runtime_state_service.ensure_domain_seed(
            db, user, page, storage, revision
        )
    return {
        "schemaVersion": 1,
        "releaseVersion": release_version,
        "page": page,
        "namespace": PAGE_NAMESPACES.get(page, "page"),
        "authenticated": user is not None,
        "username": user.username if user else None,
        "authUser": auth_user,
        "revision": revision,
        "readOnly": read_only,
        "storage": storage,
    }
