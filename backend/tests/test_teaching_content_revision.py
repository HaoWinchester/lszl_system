import asyncio
import json
from copy import deepcopy
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.content_prep import (
    QuestionAuditLog,
    QuestionEditLock,
    QuestionUploadBatch,
)
from app.models.question import Question, QuestionBank
from app.models.shared_runtime_state import SharedRuntimeState
from app.models.user import User
from app.schemas.content_prep import ContentPrepBatchResult
from app.services import teaching_content_revision_service as revision_service
from tests.test_content_prep_upload import question_payload


PASSWORD = "revision-pass"


async def _snapshot_revision_row() -> dict | None:
    async with AsyncSessionLocal() as db:
        row = await db.get(SharedRuntimeState, revision_service.REVISION_KEY)
        if row is None:
            return None
        return {
            "value": row.value,
            "schema_version": row.schema_version,
            "updated_by": row.updated_by,
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        }


async def _restore_revision_row(snapshot: dict | None) -> None:
    async with AsyncSessionLocal() as db:
        await db.execute(
            delete(SharedRuntimeState).where(
                SharedRuntimeState.key == revision_service.REVISION_KEY
            )
        )
        if snapshot is not None:
            db.add(
                SharedRuntimeState(
                    key=revision_service.REVISION_KEY,
                    value=str(snapshot["value"]),
                    schema_version=int(snapshot["schema_version"]),
                    updated_by=snapshot["updated_by"],
                    created_at=snapshot["created_at"],
                    updated_at=snapshot["updated_at"],
                )
            )
        await db.commit()


def test_bump_is_monotonic_deduplicated_and_capped() -> None:
    """Catch lost increments, accumulated old changes, and unbounded payload growth."""

    async def scenario() -> None:
        snapshot = await _snapshot_revision_row()
        changes = [
            {
                "entityType": "question",
                "entityId": f"q-{index}",
                "action": "updated",
            }
            for index in range(105)
        ]
        changes.insert(1, deepcopy(changes[0]))
        try:
            async with AsyncSessionLocal() as db:
                first = await revision_service.bump(db, "teacher-a", changes)
                second = await revision_service.bump(
                    db,
                    "teacher-a",
                    [
                        {
                            "entityType": "principle",
                            "entityId": "p-1",
                            "action": "created",
                        }
                    ],
                )
                await db.commit()

            assert second["revision"] == first["revision"] + 1
            assert len(first["changes"]) == 100
            assert first["changes"][0] == {
                "entityType": "question",
                "entityId": "q-0",
                "action": "updated",
            }
            assert first["changes"][-1]["entityId"] == "q-99"
            assert second["changes"] == [
                {
                    "entityType": "principle",
                    "entityId": "p-1",
                    "action": "created",
                }
            ]
            assert second["updatedBy"] == "teacher-a"
            assert isinstance(second["updatedAt"], str) and second["updatedAt"]
        finally:
            await _restore_revision_row(snapshot)

    asyncio.run(scenario())


def test_bump_flushes_without_committing_the_callers_transaction() -> None:
    """Catch a service-level commit that would break a larger atomic write."""

    async def scenario() -> None:
        snapshot = await _snapshot_revision_row()
        try:
            async with AsyncSessionLocal() as db:
                before = await revision_service.current(db)
            if snapshot is None:
                assert before == {
                    "revision": 0,
                    "changes": [],
                    "updatedAt": None,
                    "updatedBy": None,
                }

            async with AsyncSessionLocal() as db:
                bumped = await revision_service.bump(
                    db,
                    "teacher-no-commit",
                    [
                        {
                            "entityType": "question",
                            "entityId": "q-rollback",
                            "action": "updated",
                        }
                    ],
                )
                assert bumped["revision"] == before["revision"] + 1
                # Closing the session rolls back because bump must only flush.

            async with AsyncSessionLocal() as db:
                after = await revision_service.current(db)
            assert after == before
        finally:
            await _restore_revision_row(snapshot)

    asyncio.run(scenario())


def test_missing_revision_row_starts_at_zero_and_first_bump_is_one() -> None:
    """Catch deriving the initial revision from unrelated database state."""

    async def scenario() -> None:
        snapshot = await _snapshot_revision_row()
        try:
            async with AsyncSessionLocal() as db:
                await db.execute(
                    delete(SharedRuntimeState).where(
                        SharedRuntimeState.key == revision_service.REVISION_KEY
                    )
                )
                await db.commit()

            async with AsyncSessionLocal() as db:
                assert await revision_service.current(db) == {
                    "revision": 0,
                    "changes": [],
                    "updatedAt": None,
                    "updatedBy": None,
                }

            async with AsyncSessionLocal() as db:
                first = await revision_service.bump(
                    db,
                    "teacher-first",
                    [
                        {
                            "entityType": "question",
                            "entityId": "q-first",
                            "action": "created",
                        }
                    ],
                )
                await db.commit()
            assert first["revision"] == 1
        finally:
            await _restore_revision_row(snapshot)

    asyncio.run(scenario())


