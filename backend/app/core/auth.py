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
from app.core.security import now_utc
from app.models.user import ACTIVE, User
from app.services import browser_session_service, user_service
from app.services import wechat_mini_service


def _authorization_header(request: Request) -> str:
    """Read Authorization without assuming a fully populated ASGI scope."""

    for raw_name, raw_value in request.scope.get("headers", ()):
        if raw_name.lower() == b"authorization":
            return raw_value.decode("latin-1")
    return ""


async def establish_authenticated_session(request: Request, username: str, db: AsyncSession) -> str:
    """Replace the signed browser session after a successful authentication."""

    await browser_session_service.revoke(db, request)
    await db.commit()
    login_session_id = secrets.token_urlsafe(24)
    request.session.clear()
    request.session["username"] = username
    request.session["login_session_id"] = login_session_id
    return login_session_id


def record_wechat_password_proof(request: Request, username: str, authenticated_at: float | None = None) -> None:
    """Only call after successful official WeChat authentication, never a demo/bind."""
    request.session["wechat_password_proof"] = {
        "username": username,
        "authenticated_at": authenticated_at if authenticated_at is not None else now_utc().timestamp(),
    }


def has_recent_wechat_password_proof(request: Request, username: str) -> bool:
    # A mini-program bearer must never inherit an unrelated browser cookie proof.
    if getattr(request.state, "auth_transport", None) != "cookie":
        return False
    proof = request.session.get("wechat_password_proof")
    if not isinstance(proof, dict) or proof.get("username") != username:
        return False
    authenticated_at = proof.get("authenticated_at")
    if not isinstance(authenticated_at, (int, float)) or isinstance(authenticated_at, bool):
        return False
    return 0 <= now_utc().timestamp() - authenticated_at <= 600


def get_login_session_id(request: Request) -> str:
    """Return the existing login identity, upgrading legacy valid sessions once."""

    bearer_session_id = getattr(request.state, "login_session_id", None)
    if getattr(request.state, "auth_transport", None) == "bearer" and bearer_session_id:
        return str(bearer_session_id)

    login_session_id = request.session.get("login_session_id")
    if isinstance(login_session_id, str) and login_session_id:
        return login_session_id
    login_session_id = browser_session_service.identity(request) or secrets.token_urlsafe(24)
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

    had_session = bool(request.session.get("username"))
    user = await optional_cookie_user(request, db)
    if user is None:
        detail = "会话已失效，请重新登录" if had_session else "未登录"
        raise HTTPException(status_code=401, detail=detail)
    expected_identity = next((value.decode("latin-1") for name, value in request.scope.get("headers", ())
                              if name.lower() == b"x-kg-login-session-id"), None)
    if expected_identity is not None and expected_identity != browser_session_service.identity(request):
        # A stale classroom must never save under another tab's new account.
        # Leave the actual cookie untouched so that account remains signed in.
        raise HTTPException(status_code=401, detail={
            "code": "LOGIN_SESSION_CHANGED", "message": "登录账号已变化，请重新登录",
        })
    return user


async def optional_cookie_user(request: Request, db: AsyncSession) -> User | None:
    """Resolve only the browser cookie, sharing revocation with page bootstrap."""
    request.state.auth_transport = "cookie"
    username = request.session.get("username")
    if not username:
        return None
    user = await user_service.get_by_username(db, str(username))
    if not user or user.status != ACTIVE:
        # Retaining a rejected cookie must not revive it after reactivation.
        await browser_session_service.revoke(db, request)
        await db.commit()
    elif not await browser_session_service.is_revoked(db, request):
        return user
    request.session.clear()
    # A late rejected read cannot delete a newer successful login's cookie.
    # Explicit route cookies, particularly /logout deletion, are preserved.
    request.scope["_kg_rejected_session"] = True
    return None

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

    return await optional_cookie_user(request, db)


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

# Shared mutation guard for owned learning canvases.
CanvasWriter = Annotated[User, Depends(require_role("admin", "teacher", "student"))]
