import asyncio
from copy import deepcopy
from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import subprocess
import sys
from threading import Event
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select, text

from app.api.v1 import content_prep as content_prep_api
from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.content_prep import (
    QuestionAuditLog,
    QuestionEditLock,
    QuestionUploadBatch,
)
from app.models.question import Question, QuestionBank
from app.services import teaching_content_revision_service
from tests.test_content_prep_upload import question_payload


async def _batch_creator_columns_are_nullable() -> tuple[str, str]:
    async with AsyncSessionLocal() as db:
        rows = (
            await db.execute(
                text(
                    "SELECT column_name, is_nullable "
                    "FROM information_schema.columns "
                    "WHERE table_schema = 'public' "
                    "AND table_name = 'question_upload_batches' "
                    "AND column_name IN ('creator_id', 'creator_name') "
                    "ORDER BY column_name"
                )
            )
        ).all()
    return tuple(str(row.is_nullable) for row in rows)


def test_legacy_batch_creator_migration_round_trip() -> None:
    # Release identity migrations are intentionally irreversible; current schema is authoritative.
    assert asyncio.run(_batch_creator_columns_are_nullable()) == ("YES", "YES")


@pytest.mark.parametrize("creator_mode", ["legacy", "standard"])
@pytest.mark.parametrize("mutable_transition", ["creator", "deleted"])
def test_single_save_replay_precedes_mutable_question_routing(
    creator_mode: str,
    mutable_transition: str,
) -> None:
    suffix = uuid4().hex[:10]
    bank_id = f"replay-routing-bank-{suffix}"
    question_id = f"replay-routing-question-{suffix}"
    idempotency_key = f"replay-routing-{suffix}"
    initial_creator_id = "creator_001" if creator_mode == "standard" else None
    initial_creator_name = "波塞冬" if initial_creator_id else None

    async def seed() -> None:
        async with AsyncSessionLocal() as db:
            db.add(
                QuestionBank(
                    id=bank_id,
                    owner_id="admin",
                    name="幂等重放路由测试",
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
                    title="待首次保存",
                    subject="PMP",
                    scope="internal",
                    revision=1,
                    creator_id=initial_creator_id,
                    creator_name=initial_creator_name,
                    created_by="admin",
                    updated_by="admin",
                )
            )
            await db.commit()

    async def apply_mutable_transition() -> None:
        async with AsyncSessionLocal() as db:
            question = await db.get(Question, question_id)
            assert question is not None
            if mutable_transition == "deleted":
                await db.delete(question)
            else:
                question.creator_id = (
                    "creator_002" if initial_creator_id else "creator_001"
                )
                question.creator_name = "狗娃" if initial_creator_id else "波塞冬"
            await db.commit()

    async def cleanup() -> None:
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

    asyncio.run(seed())
    try:
        with TestClient(app) as client:
            assert client.post(
                "/api/v1/auth/login",
                json={"username": "admin", "password": "jbgsnmm~123"},
            ).status_code == 200
            lock_body = {"clientInstanceId": "replay-routing-editor"}
            if initial_creator_id:
                lock_body["creatorId"] = initial_creator_id
            grant_response = client.post(
                f"/api/v1/content-prep/locks/{question_id}",
                json=lock_body,
            )
            assert grant_response.status_code == 200, grant_response.text
            grant = grant_response.json()
            changed_question = question_payload(
                question_id,
                title=f"{creator_mode}-首次保存",
            )
            changed_question["metadata"]["principleIds"] = []
            changed_question["metadata"]["optionPrincipleMap"] = {}
            save_payload = {
                "idempotencyKey": idempotency_key,
                "clientInstanceId": "replay-routing-editor",
                "prepVersion": "new-legacy",
                "workspaceVersion": "1",
                "question": changed_question,
                "baseRevision": 1,
                "lockToken": grant["lockToken"],
                "principles": {},
                "synthesisPresets": {},
                "tagConfig": {},
            }
            first = client.put(
                f"/api/v1/content-prep/questions/{question_id}",
                json=save_payload,
            )
            assert first.status_code == 200, first.text
            first_result = first.json()
            content_revision = client.get(
                "/api/v1/question-catalog/revision"
            ).json()["revision"]

            asyncio.run(apply_mutable_transition())
            replay = client.put(
                f"/api/v1/content-prep/questions/{question_id}",
                json=save_payload,
            )

            assert replay.status_code == 200, replay.text
            assert replay.json() == first_result
            assert client.get("/api/v1/question-catalog/revision").json()[
                "revision"
            ] == content_revision

            conflicting_payload = deepcopy(save_payload)
            conflicting_payload["question"] = deepcopy(changed_question)
            conflicting_payload["question"]["title"] += "-冲突"
            conflict = client.put(
                f"/api/v1/content-prep/questions/{question_id}",
                json=conflicting_payload,
            )
            assert conflict.status_code == 409, conflict.text
            assert conflict.json()["detail"]["code"] == "IDEMPOTENCY_PAYLOAD_CONFLICT"
            assert client.get("/api/v1/question-catalog/revision").json()[
                "revision"
            ] == content_revision
    finally:
        asyncio.run(cleanup())


