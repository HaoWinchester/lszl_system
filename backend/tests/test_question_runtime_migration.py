import asyncio
import json
from uuid import uuid4

from sqlalchemy import delete, func, select

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.question import Question, QuestionBank
from app.models.runtime_state import RuntimeState
from app.models.shared_runtime_state import SharedRuntimeState
from app.models.user import User
from app.services.question_migration_service import (
    migrate_runtime_questions,
    scan_runtime_question_sources,
)


PUBLISHED_KEY = "kg_question_banks_published_v1"


def legacy_question(question_id: str, title: str = "历史题") -> dict:
    return {
        "id": question_id,
        "title": title,
        "type": "single_choice",
        "subject": "PMP",
        "tags": ["内部使用"],
        "stemParts": [{"text": "历史题干"}],
        "options": [
            {"id": "A", "text": "错误", "correct": False},
            {"id": "B", "text": "正确", "correct": True},
        ],
        "correctAnswer": "B",
        "analysis": "历史解析",
        "translations": {"en": {"analysis": "Legacy explanation"}},
        "metadata": {},
        "keyPath": {"answerId": "B"},
        "lifecycle": {"status": "active"},
    }


def test_runtime_question_migration_dry_run_apply_and_rerun_are_safe() -> None:
    suffix = uuid4().hex[:10]
    owner = f"migration-owner-{suffix}"
    relational_bank_id = f"migration-rel-bank-{suffix}"
    private_bank_id = f"migration-private-bank-{suffix}"
    published_bank_id = f"migration-published-bank-{suffix}"
    relational_question_id = f"legacy-rel-question-{suffix}"
    private_question_id = f"legacy-private-question-{suffix}"
    published_question_id = f"legacy-published-question-{suffix}"
    bank_ids = {relational_bank_id, private_bank_id, published_bank_id}
    question_ids = {
        relational_question_id,
        private_question_id,
        published_question_id,
    }
    previous_published: dict | None = None

    async def seed() -> None:
        nonlocal previous_published
        async with AsyncSessionLocal() as db:
            published = await db.get(SharedRuntimeState, PUBLISHED_KEY)
            if published is not None:
                previous_published = {
                    "value": published.value,
                    "schema_version": published.schema_version,
                    "updated_by": published.updated_by,
                }
            db.add(
                User(
                    username=owner,
                    password_hash=hash_password("migration-pass"),
                    role="teacher",
                    status="active",
                )
            )
            await db.flush()
            db.add(
                QuestionBank(
                    id=relational_bank_id,
                    owner_id=owner,
                    name="关系表已有题库",
                    subject="PMP",
                    visibility="private",
                )
            )
            await db.flush()
            relational_raw = legacy_question(relational_question_id, "关系表已有题")
            db.add(
                Question(
                    id=relational_question_id,
                    bank_id=relational_bank_id,
                    title=relational_raw["title"],
                    type="single_choice",
                    subject="PMP",
                    scope="internal",
                    content_hash=None,
                    revision=1,
                    tags=relational_raw["tags"],
                    stem_parts=relational_raw["stemParts"],
                    options=relational_raw["options"],
                    correct_answer="B",
                    analysis=relational_raw["analysis"],
                    translations=relational_raw["translations"],
                    content_metadata={},
                    key_path=relational_raw["keyPath"],
                    lifecycle=relational_raw["lifecycle"],
                )
            )
            db.add(
                RuntimeState(
                    owner_id=owner,
                    storage={
                        f"kg_question_banks_v1__user__{owner}": json.dumps(
                            [
                                {
                                    "id": relational_bank_id,
                                    "name": "关系表已有题库",
                                    "subject": "PMP",
                                    "visibility": "private",
                                    "questions": [relational_raw],
                                },
                                {
                                    "id": private_bank_id,
                                    "name": "待迁移私有题库",
                                    "subject": "PMP",
                                    "visibility": "private",
                                    "questions": [legacy_question(private_question_id)],
                                },
                            ],
                            ensure_ascii=False,
                        )
                    },
                    revision=1,
                )
            )
            published_value = json.dumps(
                [
                    {
                        "id": published_bank_id,
                        "name": "待迁移共享题库",
                        "subject": "PMP",
                        "visibility": "published",
                        "publishedBy": owner,
                        "questions": [
                            {
                                **legacy_question(published_question_id),
                                "tags": [],
                            }
                        ],
                    }
                ],
                ensure_ascii=False,
            )
            if published is None:
                db.add(
                    SharedRuntimeState(
                        key=PUBLISHED_KEY,
                        value=published_value,
                        updated_by=owner,
                    )
                )
            else:
                published.value = published_value
                published.updated_by = owner
            await db.commit()

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            dry = await scan_runtime_question_sources(
                db,
                owner_ids={owner},
                bank_ids=bank_ids,
            )
            assert len(dry.snapshot_hash) == 64
            assert dry.source_counts["relational"]["banks"] == 1
            assert dry.source_counts["runtimeState"]["banks"] == 2
            assert dry.source_counts["sharedPublished"]["banks"] == 1
            assert dry.bank_count == 3
            assert dry.question_count == 3
            assert dry.internal_count == 2
            assert dry.public_count == 1
            assert dry.deduplicated >= 1
            assert dry.model_dump(by_alias=True)["deduplicatedCount"] >= 1
            assert dry.conflicts == []
            assert dry.invalid_records == []
            assert dry.null_content_hashes == 1
            assert dry.applied is False
            assert await db.get(QuestionBank, private_bank_id) is None
            assert await db.get(QuestionBank, published_bank_id) is None

        async with AsyncSessionLocal() as db:
            applied = await migrate_runtime_questions(
                db,
                apply=True,
                owner_ids={owner},
                bank_ids=bank_ids,
            )
            assert applied.applied is True
            assert applied.conflicts == []

        async with AsyncSessionLocal() as db:
            relational = await db.get(Question, relational_question_id)
            private_bank = await db.get(QuestionBank, private_bank_id)
            private_question = await db.get(Question, private_question_id)
            published_bank = await db.get(QuestionBank, published_bank_id)
            published_question = await db.get(Question, published_question_id)
            assert relational is not None and relational.content_hash
            assert private_bank is not None and private_bank.owner_id == owner
            assert private_question is not None and private_question.id == private_question_id
            assert published_bank is not None and published_bank.visibility == "published"
            assert published_bank.owner_id == owner
            assert published_question is not None and published_question.scope == "public"
            before_counts = (
                int(
                    (
                        await db.execute(
                            select(func.count()).select_from(QuestionBank).where(
                                QuestionBank.id.in_(bank_ids)
                            )
                        )
                    ).scalar_one()
                ),
                int(
                    (
                        await db.execute(
                            select(func.count()).select_from(Question).where(
                                Question.id.in_(question_ids)
                            )
                        )
                    ).scalar_one()
                ),
            )

        async with AsyncSessionLocal() as db:
            rerun = await migrate_runtime_questions(
                db,
                apply=True,
                owner_ids={owner},
                bank_ids=bank_ids,
            )
            assert rerun.applied is True

        async with AsyncSessionLocal() as db:
            after_counts = (
                int(
                    (
                        await db.execute(
                            select(func.count()).select_from(QuestionBank).where(
                                QuestionBank.id.in_(bank_ids)
                            )
                        )
                    ).scalar_one()
                ),
                int(
                    (
                        await db.execute(
                            select(func.count()).select_from(Question).where(
                                Question.id.in_(question_ids)
                            )
                        )
                    ).scalar_one()
                ),
            )
            assert after_counts == before_counts == (3, 3)

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(Question).where(Question.id.in_(question_ids)))
            await db.execute(delete(QuestionBank).where(QuestionBank.id.in_(bank_ids)))
            await db.execute(delete(RuntimeState).where(RuntimeState.owner_id == owner))
            published = await db.get(SharedRuntimeState, PUBLISHED_KEY)
            if previous_published is None:
                if published is not None:
                    await db.delete(published)
            elif published is not None:
                published.value = previous_published["value"]
                published.schema_version = previous_published["schema_version"]
                published.updated_by = previous_published["updated_by"]
            await db.execute(delete(User).where(User.username == owner))
            await db.commit()

    asyncio.run(seed())
    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(cleanup())


