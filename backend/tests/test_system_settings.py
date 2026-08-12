"""归一化系统设置 API 的持久化回归测试。"""

from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app


def login_admin(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/login",
        json={"username": "admin", "password": "jbgsnmm~123"},
    )
    assert response.status_code == 200


def test_subscription_plan_update_survives_a_fresh_read() -> None:
    with TestClient(app) as client:
        login_admin(client)
        plans = client.get("/api/v1/system/subscription-plans").json()["plans"]
        original = next(plan for plan in plans if plan["planId"] == "monthly")
        marker = f"套餐持久化-{uuid4().hex[:10]}"
        try:
            saved = client.put(
                "/api/v1/system/subscription-plans/monthly",
                json={"description": marker},
            )
            assert saved.status_code == 200, saved.text

            reloaded = client.get("/api/v1/system/subscription-plans").json()["plans"]
            monthly = next(plan for plan in reloaded if plan["planId"] == "monthly")
            assert monthly["description"] == marker
        finally:
            client.put(
                "/api/v1/system/subscription-plans/monthly",
                json={"description": original["description"]},
            )
