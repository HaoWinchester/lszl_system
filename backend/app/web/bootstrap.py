"""Build request-scoped state before upstream synchronous scripts execute."""

from __future__ import annotations

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

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
    # practice-mode 无条目：默认 namespace "page"，与前端 server-state-bootstrap 的派发一致，
    # 否则 validate_update 会以 namespace 不匹配拒绝做题页保存。
    "file-manager.html": "files",
    "user-management.html": "users",
    "system-settings.html": "system",
    "paper-management.html": "papers",
    "content-prep.html": "content",
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
    if not user or user.status != "active":
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
    from app.core.auth import get_login_session_id
    from app.services import runtime_state_service

    user = await optional_user(request, db)
    auth_user = user_service.to_dict(user) if user else None
    if auth_user:
        auth_user["loginSessionId"] = get_login_session_id(request)
    revision = 0
    content_revision = 0
    if user:
        # 快照配对：contentRevision 必须与页面所见状态同一时刻；storage 本身
        # 不内联（体积可达 MB 级），由前端通过 bootstrap API 水合。
        storage, revision, content_revision = await runtime_state_service.get_state(
            db, user.username, user.role
        )
        _, revision, content_revision = await runtime_state_service.ensure_domain_seed(
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
        "contentRevision": content_revision,
        "readOnly": read_only,
    }
