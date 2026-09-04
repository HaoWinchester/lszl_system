"""Authentication endpoints used only by the native WeChat mini program."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser, get_login_session_id
from app.core.legal import accepted_legal_consent
from app.db.session import get_db
from app.schemas.wechat_mini import (
    MiniBindRequest,
    MiniRegisterRequest,
    MiniWechatLoginRequest,
)
from app.services import user_service, wechat_mini_service

router = APIRouter(prefix="/auth/mini", tags=["mini-auth"])
DB = Annotated[AsyncSession, Depends(get_db)]


def _client_info(request: Request) -> tuple[str | None, str | None]:
    return (
        request.client.host if request.client else None,
        request.headers.get("user-agent"),
    )


def _error(exc: wechat_mini_service.MiniAuthError) -> HTTPException:
    return HTTPException(
        status_code=exc.status_code,
        detail={"code": exc.code, "message": exc.message},
    )


def _session_payload(issued: wechat_mini_service.IssuedMiniSession) -> dict:
    return {
        "status": "authenticated",
        "token": issued.token,
        "expiresAt": issued.expires_at.isoformat(),
        "loginSessionId": issued.login_session_id,
        "user": user_service.to_dict(issued.user),
    }


def _legal_version(value: str | None) -> str | None:
    try:
        return accepted_legal_consent(value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/wechat/login")
async def login(req: MiniWechatLoginRequest, db: DB):
    try:
        outcome = await wechat_mini_service.exchange_login_code(
            db, req.code, req.client.model_dump(exclude_none=True)
        )
    except wechat_mini_service.MiniAuthError as exc:
        raise _error(exc) from exc
    if outcome.session:
        return _session_payload(outcome.session)
    return {
        "status": "binding_required",
        "bindingTicket": outcome.binding_ticket,
        "expiresAt": outcome.expires_at.isoformat() if outcome.expires_at else None,
    }


@router.post("/bind")
async def bind(req: MiniBindRequest, request: Request, db: DB):
    accepted_version = _legal_version(req.accepted_terms_version)
    try:
        issued = await wechat_mini_service.bind_existing_account(
            db,
            req.binding_ticket,
            req.username,
            req.password,
            req.client.model_dump(exclude_none=True),
        )
    except wechat_mini_service.MiniAuthError as exc:
        raise _error(exc) from exc
    user_service.record_legal_consent(issued.user, accepted_version)
    ip, ua = _client_info(request)
    await user_service.log_action(
        db,
        "wechat_mini_bind",
        issued.user.username,
        issued.user.username,
        "小程序绑定现有账号",
        ip,
        ua,
    )
    await db.commit()
    await db.refresh(issued.user)
    return _session_payload(issued)


@router.post("/register")
async def register(req: MiniRegisterRequest, request: Request, db: DB):
    accepted_version = _legal_version(req.accepted_terms_version)
    try:
        issued = await wechat_mini_service.register_account(
            db,
            req.binding_ticket,
            username=req.username,
            password=req.password,
            display_name=req.display_name,
            subject=req.subject,
            accepted_terms_version=accepted_version or "",
            client_metadata=req.client.model_dump(exclude_none=True),
        )
    except wechat_mini_service.MiniAuthError as exc:
        raise _error(exc) from exc
    ip, ua = _client_info(request)
    await user_service.log_action(
        db,
        "wechat_mini_login",
        issued.user.username,
        issued.user.username,
        "小程序注册后登录",
        ip,
        ua,
    )
    await db.commit()
    return _session_payload(issued)


@router.get("/session")
async def current_session(request: Request, user: CurrentUser):
    return {
        "status": "authenticated",
        "loginSessionId": get_login_session_id(request),
        "user": user_service.to_dict(user),
    }


@router.post("/logout")
async def logout(request: Request, user: CurrentUser, db: DB):
    authorization = request.headers.get("authorization", "")
    raw_token = authorization[6:].strip() if authorization.lower().startswith("bearer") else ""
    if not raw_token or not await wechat_mini_service.revoke_session_token(db, raw_token):
        raise HTTPException(status_code=401, detail="小程序会话已失效，请重新登录")
    ip, ua = _client_info(request)
    await user_service.log_action(
        db, "wechat_mini_logout", user.username, user.username, "小程序退出登录", ip, ua
    )
    await db.commit()
    return {"ok": True}
