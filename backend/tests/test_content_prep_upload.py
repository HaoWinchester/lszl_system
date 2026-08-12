import asyncio
from copy import deepcopy
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Event
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.core.security import hash_password
from app.api.v1 import content_prep as content_prep_api
from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.content_prep import (
    Principle,
    QuestionAuditLog,
    QuestionTagConfig,
    QuestionUploadBatch,
    SynthesisPreset,
)
from app.models.question import Question, QuestionBank
from app.models.user import User
from app.schemas.content_prep import ContentPrepBatchRequest
from app.services.content_prep_service import ContentPrepOperationError, upload_bundle
from app.services.question_content_service import canonical_question_hash
from app.services.question_lock_service import acquire_lock
from app.services import teaching_content_revision_service


PASSWORD = "prep-upload-pass"


def question_payload(question_id: str, *, title: str = "上传题目", analysis: str = "原解析") -> dict:
    return {
        "id": question_id,
        "title": title,
        "type": "single_choice",
        "subject": "PMP",
        "difficulty": "基础",
        "domain": "沟通",
        "topic": "反馈闭环",
        "tags": ["内部使用", "基础练习"],
        "stage": "基础练习",
        "stemParts": [{"text": "应该怎么做？"}],
        "options": [
            {"id": "A", "text": "忽略", "correct": False},
            {"id": "B", "text": "确认理解", "correct": True},
        ],
        "correctAnswer": "B",
        "analysis": analysis,
        "translations": {"en": {"analysis": "Confirm understanding."}},
        "clues": [],
        "concepts": [{"id": "local-concept", "title": "反馈"}],
        "reasoningSteps": [{"id": "step-1", "content": "确认反馈"}],
        "keyPath": {"answerId": "B"},
        "metadata": {
            "principleIds": ["principle-upload"],
            "optionPrincipleMap": {"B": ["principle-upload"]},
            "tagPaths": [
                {
                    "groupId": "usage",
                    "categoryId": "stage",
                    "label": "基础练习",
                },
                {
                    "groupId": "source",
                    "categoryId": "scope",
                    "label": "内部使用",
                },
            ],
            "origin": {
                "creatorId": "forged-in-question",
                "creatorName": "伪造制作人",
                "actorUsername": "admin",
                "deviceId": "browser",
            },
        },
        "status": {"contentReady": True},
        "lifecycle": {"status": "active"},
        "teacherNumber": "PMP-UPLOAD-001",
        "explanation": analysis,
        "creatorName": "客户端伪造名称",
        "actorUsername": "admin",
        "contentHash": "forged-client-hash",
    }


def request_payload(
    *,
    key: str,
    bank_id: str,
    question: dict,
    base_revision: int | None = None,
    lock_token: str | None = None,
) -> ContentPrepBatchRequest:
    return ContentPrepBatchRequest.model_validate(
        {
            "idempotencyKey": key,
            "clientInstanceId": "upload-browser",
            "targetBankId": bank_id,
            "creatorId": "creator_001",
            "prepVersion": "0.4.0",
            "workspaceVersion": "1",
            "questions": [
                {
                    "question": question,
                    "baseRevision": base_revision,
                    "lockToken": lock_token,
                }
            ],
            "principles": {
                "schemaVersion": 1,
                "items": [
                    {
                        "id": "principle-upload",
                        "name": "上传原则",
                        "status": "active",
                        "confusablePrincipleIds": [],
                    }
                ],
            },
            "synthesisPresets": {
                "schemaVersion": 1,
                "items": [
                    {
                        "id": "preset-upload",
                        "principleId": "principle-upload",
                        "title": "上传归纳卡",
                        "content": "确认接收与理解。",
                        "status": "active",
                        "version": 1,
                    }
                ],
            },
            "tagConfig": {
                "schemaVersion": 2,
                "names": {"usage/stage/basic": "基础练习"},
                "groupNames": {},
                "categoryNames": {},
                "aliases": {},
            },
        }
    )