def test_concurrent_bumps_do_not_lose_revisions() -> None:
    """Catch a read-modify-write race when multiple managers save together."""

    async def scenario() -> None:
        snapshot = await _snapshot_revision_row()
        worker_count = 8
        try:
            async with AsyncSessionLocal() as db:
                baseline = (await revision_service.current(db))["revision"]

            async def worker(index: int) -> int:
                async with AsyncSessionLocal() as db:
                    async with db.begin():
                        payload = await revision_service.bump(
                            db,
                            f"teacher-{index}",
                            [
                                {
                                    "entityType": "question",
                                    "entityId": f"q-concurrent-{index}",
                                    "action": "updated",
                                }
                            ],
                        )
                        return int(payload["revision"])

            revisions = await asyncio.gather(
                *(worker(index) for index in range(worker_count))
            )
            assert sorted(revisions) == list(
                range(baseline + 1, baseline + worker_count + 1)
            )
            async with AsyncSessionLocal() as db:
                current = await revision_service.current(db)
            assert current["revision"] == baseline + worker_count
        finally:
            await _restore_revision_row(snapshot)

    asyncio.run(scenario())


def test_revision_endpoint_filters_non_object_changes_from_a_damaged_row() -> None:
    """Catch a malformed persisted change crashing the revision polling endpoint."""

    async def seed() -> dict | None:
        snapshot = await _snapshot_revision_row()
        async with AsyncSessionLocal() as db:
            await db.execute(
                delete(SharedRuntimeState).where(
                    SharedRuntimeState.key == revision_service.REVISION_KEY
                )
            )
            db.add(
                SharedRuntimeState(
                    key=revision_service.REVISION_KEY,
                    value=json.dumps(
                        {
                            "revision": 7,
                            "changes": [
                                None,
                                "not-an-object",
                                {
                                    "entityType": "question",
                                    "entityId": "q-valid",
                                    "action": "updated",
                                },
                            ],
                            "updatedAt": "2026-08-10T10:00:00+00:00",
                            "updatedBy": "admin",
                        }
                    ),
                    updated_by="admin",
                )
            )
            await db.commit()
        return snapshot

    snapshot = asyncio.run(seed())
    try:
        with TestClient(app) as client:
            assert client.post(
                "/api/v1/auth/login",
                json={"username": "admin", "password": "admin123"},
            ).status_code == 200
            response = client.get("/api/v1/question-catalog/revision")
        assert response.status_code == 200, response.text
        assert response.json()["revision"] == 7
        assert response.json()["changes"] == [
            {
                "entityType": "question",
                "entityId": "q-valid",
                "action": "updated",
            }
        ]
    finally:
        asyncio.run(_restore_revision_row(snapshot))


def test_revision_endpoint_and_managed_bootstrap_are_role_safe() -> None:
    """Catch accidental public/student access or omission from managed bootstrap."""

    suffix = uuid4().hex[:10]
    usernames = {
        role: f"revision-{role}-{suffix}"
        for role in ("admin", "teacher", "student", "viewer")
    }

    async def seed() -> tuple[dict | None, int]:
        snapshot = await _snapshot_revision_row()
        async with AsyncSessionLocal() as db:
            password_hash = hash_password(PASSWORD)
            db.add_all(
                [
                    User(
                        username=username,
                        password_hash=password_hash,
                        role=role,
                        status="active",
                    )
                    for role, username in usernames.items()
                ]
            )
            await db.flush()
            payload = await revision_service.bump(
                db,
                usernames["teacher"],
                [
                    {
                        "entityType": "question",
                        "entityId": f"q-endpoint-{suffix}",
                        "action": "created",
                    }
                ],
            )
            await db.commit()
        return snapshot, int(payload["revision"])

    async def cleanup(snapshot: dict | None) -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(User).where(User.username.in_(usernames.values())))
            await db.commit()
        await _restore_revision_row(snapshot)

    snapshot, expected_revision = asyncio.run(seed())
    try:
        with TestClient(app) as client:
            assert client.get("/api/v1/question-catalog/revision").status_code == 401

            for role in ("admin", "teacher"):
                login = client.post(
                    "/api/v1/auth/login",
                    json={"username": usernames[role], "password": PASSWORD},
                )
                assert login.status_code == 200
                response = client.get("/api/v1/question-catalog/revision")
                assert response.status_code == 200
                assert response.json() == {
                    "revision": expected_revision,
                    "changes": [
                        {
                            "entityType": "question",
                            "entityId": f"q-endpoint-{suffix}",
                            "action": "created",
                        }
                    ],
                    "updatedAt": response.json()["updatedAt"],
                    "updatedBy": usernames["teacher"],
                }
                assert isinstance(response.json()["updatedAt"], str)

                bootstrap = client.get(
                    "/api/v1/question-catalog/bootstrap",
                    params={"mode": "managed"},
                )
                assert bootstrap.status_code == 200
                assert bootstrap.json()["contentRevision"] == expected_revision
                assert len(bootstrap.json()["catalogRevision"]) == 64
                client.post("/api/v1/auth/logout")

            for role in ("student", "viewer"):
                login = client.post(
                    "/api/v1/auth/login",
                    json={"username": usernames[role], "password": PASSWORD},
                )
                assert login.status_code == 200
                assert (
                    client.get("/api/v1/question-catalog/revision").status_code
                    == 403
                )
                client.post("/api/v1/auth/logout")
    finally:
        asyncio.run(cleanup(snapshot))


