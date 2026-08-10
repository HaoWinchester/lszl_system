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
from app.services import teaching_content_revision_service
from app.services import question_service


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
    revision_before_apply = 0

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
        nonlocal revision_before_apply
        async with AsyncSessionLocal() as db:
            revision_before_apply = int(
                (await teaching_content_revision_service.current(db))["revision"]
            )
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
            dry_apply = await migrate_runtime_questions(
                db,
                apply=False,
                owner_ids={owner},
                bank_ids=bank_ids,
            )
            assert dry_apply.applied is False
            assert int(
                (await teaching_content_revision_service.current(db))["revision"]
            ) == revision_before_apply

        async with AsyncSessionLocal() as db:
            applied = await migrate_runtime_questions(
                db,
                apply=True,
                owner_ids={owner},
                bank_ids=bank_ids,
            )
            assert applied.applied is True
            assert applied.conflicts == []
            revision = await teaching_content_revision_service.current(db)
            assert revision["revision"] == revision_before_apply + 1
            assert {
                (change["entityType"], change["entityId"], change["action"])
                for change in revision["changes"]
            } == {
                ("questionBank", relational_bank_id, "updated"),
                ("questionBank", private_bank_id, "created"),
                ("questionBank", published_bank_id, "created"),
                ("question", relational_question_id, "updated"),
                ("question", private_question_id, "created"),
                ("question", published_question_id, "created"),
            }

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
            assert int(
                (await teaching_content_revision_service.current(db))["revision"]
            ) == revision_before_apply + 1

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
            revision_before = int(
                (await teaching_content_revision_service.current(db))["revision"]
            )
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
            assert int(
                (await teaching_content_revision_service.current(db))["revision"]
            ) == revision_before

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


def test_apply_migration_builds_snapshot_only_after_the_global_lock(
    monkeypatch,
) -> None:
    suffix = uuid4().hex[:10]
    owner = f"migration-lock-{suffix}"
    bank_id = f"migration-lock-bank-{suffix}"
    question_id = f"migration-lock-question-{suffix}"
    raw = legacy_question(question_id, "迁移旧标题")

    async def seed() -> None:
        async with AsyncSessionLocal() as db:
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
                    id=bank_id,
                    owner_id=owner,
                    name="迁移锁顺序题库",
                    subject="PMP",
                    visibility="private",
                )
            )
            await db.flush()
            db.add(
                Question(
                    id=question_id,
                    bank_id=bank_id,
                    title=raw["title"],
                    type="single_choice",
                    subject="PMP",
                    scope="internal",
                    content_hash=None,
                    revision=1,
                    tags=raw["tags"],
                    stem_parts=raw["stemParts"],
                    options=raw["options"],
                    correct_answer="B",
                    analysis=raw["analysis"],
                    translations=raw["translations"],
                    content_metadata={},
                    key_path=raw["keyPath"],
                    lifecycle=raw["lifecycle"],
                )
            )
            db.add(
                RuntimeState(
                    owner_id=owner,
                    storage={
                        f"kg_question_banks_v1__user__{owner}": json.dumps(
                            [
                                {
                                    "id": bank_id,
                                    "name": "迁移锁顺序题库",
                                    "subject": "PMP",
                                    "questions": [raw],
                                }
                            ],
                            ensure_ascii=False,
                        )
                    },
                    revision=1,
                )
            )
            await db.commit()

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(Question).where(Question.id == question_id))
            await db.execute(delete(QuestionBank).where(QuestionBank.id == bank_id))
            await db.execute(delete(RuntimeState).where(RuntimeState.owner_id == owner))
            await db.execute(delete(User).where(User.username == owner))
            await db.commit()

    async def scenario() -> None:
        migration_at_lock = asyncio.Event()
        competitor_done = asyncio.Event()
        original_acquire = teaching_content_revision_service.acquire_lock

        async def gated_acquire(db) -> None:
            if db.info.get("migration_lock_probe"):
                migration_at_lock.set()
                await asyncio.wait_for(competitor_done.wait(), timeout=10)
            await original_acquire(db)

        monkeypatch.setattr(
            teaching_content_revision_service,
            "acquire_lock",
            gated_acquire,
        )

        async def migrate() -> object:
            async with AsyncSessionLocal() as db:
                db.info["migration_lock_probe"] = True
                return await migrate_runtime_questions(
                    db,
                    apply=True,
                    owner_ids={owner},
                    bank_ids={bank_id},
                )

        async def relational_update() -> None:
            await asyncio.wait_for(migration_at_lock.wait(), timeout=10)
            async with AsyncSessionLocal() as db:
                actor = await db.get(User, owner)
                assert actor is not None
                updated = await question_service.update_question(
                    db,
                    actor,
                    question_id,
                    {"title": "并发关系表新标题"},
                )
                assert updated is not None
            competitor_done.set()

        report, _ = await asyncio.gather(migrate(), relational_update())
        async with AsyncSessionLocal() as db:
            question = await db.get(Question, question_id)
            assert question is not None
            assert question.title == "并发关系表新标题"
            assert question.revision == 2
        assert report.applied is False
        assert any(
            item["code"] == "QUESTION_CONTENT_CONFLICT"
            for item in report.conflicts
        )

    asyncio.run(seed())
    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(cleanup())


