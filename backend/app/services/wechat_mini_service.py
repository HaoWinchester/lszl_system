"""Native WeChat mini-program code exchange, account binding, and sessions."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import secrets
from typing import Literal
from uuid import uuid4

import httpx
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import hash_password, now_utc, verify_password
from app.models.user import ACTIVE, User
from app.models.wechat_mini import WechatMiniAuthTicket, WechatMiniSession
from app.services import user_service


class MiniAuthError(RuntimeError):
    def __init__(self, code: str, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


@dataclass(frozen=True)
class IssuedBindingTicket:
    raw_ticket: str
    expires_at: datetime


@dataclass(frozen=True)
class IssuedMiniSession:
    token: str
    login_session_id: str
    expires_at: datetime
    user: User


@dataclass(frozen=True)
class MiniLoginOutcome:
    status: Literal["binding_required", "authenticated"]
    binding_ticket: str | None = None
    expires_at: datetime | None = None
    session: IssuedMiniSession | None = None


def hash_secret(raw_secret: str) -> str:
    return hashlib.sha256(raw_secret.encode("utf-8")).hexdigest()


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat()


def _metadata(value: dict | None) -> dict:
    allowed = ("platform", "model", "system", "version")
    return {
        key: str((value or {}).get(key) or "")[:80]
        for key in allowed
        if str((value or {}).get(key) or "").strip()
    }


async def exchange_code(code: str) -> dict:
    """Exchange a one-time wx.login code without exposing the session key."""

    if settings.ENV != "prod" and settings.WECHAT_MINI_ENABLE_DEMO is True:
        return {"openid": "wechat_mini_demo_openid", "unionid": "wechat_mini_demo_unionid"}
    if not settings.WECHAT_MINI_APP_ID or not settings.WECHAT_MINI_APP_SECRET:
        raise MiniAuthError("WECHAT_MINI_NOT_CONFIGURED", "微信小程序登录尚未配置", 503)
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(
            "https://api.weixin.qq.com/sns/jscode2session",
            params={
                "appid": settings.WECHAT_MINI_APP_ID,
                "secret": settings.WECHAT_MINI_APP_SECRET,
                "js_code": code,
                "grant_type": "authorization_code",
            },
        )
    try:
        payload = response.json()
    except ValueError as exc:
        raise MiniAuthError("WECHAT_PROVIDER_ERROR", "微信登录服务返回异常", 502) from exc
    if payload.get("errcode") or not payload.get("openid"):
        raise MiniAuthError("WECHAT_CODE_INVALID", "微信登录凭证无效，请重试", 401)
    return {
        "openid": str(payload["openid"]),
        "unionid": str(payload.get("unionid") or ""),
    }


async def find_linked_user(db: AsyncSession, openid: str, unionid: str = "") -> User | None:
    conditions = [User.wechat["miniOpenid"].astext == openid]
    if unionid:
        conditions.append(User.wechat["unionid"].astext == unionid)
    return (await db.execute(select(User).where(or_(*conditions)))).scalar_one_or_none()


async def issue_binding_ticket(
    db: AsyncSession,
    openid: str,
    unionid: str | None = None,
    *,
    expires_at: datetime | None = None,
) -> IssuedBindingTicket:
    raw_ticket = secrets.token_urlsafe(36)
    expiry = expires_at or (
        now_utc() + timedelta(seconds=settings.WECHAT_MINI_BINDING_TICKET_MAX_AGE_SECONDS)
    )
    db.add(
        WechatMiniAuthTicket(
            id=str(uuid4()),
            ticket_digest=hash_secret(raw_ticket),
            openid=openid,
            unionid=unionid or None,
            expires_at=expiry,
        )
    )
    await db.commit()
    return IssuedBindingTicket(raw_ticket=raw_ticket, expires_at=expiry)


def _new_session(user: User, client_metadata: dict | None) -> tuple[WechatMiniSession, IssuedMiniSession]:
    token = secrets.token_urlsafe(48)
    login_session_id = secrets.token_urlsafe(24)
    expiry = now_utc() + timedelta(seconds=settings.WECHAT_MINI_SESSION_MAX_AGE_SECONDS)
    record = WechatMiniSession(
        id=str(uuid4()),
        token_digest=hash_secret(token),
        username=user.username,
        login_session_id=login_session_id,
        expires_at=expiry,
        client_metadata=_metadata(client_metadata),
    )
    return record, IssuedMiniSession(token, login_session_id, expiry, user)


async def issue_session(
    db: AsyncSession, user: User, client_metadata: dict | None
) -> IssuedMiniSession:
    record, issued = _new_session(user, client_metadata)
    db.add(record)
    await db.commit()
    await db.refresh(user)
    return IssuedMiniSession(
        issued.token, issued.login_session_id, issued.expires_at, user
    )


async def _lock_valid_ticket(db: AsyncSession, raw_ticket: str) -> WechatMiniAuthTicket:
    ticket = (
        await db.execute(
            select(WechatMiniAuthTicket)
            .where(WechatMiniAuthTicket.ticket_digest == hash_secret(raw_ticket))
            .with_for_update()
        )
    ).scalar_one_or_none()
    if not ticket or ticket.consumed_at is not None or ticket.expires_at <= now_utc():
        raise MiniAuthError("BINDING_TICKET_INVALID", "绑定凭证已失效，请重新进行微信登录", 401)
    return ticket


def _bind_identity(user: User, ticket: WechatMiniAuthTicket) -> None:
    previous = dict(user.wechat or {})
    now = now_utc()
    previous.update(
        {
            "miniOpenid": ticket.openid,
            "unionid": ticket.unionid or previous.get("unionid", ""),
            "nickname": previous.get("nickname") or user.display_name or "微信用户",
            "avatar": previous.get("avatar") or "",
            "miniBoundAt": previous.get("miniBoundAt") or _iso(now),
            "miniLastLoginAt": _iso(now),
            "source": previous.get("source") or "wechat-mini",
        }
    )
    user.wechat = previous
    user.last_login_at = now
    user.last_active_at = now


async def _assert_identity_available(
    db: AsyncSession, ticket: WechatMiniAuthTicket, username: str
) -> None:
    owner = await find_linked_user(db, ticket.openid, ticket.unionid or "")
    if owner and owner.username != username:
        raise MiniAuthError("WECHAT_ALREADY_BOUND", "该微信已绑定其他账号", 409)


async def bind_existing_account(
    db: AsyncSession,
    raw_ticket: str,
    username: str,
    password: str,
    client_metadata: dict | None,
) -> IssuedMiniSession:
    user = await user_service.get_by_username(db, username.strip())
    if not user or not verify_password(password, user.password_hash):
        raise MiniAuthError("INVALID_CREDENTIALS", "用户名或密码错误", 401)
    if user.status != ACTIVE:
        raise MiniAuthError("ACCOUNT_UNAVAILABLE", "账号已停用或归档，无法登录", 403)
    ticket = await _lock_valid_ticket(db, raw_ticket)
    await _assert_identity_available(db, ticket, user.username)
    _bind_identity(user, ticket)
    ticket.consumed_at = now_utc()
    record, issued = _new_session(user, client_metadata)
    db.add(record)
    await db.commit()
    await db.refresh(user)
    return IssuedMiniSession(issued.token, issued.login_session_id, issued.expires_at, user)


async def register_account(
    db: AsyncSession,
    raw_ticket: str,
    *,
    username: str,
    password: str,
    display_name: str | None,
    subject: str | None,
    accepted_terms_version: str,
    client_metadata: dict | None,
) -> IssuedMiniSession:
    """Create, bind, consume the ticket, and issue a session atomically."""

    normalized_username = username.strip()
    ticket = await _lock_valid_ticket(db, raw_ticket)
    await _assert_identity_available(db, ticket, normalized_username)
    if await user_service.get_by_username(db, normalized_username):
        raise MiniAuthError("ACCOUNT_CREATE_FAILED", "用户名已存在", 400)
    user = User(
        username=normalized_username,
        password_hash=hash_password(password),
        role="student",
        status=ACTIVE,
        display_name=(display_name or "").strip() or None,
        subject=(subject or "PMP").strip() or "PMP",
        tags=[],
        source="wechat-mini-register",
    )
    db.add(user)
    try:
        await db.flush()
        _bind_identity(user, ticket)
        user_service.record_legal_consent(user, accepted_terms_version)
        ticket.consumed_at = now_utc()
        record, issued = _new_session(user, client_metadata)
        db.add(record)
        await user_service.log_action(
            db,
            "wechat_mini_register",
            user.username,
            user.username,
            "小程序创建并绑定学习账号",
        )
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise MiniAuthError("ACCOUNT_CREATE_FAILED", "用户名已存在", 400) from exc
    await db.refresh(user)
    return IssuedMiniSession(issued.token, issued.login_session_id, issued.expires_at, user)


async def exchange_login_code(
    db: AsyncSession, code: str, client_metadata: dict | None
) -> MiniLoginOutcome:
    identity = await exchange_code(code)
    openid = str(identity.get("openid") or "")
    unionid = str(identity.get("unionid") or "")
    if not openid:
        raise MiniAuthError("WECHAT_CODE_INVALID", "微信登录凭证无效，请重试", 401)
    user = await find_linked_user(db, openid, unionid)
    if not user:
        ticket = await issue_binding_ticket(db, openid, unionid)
        return MiniLoginOutcome(
            status="binding_required",
            binding_ticket=ticket.raw_ticket,
            expires_at=ticket.expires_at,
        )
    if user.status != ACTIVE:
        raise MiniAuthError("ACCOUNT_UNAVAILABLE", "该微信绑定账号已停用或归档", 403)
    now = now_utc()
    user.last_login_at = now
    user.last_active_at = now
    existing = dict(user.wechat or {})
    existing["miniLastLoginAt"] = _iso(now)
    user.wechat = existing
    record, issued = _new_session(user, client_metadata)
    db.add(record)
    await db.commit()
    await db.refresh(user)
    return MiniLoginOutcome(
        status="authenticated",
        session=IssuedMiniSession(
            issued.token, issued.login_session_id, issued.expires_at, user
        ),
    )


async def resolve_session_token(db: AsyncSession, raw_token: str) -> User | None:
    if not raw_token:
        return None
    row = (
        await db.execute(
            select(WechatMiniSession).where(
                WechatMiniSession.token_digest == hash_secret(raw_token)
            )
        )
    ).scalar_one_or_none()
    if not row or row.revoked_at is not None or row.expires_at <= now_utc():
        return None
    user = await user_service.get_by_username(db, row.username)
    if not user or user.status != ACTIVE:
        return None
    row.last_seen_at = now_utc()
    user.last_active_at = now_utc()
    await db.commit()
    await db.refresh(user)
    return user


async def revoke_session_token(db: AsyncSession, raw_token: str) -> bool:
    if not raw_token:
        return False
    row = (
        await db.execute(
            select(WechatMiniSession).where(
                WechatMiniSession.token_digest == hash_secret(raw_token),
                WechatMiniSession.revoked_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if not row:
        return False
    row.revoked_at = now_utc()
    await db.commit()
    return True
