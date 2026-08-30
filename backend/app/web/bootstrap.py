"""Build request-scoped state before upstream synchronous scripts execute."""

from __future__ import annotations

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.services import user_service


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

    user = await optional_user(request, db)
    auth_user = user_service.to_dict(user) if user else None
    if auth_user:
        auth_user["loginSessionId"] = get_login_session_id(request)
    return {
        "schemaVersion": 1,
        "releaseVersion": release_version,
        "page": page,
        "authenticated": user is not None,
        "username": user.username if user else None,
        "authUser": auth_user,
        # 关系化图谱 API 的既有开关属于发布配置，不是 Runtime 状态。
        "graphFilesApiCutoverEnabled": settings.GRAPH_FILES_API_CUTOVER_ENABLED,
        "readOnly": read_only,
    }
