import asyncio
from datetime import timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.core.security import hash_password, now_utc
from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.content_prep import (
    QuestionAuditLog,
    QuestionBankCollaborator,
    QuestionEditLock,
)
from app.models.question import Question, QuestionBank
from app.models.user import User
from app.services.question_lock_service import (
    QuestionLockError,
    acquire_lock,
    assert_lock_and_revision,
    heartbeat_lock,
    release_lock,
)


PASSWORD = "question-lock-pass"


def test_per_question_lock_lifecycle_conflicts_and_force_release() -> None:
    suffix = uuid4().hex[:10]
    owner_name = f"lock-owner-{suffix}"
    other_name = f"lock-other-{suffix}"
    bank_id = f"lock-bank-{suffix}"
    question_ids = [f"lock-question-{index}-{suffix}" for index in range(1, 4)]

    async def seed() -> None:
        password_hash = hash_password(PASSWORD)
        async with AsyncSessionLocal() as db:
            db.add_all(
                [
                    User(
                        username=owner_name,
                        password_hash=password_hash,
                        role="teacher",
                        status="active",
                    ),
                    User(
                        username=other_name,
                        password_hash=password_hash,
                        role="teacher",
                        status="active",
                    ),
                ]
            )
            await db.flush()
            db.add(
                QuestionBank(
                    id=bank_id,
                    owner_id=owner_name,
                    name="锁测试题库",
                    subject="PMP",
                )
            )
            await db.flush()
            db.add(
                QuestionBankCollaborator(
                    id=f"lock-collaborator-{suffix}",
                    bank_id=bank_id,
                    username=other_name,
                    permission="edit",
                    granted_by=owner_name,
                )
            )
            db.add_all(
                [
                    Question(
                        id=question_id,
                        bank_id=bank_id,
                        title=f"锁测试题 {index}",
                        subject="PMP",
                        revision=3,
                        creator_id=("creator_001" if index == 1 else None),
                        creator_name=("波塞冬" if index == 1 else None),
                    )
                    for index, question_id in enumerate(question_ids, start=1)
                ]
            )
            await db.commit()

    async def service_scenario() -> str:
        async with AsyncSessionLocal() as db:
            owner = await db.get(User, owner_name)
            other = await db.get(User, other_name)
            first_question = await db.get(Question, question_ids[0])
            assert owner is not None and other is not None and first_question is not None

            first = await acquire_lock(
                db,
                first_question.id,
                owner,
                client_instance_id="client-owner",
                creator_id=None,
            )
            assert first["questionId"] == first_question.id
            assert first["lockedBy"] == owner_name
            assert first["creatorId"] == "creator_001"
            assert first["creatorName"] == "波塞冬"
            assert first["heartbeatIntervalSeconds"] == 30
            assert first["leaseSeconds"] == 300
            stored = await db.get(QuestionEditLock, first_question.id)
            assert stored is not None
            assert stored.token_hash != first["lockToken"]
            assert len(stored.token_hash) == 64

            repeated = await acquire_lock(
                db,
                first_question.id,
                owner,
                client_instance_id="client-owner",
                creator_id="creator_001",
            )
            assert repeated["lockedBy"] == owner_name
            assert repeated["lockToken"] != first["lockToken"]

            with pytest.raises(QuestionLockError) as occupied:
                await acquire_lock(
                    db,
                    first_question.id,
                    other,
                    client_instance_id="client-other",
                    creator_id="creator_006",
                )
            assert occupied.value.code == "LOCKED_BY_OTHER"

            second = await acquire_lock(
                db,
                question_ids[1],
                other,
                client_instance_id="client-other",
                creator_id=None,
            )
            assert second["lockedBy"] == other_name
            assert second["creatorId"] is None

            before_expiry = repeated["expiresAt"]
            heartbeat = await heartbeat_lock(
                db,
                first_question.id,
                owner,
                client_instance_id="client-owner",
                lock_token=repeated["lockToken"],
            )
            assert heartbeat["expiresAt"] >= before_expiry

            with pytest.raises(QuestionLockError) as bad_token:
                await release_lock(
                    db,
                    first_question.id,
                    owner,
                    client_instance_id="client-owner",
                    lock_token="wrong-token",
                )
            assert bad_token.value.code == "LOCK_TOKEN_INVALID"

            with pytest.raises(QuestionLockError) as revision_error:
                await assert_lock_and_revision(
                    db,
                    first_question,
                    owner,
                    client_instance_id="client-owner",
                    lock_token=repeated["lockToken"],
                    base_revision=2,
                )
            assert revision_error.value.code == "REVISION_CONFLICT"
            await assert_lock_and_revision(
                db,
                first_question,
                owner,
                client_instance_id="client-owner",
                lock_token=repeated["lockToken"],
                base_revision=3,
            )

            stored = await db.get(QuestionEditLock, first_question.id)
            assert stored is not None
            stored.expires_at = now_utc() - timedelta(seconds=1)
            await db.commit()
            takeover = await acquire_lock(
                db,
                first_question.id,
                other,
                client_instance_id="client-other",
                creator_id="creator_006",
            )
            assert takeover["lockedBy"] == other_name
            assert takeover["creatorName"] == "女帝"
            with pytest.raises(QuestionLockError) as old_token:
                await assert_lock_and_revision(
                    db,
                    first_question,
                    owner,
                    client_instance_id="client-owner",
                    lock_token=repeated["lockToken"],
                    base_revision=3,
                )
            assert old_token.value.code in {"LOCKED_BY_OTHER", "LOCK_TOKEN_INVALID"}
            await release_lock(
                db,
                first_question.id,
                other,
                client_instance_id="client-other",
                lock_token=takeover["lockToken"],
            )
            return second["lockToken"]

    async def concurrent_scenario() -> None:
        async def attempt(username: str, client_id: str, creator_id: str):
            async with AsyncSessionLocal() as db:
                actor = await db.get(User, username)
                assert actor is not None
                try:
                    result = await acquire_lock(
                        db,
                        question_ids[2],
                        actor,
                        client_instance_id=client_id,
                        creator_id=creator_id,
                    )
                    return "acquired", result["lockedBy"]
                except QuestionLockError as error:
                    return error.code, username

        results = await asyncio.gather(
            attempt(owner_name, "concurrent-owner", "creator_001"),
            attempt(other_name, "concurrent-other", "creator_006"),
        )
        assert sorted(result[0] for result in results) == ["LOCKED_BY_OTHER", "acquired"]

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(QuestionEditLock).where(QuestionEditLock.question_id.in_(question_ids)))
            await db.execute(
                delete(QuestionAuditLog).where(QuestionAuditLog.bank_id == bank_id)
            )
            await db.execute(delete(Question).where(Question.id.in_(question_ids)))
            await db.execute(
                delete(QuestionBankCollaborator).where(
                    QuestionBankCollaborator.bank_id == bank_id
                )
            )
            await db.execute(delete(QuestionBank).where(QuestionBank.id == bank_id))
            await db.execute(delete(User).where(User.username.in_([owner_name, other_name])))
            await db.commit()

    asyncio.run(seed())
    try:
        second_token = asyncio.run(service_scenario())
        with TestClient(app) as client:
            login = client.post(
                "/api/v1/auth/login",
                json={"username": owner_name, "password": PASSWORD},
            )
            assert login.status_code == 200
            unknown_creator = client.post(
                f"/api/v1/content-prep/locks/{question_ids[0]}",
                json={"clientInstanceId": "route-owner", "creatorId": "forged"},
            )
            assert unknown_creator.status_code == 422
            assert unknown_creator.json()["detail"]["code"] == "UNKNOWN_CREATOR"
            route_lock = client.post(
                f"/api/v1/content-prep/locks/{question_ids[0]}",
                json={"clientInstanceId": "route-owner", "creatorId": "creator_001"},
            )
            assert route_lock.status_code == 200
            route_grant = route_lock.json()
            assert route_grant["lockedBy"] == owner_name
            route_heartbeat = client.put(
                f"/api/v1/content-prep/locks/{question_ids[0]}/heartbeat",
                json={
                    "clientInstanceId": "route-owner",
                    "lockToken": route_grant["lockToken"],
                },
            )
            assert route_heartbeat.status_code == 200
            route_release = client.request(
                "DELETE",
                f"/api/v1/content-prep/locks/{question_ids[0]}",
                json={
                    "clientInstanceId": "route-owner",
                    "lockToken": route_grant["lockToken"],
                },
            )
            assert route_release.status_code == 200
            non_admin_force = client.delete(
                f"/api/v1/content-prep/locks/{question_ids[1]}/force"
            )
            assert non_admin_force.status_code == 403

            client.post("/api/v1/auth/logout")
            assert client.post(
                "/api/v1/auth/login",
                json={"username": "admin", "password": "jbgsnmm~123"},
            ).status_code == 200
            forced = client.delete(
                f"/api/v1/content-prep/locks/{question_ids[1]}/force"
            )
            assert forced.status_code == 200
            assert forced.json() == {"ok": True}

            client.post("/api/v1/auth/logout")
            assert client.post(
                "/api/v1/auth/login",
                json={"username": other_name, "password": PASSWORD},
            ).status_code == 200
            stale_release = client.request(
                "DELETE",
                f"/api/v1/content-prep/locks/{question_ids[1]}",
                json={
                    "clientInstanceId": "client-other",
                    "lockToken": second_token,
                },
            )
            assert stale_release.status_code == 409
            assert stale_release.json()["detail"]["code"] == "LOCK_TOKEN_INVALID"

        asyncio.run(concurrent_scenario())

        async def assert_force_audit() -> None:
            async with AsyncSessionLocal() as db:
                audit = (
                    await db.execute(
                        select(QuestionAuditLog).where(
                            QuestionAuditLog.question_id == question_ids[1],
                            QuestionAuditLog.action == "lock_force_released",
                            QuestionAuditLog.actor_username == "admin",
                        )
                    )
                ).scalar_one_or_none()
                assert audit is not None

        asyncio.run(assert_force_audit())
    finally:
        asyncio.run(cleanup())
