"""学员待支付订单的本人取消与越权保护。"""

import asyncio
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.subscription import Subscription, SubscriptionOrder


def _login(client: TestClient, username: str, password: str) -> None:
    response = client.post(
        "/api/v1/auth/login", json={"username": username, "password": password}
    )
    assert response.status_code == 200, response.text


def _create_student(admin: TestClient, username: str) -> None:
    response = admin.post(
        "/api/v1/users",
        json={"username": username, "password": "test1234", "role": "student"},
    )
    assert response.status_code == 200, response.text


async def _delete_subscription_rows(usernames: list[str]) -> None:
    async with AsyncSessionLocal() as db:
        await db.execute(delete(SubscriptionOrder).where(SubscriptionOrder.username.in_(usernames)))
        await db.execute(delete(Subscription).where(Subscription.username.in_(usernames)))
        await db.commit()


async def _set_order_state(order_id: str, *, status: str, pay_status: str) -> None:
    async with AsyncSessionLocal() as db:
        order = await db.get(SubscriptionOrder, order_id)
        assert order is not None
        order.status = status
        order.pay_status = pay_status
        await db.commit()


def test_student_can_cancel_only_their_own_pending_order() -> None:
    token = uuid4().hex[:10]
    owner_name = f"cancel-owner-{token}"
    other_name = f"cancel-other-{token}"
    admin = TestClient(app)
    owner = TestClient(app)
    other = TestClient(app)
    _login(admin, "admin", "jbgsnmm~123")
    _create_student(admin, owner_name)
    _create_student(admin, other_name)
    try:
        _login(owner, owner_name, "test1234")
        _login(other, other_name, "test1234")
        created = owner.post(
            "/api/v1/subscriptions/orders", json={"planId": "monthly"}
        )
        assert created.status_code == 200, created.text
        order_id = created.json()["order"]["id"]

        foreign = other.post(
            f"/api/v1/subscriptions/orders/{order_id}/self-cancel"
        )
        assert foreign.status_code == 404

        cancelled = owner.post(
            f"/api/v1/subscriptions/orders/{order_id}/self-cancel"
        )
        assert cancelled.status_code == 200, cancelled.text
        assert cancelled.json()["order"]["status"] == "cancelled"

        repeated = owner.post(
            f"/api/v1/subscriptions/orders/{order_id}/self-cancel"
        )
        assert repeated.status_code == 400

        approved = owner.post(
            "/api/v1/subscriptions/orders", json={"planId": "quarterly"}
        )
        assert approved.status_code == 200, approved.text
        approved_id = approved.json()["order"]["id"]
        asyncio.run(_set_order_state(approved_id, status="approved", pay_status="pending"))
        assert owner.post(
            f"/api/v1/subscriptions/orders/{approved_id}/self-cancel"
        ).status_code == 400

        paid = owner.post(
            "/api/v1/subscriptions/orders", json={"planId": "half_year"}
        )
        assert paid.status_code == 200, paid.text
        paid_id = paid.json()["order"]["id"]
        asyncio.run(_set_order_state(paid_id, status="approved", pay_status="paid"))
        assert owner.post(
            f"/api/v1/subscriptions/orders/{paid_id}/self-cancel"
        ).status_code == 400
    finally:
        asyncio.run(_delete_subscription_rows([owner_name, other_name]))
        admin.request(
            "DELETE", "/api/v1/users/batch", json={"usernames": [owner_name, other_name]}
        )


def test_each_order_request_creates_a_fresh_order_and_cancels_stale_pending() -> None:
    token = uuid4().hex[:10]
    username = f"single-native-order-{token}"
    admin = TestClient(app)
    student = TestClient(app)
    _login(admin, "admin", "jbgsnmm~123")
    _create_student(admin, username)
    try:
        _login(student, username, "test1234")
        first = student.post("/api/v1/subscriptions/orders", json={"planId": "monthly"})
        assert first.status_code == 200, first.text
        second = student.post("/api/v1/subscriptions/orders", json={"planId": "quarterly"})
        assert second.status_code == 200, second.text
        # 不复用待支付订单：点击哪个套餐就出现哪个套餐的新订单
        assert second.json()["order"]["id"] != first.json()["order"]["id"]
        assert second.json()["order"]["planId"] == "quarterly"
        # 旧待支付订单被自动作废，避免旧二维码仍可支付
        from app.db.session import AsyncSessionLocal

        async def stale_count() -> int:
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    select(SubscriptionOrder).where(
                        SubscriptionOrder.username == username,
                        SubscriptionOrder.id == first.json()["order"]["id"],
                        SubscriptionOrder.status == "pending",
                    )
                )
                return len(result.scalars().all())

        assert asyncio.run(stale_count()) == 0
    finally:
        asyncio.run(_delete_subscription_rows([username]))
        admin.request("DELETE", "/api/v1/users/batch", json={"usernames": [username]})


def test_unavailable_native_payment_is_terminal_and_never_reused_as_pending(monkeypatch) -> None:
    from app.services import subscription_service

    async def no_native_payment_config(_db):
        return {"enableDemo": False}

    monkeypatch.setattr(
        subscription_service.system_service,
        "get_wechat_pay_config",
        no_native_payment_config,
    )
    token = uuid4().hex[:10]
    username = f"native-payment-unavailable-{token}"
    admin = TestClient(app)
    student = TestClient(app)
    _login(admin, "admin", "jbgsnmm~123")
    _create_student(admin, username)
    try:
        _login(student, username, "test1234")
        first = student.post("/api/v1/subscriptions/orders", json={"planId": "monthly"})
        assert first.status_code == 200, first.text
        assert first.json()["order"]["status"] == "cancelled"
        assert first.json()["order"]["payStatus"] == "failed"

        second = student.post("/api/v1/subscriptions/orders", json={"planId": "quarterly"})
        assert second.status_code == 200, second.text
        assert second.json()["order"]["id"] != first.json()["order"]["id"]

        async def pending_count() -> int:
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    select(SubscriptionOrder).where(
                        SubscriptionOrder.username == username,
                        SubscriptionOrder.status == "pending",
                    )
                )
                return len(result.scalars().all())

        assert asyncio.run(pending_count()) == 0
    finally:
        asyncio.run(_delete_subscription_rows([username]))
        admin.request("DELETE", "/api/v1/users/batch", json={"usernames": [username]})


def test_order_terminal_transitions_lock_the_order_row() -> None:
    import inspect

    from app.services import subscription_service as service

    for function in (service.activate_paid_order, service.approve_order, service.cancel_order):
        assert "with_for_update" in inspect.getsource(function)


def test_pending_native_orders_use_a_per_student_transaction_lock() -> None:
    import inspect

    from app.services import subscription_service as service

    source = inspect.getsource(service.request_order)
    assert "pg_advisory_xact_lock" in source
    assert "subscription-native-order:{username}" in source
