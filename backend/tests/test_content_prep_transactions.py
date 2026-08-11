import asyncio
from copy import deepcopy
from uuid import uuid4

import pytest
from sqlalchemy import delete, select

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.content_prep import (
    Principle,
    QuestionAuditLog,
    QuestionEditLock,
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

from tests.test_content_prep_upload import question_payload


PASSWORD = "prep-transaction-pass"


def test_failed_bundle_rolls_back_all_business_writes_but_records_failure() -> None:
    suffix = uuid4().hex[:10]
    username = f"prep-transaction-{suffix}"
    bank_id = f"prep-transaction-bank-{suffix}"
    existing_id = str(uuid4())
    new_id = str(uuid4())
    failed_principle_id = f"principle-rollback-{suffix}"
    failed_preset_id = f"preset-rollback-{suffix}"
    original = question_payload(existing_id, title="原题", analysis="原解析")

    async def seed_and_lock() -> dict:
        async with AsyncSessionLocal() as db:
            db.add(
                User(
                    username=username,
                    password_hash=hash_password(PASSWORD),
                    role="teacher",
                    status="active",
                )
            )
            await db.flush()
            db.add(
                QuestionBank(
                    id=bank_id,
                    owner_id=username,
                    name="事务回滚题库",
                    subject="PMP",
                )
            )
            await db.flush()
            db.add(
                Question(
                    id=existing_id,
                    bank_id=bank_id,
                    title=original["title"],
                    type=original["type"],
                    subject="PMP",
                    scope="internal",
                    content_hash=canonical_question_hash(original),
                    revision=1,
                    options=original["options"],
                    correct_answer="B",
                    analysis=original["analysis"],
                    content_metadata=original["metadata"],
                )
            )
            await db.commit()
            actor = await db.get(User, username)
            assert actor is not None
            return await acquire_lock(
                db,
                existing_id,
                actor,
                client_instance_id="rollback-browser",
                creator_id="creator_006",
            )

    changed_existing = question_payload(existing_id, title="不应提交的修改", analysis="变化")
    changed_existing["metadata"]["principleIds"] = [failed_principle_id]
    changed_existing["metadata"]["optionPrincipleMap"] = {"B": [failed_principle_id]}
    invalid_new = question_payload(new_id, title="引用不存在的新题")
    invalid_new["metadata"]["principleIds"] = ["principle-does-not-exist"]
    invalid_new["metadata"]["optionPrincipleMap"] = {}

    async def run_failure(grant: dict) -> None:
        request = ContentPrepBatchRequest.model_validate(
            {
                "idempotencyKey": f"rollback-{suffix}",
                "clientInstanceId": "rollback-browser",
                "targetBankId": bank_id,
                "creatorId": "creator_006",
                "prepVersion": "0.4.0",
                "workspaceVersion": "1",
                "questions": [
                    {
                        "question": changed_existing,
                        "baseRevision": 1,
                        "lockToken": grant["lockToken"],
                    },
                    {"question": invalid_new, "baseRevision": None, "lockToken": None},
                ],
                "principles": {
                    "schemaVersion": 1,
                    "items": [
                        {
                            "id": failed_principle_id,
                            "name": "不应保留的原则",
                            "status": "active",
                            "confusablePrincipleIds": [],
                        }
                    ],
                },
                "synthesisPresets": {
                    "schemaVersion": 1,
                    "items": [
                        {
                            "id": failed_preset_id,
                            "principleId": failed_principle_id,
                            "title": "不应保留的归纳卡",
                            "content": "回滚",
                            "status": "active",
                            "version": 1,
                        }
                    ],
                },
                "tagConfig": {
                    "schemaVersion": 99,
                    "names": {"usage/stage/basic": "事务标签"},
                },
            }
        )
        async with AsyncSessionLocal() as db:
            actor = await db.get(User, username)
            assert actor is not None
            with pytest.raises(ContentPrepOperationError) as failure:
                await upload_bundle(db, actor, request)
            assert failure.value.code == "QUESTION_VALIDATION_FAILED"
            assert any(
                issue.field == "metadata.stemPrincipleIds[0]"
                and issue.question_id == new_id
                for issue in failure.value.issues
            )

        async with AsyncSessionLocal() as db:
            existing = await db.get(Question, existing_id)
            assert existing is not None
            assert existing.title == "原题"
            assert existing.revision == 1
            assert existing.content_hash == canonical_question_hash(original)
            assert await db.get(Question, new_id) is None
            assert await db.get(Principle, failed_principle_id) is None
            assert await db.get(SynthesisPreset, failed_preset_id) is None
            assert (
                await db.execute(
                    select(QuestionTagConfig).where(QuestionTagConfig.schema_version == 99)
                )
            ).scalar_one_or_none() is None
            assert await db.get(QuestionEditLock, existing_id) is not None
            assert (
                await db.execute(
                    select(QuestionAuditLog).where(
                        QuestionAuditLog.batch_id.is_not(None),
                        QuestionAuditLog.actor_username == username,
                    )
                )
            ).scalars().all() == []
            batches = (
                await db.execute(
                    select(QuestionUploadBatch).where(
                        QuestionUploadBatch.actor_username == username,
                        QuestionUploadBatch.idempotency_key == f"rollback-{suffix}",
                    )
                )
            ).scalars().all()
            assert len(batches) == 1
            assert batches[0].status == "rolled_back"
            assert batches[0].error_summary["code"] == "QUESTION_VALIDATION_FAILED"
            assert batches[0].creator_name == "女帝"

        async with AsyncSessionLocal() as db:
            actor = await db.get(User, username)
            assert actor is not None
            with pytest.raises(ContentPrepOperationError) as replayed_failure:
                await upload_bundle(db, actor, request)
            assert replayed_failure.value.code == "QUESTION_VALIDATION_FAILED"

            changed_request = request.model_copy(deep=True)
            changed_request.questions[1].question.title = "修改后仍使用旧键"
            with pytest.raises(ContentPrepOperationError) as changed_key:
                await upload_bundle(db, actor, changed_request)
            assert changed_key.value.code == "IDEMPOTENCY_PAYLOAD_CONFLICT"

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(QuestionEditLock).where(QuestionEditLock.question_id == existing_id))
            await db.execute(delete(QuestionAuditLog).where(QuestionAuditLog.actor_username == username))
            await db.execute(delete(QuestionUploadBatch).where(QuestionUploadBatch.actor_username == username))
            await db.execute(delete(SynthesisPreset).where(SynthesisPreset.id == failed_preset_id))
            await db.execute(delete(Principle).where(Principle.id == failed_principle_id))
            await db.execute(delete(Question).where(Question.id.in_([existing_id, new_id])))
            await db.execute(delete(QuestionBank).where(QuestionBank.id == bank_id))
            await db.execute(delete(User).where(User.username == username))
            await db.commit()

    grant = asyncio.run(seed_and_lock())
    try:
        asyncio.run(run_failure(grant))
    finally:
        asyncio.run(cleanup())
