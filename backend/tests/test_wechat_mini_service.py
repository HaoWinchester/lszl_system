"""Service-level tests for native WeChat mini-program authentication."""

import asyncio
from datetime import timedelta
from uuid import uuid4

import pytest

from app.core.security import hash_password, now_utc
from app.db.session import AsyncSessionLocal
from app.models.user import ACTIVE, PAUSED, User
from app.services import wechat_mini_service


def _user(username: str, *, status: str = ACTIVE) -> User:
    return User(
        username=username,
        password_hash=hash_password("test1234"),
        role="student",
        status=status,
        tags=[],
        source="wechat-mini-test",
    )


def test_hash_secret_never_returns_plaintext() -> None:
    digest = wechat_mini_service.hash_secret("visible-token")
    assert digest != "visible-token"
    assert len(digest) == 64
    assert digest == wechat_mini_service.hash_secret("visible-token")


def test_user_serialization_recognizes_mini_program_binding() -> None:
    user = _user("mini_serialized")
    user.wechat = {"miniOpenid": "secret", "nickname": "小程序学员"}

    payload = wechat_mini_service.user_service.to_dict(user)

    assert payload["wechat"] == {
        "bound": True,
        "nickname": "小程序学员",
        "avatar": "",
        "boundAt": None,
        "lastLoginAt": None,
    }
    assert "miniOpenid" not in str(payload)


def test_binding_ticket_is_one_time_and_issues_resolvable_session() -> None:
    async def scenario() -> None:
        username = f"mini_bind_{uuid4().hex[:10]}"
        async with AsyncSessionLocal() as db:
            db.add(_user(username))
            await db.commit()
            ticket = await wechat_mini_service.issue_binding_ticket(
                db,
                openid=f"mini_openid_{username}",
                unionid=f"mini_unionid_{username}",
            )
            issued = await wechat_mini_service.bind_existing_account(
                db,
                raw_ticket=ticket.raw_ticket,
                username=username,
                password="test1234",
                client_metadata={"platform": "devtools"},
            )
            resolved = await wechat_mini_service.resolve_session_token(db, issued.token)

            assert resolved is not None
            assert resolved.username == username
            assert issued.login_session_id
            assert resolved.wechat["miniOpenid"] == f"mini_openid_{username}"
            with pytest.raises(wechat_mini_service.MiniAuthError) as replay:
                await wechat_mini_service.bind_existing_account(
                    db,
                    raw_ticket=ticket.raw_ticket,
                    username=username,
                    password="test1234",
                    client_metadata={},
                )
            assert replay.value.code == "BINDING_TICKET_INVALID"

    asyncio.run(scenario())


def test_binding_rejects_invalid_password_without_consuming_ticket() -> None:
    async def scenario() -> None:
        username = f"mini_password_{uuid4().hex[:10]}"
        async with AsyncSessionLocal() as db:
            db.add(_user(username))
            await db.commit()
            ticket = await wechat_mini_service.issue_binding_ticket(db, f"openid_{username}")
            with pytest.raises(wechat_mini_service.MiniAuthError) as denied:
                await wechat_mini_service.bind_existing_account(
                    db, ticket.raw_ticket, username, "wrong-password", {}
                )
            assert denied.value.code == "INVALID_CREDENTIALS"
            issued = await wechat_mini_service.bind_existing_account(
                db, ticket.raw_ticket, username, "test1234", {}
            )
            assert issued.token

    asyncio.run(scenario())


def test_expired_ticket_and_inactive_user_are_rejected() -> None:
    async def scenario() -> None:
        suffix = uuid4().hex[:10]
        active_username = f"mini_expired_{suffix}"
        paused_username = f"mini_paused_{suffix}"
        async with AsyncSessionLocal() as db:
            db.add_all([_user(active_username), _user(paused_username, status=PAUSED)])
            await db.commit()
            expired = await wechat_mini_service.issue_binding_ticket(
                db,
                f"expired_{active_username}",
                expires_at=now_utc() - timedelta(seconds=1),
            )
            with pytest.raises(wechat_mini_service.MiniAuthError) as expired_error:
                await wechat_mini_service.bind_existing_account(
                    db, expired.raw_ticket, active_username, "test1234", {}
                )
            assert expired_error.value.code == "BINDING_TICKET_INVALID"

            active_ticket = await wechat_mini_service.issue_binding_ticket(
                db, f"paused_{paused_username}"
            )
            with pytest.raises(wechat_mini_service.MiniAuthError) as paused_error:
                await wechat_mini_service.bind_existing_account(
                    db, active_ticket.raw_ticket, paused_username, "test1234", {}
                )
            assert paused_error.value.code == "ACCOUNT_UNAVAILABLE"

    asyncio.run(scenario())


def test_revoked_session_no_longer_resolves() -> None:
    async def scenario() -> None:
        username = f"mini_revoke_{uuid4().hex[:10]}"
        async with AsyncSessionLocal() as db:
            db.add(_user(username))
            await db.commit()
            user = await db.get(User, username)
            issued = await wechat_mini_service.issue_session(db, user, {})
            assert await wechat_mini_service.revoke_session_token(db, issued.token) is True
            assert await wechat_mini_service.resolve_session_token(db, issued.token) is None
            assert await wechat_mini_service.revoke_session_token(db, "unknown") is False

    asyncio.run(scenario())


def test_exchange_login_code_returns_ticket_or_linked_session(monkeypatch) -> None:
    async def scenario() -> None:
        suffix = uuid4().hex[:10]
        identity = {"openid": f"openid_{suffix}", "unionid": f"unionid_{suffix}"}

        async def exchange(_code: str) -> dict:
            return identity

        monkeypatch.setattr(wechat_mini_service, "exchange_code", exchange)
        async with AsyncSessionLocal() as db:
            first = await wechat_mini_service.exchange_login_code(db, "code", {})
            assert first.status == "binding_required"
            username = f"mini_linked_{suffix}"
            db.add(_user(username))
            await db.commit()
            await wechat_mini_service.bind_existing_account(
                db, first.binding_ticket, username, "test1234", {}
            )
            second = await wechat_mini_service.exchange_login_code(db, "next-code", {})
            assert second.status == "authenticated"
            assert second.session is not None
            assert second.session.user.username == username

    asyncio.run(scenario())


def test_register_account_consumes_ticket_and_records_consent() -> None:
    async def scenario() -> None:
        suffix = uuid4().hex[:10]
        username = f"mini_new_{suffix}"
        async with AsyncSessionLocal() as db:
            ticket = await wechat_mini_service.issue_binding_ticket(
                db, f"new_openid_{suffix}", f"new_unionid_{suffix}"
            )
            issued = await wechat_mini_service.register_account(
                db,
                ticket.raw_ticket,
                username=username,
                password="test1234",
                display_name="新学员",
                subject="PMP",
                accepted_terms_version="2026-08-13-v1",
                client_metadata={"platform": "ios"},
            )
            assert issued.user.username == username
            assert issued.user.wechat["miniOpenid"] == f"new_openid_{suffix}"
            assert issued.user.legal_consent_version == "2026-08-13-v1"
            with pytest.raises(wechat_mini_service.MiniAuthError) as replay:
                await wechat_mini_service.register_account(
                    db,
                    ticket.raw_ticket,
                    username=f"mini_other_{suffix}",
                    password="test1234",
                    display_name=None,
                    subject="PMP",
                    accepted_terms_version="2026-08-13-v1",
                    client_metadata={},
                )
            assert replay.value.code == "BINDING_TICKET_INVALID"

    asyncio.run(scenario())
