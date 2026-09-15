"""Regression coverage for preserving PC and mini-program WeChat identities."""

import asyncio
from uuid import uuid4

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.user import ACTIVE, User
from app.services import wechat_mini_service, wechat_service


def _user(username: str) -> User:
    return User(
        username=username,
        password_hash=hash_password("test1234"),
        role="student",
        status=ACTIVE,
        tags=[],
        source="wechat-mini-test",
    )


def test_pc_login_refresh_preserves_mini_identity() -> None:
    existing = {
        "miniOpenid": "mini-test",
        "miniBoundAt": "bound",
        "unionid": "union-test",
    }
    payload = wechat_service._wechat_payload(
        {"openid": "pc-test", "nickname": "更新昵称"}, existing, "wechat"
    )

    assert payload["miniOpenid"] == "mini-test"
    assert payload["miniBoundAt"] == "bound"
    assert payload["unionid"] == "union-test"
    assert payload["openid"] == "pc-test"
    assert payload["nickname"] == "更新昵称"
    assert "openid" not in existing


def test_unionid_login_persists_mini_identity_and_survives_pc_login(
    monkeypatch,
) -> None:
    async def scenario() -> None:
        suffix = uuid4().hex[:10]
        identity = {"openid": f"mini_{suffix}", "unionid": f"union_{suffix}"}

        async def exchange(_code: str) -> dict:
            return identity

        monkeypatch.setattr(wechat_mini_service, "exchange_code", exchange)
        async with AsyncSessionLocal() as db:
            user = _user(f"mini_cross_{suffix}")
            user.display_name = "自定义昵称"
            user.wechat = {
                "openid": f"pc_{suffix}",
                "unionid": identity["unionid"],
                "nickname": "微信昵称",
            }
            db.add(user)
            await db.commit()

            first = await wechat_mini_service.exchange_login_code(db, "mini-code", {})
            assert first.status == "authenticated"
            assert first.session.user.wechat["miniOpenid"] == identity["openid"]
            assert first.session.user.wechat["openid"] == f"pc_{suffix}"
            bound_at = first.session.user.wechat["miniBoundAt"]

            await wechat_service.find_or_create_user(
                db,
                {
                    "openid": f"pc_{suffix}",
                    "unionid": identity["unionid"],
                    "nickname": "新微信昵称",
                },
                {},
                "wechat",
            )
            identity.pop("unionid")
            second = await wechat_mini_service.exchange_login_code(
                db, "next-mini-code", {}
            )

            assert second.status == "authenticated"
            assert second.session.user.username == f"mini_cross_{suffix}"
            assert second.session.user.display_name == "自定义昵称"
            assert second.session.user.wechat["miniBoundAt"] == bound_at
            assert second.session.user.wechat["unionid"] == f"union_{suffix}"

    asyncio.run(scenario())
