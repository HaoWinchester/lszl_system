"""归一化系统设置 API 的持久化回归测试。"""

from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.subscription import Subscription, SubscriptionOrder
from app.services.system_service import legacy_payment_amount_fen


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


def test_plan_payment_amount_is_the_single_source_for_display_and_new_orders() -> None:
    """套餐展示金额、订单金额必须来自同一个数据库字段。"""
    username = f"price-source-{uuid4().hex[:10]}"
    payment_amount_fen = 4567
    with TestClient(app) as admin, TestClient(app) as student:
        login_admin(admin)
        original = next(
            plan
            for plan in admin.get("/api/v1/system/subscription-plans").json()["plans"]
            if plan["planId"] == "monthly"
        )
        created = admin.post(
            "/api/v1/users",
            json={"username": username, "password": "test1234", "role": "student"},
        )
        assert created.status_code == 200, created.text
        try:
            updated = admin.put(
                "/api/v1/system/subscription-plans/monthly",
                json={
                    "paymentAmountFen": payment_amount_fen,
                    "originalPriceText": "￥99.90",
                    "discountPercent": "10",
                },
            )
            assert updated.status_code == 200, updated.text
            public_monthly = next(
                plan
                for plan in admin.get("/api/v1/subscriptions/plans").json()["plans"]
                if plan["planId"] == "monthly"
            )
            assert public_monthly["paymentAmountFen"] == payment_amount_fen
            assert public_monthly["priceText"] == "￥45.67"

            assert student.post(
                "/api/v1/auth/login",
                json={"username": username, "password": "test1234"},
            ).status_code == 200
            order = student.post("/api/v1/subscriptions/orders", json={"planId": "monthly"})
            assert order.status_code == 200, order.text
            assert order.json()["order"]["amount"] == payment_amount_fen
            assert (
                student.post(
                    f"/api/v1/subscriptions/orders/{order.json()['order']['id']}/self-cancel"
                ).status_code
                == 200
            )
        finally:
            admin.put(
                "/api/v1/system/subscription-plans/monthly",
                json={key: original[key] for key in ("paymentAmountFen", "originalPriceText", "discountPercent")},
            )
            async def cleanup() -> None:
                async with AsyncSessionLocal() as db:
                    await db.execute(delete(SubscriptionOrder).where(SubscriptionOrder.username == username))
                    await db.execute(delete(Subscription).where(Subscription.username == username))
                    await db.commit()

            import asyncio
            asyncio.run(cleanup())
            admin.request("DELETE", "/api/v1/users/batch", json={"usernames": [username]})


def test_legacy_plan_price_is_rounded_exactly_as_the_existing_price_card() -> None:
    assert legacy_payment_amount_fen({"originalPriceText": "￥39.9", "discountPercent": "75"}) == 2990
