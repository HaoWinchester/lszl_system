"""Expired plans renew through real orders and verified-payment activation once."""

import asyncio
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.subscription import Subscription, SubscriptionOrder
from app.models.user import User, UserAdminLog
from app.services import subscription_service, system_service, wechat_pay_service


NOW = datetime(2035, 1, 5, 12, tzinfo=timezone.utc)
EXPIRED_AT = NOW - timedelta(days=2)


@pytest.fixture
def native_payment(monkeypatch):
    """Replace provider boundaries; order persistence and activation remain real."""
    config = {
        "enableDemo": False,
        "mchId": "fixture-merchant",
        "apiV3Key": "fixture-key",
        "mchSerialNo": "fixture-serial",
        "mchPrivateKey": "fixture-private-key",
        "wxPubKey": "fixture-public-key",
        "wxPubKeyId": "fixture-public-key-id",
        "appId": "fixture-app",
        "notifyUrl": "https://fixture.invalid/api/v1/subscriptions/wechat-pay/notify",
    }
    transaction = {}

    async def payment_config(_db):
        return config

    async def create_native_order(order_id, _description, _amount, _config):
        return f"weixin://wxpay/bizpayurl?fixture={order_id}"

    monkeypatch.setattr(subscription_service, "now_utc", lambda: NOW)
    monkeypatch.setattr(system_service, "get_wechat_pay_config", payment_config)
    monkeypatch.setattr(wechat_pay_service, "create_native_order", create_native_order)
    monkeypatch.setattr(wechat_pay_service, "verify_signature", lambda *args: True)
    monkeypatch.setattr(wechat_pay_service, "decrypt_resource", lambda *args: transaction)
    return transaction


@pytest.fixture
def student():
    username = f"expired-renewal-{uuid4().hex[:16]}"

    async def cleanup():
        async with AsyncSessionLocal() as db:
            await db.execute(delete(SubscriptionOrder).where(SubscriptionOrder.username == username))
            await db.execute(delete(Subscription).where(Subscription.username == username))
            await db.execute(delete(UserAdminLog).where(UserAdminLog.target_username == username))
            await db.execute(delete(User).where(User.username == username))
            await db.commit()

    with TestClient(app) as client:
        try:
            registered = client.post(
                "/api/v1/auth/register",
                json={"username": username, "password": "isolated-renewal-password"},
            )
            assert registered.status_code == 200, registered.text
            yield client, username
        finally:
            asyncio.run(cleanup())


@pytest.mark.parametrize("plan_id,days", [("monthly", 30), ("quarterly", 90), ("half_year", 180)])
@pytest.mark.parametrize("original_status", ["active", "expired"])
def test_expired_same_plan_requires_payment_and_activates_once(
    student, native_payment, plan_id, days, original_status
):
    """Catch premature activation, renewal from stale expiry, and callback replay."""
    client, username = student

    async def seed_expired_subscription():
        async with AsyncSessionLocal() as db:
            db.add(Subscription(
                username=username,
                plan_id=plan_id,
                status=original_status,
                started_at=NOW - timedelta(days=200),
                expires_at=EXPIRED_AT,
                source="wechat_pay",
            ))
            await db.commit()

    asyncio.run(seed_expired_subscription())
    before = client.get("/api/v1/subscriptions/me")
    assert before.status_code == 200, before.text
    assert before.json()["entitlements"]["allExamPapers"] is False

    created = client.post("/api/v1/subscriptions/orders", json={"planId": plan_id})
    assert created.status_code == 200, created.text
    order = created.json()["order"]
    assert order["planId"] == plan_id
    assert order["status"] == "pending" and order["payStatus"] == "pending"
    assert order["codeUrl"] and order["amount"] > 0

    unpaid = client.get("/api/v1/subscriptions/me")
    assert unpaid.status_code == 200, unpaid.text
    assert unpaid.json() == before.json(), "Generating a payment QR must not activate expired membership"

    native_payment.update({
        "trade_state": "SUCCESS",
        "out_trade_no": order["id"],
        "transaction_id": "provider-" + order["id"],
        "amount": {"total": order["amount"], "currency": "CNY"},
    })
    for _ in range(2):
        notified = client.post("/api/v1/subscriptions/wechat-pay/notify", json={"resource": {}})
        assert notified.status_code == 200, notified.text
        status = client.get(f"/api/v1/subscriptions/orders/{order['id']}/status")
        assert status.status_code == 200, status.text
        paid = status.json()
        assert paid["status"] == "approved" and paid["payStatus"] == "paid"
        assert paid["subscription"]["planId"] == plan_id
        assert paid["subscription"]["status"] == "active"
        assert paid["subscription"]["source"] == "wechat_pay"
        assert datetime.fromisoformat(paid["subscription"]["expiresAt"]) == NOW + timedelta(days=days)
        active = client.get("/api/v1/subscriptions/me")
        assert active.status_code == 200, active.text
        assert active.json()["entitlements"]["allExamPapers"] is True
