import asyncio
from copy import deepcopy
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.core.security import hash_password
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


def test_transactional_upload_create_skip_update_idempotency_and_single_save() -> None:
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
        async with AsyncSessionLocal() as db:
            actor = await db.get(User, username)
            assert actor is not None
            skipped = await upload_bundle(db, actor, skip_request)
            assert skipped.questions[0].status == "skipped"
            assert skipped.questions[0].revision == 1
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

        async with AsyncSessionLocal() as db:
            actor = await db.get(User, username)
            assert actor is not None
            replayed = await upload_bundle(db, actor, update_request)
            assert replayed.batch_id == updated.batch_id
            assert replayed.replayed is True

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
        with TestClient(app) as client:
            assert client.post(
                "/api/v1/auth/login",
                json={"username": username, "password": PASSWORD},
            ).status_code == 200
            saved = client.put(
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
            assert saved.status_code == 200
            assert saved.json()["question"]["status"] == "updated"
            batch_ids.add(saved.json()["batchId"])
            batch = client.get(
                f"/api/v1/content-prep/batches/{saved.json()['batchId']}"
            )
            assert batch.status_code == 200
            assert batch.json()["batch"]["status"] == "committed"
    finally:
        asyncio.run(cleanup())
