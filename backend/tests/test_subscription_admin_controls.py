"""Behavioral coverage for server-backed subscription administration controls."""

import asyncio
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.subscription import RedeemCode, Subscription, SubscriptionOrder
from app.models.user import UserAdminLog


def login_admin(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/login",
        json={"username": "admin", "password": "jbgsnmm~123"},
    )
    assert response.status_code == 200, response.text


def create_student(admin: TestClient, username: str) -> None:
    response = admin.post(
        "/api/v1/users",
        json={"username": username, "password": "test1234", "role": "student"},
    )
    assert response.status_code == 200, response.text


def insert_pending_order(username: str, order_id: str) -> None:
    async def insert() -> None:
        async with AsyncSessionLocal() as db:
            db.add(
                SubscriptionOrder(
                    id=order_id,
                    username=username,
                    plan_id="monthly",
                    plan_name="月度会员",
                    status="pending",
                    note="学员原始申请",
                )
            )
            await db.commit()

    asyncio.run(insert())


def cleanup_records(
    username: str | None,
    *,
    code_ids: list[str] | None = None,
    log_ids: list[str] | None = None,
) -> None:
    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            if code_ids:
                await db.execute(delete(RedeemCode).where(RedeemCode.id.in_(code_ids)))
            if log_ids:
                await db.execute(delete(UserAdminLog).where(UserAdminLog.id.in_(log_ids)))
            if username:
                await db.execute(
                    delete(SubscriptionOrder).where(SubscriptionOrder.username == username)
                )
                await db.execute(delete(Subscription).where(Subscription.username == username))
            await db.commit()

    asyncio.run(cleanup())


def test_redeem_code_controls_persist_prefix_note_status_and_delete() -> None:
    marker = uuid4().hex[:8].upper()
    prefix = f"R{marker[:6]}"
    note = f"线下活动-{marker}"
    created_ids: list[str] = []
    with TestClient(app) as admin, TestClient(app) as fresh_admin:
        login_admin(admin)
        try:
            generated = admin.post(
                "/api/v1/subscriptions/redeem-codes/generate",
                json={
                    "planId": "monthly",
                    "count": 2,
                    "prefix": prefix,
                    "note": note,
                },
            )
            assert generated.status_code == 200, generated.text
            generated_codes = generated.json()["codes"]
            assert len(generated_codes) == 2
            assert all(code.startswith(f"{prefix}-") for code in generated_codes)

            login_admin(fresh_admin)
            listed = fresh_admin.get("/api/v1/subscriptions/redeem-codes")
            assert listed.status_code == 200, listed.text
            records = [
                record for record in listed.json()["codes"] if record["code"] in generated_codes
            ]
            assert len(records) == 2
            assert {record["note"] for record in records} == {note}
            created_ids = [record["id"] for record in records]

            disabled = admin.patch(
                f"/api/v1/subscriptions/redeem-codes/{created_ids[0]}",
                json={"status": "disabled"},
            )
            assert disabled.status_code == 200, disabled.text
            assert disabled.json()["code"]["status"] == "disabled"

            read_disabled = next(
                record
                for record in fresh_admin.get(
                    "/api/v1/subscriptions/redeem-codes"
                ).json()["codes"]
                if record["id"] == created_ids[0]
            )
            assert read_disabled["status"] == "disabled"
            assert read_disabled["note"] == note

            enabled = admin.patch(
                f"/api/v1/subscriptions/redeem-codes/{created_ids[0]}",
                json={"status": "unused"},
            )
            assert enabled.status_code == 200, enabled.text
            assert enabled.json()["code"]["status"] == "unused"

            removed = admin.delete(
                f"/api/v1/subscriptions/redeem-codes/{created_ids[0]}"
            )
            assert removed.status_code == 200, removed.text
            remaining_ids = {
                record["id"]
                for record in fresh_admin.get(
                    "/api/v1/subscriptions/redeem-codes"
                ).json()["codes"]
            }
            assert created_ids[0] not in remaining_ids
            created_ids = created_ids[1:]
        finally:
            cleanup_records(None, code_ids=created_ids)


def test_redeem_code_controls_validate_payloads_and_require_admin() -> None:
    username = f"redeem-permission-{uuid4().hex[:10]}"
    with TestClient(app) as admin, TestClient(app) as student:
        login_admin(admin)
        create_student(admin, username)
        try:
            assert student.post(
                "/api/v1/auth/login",
                json={"username": username, "password": "test1234"},
            ).status_code == 200
            forbidden = student.post(
                "/api/v1/subscriptions/redeem-codes/generate",
                json={"planId": "monthly", "count": 1, "prefix": "SAFE"},
            )
            assert forbidden.status_code == 403, forbidden.text
            assert student.patch(
                "/api/v1/subscriptions/redeem-codes/not-owned",
                json={"status": "disabled"},
            ).status_code == 403
            assert student.delete(
                "/api/v1/subscriptions/redeem-codes/not-owned"
            ).status_code == 403

            invalid_prefix = admin.post(
                "/api/v1/subscriptions/redeem-codes/generate",
                json={"planId": "monthly", "count": 1, "prefix": "BAD PREFIX"},
            )
            assert invalid_prefix.status_code == 422, invalid_prefix.text
            invalid_count = admin.post(
                "/api/v1/subscriptions/redeem-codes/generate",
                json={"planId": "monthly", "count": 201, "prefix": "SAFE"},
            )
            assert invalid_count.status_code == 422, invalid_count.text
            invalid_status = admin.patch(
                "/api/v1/subscriptions/redeem-codes/not-owned",
                json={"status": "used"},
            )
            assert invalid_status.status_code == 422, invalid_status.text
        finally:
            cleanup_records(username)
            admin.request("DELETE", "/api/v1/users/batch", json={"usernames": [username]})


