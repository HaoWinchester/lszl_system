"""微信登录与服务器凭证边界回归测试。"""

from fastapi.testclient import TestClient

from app.main import app
from app.models.user import ACTIVE, User
from app.services import user_service


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
