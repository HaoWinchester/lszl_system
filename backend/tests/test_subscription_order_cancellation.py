"""学员待支付订单的本人取消与越权保护。"""

import asyncio
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import delete

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
    _login(admin, "admin", "admin123")
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


def test_order_terminal_transitions_lock_the_order_row() -> None:
    import inspect

    from app.services import subscription_service as service

    for function in (service.activate_paid_order, service.approve_order, service.cancel_order):
        assert "with_for_update" in inspect.getsource(function)