def test_migration_renames_cross_owner_bank_id_conflicts_deterministically() -> None:
    suffix = uuid4().hex[:10]
    original_owner = f"migration-z-original-{suffix}"
    second_owner = f"migration-a-second-{suffix}"
    third_owner = f"migration-b-third-{suffix}"
    owners = {original_owner, second_owner, third_owner}
    bank_id = f"migration-shared-bank-{suffix}"
    mapped_bank_ids = {bank_id, f"{bank_id}-2", f"{bank_id}-3"}
    question_ids = {
        f"migration-original-question-{suffix}",
        f"migration-second-question-{suffix}",
        f"migration-third-question-{suffix}",
    }

    async def seed() -> None:
        async with AsyncSessionLocal() as db:
            db.add_all(
                [
                    User(
                        username=owner,
                        password_hash=hash_password("migration-pass"),
                        role="teacher",
                        status="active",
                    )
                    for owner in owners
                ]
            )
            await db.flush()
            db.add(
                QuestionBank(
                    id=bank_id,
                    owner_id=original_owner,
                    name="同名题库",
                    subject="PMP",
                    visibility="private",
                )
            )
            await db.flush()
            original_raw = legacy_question(
                f"migration-original-question-{suffix}",
                "关系表原题",
            )
            db.add(
                Question(
                    id=original_raw["id"],
                    bank_id=bank_id,
                    title=original_raw["title"],
                    type="single_choice",
                    subject="PMP",
                    scope="internal",
                    content_hash=None,
                    revision=1,
                    tags=original_raw["tags"],
                    stem_parts=original_raw["stemParts"],
                    options=original_raw["options"],
                    correct_answer="B",
                    analysis=original_raw["analysis"],
                    translations=original_raw["translations"],
                    content_metadata={},
                    key_path=original_raw["keyPath"],
                    lifecycle=original_raw["lifecycle"],
                )
            )
            for owner, question_id, title in (
                (second_owner, f"migration-second-question-{suffix}", "第二份题"),
                (third_owner, f"migration-third-question-{suffix}", "第三份题"),
            ):
                db.add(
                    RuntimeState(
                        owner_id=owner,
                        storage={
                            f"kg_question_banks_v1__user__{owner}": json.dumps(
                                [
                                    {
                                        "id": bank_id,
                                        "name": "同名题库",
                                        "subject": "PMP",
                                        "visibility": "private",
                                        "questions": [legacy_question(question_id, title)],
                                    }
                                ],
                                ensure_ascii=False,
                            )
                        },
                        revision=1,
                    )
                )
            await db.commit()

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            dry = await scan_runtime_question_sources(
                db,
                owner_ids=owners,
                bank_ids=mapped_bank_ids,
            )
            assert dry.conflicts == []
            assert [item.owner_id for item in dry.bank_mappings] == [
                original_owner,
                second_owner,
                third_owner,
            ]
            assert [item.new_bank_id for item in dry.bank_mappings] == [
                bank_id,
                f"{bank_id}-2",
                f"{bank_id}-3",
            ]
            assert [item.new_name for item in dry.bank_mappings] == [
                "同名题库",
                "同名题库（2）",
                "同名题库（3）",
            ]

        async with AsyncSessionLocal() as db:
            applied = await migrate_runtime_questions(
                db,
                apply=True,
                owner_ids=owners,
                bank_ids=mapped_bank_ids,
            )
            assert applied.applied is True
            first_mapping = applied.model_dump(by_alias=True)["bankMappings"]

        async with AsyncSessionLocal() as db:
            banks = {
                item.id: item
                for item in (
                    await db.execute(
                        select(QuestionBank).where(QuestionBank.id.in_(mapped_bank_ids))
                    )
                ).scalars()
            }
            assert {bank_id: (banks[bank_id].owner_id, banks[bank_id].name)} == {
                bank_id: (original_owner, "同名题库")
            }
            assert banks[f"{bank_id}-2"].owner_id == second_owner
            assert banks[f"{bank_id}-2"].name == "同名题库（2）"
            assert banks[f"{bank_id}-3"].owner_id == third_owner
            assert banks[f"{bank_id}-3"].name == "同名题库（3）"
            questions = {
                item.id: item.bank_id
                for item in (
                    await db.execute(select(Question).where(Question.id.in_(question_ids)))
                ).scalars()
            }
            assert questions == {
                f"migration-original-question-{suffix}": bank_id,
                f"migration-second-question-{suffix}": f"{bank_id}-2",
                f"migration-third-question-{suffix}": f"{bank_id}-3",
            }

        async with AsyncSessionLocal() as db:
            rerun = await migrate_runtime_questions(
                db,
                apply=True,
                owner_ids=owners,
                bank_ids=mapped_bank_ids,
            )
            assert rerun.applied is True
            assert rerun.model_dump(by_alias=True)["bankMappings"] == first_mapping
            bank_count = int(
                (
                    await db.execute(
                        select(func.count()).select_from(QuestionBank).where(
                            QuestionBank.id.in_(mapped_bank_ids)
                        )
                    )
                ).scalar_one()
            )
            question_count = int(
                (
                    await db.execute(
                        select(func.count()).select_from(Question).where(
                            Question.id.in_(question_ids)
                        )
                    )
                ).scalar_one()
            )
            assert (bank_count, question_count) == (3, 3)

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(Question).where(Question.id.in_(question_ids)))
            await db.execute(delete(QuestionBank).where(QuestionBank.id.in_(mapped_bank_ids)))
            await db.execute(delete(RuntimeState).where(RuntimeState.owner_id.in_(owners)))
            await db.execute(delete(User).where(User.username.in_(owners)))
            await db.commit()

    asyncio.run(seed())
    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(cleanup())


