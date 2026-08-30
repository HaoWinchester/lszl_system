"""归一化系统设置 API 的持久化回归测试。"""

import asyncio
from datetime import datetime
from uuid import uuid4

from fastapi.testclient import TestClient

from sqlalchemy import delete

from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.subscription import RedeemCode, Subscription, SubscriptionOrder
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


def test_admin_subscription_exact_dates_are_validated_and_survive_a_fresh_read() -> None:
    username = f"subscription-dates-{uuid4().hex[:10]}"
    started_at = "2026-08-02T00:00:00+00:00"
    expires_at = "2026-09-02T23:59:59+00:00"
    with TestClient(app) as admin, TestClient(app) as student:
        login_admin(admin)
        created = admin.post(
            "/api/v1/users",
            json={"username": username, "password": "test1234", "role": "student"},
        )
        assert created.status_code == 200, created.text
        try:
            saved = admin.put(
                f"/api/v1/subscriptions/admin/{username}",
                json={
                    "planId": "monthly",
                    "status": "active",
                    "startedAt": started_at,
                    "expiresAt": expires_at,
                    "note": "精确日期回归",
                },
            )
            assert saved.status_code == 200, saved.text
            record = saved.json()["subscription"]
            assert datetime.fromisoformat(record["startedAt"]) == datetime.fromisoformat(started_at)
            assert datetime.fromisoformat(record["expiresAt"]) == datetime.fromisoformat(expires_at)

            logged_in = student.post(
                "/api/v1/auth/login",
                json={"username": username, "password": "test1234"},
            )
            assert logged_in.status_code == 200, logged_in.text
            reloaded = student.get("/api/v1/subscriptions/me")
            assert reloaded.status_code == 200, reloaded.text
            persisted = reloaded.json()["subscription"]
            assert datetime.fromisoformat(persisted["startedAt"]) == datetime.fromisoformat(started_at)
            assert datetime.fromisoformat(persisted["expiresAt"]) == datetime.fromisoformat(expires_at)

            listed = admin.get(f"/api/v1/users?query={username}&page_size=10")
            assert listed.status_code == 200, listed.text
            summary = listed.json()["users"][0]["subscription"]
            assert datetime.fromisoformat(summary["startedAt"]) == datetime.fromisoformat(started_at)
            assert datetime.fromisoformat(summary["expiresAt"]) == datetime.fromisoformat(expires_at)
            assert summary["note"] == "精确日期回归"

            invalid = admin.put(
                f"/api/v1/subscriptions/admin/{username}",
                json={
                    "planId": "monthly",
                    "startedAt": "2026-09-03T00:00:00+00:00",
                    "expiresAt": "2026-09-02T00:00:00+00:00",
                },
            )
            assert invalid.status_code == 422, invalid.text
        finally:
            async def cleanup_subscription() -> None:
                async with AsyncSessionLocal() as db:
                    await db.execute(delete(Subscription).where(Subscription.username == username))
                    await db.commit()

            asyncio.run(cleanup_subscription())
            admin.request("DELETE", "/api/v1/users/batch", json={"usernames": [username]})


def test_orders_and_redeem_codes_survive_fresh_admin_api_reads() -> None:
    username = f"subscription-records-{uuid4().hex[:10]}"
    generated_codes: list[str] = []
    with TestClient(app) as admin, TestClient(app) as student, TestClient(app) as fresh_admin:
        login_admin(admin)
        created = admin.post(
            "/api/v1/users",
            json={"username": username, "password": "test1234", "role": "student"},
        )
        assert created.status_code == 200, created.text
        try:
            assert student.post(
                "/api/v1/auth/login", json={"username": username, "password": "test1234"}
            ).status_code == 200
            order = student.post("/api/v1/subscriptions/orders", json={"planId": "monthly"})
            assert order.status_code == 200, order.text
            order_id = order.json()["order"]["id"]

            generated = admin.post(
                "/api/v1/subscriptions/redeem-codes/generate",
                json={"planId": "monthly", "count": 2},
            )
            assert generated.status_code == 200, generated.text
            generated_codes = generated.json()["codes"]

            login_admin(fresh_admin)
            persisted_orders = fresh_admin.get("/api/v1/subscriptions/orders")
            assert persisted_orders.status_code == 200, persisted_orders.text
            assert any(item["id"] == order_id for item in persisted_orders.json()["orders"])
            persisted_codes = fresh_admin.get("/api/v1/subscriptions/redeem-codes")
            assert persisted_codes.status_code == 200, persisted_codes.text
            listed_codes = {item["code"] for item in persisted_codes.json()["codes"]}
            assert set(generated_codes).issubset(listed_codes)
        finally:
            async def cleanup_records() -> None:
                async with AsyncSessionLocal() as db:
                    if generated_codes:
                        await db.execute(delete(RedeemCode).where(RedeemCode.code.in_(generated_codes)))
                    await db.execute(delete(SubscriptionOrder).where(SubscriptionOrder.username == username))
                    await db.execute(delete(Subscription).where(Subscription.username == username))
                    await db.commit()

            asyncio.run(cleanup_records())
            admin.request("DELETE", "/api/v1/users/batch", json={"usernames": [username]})
