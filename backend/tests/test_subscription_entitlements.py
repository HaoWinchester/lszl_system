"""Server-side subscription entitlements must fail closed."""

import asyncio
from datetime import timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select

from app.core.security import now_utc
from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.subscription import RedeemCode, Subscription, SubscriptionOrder
from app.services.subscription_service import entitlements_for


def _subscription(
    plan_id: str,
    *,
    status: str = "active",
    expires_at=None,
) -> Subscription:
    return Subscription(
        username="entitlement-probe",
        plan_id=plan_id,
        status=status,
        expires_at=expires_at,
    )


@pytest.mark.parametrize("role", ["admin", "teacher"])
def test_teaching_roles_bypass_student_subscription_checks(role: str) -> None:
    assert entitlements_for(role, None) == {"allExamPapers": True}


@pytest.mark.parametrize("role", ["student", "viewer", "guest", "unknown"])
def test_non_teaching_roles_fail_closed_without_a_paid_subscription(role: str) -> None:
    assert entitlements_for(role, None) == {"allExamPapers": False}


@pytest.mark.parametrize("plan_id", ["monthly", "quarterly", "half_year"])
def test_finite_paid_plans_require_a_future_expiry(plan_id: str) -> None:
    assert entitlements_for("student", _subscription(plan_id)) == {"allExamPapers": False}
    assert entitlements_for(
        "student",
        _subscription(plan_id, expires_at=now_utc() - timedelta(seconds=1)),
    ) == {"allExamPapers": False}
    assert entitlements_for(
        "student",
        _subscription(plan_id, expires_at=now_utc() + timedelta(days=1)),
    ) == {"allExamPapers": True}


def test_lifetime_is_the_only_paid_plan_allowed_without_expiry() -> None:
    assert entitlements_for("student", _subscription("lifetime")) == {"allExamPapers": True}
    assert entitlements_for("student", _subscription("bogus")) == {"allExamPapers": False}
    assert entitlements_for("student", _subscription("free")) == {"allExamPapers": False}
    assert entitlements_for(
        "student", _subscription("lifetime", status="paused")
    ) == {"allExamPapers": False}


def test_visitor_can_read_database_backed_subscription_plans() -> None:
    with TestClient(app) as visitor:
        response = visitor.get("/api/v1/subscriptions/plans")

    assert response.status_code == 200, response.text
    plans = response.json()["plans"]
    assert {plan["planId"] for plan in plans} >= {"free", "monthly", "quarterly", "half_year", "lifetime"}
    assert all(plan["originalPriceText"] for plan in plans)


def test_subscription_write_endpoints_reject_unknown_plan_ids() -> None:
    token = uuid4().hex[:10]
    username = f"plan-validation-{token}"
    invalid_plan = f"bogus-{token}"

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(SubscriptionOrder).where(SubscriptionOrder.username == username))
            await db.execute(delete(Subscription).where(Subscription.username == username))
            await db.execute(delete(RedeemCode).where(RedeemCode.plan_id == invalid_plan))
            await db.commit()

    async def write_state() -> tuple[int, tuple[str, str] | None, int]:
        async with AsyncSessionLocal() as db:
            order_count = await db.scalar(
                select(func.count())
                .select_from(SubscriptionOrder)
                .where(SubscriptionOrder.username == username)
            )
            subscription = await db.scalar(
                select(Subscription).where(Subscription.username == username)
            )
            code_count = await db.scalar(
                select(func.count())
                .select_from(RedeemCode)
                .where(RedeemCode.plan_id == invalid_plan)
            )
            subscription_state = (
                (subscription.plan_id, subscription.status)
                if subscription is not None
                else None
            )
            return int(order_count or 0), subscription_state, int(code_count or 0)

    with TestClient(app) as admin, TestClient(app) as student:
        assert admin.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": "jbgsnmm~123"},
        ).status_code == 200
        created = admin.post(
            "/api/v1/users",
            json={"username": username, "password": "test1234", "role": "student"},
        )
        assert created.status_code == 200, created.text
        try:
            before = asyncio.run(write_state())
            assert student.post(
                "/api/v1/auth/login",
                json={"username": username, "password": "test1234"},
            ).status_code == 200
            order = student.post(
                "/api/v1/subscriptions/orders", json={"planId": invalid_plan}
            )
            manual = admin.put(
                f"/api/v1/subscriptions/admin/{username}",
                json={"planId": invalid_plan, "status": "active"},
            )
            codes = admin.post(
                "/api/v1/subscriptions/redeem-codes/generate",
                json={"planId": invalid_plan, "count": 1},
            )

            assert order.status_code == 400
            assert manual.status_code == 400
            assert codes.status_code == 400
            assert asyncio.run(write_state()) == before
        finally:
            asyncio.run(cleanup())
            admin.request(
                "DELETE", "/api/v1/users/batch", json={"usernames": [username]}
            )