def test_migration_reports_conflicts_missing_publishers_and_broken_json() -> None:
    suffix = uuid4().hex[:10]
    owner = f"migration-conflict-{suffix}"
    conflict_bank_id = f"migration-conflict-bank-{suffix}"
    conflict_question_id = f"migration-conflict-question-{suffix}"
    missing_owner_bank_id = f"migration-missing-owner-{suffix}"
    previous_published: dict | None = None

    async def seed() -> None:
        nonlocal previous_published
        async with AsyncSessionLocal() as db:
            published = await db.get(SharedRuntimeState, PUBLISHED_KEY)
            if published is not None:
                previous_published = {
                    "value": published.value,
                    "schema_version": published.schema_version,
                    "updated_by": published.updated_by,
                }
            db.add(
                User(
                    username=owner,
                    password_hash=hash_password("migration-pass"),
                    role="teacher",
                    status="active",
                )
            )
            await db.flush()
            db.add(
                QuestionBank(
                    id=conflict_bank_id,
                    owner_id=owner,
                    name="冲突题库",
                    subject="PMP",
                )
            )
            await db.flush()
            db.add(
                Question(
                    id=conflict_question_id,
                    bank_id=conflict_bank_id,
                    title="关系表版本",
                    subject="PMP",
                    scope="internal",
                    content_hash="a" * 64,
                )
            )
            db.add(
                RuntimeState(
                    owner_id=owner,
                    storage={
                        f"kg_question_banks_v1__user__{owner}": json.dumps(
                            [
                                {
                                    "id": conflict_bank_id,
                                    "name": "冲突题库",
                                    "subject": "PMP",
                                    "questions": [
                                        legacy_question(
                                            conflict_question_id,
                                            "Runtime 不同版本",
                                        )
                                    ],
                                }
                            ],
                            ensure_ascii=False,
                        ),
                        f"kg_question_banks_v1__broken__{suffix}": "{bad-json",
                    },
                    revision=1,
                )
            )
            shared_value = json.dumps(
                [
                    {
                        "id": missing_owner_bank_id,
                        "name": "缺少发布者题库",
                        "subject": "PMP",
                        "questions": [],
                    }
                ],
                ensure_ascii=False,
            )
            if published is None:
                db.add(
                    SharedRuntimeState(
                        key=PUBLISHED_KEY,
                        value=shared_value,
                        updated_by=owner,
                    )
                )
            else:
                published.value = shared_value
                published.updated_by = owner
            await db.commit()

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            report = await migrate_runtime_questions(
                db,
                apply=True,
                owner_ids={owner},
                bank_ids={conflict_bank_id, missing_owner_bank_id},
            )
            assert report.applied is False
            assert any(item["code"] == "QUESTION_CONTENT_CONFLICT" for item in report.conflicts)
            assert any(item["code"] == "PUBLISHED_OWNER_MISSING" for item in report.conflicts)
            assert any(item["code"] == "INVALID_JSON" for item in report.invalid_records)
            existing = await db.get(Question, conflict_question_id)
            assert existing is not None and existing.title == "关系表版本"
            assert await db.get(QuestionBank, missing_owner_bank_id) is None

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(Question).where(Question.id == conflict_question_id))
            await db.execute(delete(QuestionBank).where(QuestionBank.id == conflict_bank_id))
            await db.execute(delete(RuntimeState).where(RuntimeState.owner_id == owner))
            published = await db.get(SharedRuntimeState, PUBLISHED_KEY)
            if previous_published is None:
                if published is not None:
                    await db.delete(published)
            elif published is not None:
                published.value = previous_published["value"]
                published.schema_version = previous_published["schema_version"]
                published.updated_by = previous_published["updated_by"]
            await db.execute(delete(User).where(User.username == owner))
            await db.commit()

    asyncio.run(seed())
    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(cleanup())
