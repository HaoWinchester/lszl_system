"""认证依赖：从 session 取当前用户、角色鉴权。

session 由 starlette SessionMiddleware（itsdangerous 签名 cookie）提供，
request.session 是 dict，登录时写入 username，登出时清空。
"""

import secrets
from typing import Annotated, Callable

from fastapi import Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.core.permissions import can
from app.models.user import ACTIVE, User
from app.services import user_service
from app.services import wechat_mini_service


def _authorization_header(request: Request) -> str:
    """Read Authorization without assuming a fully populated ASGI scope."""

    for raw_name, raw_value in request.scope.get("headers", ()):
        if raw_name.lower() == b"authorization":
            return raw_value.decode("latin-1")
    return ""


def establish_authenticated_session(request: Request, username: str) -> str:
    """Replace the signed browser session after a successful authentication."""

    login_session_id = secrets.token_urlsafe(24)
    request.session.clear()
    request.session["username"] = username
    request.session["login_session_id"] = login_session_id
    return login_session_id


def get_login_session_id(request: Request) -> str:
    """Return the existing login identity, upgrading legacy valid sessions once."""

    bearer_session_id = getattr(request.state, "login_session_id", None)
    if getattr(request.state, "auth_transport", None) == "bearer" and bearer_session_id:
        return str(bearer_session_id)

    login_session_id = request.session.get("login_session_id")
    if isinstance(login_session_id, str) and login_session_id:
        return login_session_id
    login_session_id = secrets.token_urlsafe(24)
    request.session["login_session_id"] = login_session_id
    return login_session_id


async def get_current_user(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    authorization = _authorization_header(request)
    if authorization.lower().startswith("bearer"):
        raw_token = authorization[6:].strip()
        request.state.auth_transport = "bearer"
        resolved = await wechat_mini_service.resolve_session(db, raw_token)
        if not resolved:
            raise HTTPException(status_code=401, detail="小程序会话已失效，请重新登录")
        request.state.login_session_id = resolved.login_session_id
        return resolved.user

    request.state.auth_transport = "cookie"
    username = request.session.get("username")
    if not username:
        raise HTTPException(status_code=401, detail="未登录")
    user = await user_service.get_by_username(db, username)
    if not user or user.status != ACTIVE:
        request.session.clear()
        raise HTTPException(status_code=401, detail="会话已失效，请重新登录")
    return user


async def optional_current_user(request: Request, db: AsyncSession) -> User | None:
    """Resolve an active session when present without requiring authentication."""

    authorization = _authorization_header(request)
    if authorization.lower().startswith("bearer"):
        raw_token = authorization[6:].strip()
        request.state.auth_transport = "bearer"
        resolved = await wechat_mini_service.resolve_session(db, raw_token)
        if not resolved:
            raise HTTPException(status_code=401, detail="小程序会话已失效，请重新登录")
        request.state.login_session_id = resolved.login_session_id
        return resolved.user

    request.state.auth_transport = "cookie"

    username = request.session.get("username")
    if not username:
        return None
    user = await user_service.get_by_username(db, str(username))
    if not user or user.status != ACTIVE:
        request.session.clear()
        return None
    return user


def require_role(*roles: str) -> Callable:
    """角色鉴权依赖工厂：require_role('admin') 或 require_role('admin','teacher')。"""

    async def _dependency(user: Annotated[User, Depends(get_current_user)]) -> User:
        if roles and user.role not in roles:
            raise HTTPException(status_code=403, detail="当前角色无权限执行此操作")
        return user

    return _dependency


def require_permissions(*permission_names: str) -> Callable:
    """Require every named capability from the server-side role matrix."""

    async def _dependency(user: Annotated[User, Depends(get_current_user)]) -> User:
        missing = [name for name in permission_names if not can(user.role, name)]
        if missing:
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "PERMISSION_DENIED",
                    "message": "当前账号缺少所需权限",
                    "permissions": missing,
                },
            )
        return user

    return _dependency


# 便捷类型别名
CurrentUser = Annotated[User, Depends(get_current_user)]