def test_admin_order_cancel_persists_the_submitted_reason_on_fresh_read() -> None:
    username = f"cancel-reason-{uuid4().hex[:10]}"
    order_id = f"cancel_{uuid4().hex}"
    reason = f"资料不完整-{uuid4().hex[:8]}"
    with TestClient(app) as admin, TestClient(app) as fresh_admin:
        login_admin(admin)
        create_student(admin, username)
        insert_pending_order(username, order_id)
        try:
            cancelled = admin.post(
                f"/api/v1/subscriptions/orders/{order_id}/cancel",
                json={"note": reason},
            )
            assert cancelled.status_code == 200, cancelled.text
            assert cancelled.json()["order"]["status"] == "cancelled"
            assert cancelled.json()["order"]["note"] == "学员原始申请"
            assert cancelled.json()["order"]["adminNote"] == reason

            login_admin(fresh_admin)
            reloaded = fresh_admin.get("/api/v1/subscriptions/orders")
            assert reloaded.status_code == 200, reloaded.text
            record = next(item for item in reloaded.json()["orders"] if item["id"] == order_id)
            assert record["status"] == "cancelled"
            assert record["note"] == "学员原始申请"
            assert record["adminNote"] == reason
        finally:
            cleanup_records(username)
            admin.request("DELETE", "/api/v1/users/batch", json={"usernames": [username]})


def test_subscription_admin_mutations_persist_actor_action_and_target_audits() -> None:
    marker = uuid4().hex[:10].upper()
    username = f"audit-sub-{uuid4().hex[:10]}"
    order_id = f"audit_{uuid4().hex}"
    reason = f"审核取消-{marker}"
    code_ids: list[str] = []
    log_ids: list[str] = []
    with TestClient(app) as admin, TestClient(app) as fresh_admin:
        login_admin(admin)
        create_student(admin, username)
        insert_pending_order(username, order_id)
        try:
            generated = admin.post(
                "/api/v1/subscriptions/redeem-codes/generate",
                json={
                    "planId": "monthly",
                    "count": 1,
                    "prefix": f"A{marker[:6]}",
                    "note": marker,
                },
            )
            assert generated.status_code == 200, generated.text
            generated_code = generated.json()["codes"][0]

            listed_codes = admin.get("/api/v1/subscriptions/redeem-codes").json()["codes"]
            code = next(item for item in listed_codes if item["code"] == generated_code)
            code_ids = [code["id"]]
            disabled = admin.patch(
                f"/api/v1/subscriptions/redeem-codes/{code['id']}",
                json={"status": "disabled"},
            )
            assert disabled.status_code == 200, disabled.text
            enabled = admin.patch(
                f"/api/v1/subscriptions/redeem-codes/{code['id']}",
                json={"status": "unused"},
            )
            assert enabled.status_code == 200, enabled.text
            removed = admin.delete(f"/api/v1/subscriptions/redeem-codes/{code['id']}")
            assert removed.status_code == 200, removed.text
            code_ids = []

            cancelled = admin.post(
                f"/api/v1/subscriptions/orders/{order_id}/cancel",
                json={"note": reason},
            )
            assert cancelled.status_code == 200, cancelled.text

            login_admin(fresh_admin)
            response = fresh_admin.get("/api/v1/system/logs", params={"limit": 100})
            assert response.status_code == 200, response.text
            logs = response.json()["logs"]
            expected = {
                "generate_redeem_codes": generated_code,
                "disable_redeem_code": generated_code,
                "enable_redeem_code": generated_code,
                "delete_redeem_code": generated_code,
                "cancel_subscription_order": username,
            }
            matched = {
                row["action"]: row
                for row in logs
                if row["action"] in expected
                and row["target_username"] == expected[row["action"]]
                and row["actor"] == "admin"
            }
            assert set(matched) == set(expected)
            assert marker in matched["generate_redeem_codes"]["detail"]
            assert reason in matched["cancel_subscription_order"]["detail"]
            log_ids = [row["id"] for row in matched.values()]
        finally:
            cleanup_records(username, code_ids=code_ids, log_ids=log_ids)
            admin.request("DELETE", "/api/v1/users/batch", json={"usernames": [username]})


def test_admin_order_cancel_validates_reason_and_requires_admin() -> None:
    username = f"cancel-permission-{uuid4().hex[:10]}"
    order_id = f"cancel_{uuid4().hex}"
    with TestClient(app) as admin, TestClient(app) as student:
        login_admin(admin)
        create_student(admin, username)
        insert_pending_order(username, order_id)
        try:
            assert student.post(
                "/api/v1/auth/login",
                json={"username": username, "password": "test1234"},
            ).status_code == 200
            forbidden = student.post(
                f"/api/v1/subscriptions/orders/{order_id}/cancel",
                json={"note": "不应允许"},
            )
            assert forbidden.status_code == 403, forbidden.text

            invalid = admin.post(
                f"/api/v1/subscriptions/orders/{order_id}/cancel",
                json={"note": "x" * 501},
            )
            assert invalid.status_code == 422, invalid.text

            async def status_after_invalid() -> tuple[str, str | None]:
                async with AsyncSessionLocal() as db:
                    order = await db.get(SubscriptionOrder, order_id)
                    assert order is not None
                    return order.status, order.note

            assert asyncio.run(status_after_invalid()) == ("pending", "学员原始申请")
        finally:
            cleanup_records(username)
            admin.request("DELETE", "/api/v1/users/batch", json={"usernames": [username]})