def test_content_prep_result_exposes_content_revision_in_camel_case() -> None:
    """Catch dropping the revision that clients publish after a successful save."""

    payload = ContentPrepBatchResult.model_validate(
        {
            "batchId": "batch-revision",
            "bankId": "bank-revision",
            "bankRevision": 2,
            "contentRevision": 9,
            "questions": [
                {
                    "questionId": "question-revision",
                    "status": "updated",
                    "revision": 2,
                    "contentHash": "a" * 64,
                }
            ],
        }
    ).model_dump(by_alias=True)

    assert payload["contentRevision"] == 9


@pytest.mark.parametrize(
    ("creator_id", "case_name"),
    [("creator_001", "standard"), (None, "legacy-null-creator")],
)
def test_single_question_save_returns_current_content_revision(
    creator_id: str | None,
    case_name: str,
) -> None:
    """Catch either single-save route returning success without a sync revision."""

    suffix = uuid4().hex[:10]
    bank_id = f"revision-save-bank-{suffix}"
    question_id = f"revision-save-question-{suffix}"
    client_instance_id = f"revision-save-client-{suffix}"

    async def seed() -> dict | None:
        snapshot = await _snapshot_revision_row()
        async with AsyncSessionLocal() as db:
            db.add(
                QuestionBank(
                    id=bank_id,
                    owner_id="admin",
                    name=f"revision {case_name} save bank",
                    subject="PMP",
                    created_by="admin",
                    updated_by="admin",
                )
            )
            await db.flush()
            db.add(
                Question(
                    id=question_id,
                    bank_id=bank_id,
                    title="single save before",
                    subject="PMP",
                    scope="internal",
                    revision=1,
                    creator_id=creator_id,
                    creator_name="波塞冬" if creator_id else None,
                    created_by="admin",
                    updated_by="admin",
                )
            )
            await revision_service.bump(
                db,
                "admin",
                [
                    {
                        "entityType": "question",
                        "entityId": f"pre-save-{suffix}",
                        "action": "updated",
                    }
                ],
            )
            await db.commit()
        return snapshot

    async def current_revision() -> int:
        async with AsyncSessionLocal() as db:
            return int((await revision_service.current(db))["revision"])

    async def cleanup(snapshot: dict | None) -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(
                delete(QuestionEditLock).where(
                    QuestionEditLock.question_id == question_id
                )
            )
            await db.execute(
                delete(QuestionAuditLog).where(QuestionAuditLog.bank_id == bank_id)
            )
            await db.execute(
                delete(QuestionUploadBatch).where(
                    QuestionUploadBatch.bank_id == bank_id
                )
            )
            await db.execute(delete(Question).where(Question.id == question_id))
            await db.execute(delete(QuestionBank).where(QuestionBank.id == bank_id))
            await db.commit()
        await _restore_revision_row(snapshot)

    snapshot = asyncio.run(seed())
    try:
        with TestClient(app) as client:
            assert client.post(
                "/api/v1/auth/login",
                json={"username": "admin", "password": "admin123"},
            ).status_code == 200
            lock = client.post(
                f"/api/v1/content-prep/locks/{question_id}",
                json={
                    "clientInstanceId": client_instance_id,
                    **({"creatorId": creator_id} if creator_id else {}),
                },
            )
            assert lock.status_code == 200, lock.text
            changed_question = question_payload(
                question_id,
                title=f"single save after {case_name}",
            )
            changed_question["metadata"]["principleIds"] = []
            changed_question["metadata"]["optionPrincipleMap"] = {}
            changed_question["metadata"]["tagPaths"] = []
            body = {
                "idempotencyKey": f"revision-save-{suffix}",
                "clientInstanceId": client_instance_id,
                "prepVersion": "0.4.0",
                "workspaceVersion": "1",
                "question": changed_question,
                "baseRevision": 1,
                "lockToken": lock.json()["lockToken"],
                "principles": {},
                "synthesisPresets": {},
                "tagConfig": {},
                **({"creatorId": creator_id} if creator_id else {}),
            }
            response = client.put(
                f"/api/v1/content-prep/questions/{question_id}",
                json=body,
            )
        assert response.status_code == 200, response.text
        assert response.json()["contentRevision"] == asyncio.run(current_revision())
        assert response.json()["contentRevision"] >= 1
    finally:
        asyncio.run(cleanup(snapshot))