@pytest.mark.parametrize(
    ("field", "container"),
    [
        (
            "principles",
            {
                "schemaVersion": 1,
                "items": [
                    {"id": "p" * 129, "name": "原则", "confusablePrincipleIds": []}
                ],
            },
        ),
        (
            "synthesisPresets",
            {
                "schemaVersion": 1,
                "items": [
                    {
                        "id": "preset",
                        "principleId": "principle",
                        "title": "归纳",
                        "version": "1",
                    }
                ],
            },
        ),
        (
            "principles",
            {
                "schemaVersion": 2,
                "items": [
                    {"id": "schema-principle", "name": "原则", "confusablePrincipleIds": []}
                ],
            },
        ),
        (
            "principles",
            {
                "schemaVersion": True,
                "items": [
                    {"id": "schema-bool", "name": "原则", "confusablePrincipleIds": []}
                ],
            },
        ),
        (
            "principles",
            {
                "schemaVersion": 1,
                "items": [
                    {
                        "id": "bad-principle-status",
                        "name": "原则",
                        "status": "paused",
                        "confusablePrincipleIds": [],
                    }
                ],
            },
        ),
        (
            "synthesisPresets",
            {
                "schemaVersion": 1,
                "items": [
                    {
                        "id": "bad-preset-status",
                        "principleId": "principle-upload",
                        "title": "归纳",
                        "content": "内容",
                        "status": "published",
                        "version": 1,
                    }
                ],
            },
        ),
        (
            "synthesisPresets",
            {
                "schemaVersion": 1,
                "items": [
                    {
                        "id": "bad-preset-content",
                        "principleId": "principle-upload",
                        "title": "归纳",
                        "content": 123,
                        "status": "active",
                        "version": 1,
                    }
                ],
            },
        ),
        (
            "principles",
            {
                "schemaVersion": 1,
                "items": [
                    {"id": f"p-{index}", "name": "原则", "confusablePrincipleIds": []}
                    for index in range(501)
                ],
            },
        ),
        (
            "synthesisPresets",
            {
                "schemaVersion": 1,
                "items": [
                    {
                        "id": "oversized-preset",
                        "principleId": "principle-upload",
                        "title": "归纳",
                        "content": "x" * (2 * 1024 * 1024),
                        "version": 1,
                    }
                ],
            },
        ),
    ],
)
def test_content_prep_http_rejects_invalid_projection_before_revision_lock(
    field: str,
    container: dict,
    monkeypatch,
) -> None:
    payload = request_payload(
        key=f"invalid-projection-{uuid4().hex}",
        bank_id="validation-only-bank",
        question=question_payload(str(uuid4())),
    ).model_dump(by_alias=True)
    payload[field] = container
    lock_calls = 0
    original_acquire = teaching_content_revision_service.acquire_lock

    async def counted_acquire(db) -> None:
        nonlocal lock_calls
        lock_calls += 1
        await original_acquire(db)

    with TestClient(app) as client:
        assert client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": "jbgsnmm~123"},
        ).status_code == 200
        monkeypatch.setattr(
            teaching_content_revision_service,
            "acquire_lock",
            counted_acquire,
        )
        response = client.post("/api/v1/content-prep/batches", json=payload)

    assert response.status_code == 422, response.text
    assert lock_calls == 0