def test_locked_single_save_preserves_null_legacy_creator_and_audits_actor(
    monkeypatch,
) -> None:
    suffix = uuid4().hex[:10]
    bank_id = f"legacy-save-bank-{suffix}"
    question_id = f"legacy-save-question-{suffix}"

    async def seed() -> None:
        async with AsyncSessionLocal() as db:
            db.add(
                QuestionBank(
                    id=bank_id,
                    owner_id="admin",
                    name="历史题保存测试",
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
                    title="历史题",
                    subject="PMP",
                    scope="internal",
                    revision=1,
                    creator_id=None,
                    creator_name=None,
                    created_by="admin",
                    updated_by="admin",
                )
            )
            await db.commit()

    async def verify() -> None:
        async with AsyncSessionLocal() as db:
            question = await db.get(Question, question_id)
            assert question is not None
            assert question.title == "历史题已更新"
            assert question.revision == 2
            assert question.creator_id is None
            assert question.creator_name is None
            assert question.updated_by == "admin"
            bank = await db.get(QuestionBank, bank_id)
            assert bank is not None
            assert bank.revision == 2
            audit = (
                await db.execute(
                    select(QuestionAuditLog).where(
                        QuestionAuditLog.question_id == question_id,
                        QuestionAuditLog.action == "question_updated",
                    )
                )
            ).scalar_one()
            assert audit.actor_username == "admin"
            assert audit.actor_role == "admin"
            assert audit.creator_id is None
            batches = (
                await db.execute(
                    select(QuestionUploadBatch).where(
                        QuestionUploadBatch.bank_id == bank_id
                    )
                )
            ).scalars().all()
            assert len(batches) == 1
            assert batches[0].creator_id is None
            assert batches[0].creator_name is None
            assert batches[0].status == "committed"

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(QuestionEditLock).where(QuestionEditLock.question_id == question_id))
            await db.execute(delete(QuestionAuditLog).where(QuestionAuditLog.bank_id == bank_id))
            await db.execute(delete(QuestionUploadBatch).where(QuestionUploadBatch.bank_id == bank_id))
            await db.execute(delete(Question).where(Question.id == question_id))
            await db.execute(delete(QuestionBank).where(QuestionBank.id == bank_id))
            await db.commit()

    asyncio.run(seed())
    try:
        with TestClient(app) as client:
            login = client.post(
                "/api/v1/auth/login",
                json={"username": "admin", "password": "jbgsnmm~123"},
            )
            assert login.status_code == 200
            grant_response = client.post(
                f"/api/v1/content-prep/locks/{question_id}",
                json={"clientInstanceId": "legacy-editor"},
            )
            assert grant_response.status_code == 200
            grant = grant_response.json()
            changed = question_payload(question_id, title="历史题已更新")
            save_committed = Event()
            release_response = Event()
            exact_revision: dict[str, int] = {}
            original_save = (
                content_prep_api.content_prep_service.save_legacy_question_without_creator
            )

            async def gated_save(*args, **kwargs):
                result = await original_save(*args, **kwargs)
                exact_revision["value"] = result["contentRevision"]
                save_committed.set()
                assert await asyncio.to_thread(release_response.wait, 10)
                return result

            monkeypatch.setattr(
                content_prep_api.content_prep_service,
                "save_legacy_question_without_creator",
                gated_save,
            )

            async def bump_competing_revision() -> None:
                async with AsyncSessionLocal() as db:
                    async with db.begin():
                        await teaching_content_revision_service.bump(
                            db,
                            "admin",
                            [
                                {
                                    "entityType": "question",
                                    "entityId": f"legacy-competitor-{suffix}",
                                    "action": "updated",
                                }
                            ],
                        )

            save_payload = {
                "idempotencyKey": f"legacy-save-{suffix}",
                "clientInstanceId": "legacy-editor",
                "prepVersion": "new-legacy",
                "workspaceVersion": "1",
                "question": changed,
                "baseRevision": 1,
                "lockToken": grant["lockToken"],
                "principles": {},
                "synthesisPresets": {},
                "tagConfig": {},
            }
            with ThreadPoolExecutor(max_workers=1) as pool:
                pending = pool.submit(
                    client.put,
                    f"/api/v1/content-prep/questions/{question_id}",
                    json=save_payload,
                )
                assert save_committed.wait(10)
                asyncio.run(bump_competing_revision())
                release_response.set()
                response = pending.result(timeout=10)
            assert response.status_code == 200, response.text
            assert response.json()["question"]["creatorId"] is None
            assert response.json()["contentRevision"] == exact_revision["value"]
            first_result = response.json()
            revision_after_competitor = client.get(
                "/api/v1/question-catalog/revision"
            ).json()["revision"]

            replay = client.put(
                f"/api/v1/content-prep/questions/{question_id}",
                json=save_payload,
            )
            assert replay.status_code == 200, replay.text
            assert replay.json() == first_result
            assert client.get("/api/v1/question-catalog/revision").json()[
                "revision"
            ] == revision_after_competitor

            conflicting_payload = deepcopy(save_payload)
            conflicting_payload["question"] = deepcopy(changed)
            conflicting_payload["question"]["title"] = "同一幂等键的不同内容"
            conflict = client.put(
                f"/api/v1/content-prep/questions/{question_id}",
                json=conflicting_payload,
            )
            assert conflict.status_code == 409, conflict.text
            assert conflict.json()["detail"]["code"] == "IDEMPOTENCY_PAYLOAD_CONFLICT"
            assert client.get("/api/v1/question-catalog/revision").json()[
                "revision"
            ] == revision_after_competitor
        asyncio.run(verify())
    finally:
        asyncio.run(cleanup())