def test_migration_uses_stable_fallback_id_without_renaming_different_names() -> None:
    suffix = uuid4().hex[:8]
    original_owner = f"migration-z-fallback-{suffix}"
    second_owner = f"migration-a-fallback-{suffix}"
    occupied_owner = f"migration-occupied-{suffix}"
    owners = {original_owner, second_owner, occupied_owner}
    bank_id = f"fallback-{suffix}-" + ("x" * 40)
    occupied_id = f"{bank_id}-2"
    bank_ids = {bank_id, occupied_id}

    async def seed() -> None:
        async with AsyncSessionLocal() as db:
            db.add_all(
                [
                    User(
                        username=owner,
                        password_hash=hash_password("migration-pass"),
                        role="teacher",
                        status="active",
                    )
                    for owner in owners
                ]
            )
            await db.flush()
            db.add_all(
                [
                    QuestionBank(
                        id=bank_id,
                        owner_id=original_owner,
                        name="原名称",
                        subject="PMP",
                    ),
                    QuestionBank(
                        id=occupied_id,
                        owner_id=occupied_owner,
                        name="已占用题库",
                        subject="PMP",
                    ),
                ]
            )
            db.add(
                RuntimeState(
                    owner_id=second_owner,
                    storage={
                        f"kg_question_banks_v1__user__{second_owner}": json.dumps(
                            [
                                {
                                    "id": bank_id,
                                    "name": "不同名称",
                                    "subject": "PMP",
                                    "questions": [],
                                }
                            ],
                            ensure_ascii=False,
                        )
                    },
                    revision=1,
                )
            )
            await db.commit()

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            first = await scan_runtime_question_sources(
                db,
                owner_ids=owners,
                bank_ids=bank_ids,
            )
            second = await scan_runtime_question_sources(
                db,
                owner_ids=owners,
                bank_ids=bank_ids,
            )
            assert first.conflicts == []
            mapping = next(item for item in first.bank_mappings if item.owner_id == second_owner)
            assert mapping.new_name == "不同名称"
            assert mapping.new_bank_id != occupied_id
            assert "-2-" in mapping.new_bank_id
            assert len(mapping.new_bank_id) <= 64
            assert second.model_dump(by_alias=True)["bankMappings"] == first.model_dump(
                by_alias=True
            )["bankMappings"]

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(QuestionBank).where(QuestionBank.id.in_(bank_ids)))
            await db.execute(delete(RuntimeState).where(RuntimeState.owner_id.in_(owners)))
            await db.execute(delete(User).where(User.username.in_(owners)))
            await db.commit()

    asyncio.run(seed())
    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(cleanup())