def test_deleting_bank_removes_upload_batches_and_preserves_audit_history() -> None:
    suffix = uuid4().hex[:10]
    bank_id = f"delete-upload-bank-{suffix}"
    question_id = str(uuid4())
    batch_id = f"delete-upload-batch-{suffix}"
    audit_id = f"delete-upload-audit-{suffix}"

    async def seed() -> None:
        async with AsyncSessionLocal() as db:
            db.add(
                QuestionBank(
                    id=bank_id,
                    owner_id="admin",
                    name="可删除上传题库",
                    subject="PMP",
                )
            )
            await db.flush()
            db.add(
                Question(
                    id=question_id,
                    bank_id=bank_id,
                    title="待删除题目",
                    subject="PMP",
                )
            )
            db.add(
                QuestionUploadBatch(
                    id=batch_id,
                    idempotency_key=f"delete-{suffix}",
                    bank_id=bank_id,
                    actor_username="admin",
                    actor_role="admin",
                    creator_id="creator_001",
                    creator_name="波塞冬",
                    client_instance_id="delete-test",
                    manifest_hash="a" * 64,
                    input_count=1,
                    status="committed",
                )
            )
            db.add(
                QuestionAuditLog(
                    id=audit_id,
                    entity_type="question",
                    entity_id=question_id,
                    action="question_created",
                    actor_username="admin",
                    actor_role="admin",
                    creator_id="creator_001",
                    creator_name="波塞冬",
                    bank_id=bank_id,
                    question_id=question_id,
                    batch_id=batch_id,
                )
            )
            await db.commit()

    async def verify_and_cleanup() -> None:
        async with AsyncSessionLocal() as db:
            assert await db.get(QuestionBank, bank_id) is None
            assert await db.get(QuestionUploadBatch, batch_id) is None
            assert await db.get(QuestionAuditLog, audit_id) is not None
            await db.execute(delete(QuestionAuditLog).where(QuestionAuditLog.id == audit_id))
            await db.commit()

    async def cleanup_after_failure() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(QuestionAuditLog).where(QuestionAuditLog.id == audit_id))
            await db.execute(delete(QuestionUploadBatch).where(QuestionUploadBatch.id == batch_id))
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
            deleted = client.delete(f"/api/v1/banks/{bank_id}")
            assert deleted.status_code == 200, deleted.text
        asyncio.run(verify_and_cleanup())
    except Exception:
        asyncio.run(cleanup_after_failure())
        raise


