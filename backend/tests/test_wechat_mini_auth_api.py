"""API contracts for native WeChat mini-program authentication."""

import asyncio
from uuid import uuid4

from fastapi.testclient import TestClient

from app.core.config import settings
from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.user import User
from app.services import wechat_mini_service


def _issue_student_token() -> tuple[str, str]:
    async def scenario() -> tuple[str, str]:
        async with AsyncSessionLocal() as db:
            user = await db.get(User, "学生")
            issued = await wechat_mini_service.issue_session(db, user, {"platform": "test"})
            return issued.token, issued.login_session_id

    return asyncio.run(scenario())


def _login_cookie(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/login",
        json={"username": "学生", "password": "111111"},
    )
    assert response.status_code == 200, response.text


def test_wechat_login_returns_redacted_one_time_binding_ticket(monkeypatch) -> None:
    async def exchange(_code: str) -> dict:
        suffix = uuid4().hex[:10]
        return {"openid": f"api_openid_{suffix}", "unionid": f"api_unionid_{suffix}"}

    monkeypatch.setattr(wechat_mini_service, "exchange_code", exchange)
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/auth/mini/wechat/login",
            json={"code": "wx-code", "client": {"platform": "devtools"}},
        )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["status"] == "binding_required"
    assert len(payload["bindingTicket"]) >= 16
    assert payload["expiresAt"]
    assert "openid" not in response.text.lower()
    assert "session_key" not in response.text.lower()


def test_binding_existing_account_issues_bearer_session(monkeypatch) -> None:
    suffix = uuid4().hex[:10]

    async def exchange(_code: str) -> dict:
        return {"openid": f"bind_openid_{suffix}", "unionid": f"bind_unionid_{suffix}"}

    monkeypatch.setattr(wechat_mini_service, "exchange_code", exchange)
    with TestClient(app) as client:
        started = client.post("/api/v1/auth/mini/wechat/login", json={"code": "wx-code"})
        bound = client.post(
            "/api/v1/auth/mini/bind",
            json={
                "bindingTicket": started.json()["bindingTicket"],
                "username": "学生",
                "password": "111111",
            },
        )
        current = client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {bound.json()['token']}"},
        )

    assert bound.status_code == 200, bound.text
    assert bound.json()["status"] == "authenticated"
    assert current.status_code == 200, current.text
    assert current.json()["user"]["username"] == "学生"
    assert current.json()["loginSessionId"] == bound.json()["loginSessionId"]


def test_bearer_token_accesses_existing_current_user_route() -> None:
    token, login_session_id = _issue_student_token()
    with TestClient(app) as client:
        response = client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert response.status_code == 200, response.text
    assert response.json()["user"]["username"] == "学生"
    assert response.json()["loginSessionId"] == login_session_id


def test_malformed_bearer_does_not_fall_back_to_cookie() -> None:
    with TestClient(app) as client:
        _login_cookie(client)
        response = client.get(
            "/api/v1/auth/me",
            headers={"Authorization": "Bearer invalid-token"},
        )
    assert response.status_code == 401
    assert response.json()["detail"] == "小程序会话已失效，请重新登录"


def test_mini_logout_revokes_the_presented_token() -> None:
    token, _ = _issue_student_token()
    headers = {"Authorization": f"Bearer {token}"}
    with TestClient(app) as client:
        logged_out = client.post("/api/v1/auth/mini/logout", headers=headers)
        current = client.get("/api/v1/auth/me", headers=headers)
    assert logged_out.status_code == 200
    assert logged_out.json() == {"ok": True}
    assert current.status_code == 401


def test_mini_registration_requires_current_legal_consent(monkeypatch) -> None:
    suffix = uuid4().hex[:10]

    async def exchange(_code: str) -> dict:
        return {"openid": f"register_openid_{suffix}"}

    monkeypatch.setattr(wechat_mini_service, "exchange_code", exchange)
    monkeypatch.setattr(settings, "LEGAL_CONSENT_REQUIRED", True)
    with TestClient(app) as client:
        started = client.post("/api/v1/auth/mini/wechat/login", json={"code": "wx-code"})
        denied = client.post(
            "/api/v1/auth/mini/register",
            json={
                "bindingTicket": started.json()["bindingTicket"],
                "username": f"mini_api_{suffix}",
                "password": "test1234",
                "acceptedTermsVersion": "old",
            },
        )
    assert denied.status_code == 400
    assert "隐私政策" in denied.text


def test_api_errors_use_stable_code_and_message(monkeypatch) -> None:
    async def fail(_code: str) -> dict:
        raise wechat_mini_service.MiniAuthError(
            "WECHAT_CODE_INVALID", "微信登录凭证无效，请重试", 401
        )

    monkeypatch.setattr(wechat_mini_service, "exchange_code", fail)
    with TestClient(app) as client:
        response = client.post("/api/v1/auth/mini/wechat/login", json={"code": "bad"})
    assert response.status_code == 401
    assert response.json() == {
        "detail": {"code": "WECHAT_CODE_INVALID", "message": "微信登录凭证无效，请重试"}
    }