def test_migration_leaves_same_name_banks_with_distinct_ids_unchanged() -> None:
    suffix = uuid4().hex[:10]
    first_owner = f"migration-same-name-a-{suffix}"
    second_owner = f"migration-same-name-b-{suffix}"
    owners = {first_owner, second_owner}
    first_id = f"migration-same-name-one-{suffix}"
    second_id = f"migration-same-name-two-{suffix}"
    bank_ids = {first_id, second_id}

    async def seed() -> None:
        async with AsyncSessionLocal() as db:
            db.add_all(
                [
                    User(
                        username=owner,
                        password_hash=hash_password("migration-pass"),
                        role="teacher",
                        status="active",
                    )
                    for owner in owners
                ]
            )
            await db.flush()
            db.add_all(
                [
                    QuestionBank(
                        id=first_id,
                        owner_id=first_owner,
                        name="普通同名题库",
                        subject="PMP",
                    ),
                    QuestionBank(
                        id=second_id,
                        owner_id=second_owner,
                        name="普通同名题库",
                        subject="PMP",
                    ),
                ]
            )
            await db.commit()

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            report = await scan_runtime_question_sources(
                db,
                owner_ids=owners,
                bank_ids=bank_ids,
            )
            assert report.conflicts == []
            assert report.bank_mappings == []
            banks = (
                await db.execute(
                    select(QuestionBank).where(QuestionBank.id.in_(bank_ids)).order_by(
                        QuestionBank.id
                    )
                )
            ).scalars().all()
            assert [(bank.id, bank.name) for bank in banks] == [
                (first_id, "普通同名题库"),
                (second_id, "普通同名题库"),
            ]

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(QuestionBank).where(QuestionBank.id.in_(bank_ids)))
            await db.execute(delete(User).where(User.username.in_(owners)))
            await db.commit()

    asyncio.run(seed())
    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(cleanup())
