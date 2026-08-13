"""微信登录与服务器凭证边界回归测试。"""

import asyncio
import json
import re
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest

from app.db.session import AsyncSessionLocal
from app.core.config import settings
from app.main import app
from app.models.system import SystemSetting
from app.models.user import ACTIVE, User
from app.services import system_service, user_service, wechat_service


def extract_bootstrap(response) -> dict:
    match = re.search(r"window\.__KG_DIRECT_BOOTSTRAP__=(.*?);</script>", response.text)
    assert match, "missing direct bootstrap"
    return json.loads(match.group(1))


def login_admin(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/login",
        json={"username": "admin", "password": "jbgsnmm~123"},
    )
    assert response.status_code == 200, response.text


def test_admin_wechat_config_never_returns_app_secret() -> None:
    marker = "browser-must-not-see-this"
    with TestClient(app) as client:
        login_admin(client)
        try:
            saved = client.put(
                "/api/v1/system/wechat-config",
                json={"appId": "wx_test_app", "appSecret": marker},
            )
            assert saved.status_code == 200, saved.text
            payload = client.get("/api/v1/system/wechat-config").json()["config"]
        finally:
            client.put(
                "/api/v1/system/wechat-config",
                json={"appId": "", "appSecret": ""},
            )

    assert payload["appId"] == "wx_test_app"
    assert "appSecret" not in payload
    assert marker not in str(payload)


def test_database_app_secret_is_not_used_at_runtime() -> None:
    """旧管理后台遗留的密钥不能越过环境变量凭证边界。"""
    marker = "legacy-secret-must-not-be-used"

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            existing = await db.get(SystemSetting, "wechat_config")
            original = dict(existing.value) if existing else None
            try:
                if existing:
                    existing.value = {**original, "appSecret": marker}
                else:
                    db.add(SystemSetting(key="wechat_config", value={"appSecret": marker}))
                await db.commit()

                config = await system_service.get_wechat_config(db)
                assert config.get("appSecret") != marker
            finally:
                setting = await db.get(SystemSetting, "wechat_config")
                if original is None:
                    if setting:
                        await db.delete(setting)
                elif setting:
                    setting.value = original
                await db.commit()

    asyncio.run(scenario())


def test_user_serialization_hides_wechat_identifiers() -> None:
    user = User(
        username="wechat_summary_test",
        password_hash="",
        role="student",
        status=ACTIVE,
        tags=[],
        wechat={
            "openid": "openid-that-must-not-reach-browser",
            "unionid": "unionid-that-must-not-reach-browser",
            "nickname": "微信用户",
            "avatar": "https://avatar.example/avatar.png",
        },
    )

    payload = user_service.to_dict(user)

    assert payload["wechat"] == {
        "bound": True,
        "nickname": "微信用户",
        "avatar": "https://avatar.example/avatar.png",
        "boundAt": None,
        "lastLoginAt": None,
    }


def test_wechat_binding_rejects_an_identity_owned_by_another_user() -> None:
    async def scenario() -> None:
        suffix = uuid4().hex[:12]
        owner = User(
            username=f"wx_owner_{suffix}",
            password_hash="",
            role="student",
            status=ACTIVE,
            tags=[],
        )
        target = User(
            username=f"wx_target_{suffix}",
            password_hash="",
            role="student",
            status=ACTIVE,
            tags=[],
        )
        async with AsyncSessionLocal() as db:
            db.add_all([owner, target])
            await db.commit()
            try:
                await wechat_service.bind_user(
                    db,
                    owner,
                    {"openid": f"openid_{suffix}", "nickname": "甲"},
                    "wechat-bind",
                )
                with pytest.raises(ValueError, match="已绑定其他账号"):
                    await wechat_service.bind_user(
                        db,
                        target,
                        {"openid": f"openid_{suffix}", "nickname": "乙"},
                        "wechat-bind",
                    )
            finally:
                for user in (owner, target):
                    attached = await db.get(User, user.username)
                    if attached:
                        await db.delete(attached)
                await db.commit()

    asyncio.run(scenario())