def test_transactional_upload_create_skip_update_idempotency_and_single_save(
    monkeypatch,
) -> None:
    suffix = uuid4().hex[:10]
    username = f"prep-upload-{suffix}"
    target_bank_id = f"prep-upload-bank-{suffix}"
    other_bank_id = f"prep-upload-other-bank-{suffix}"
    new_question_id = str(uuid4())
    other_question_id = str(uuid4())
    batch_ids: set[str] = set()
    previous_active_tag_config_id: str | None = None

    async def seed() -> None:
        nonlocal previous_active_tag_config_id
        async with AsyncSessionLocal() as db:
            previous_active = (
                await db.execute(
                    select(QuestionTagConfig).where(QuestionTagConfig.active.is_(True))
                )
            ).scalar_one_or_none()
            previous_active_tag_config_id = previous_active.id if previous_active else None
            db.add(
                User(
                    username=username,
                    password_hash=hash_password(PASSWORD),
                    role="teacher",
                    status="active",
                )
            )
            await db.flush()
            db.add_all(
                [
                    QuestionBank(
                        id=target_bank_id,
                        owner_id=username,
                        name="上传目标题库",
                        subject="PMP",
                        revision=1,
                    ),
                    QuestionBank(
                        id=other_bank_id,
                        owner_id=username,
                        name="其他题库",
                        subject="PMP",
                        revision=1,
                    ),
                ]
            )
            await db.flush()
            db.add(
                Question(
                    id=other_question_id,
                    bank_id=other_bank_id,
                    title="不可移动题目",
                    subject="PMP",
                    scope="internal",
                    revision=1,
                )
            )
            await db.commit()

    async def run_uploads() -> tuple[dict, dict]:
        raw = question_payload(new_question_id)
        create_request = request_payload(
            key=f"create-{suffix}",
            bank_id=target_bank_id,
            question=raw,
        )
        async with AsyncSessionLocal() as db:
            actor = await db.get(User, username)
            assert actor is not None
            created = await upload_bundle(db, actor, create_request)
            assert created.questions[0].status == "created"
            assert created.questions[0].revision == 1
            assert created.questions[0].content_hash == canonical_question_hash(raw)
            batch_ids.add(created.batch_id)

        async with AsyncSessionLocal() as db:
            stored = await db.get(Question, new_question_id)
            assert stored is not None
            assert stored.creator_id == "creator_001"
            assert stored.creator_name == "波塞冬"
            assert stored.created_by == username
            assert stored.updated_by == username
            assert stored.content_hash != "forged-client-hash"
            assert stored.translations == raw["translations"]
            assert stored.content_metadata["origin"] == {
                "creatorId": "creator_001",
                "creatorName": "波塞冬",
                "actorUsername": username,
                "actorRole": "teacher",
                "deviceId": "browser",
            }
            assert await db.get(Principle, "principle-upload") is not None
            assert await db.get(SynthesisPreset, "preset-upload") is not None
            active_tag_config = (
                await db.execute(
                    select(QuestionTagConfig).where(QuestionTagConfig.active.is_(True))
                )
            ).scalar_one()
            assert active_tag_config.schema_version == 2
            assert active_tag_config.created_by == username
            audit = (
                await db.execute(
                    select(QuestionAuditLog).where(
                        QuestionAuditLog.question_id == new_question_id,
                        QuestionAuditLog.action == "question_created",
                    )
                )
            ).scalar_one()
            assert audit.actor_username == username
            assert audit.creator_name == "波塞冬"

        skip_request = request_payload(
            key=f"skip-{suffix}",
            bank_id=target_bank_id,
            question=raw,
        )
        projection_writes = 0
        original_projection_write = (
            content_prep_api.content_prep_service
            .teaching_content_projection_service.write_principle_projection
        )

        async def counted_projection_write(*args, **kwargs):
            nonlocal projection_writes
            projection_writes += 1
            return await original_projection_write(*args, **kwargs)

        monkeypatch.setattr(
            content_prep_api.content_prep_service.teaching_content_projection_service,
            "write_principle_projection",
            counted_projection_write,
        )
        async with AsyncSessionLocal() as db:
            actor = await db.get(User, username)
            assert actor is not None
            skipped = await upload_bundle(db, actor, skip_request)
            assert skipped.questions[0].status == "skipped"
            assert skipped.questions[0].revision == 1
            assert projection_writes == 0
            batch_ids.add(skipped.batch_id)

        changed = question_payload(new_question_id, analysis="更新后的解析")
        async with AsyncSessionLocal() as db:
            actor = await db.get(User, username)
            assert actor is not None
            grant = await acquire_lock(
                db,
                new_question_id,
                actor,
                client_instance_id="upload-browser",
                creator_id="creator_001",
            )
        update_request = request_payload(
            key=f"update-{suffix}",
            bank_id=target_bank_id,
            question=changed,
            base_revision=1,
            lock_token=grant["lockToken"],
        )
        async with AsyncSessionLocal() as db:
            actor = await db.get(User, username)
            assert actor is not None
            updated = await upload_bundle(db, actor, update_request)
            assert updated.questions[0].status == "updated"
            assert updated.questions[0].revision == 2
            batch_ids.add(updated.batch_id)
            assert await db.get(Question, new_question_id) is not None
            assert await db.get(QuestionUploadBatch, updated.batch_id) is not None

        global_arrival = Barrier(2)
        original_global_lock = teaching_content_revision_service.acquire_lock
        original_idempotency_lock = (
            content_prep_api.content_prep_service._lock_idempotency_key
        )

        async def ordered_global_lock(db) -> None:
            if db.info.get("content_prep_lock_order_probe"):
                await asyncio.to_thread(global_arrival.wait, 10)
            await original_global_lock(db)
            if db.info.get("content_prep_lock_order_probe"):
                db.info["content_prep_global_lock_acquired"] = True

        async def checked_idempotency_lock(db, actor_username, idempotency_key) -> None:
            if db.info.get("content_prep_lock_order_probe"):
                assert db.info.get("content_prep_global_lock_acquired") is True
            await original_idempotency_lock(db, actor_username, idempotency_key)

        monkeypatch.setattr(
            teaching_content_revision_service,
            "acquire_lock",
            ordered_global_lock,
        )
        monkeypatch.setattr(
            content_prep_api.content_prep_service,
            "_lock_idempotency_key",
            checked_idempotency_lock,
        )

        async def concurrent_replay_probe():
            async with AsyncSessionLocal() as db:
                db.info["content_prep_lock_order_probe"] = True
                actor = await db.get(User, username)
                assert actor is not None
                return await upload_bundle(db, actor, update_request)

        with ThreadPoolExecutor(max_workers=2) as pool:
            probes = list(
                pool.map(lambda _: asyncio.run(concurrent_replay_probe()), range(2))
            )
        assert all(probe.replayed for probe in probes)
        assert {probe.content_revision for probe in probes} == {
            updated.content_revision
        }

        failed_request = request_payload(
            key=f"failed-lock-order-{suffix}",
            bank_id=target_bank_id,
            question=changed,
            base_revision=2,
            lock_token="unused-for-failure-record",
        )

        async def concurrent_failure_record_probe() -> str | None:
            async with AsyncSessionLocal() as db:
                db.info["content_prep_lock_order_probe"] = True
                actor = await db.get(User, username)
                assert actor is not None
                error = ContentPrepOperationError(
                    "CONTROLLED_FAILURE",
                    "controlled failure for lock-order proof",
                )
                await content_prep_api.content_prep_service.record_failed_batch(
                    db,
                    actor,
                    failed_request,
                    error,
                )
                return error.batch_id

        with ThreadPoolExecutor(max_workers=2) as pool:
            failed_batch_ids = list(
                pool.map(
                    lambda _: asyncio.run(concurrent_failure_record_probe()),
                    range(2),
                )
            )
        batch_ids.update(batch_id for batch_id in failed_batch_ids if batch_id)
        assert len([batch_id for batch_id in failed_batch_ids if batch_id]) == 1

        async with AsyncSessionLocal() as db:
            actor = await db.get(User, username)
            assert actor is not None
            replayed = await upload_bundle(db, actor, update_request)
            assert replayed.batch_id == updated.batch_id
            assert replayed.replayed is True
            assert replayed.content_revision == updated.content_revision
            assert int(
                (await teaching_content_revision_service.current(db))["revision"]
            ) == updated.content_revision

            historical_batch = await db.get(QuestionUploadBatch, updated.batch_id)
            assert historical_batch is not None
            historical_result = dict(historical_batch.result or {})
            historical_result.pop("contentRevision", None)
            historical_batch.result = historical_result
            await db.commit()
            async with db.begin():
                competing_revision = await teaching_content_revision_service.bump(
                    db,
                    username,
                    [
                        {
                            "entityType": "question",
                            "entityId": f"historical-replay-{suffix}",
                            "action": "updated",
                        }
                    ],
                )
            historical_replay = await upload_bundle(db, actor, update_request)
            assert historical_replay.replayed is True
            assert historical_replay.content_revision == competing_revision["revision"]
            assert int(
                (await teaching_content_revision_service.current(db))["revision"]
            ) == competing_revision["revision"]

            conflicting_raw = question_payload(new_question_id, analysis="相同键的不同内容")
            conflicting_request = request_payload(
                key=f"update-{suffix}",
                bank_id=target_bank_id,
                question=conflicting_raw,
                base_revision=2,
                lock_token="different-lock",
            )
            with pytest.raises(ContentPrepOperationError) as conflict:
                await upload_bundle(db, actor, conflicting_request)
            assert conflict.value.code == "IDEMPOTENCY_PAYLOAD_CONFLICT"

            move_request = request_payload(
                key=f"move-{suffix}",
                bank_id=target_bank_id,
                question=question_payload(other_question_id),
            )
            with pytest.raises(ContentPrepOperationError) as move:
                await upload_bundle(db, actor, move_request)
            assert move.value.code == "QUESTION_BANK_MOVE_FORBIDDEN"

        return changed, update_request.model_dump(by_alias=True)

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(
                delete(QuestionAuditLog).where(
                    QuestionAuditLog.actor_username == username
                )
            )
            await db.execute(
                delete(QuestionUploadBatch).where(
                    QuestionUploadBatch.actor_username == username
                )
            )
            await db.execute(delete(SynthesisPreset).where(SynthesisPreset.id == "preset-upload"))
            await db.execute(delete(Principle).where(Principle.id == "principle-upload"))
            await db.execute(
                delete(QuestionTagConfig).where(QuestionTagConfig.created_by == username)
            )
            await db.flush()
            if previous_active_tag_config_id:
                previous_active = await db.get(
                    QuestionTagConfig,
                    previous_active_tag_config_id,
                )
                if previous_active is not None:
                    previous_active.active = True
            await db.execute(
                delete(Question).where(Question.id.in_([new_question_id, other_question_id]))
            )
            await db.execute(
                delete(QuestionBank).where(QuestionBank.id.in_([target_bank_id, other_bank_id]))
            )
            await db.execute(delete(User).where(User.username == username))
            await db.commit()

    asyncio.run(seed())
    try:
        changed, _ = asyncio.run(run_uploads())

        async def lock_for_single_save() -> dict:
            async with AsyncSessionLocal() as db:
                actor = await db.get(User, username)
                assert actor is not None
                return await acquire_lock(
                    db,
                    new_question_id,
                    actor,
                    client_instance_id="upload-browser",
                    creator_id="creator_001",
                )

        single_grant = asyncio.run(lock_for_single_save())
        single_changed = deepcopy(changed)
        single_changed["title"] = "单题接口更新"
        upload_committed = Event()
        release_response = Event()
        exact_revision: dict[str, int] = {}
        original_upload = content_prep_api.content_prep_service.upload_bundle

        async def gated_upload(*args, **kwargs):
            result = await original_upload(*args, **kwargs)
            if args[2].idempotency_key == f"single-{suffix}":
                exact_revision["value"] = result.content_revision
                upload_committed.set()
                assert await asyncio.to_thread(release_response.wait, 10)
            return result

        monkeypatch.setattr(
            content_prep_api.content_prep_service,
            "upload_bundle",
            gated_upload,
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
                                "entityId": f"competing-{suffix}",
                                "action": "updated",
                            }
                        ],
                    )

        with TestClient(app) as client:
            assert client.post(
                "/api/v1/auth/login",
                json={"username": username, "password": PASSWORD},
            ).status_code == 200
            with ThreadPoolExecutor(max_workers=1) as pool:
                pending = pool.submit(
                    client.put,
                    f"/api/v1/content-prep/questions/{new_question_id}",
                    json={
                        "idempotencyKey": f"single-{suffix}",
                        "clientInstanceId": "upload-browser",
                        "creatorId": "creator_001",
                        "baseRevision": 2,
                        "lockToken": single_grant["lockToken"],
                        "question": single_changed,
                        "principles": request_payload(
                            key="unused",
                            bank_id=target_bank_id,
                            question=single_changed,
                        ).principles,
                        "synthesisPresets": {},
                        "tagConfig": {},
                    },
                )
                assert upload_committed.wait(10)
                asyncio.run(bump_competing_revision())
                release_response.set()
                saved = pending.result(timeout=10)
            assert saved.status_code == 200
            assert saved.json()["contentRevision"] == exact_revision["value"]
            assert saved.json()["question"]["status"] == "updated"
            batch_ids.add(saved.json()["batchId"])
            batch = client.get(
                f"/api/v1/content-prep/batches/{saved.json()['batchId']}"
            )
            assert batch.status_code == 200
            assert batch.json()["batch"]["status"] == "committed"

            stale_grant = asyncio.run(lock_for_single_save())
            client.post("/api/v1/auth/logout")
            assert client.post(
                "/api/v1/auth/login",
                json={"username": "admin", "password": "jbgsnmm~123"},
            ).status_code == 200
            forced = client.delete(
                f"/api/v1/content-prep/locks/{new_question_id}/force"
            )
            assert forced.status_code == 200
            client.post("/api/v1/auth/logout")
            assert client.post(
                "/api/v1/auth/login",
                json={"username": username, "password": PASSWORD},
            ).status_code == 200
            stale = client.put(
                f"/api/v1/content-prep/questions/{new_question_id}",
                json={
                    "idempotencyKey": f"single-stale-{suffix}",
                    "clientInstanceId": "upload-browser",
                    "creatorId": "creator_001",
                    "baseRevision": 3,
                    "lockToken": stale_grant["lockToken"],
                    "question": single_changed,
                    "principles": request_payload(
                        key="unused-stale",
                        bank_id=target_bank_id,
                        question=single_changed,
                    ).principles,
                    "synthesisPresets": {},
                    "tagConfig": {},
                },
            )
            assert stale.status_code == 409, stale.text
            assert stale.json()["detail"]["code"] == "LOCK_TOKEN_INVALID"
    finally:
        asyncio.run(cleanup())
