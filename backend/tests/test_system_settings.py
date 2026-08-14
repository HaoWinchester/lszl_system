"""归一化系统设置 API 的持久化回归测试。"""

import asyncio
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.subscription import Subscription, SubscriptionOrder
from app.models.user import User


def login_admin(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/login",
        json={"username": "admin", "password": "admin123"},
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


def test_native_orders_use_the_database_configured_price_for_every_paid_plan() -> None:
    """Protect against QR orders falling back to deployment/demo fixed amounts."""

    username = f"configured-price-student-{uuid4().hex[:12]}"
    configured = {
        "monthly": ("39.9", "80", 3190),
        "quarterly": ("119.9", "75", 8990),
        "half_year": ("229.9", "70", 16090),
        "lifetime": ("459.9", "60", 27590),
    }

    async def create_student() -> None:
        async with AsyncSessionLocal() as db:
            db.add(
                User(
                    username=username,
                    password_hash=hash_password("configured-price-pass"),
                    role="student",
                    status="active",
                    subject="PMP",
                )
            )
            await db.commit()

    async def remove_student() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(SubscriptionOrder).where(SubscriptionOrder.username == username))
            await db.execute(delete(Subscription).where(Subscription.username == username))
            await db.execute(delete(User).where(User.username == username))
            await db.commit()

    asyncio.run(create_student())
    originals: dict[str, dict] = {}
    try:
        with TestClient(app) as client:
            login_admin(client)
            plans = client.get("/api/v1/system/subscription-plans").json()["plans"]
            originals = {plan["planId"]: plan for plan in plans if plan["planId"] in configured}
            for plan_id, (original_price, discount_percent, _) in configured.items():
                saved = client.put(
                    f"/api/v1/system/subscription-plans/{plan_id}",
                    json={
                        "originalPriceText": original_price,
                        "discountPercent": discount_percent,
                    },
                )
                assert saved.status_code == 200, saved.text
            client.post("/api/v1/auth/logout")

            signed_in = client.post(
                "/api/v1/auth/login",
                json={"username": username, "password": "configured-price-pass"},
            )
            assert signed_in.status_code == 200, signed_in.text
            for plan_id, (_, _, expected_fen) in configured.items():
                response = client.post("/api/v1/subscriptions/orders", json={"planId": plan_id})
                assert response.status_code == 200, response.text
                assert response.json()["order"]["amount"] == expected_fen
    finally:
        with TestClient(app) as client:
            login_admin(client)
            for plan_id, original in originals.items():
                client.put(
                    f"/api/v1/system/subscription-plans/{plan_id}",
                    json={
                        "originalPriceText": original.get("originalPriceText", ""),
                        "discountPercent": original.get("discountPercent", ""),
                    },
                )
        asyncio.run(remove_student())
