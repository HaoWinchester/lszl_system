"""微信登录与服务器凭证边界回归测试。"""

import asyncio
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest

from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.user import ACTIVE, User
from app.services import user_service, wechat_service


def login_admin(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/login",
        json={"username": "admin", "password": "admin123"},
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