def test_unbinding_wechat_preserves_the_user() -> None:
    async def scenario() -> None:
        username = f"wx_unbind_{uuid4().hex[:12]}"
        user = User(
            username=username,
            password_hash="",
            role="student",
            status=ACTIVE,
            tags=[],
        )
        async with AsyncSessionLocal() as db:
            db.add(user)
            await db.commit()
            try:
                await wechat_service.bind_user(
                    db,
                    user,
                    {"openid": f"openid_{username}", "nickname": "解绑测试"},
                    "wechat-bind",
                )
                updated = await wechat_service.unbind_user(db, user)

                assert updated.username == username
                assert updated.wechat is None
            finally:
                attached = await db.get(User, username)
                if attached:
                    await db.delete(attached)
                await db.commit()

    asyncio.run(scenario())


def configure_official_wechat(monkeypatch) -> None:
    monkeypatch.setattr(settings, "WECHAT_APP_ID", "wx_test_official")
    monkeypatch.setattr(settings, "WECHAT_APP_SECRET", "test-secret-only-for-mocks")
    monkeypatch.setattr(settings, "WECHAT_ENABLE_OFFICIAL", True)
    monkeypatch.setattr(settings, "WECHAT_ENABLE_DEMO", False)


def delete_user(username: str) -> None:
    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            user = await db.get(User, username)
            if user:
                await db.delete(user)
                await db.commit()

    asyncio.run(scenario())


def test_callback_creates_student_sets_session_and_redirects(monkeypatch) -> None:
    openid = f"openid_login_{uuid4().hex[:12]}"
    username = wechat_service._wx_username(openid)

    async def exchange(_cfg, _code):
        return {"access_token": "mock-token", "openid": openid, "unionid": f"unionid_{openid}"}

    async def userinfo(_cfg, _token, _openid):
        return {"nickname": "扫码新用户", "avatar": "", "unionid": f"unionid_{openid}"}

    monkeypatch.setattr(wechat_service, "exchange_code", exchange)
    monkeypatch.setattr(wechat_service, "fetch_userinfo", userinfo)
    configure_official_wechat(monkeypatch)
    try:
        with TestClient(app) as client:
            start = client.get(
                "/api/v1/auth/wechat/auth-url",
                params={
                    "intent": "login",
                    "return_path": "/training",
                    "accepted_terms_version": "2026-08-13-v1",
                },
            )
            assert start.status_code == 200, start.text
            state = start.json()["state"]
            callback = client.get(
                "/api/v1/auth/wechat/callback",
                params={"code": "one-time-code", "state": state},
                follow_redirects=False,
            )
            current = client.get("/api/v1/auth/me")
            repeated_current = client.get("/api/v1/auth/me")
            bootstrap = extract_bootstrap(client.get("/index.html"))

        assert callback.status_code == 303
        assert callback.headers["location"].startswith("/training?wechat=login-success")
        assert current.status_code == 200
        assert current.json()["user"]["username"] == username
        assert current.json()["user"]["role"] == "student"
        assert current.json()["user"]["legalConsentVersion"] == "2026-08-13-v1"
        assert current.json()["user"]["legalConsentAt"]
        login_session_id = current.json()["loginSessionId"]
        assert isinstance(login_session_id, str)
        assert login_session_id
        assert repeated_current.json()["loginSessionId"] == login_session_id
        assert bootstrap["authUser"]["loginSessionId"] == login_session_id
    finally:
        delete_user(username)


def test_callback_consumes_state_and_rejects_replay(monkeypatch) -> None:
    openid = f"openid_replay_{uuid4().hex[:12]}"
    username = wechat_service._wx_username(openid)

    async def exchange(_cfg, _code):
        return {"access_token": "mock-token", "openid": openid}

    async def userinfo(_cfg, _token, _openid):
        return {}

    monkeypatch.setattr(wechat_service, "exchange_code", exchange)
    monkeypatch.setattr(wechat_service, "fetch_userinfo", userinfo)
    configure_official_wechat(monkeypatch)
    try:
        with TestClient(app) as client:
            start = client.get("/api/v1/auth/wechat/auth-url")
            assert start.status_code == 200, start.text
            state = start.json()["state"]
            first = client.get(
                "/api/v1/auth/wechat/callback",
                params={"code": "once", "state": state},
                follow_redirects=False,
            )
            replay = client.get(
                "/api/v1/auth/wechat/callback",
                params={"code": "once", "state": state},
                follow_redirects=False,
            )

        assert first.status_code == 303
        assert replay.status_code == 303
        assert replay.headers["location"].startswith("/?wechat=state-invalid")
    finally:
        delete_user(username)


def test_callback_rejects_an_external_return_path(monkeypatch) -> None:
    openid = f"openid_return_path_{uuid4().hex[:12]}"
    username = wechat_service._wx_username(openid)

    async def exchange(_cfg, _code):
        return {"access_token": "mock-token", "openid": openid}

    async def userinfo(_cfg, _token, _openid):
        return {}

    monkeypatch.setattr(wechat_service, "exchange_code", exchange)
    monkeypatch.setattr(wechat_service, "fetch_userinfo", userinfo)
    configure_official_wechat(monkeypatch)
    try:
        with TestClient(app) as client:
            start = client.get(
                "/api/v1/auth/wechat/auth-url",
                params={"return_path": "https://malicious.example/capture"},
            )
            callback = client.get(
                "/api/v1/auth/wechat/callback",
                params={"code": "safe-return", "state": start.json()["state"]},
                follow_redirects=False,
            )

        assert callback.status_code == 303
        assert callback.headers["location"].startswith("/?wechat=login-success")
        assert "malicious.example" not in callback.headers["location"]
    finally:
        delete_user(username)


def test_callback_binds_and_unbinds_an_existing_password_user(monkeypatch) -> None:
    suffix = uuid4().hex[:12]
    username = f"wechat_bind_{suffix}"
    openid = f"openid_bind_{suffix}"

    async def exchange(_cfg, _code):
        return {"access_token": "mock-token", "openid": openid}

    async def userinfo(_cfg, _token, _openid):
        return {"nickname": "已绑定微信", "avatar": "https://avatar.example/bind.png"}

    monkeypatch.setattr(wechat_service, "exchange_code", exchange)
    monkeypatch.setattr(wechat_service, "fetch_userinfo", userinfo)
    configure_official_wechat(monkeypatch)
    monkeypatch.setattr(settings, "LEGAL_CONSENT_REQUIRED", True)
    try:
        with TestClient(app) as client:
            registered = client.post(
                "/api/v1/auth/register",
                json={
                    "username": username,
                    "password": "test-password",
                    "display_name": "绑定用户",
                    "acceptedTermsVersion": "2026-08-13-v1",
                },
            )
            assert registered.status_code == 200, registered.text
            start = client.get(
                "/api/v1/auth/wechat/auth-url",
                params={"intent": "bind", "return_path": "/settings"},
            )
            assert start.status_code == 200, start.text
            callback = client.get(
                "/api/v1/auth/wechat/callback",
                params={"code": "bind-code", "state": start.json()["state"]},
                follow_redirects=False,
            )
            bound = client.get("/api/v1/auth/me")
            unbound = client.delete("/api/v1/auth/wechat/binding")

        assert callback.status_code == 303
        assert callback.headers["location"].startswith("/settings?wechat=bind-success")
        assert bound.json()["user"]["wechat"]["bound"] is True
        assert bound.json()["user"]["wechat"]["nickname"] == "已绑定微信"
        assert unbound.status_code == 200
        assert unbound.json()["user"]["wechat"] is None
    finally:
        delete_user(username)


def test_bind_intent_requires_an_authenticated_user(monkeypatch) -> None:
    configure_official_wechat(monkeypatch)
    with TestClient(app) as client:
        response = client.get("/api/v1/auth/wechat/auth-url", params={"intent": "bind"})

    assert response.status_code == 401


def test_demo_login_issues_a_stable_login_session_id(monkeypatch) -> None:
    monkeypatch.setattr(settings, "WECHAT_ENABLE_DEMO", True)
    with TestClient(app) as client:
        response = client.post("/api/v1/auth/wechat/demo-login")
        assert response.status_code == 200, response.text
        login_session_id = response.json()["loginSessionId"]
        assert client.get("/api/v1/auth/me").json()["loginSessionId"] == login_session_id
        assert extract_bootstrap(client.get("/index.html"))["authUser"]["loginSessionId"] == login_session_id
