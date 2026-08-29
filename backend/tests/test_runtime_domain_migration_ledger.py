import asyncio
import inspect
from datetime import datetime, timezone
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import delete, func, select

from app.cli.runtime_domain_migration import _run, build_parser, report_exit_code
from app.db.session import AsyncSessionLocal
from app.models.engagement import Announcement, MessageReceipt
from app.models.paper_release import PaperRelease, PaperReleaseQuestion
from app.models.question import ExamPaper, Question, QuestionBank
from app.models.runtime_migration import RuntimeMigrationItem, RuntimeMigrationRun
from app.models.shared_runtime_state import SharedRuntimeState
from app.models.user import User
from app.services.runtime_domain_migration_service import (
    PAPER_RELEASE_HISTORY_KEY,
    PUBLISHED_PAPERS_KEY,
    can_drop_runtime,
    canonical_json_hash,
    drop_check,
    migrate,
    plan,
    scan,
    verify,
)
from app.services import (
    question_service,
    runtime_domain_migration_service,
    teaching_content_revision_service,
)


def test_canonical_json_hash_ignores_object_key_order() -> None:
    assert canonical_json_hash({"b": 2, "a": [1, {"d": 4, "c": 3}]}) == canonical_json_hash(
        {"a": [1, {"c": 3, "d": 4}], "b": 2}
    )


def test_cli_accepts_repeated_source_key_filters() -> None:
    args = build_parser().parse_args([
        "plan",
        "--report-json",
        "/tmp/runtime-plan.json",
        "--source-key",
        PUBLISHED_PAPERS_KEY,
        "--source-key",
        PAPER_RELEASE_HISTORY_KEY,
    ])

    assert args.source_keys == [PUBLISHED_PAPERS_KEY, PAPER_RELEASE_HISTORY_KEY]


def test_message_receipt_verification_is_scoped_to_each_runtime_owner() -> None:
    suffix = uuid4().hex[:10]
    run_id = f"message-receipts-{suffix}"
    announcement_id = f"message-{suffix}"
    first_username = f"receipt-a-{suffix}"
    second_username = f"receipt-b-{suffix}"

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            db.add_all([
                User(
                    username=first_username,
                    password_hash="test-only",
                    role="student",
                    status="active",
                ),
                User(
                    username=second_username,
                    password_hash="test-only",
                    role="student",
                    status="active",
                ),
            ])
            await db.flush()
            db.add(Announcement(
                id=announcement_id,
                title="迁移验证公告",
                body="验证每个账号只读取自己的公告收据。",
                link="",
                status="published",
                publish_at=100,
                expires_at=0,
                published_at=100,
                withdrawn_at=0,
                created_by=first_username,
                created_at=100,
                updated_at=100,
            ))
            await db.commit()

            try:
                source_rows = [
                    {
                        "source_type": "runtime",
                        "source_key": f"kg_user_message_reads_v1__{username}",
                        "owner_id": username,
                        "payload": {announcement_id: read_at},
                        "required": True,
                    }
                    for username, read_at in (
                        (first_username, 111),
                        (second_username, 222),
                    )
                ]
                scanned = await scan(db, run_id=run_id, sources=source_rows)
                assert scanned["items"] == 2
                assert (await migrate(db, run_id))["migrated"] == 2

                verified = await verify(db, run_id)

                assert verified["status"] == "verified"
                assert verified["required_failures"] == 0
                items = list((await db.scalars(
                    select(RuntimeMigrationItem)
                    .where(RuntimeMigrationItem.run_id == run_id)
                    .order_by(RuntimeMigrationItem.owner_scope)
                )).all())
                assert [(item.owner_scope, item.target_count) for item in items] == [
                    (first_username, 1),
                    (second_username, 1),
                ]
                receipts = list((await db.scalars(
                    select(MessageReceipt)
                    .where(MessageReceipt.announcement_id == announcement_id)
                    .order_by(MessageReceipt.username)
                )).all())
                assert [(row.username, row.read_at) for row in receipts] == [
                    (first_username, 111),
                    (second_username, 222),
                ]
            finally:
                await db.execute(delete(RuntimeMigrationRun).where(RuntimeMigrationRun.id == run_id))
                await db.execute(delete(Announcement).where(Announcement.id == announcement_id))
                await db.execute(delete(User).where(User.username.in_([
                    first_username,
                    second_username,
                ])))
                await db.commit()

    asyncio.run(scenario())


def test_plan_and_scan_can_isolate_paper_release_sources() -> None:
    suffix = uuid4().hex[:10]
    run_id = f"paper-source-filter-{suffix}"
    unrelated_key = f"unrelated-runtime-key-{suffix}"

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            previous = await db.get(SharedRuntimeState, PUBLISHED_PAPERS_KEY)
            previous_values = None if previous is None else {
                "value": previous.value,
                "updated_by": previous.updated_by,
            }
            if previous is not None:
                await db.delete(previous)
            db.add_all([
                SharedRuntimeState(key=PUBLISHED_PAPERS_KEY, value="[]"),
                SharedRuntimeState(key=unrelated_key, value='{"keep":true}'),
            ])
            await db.commit()

            planned = await plan(db, source_keys={PUBLISHED_PAPERS_KEY})
            assert planned["items"] == 1
            assert planned["unknown"] == 0
            assert [item["source_key"] for item in planned["plan"]] == [PUBLISHED_PAPERS_KEY]

            scanned = await scan(db, run_id=run_id, source_keys={PUBLISHED_PAPERS_KEY})
            assert scanned["items"] == 1
            source_keys = set((await db.scalars(
                select(RuntimeMigrationItem.source_key).where(
                    RuntimeMigrationItem.run_id == run_id
                )
            )).all())
            assert source_keys == {PUBLISHED_PAPERS_KEY}

            await db.execute(delete(RuntimeMigrationRun).where(RuntimeMigrationRun.id == run_id))
            await db.execute(delete(SharedRuntimeState).where(
                SharedRuntimeState.key.in_([PUBLISHED_PAPERS_KEY, unrelated_key])
            ))
            if previous_values is not None:
                db.add(SharedRuntimeState(key=PUBLISHED_PAPERS_KEY, **previous_values))
            await db.commit()

    asyncio.run(scenario())


def test_scan_deduplicates_identical_source_hashes_and_required_failure_blocks_drop() -> None:
    run_id = f"ledger-{uuid4().hex}"

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            run = RuntimeMigrationRun(id=run_id, status="scanning")
            db.add(run)
            await db.flush()

            first = await scan(
                db,
                run_id=run_id,
                sources=[
                    {
                        "source_type": "runtime",
                        "source_key": "kg_required_v1",
                        "owner_id": "teacher-a",
                        "payload": {"b": 2, "a": 1},
                        "required": True,
                    },
                    {
                        "source_type": "runtime",
                        "source_key": "kg_required_v1",
                        "owner_id": "teacher-a",
                        "payload": {"a": 1, "b": 2},
                        "required": True,
                    },
                ],
            )
            second = await scan(
                db,
                run_id=run_id,
                sources=[
                    {
                        "source_type": "runtime",
                        "source_key": "kg_required_v1",
                        "owner_id": "teacher-a",
                        "payload": {"a": 1, "b": 2},
                        "required": True,
                    }
                ],
            )
            assert first["created"] == 1
            assert first["deduplicated"] == 1
            assert first["source_snapshot_hash"]
            assert first["source_snapshot_payload"]
            assert second["created"] == 0
            assert second["deduplicated"] == 1
            count = await db.scalar(
                select(func.count()).select_from(RuntimeMigrationItem).where(
                    RuntimeMigrationItem.run_id == run_id
                )
            )
            assert count == 1

            await migrate(db, run_id)
            item = await db.scalar(
                select(RuntimeMigrationItem).where(RuntimeMigrationItem.run_id == run_id)
            )
            assert item is not None
            assert item.status == "pending"
            assert item.disposition == "unknown"
            assert item.target_domain is None
            assert item.discard_reason is not None
            assert item.verification_metadata["source_hash"] == item.source_hash
            assert await can_drop_runtime(db, run_id) is False
            unknown_drop_report = await drop_check(db, run_id)
            assert unknown_drop_report["can_drop"] is False
            assert unknown_drop_report["unknown"] == 1

            async def missing_target(_db, _item):
                return None

            await migrate(db, run_id, target_mappers={item.source_key: missing_target})
            await db.refresh(item)
            assert item.status == "pending"
            assert item.target_hash is None

            assert "target_results" in inspect.signature(migrate).parameters
            with pytest.raises(TypeError, match="target_results is not accepted"):
                await migrate(db, run_id, target_results={item.id: {"canonical_payload": {}}})

            async def invalid_target(_db, _item):
                return {"a": 1, "b": 2}

            await migrate(db, run_id, target_mappers={item.source_key: invalid_target})
            await db.refresh(item)
            assert item.status == "pending"
            assert item.error == "target mapper must return a mapping with canonical_payload"

            async def target_mapper(mapper_db, mapper_item):
                assert mapper_db is db
                assert mapper_item.id == item.id
                return {"canonical_payload": {"a": 1, "b": 2}}

            await migrate(db, run_id, target_mappers={item.source_key: target_mapper})
            await db.refresh(item)
            assert item.status == "migrated"
            assert item.target_count == 2
            assert item.target_hash == canonical_json_hash({"a": 1, "b": 2})

            item.target_count = item.source_count
            item.target_hash = "0" * 64
            await db.commit()
            hash_report = await verify(db, run_id)
            assert hash_report["required_failures"] == 1
            assert item.error == "source and target hashes differ"
            assert await can_drop_runtime(db, run_id) is False

            item.status = "migrated"
            item.error = None
            item.target_hash = item.source_hash
            item.disposition = "migrate"
            item.target_domain = "test-relational-domain"
            item.discard_reason = None
            await db.commit()
            assert (await verify(db, run_id))["required_failures"] == 0
            assert await can_drop_runtime(db, run_id) is True

            drop_report = await drop_check(db, run_id)
            assert drop_report["can_drop"] is True
            assert drop_report["ddl_executed"] is False
            assert drop_report["status"] == "drop_allowed"
            run.source_snapshot_hash = "0" * 64
            await db.commit()
            assert await can_drop_runtime(db, run_id) is False
            # 第二次 scan（单源）已覆盖快照哈希，恢复时必须用当前账本快照而非首扫双源哈希。
            run.source_snapshot_hash = second["source_snapshot_hash"]
            run.backup_reference = None
            await db.commit()
            blocked_backup = await drop_check(db, run_id)
            assert blocked_backup["can_drop"] is False
            assert blocked_backup["ddl_executed"] is False
            run.backup_reference = f"backup:{run_id}"
            await db.commit()
            assert await can_drop_runtime(db, run_id) is True
            # verify 以账本计数为准重算状态；制造真实计数不匹配而不是只写 error。
            item.target_count = item.source_count + 1
            item.error = "target count mismatch"
            await db.commit()

            report = await verify(db, run_id)
            assert report["required_failures"] == 1
            assert await can_drop_runtime(db, run_id) is False

            item.status = "verified"
            item.error = None
            item.expected_count = 1
            item.expected_hash = item.source_hash
            item.source_count = 1
            item.target_count = 1
            await db.commit()
            assert (await verify(db, run_id))["required_failures"] == 0
            assert await can_drop_runtime(db, run_id) is True

            item.required = False
            item.status = "failed"
            item.error = "optional source was intentionally skipped"
            await db.commit()
            optional_report = await verify(db, run_id)
            assert optional_report["required_failures"] == 0
            assert optional_report["status"] == "verified"
            assert await can_drop_runtime(db, run_id) is False

            await db.execute(delete(RuntimeMigrationRun).where(RuntimeMigrationRun.id == run_id))
            await db.commit()

    asyncio.run(scenario())


def test_backfill_rescans_changed_sources_with_the_same_run_id() -> None:
    suffix = uuid4().hex[:10]
    run_id = f"repeat-backfill-{suffix}"
    subject_id = f"subject-repeat-{suffix}"
    first_id = f"taxonomy-first-{suffix}"
    second_id = f"taxonomy-second-{suffix}"
    source_key = "kg_content_taxonomies_v1"
    first_payload = [{
        "id": first_id,
        "subjectId": subject_id,
        "subjectName": "重复回填科目",
        "title": "第一版分类",
        "version": 1,
        "status": "published",
        "nodes": [],
    }]
    second_payload = [
        *first_payload,
        {
            "id": second_id,
            "subjectId": subject_id,
            "subjectName": "重复回填科目",
            "title": "第二版新增分类",
            "version": 2,
            "status": "published",
            "nodes": [],
        },
    ]

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            previous = await db.get(SharedRuntimeState, source_key)
            previous_values = None if previous is None else {
                "value": previous.value,
                "updated_by": previous.updated_by,
            }
            if previous is not None:
                await db.delete(previous)
            db.add(SharedRuntimeState(
                key=source_key,
                value=__import__("json").dumps(first_payload),
                updated_by="admin",
            ))
            await db.commit()

        first = await _run("backfill", run_id, {source_key})
        assert first["status"] == "verified"
        assert first["scan"]["created"] == 1

        async with AsyncSessionLocal() as db:
            item = await db.scalar(select(RuntimeMigrationItem).where(
                RuntimeMigrationItem.run_id == run_id,
                RuntimeMigrationItem.required.is_(True),
            ))
            assert item is not None
            item.status = "failed"
            item.error = "模拟上次部署中断"
            await db.commit()

        retried = await _run("backfill", run_id, {source_key})
        assert retried["status"] == "verified", retried

        async with AsyncSessionLocal() as db:
            row = await db.get(SharedRuntimeState, source_key)
            assert row is not None
            row.value = __import__("json").dumps(second_payload)
            await db.commit()

        second = await _run("backfill", run_id, {source_key})
        assert second["status"] == "verified", second
        assert second["scan"] is not None
        assert second["scan"]["created"] == 1

        async with AsyncSessionLocal() as db:
            assert await db.get(ContentTaxonomy, second_id) is not None
            await db.execute(delete(RuntimeMigrationRun).where(RuntimeMigrationRun.id == run_id))
            await db.execute(delete(ContentTaxonomy).where(
                ContentTaxonomy.id.in_([first_id, second_id])
            ))
            await db.execute(delete(ContentSubject).where(ContentSubject.id == subject_id))
            await db.execute(delete(SharedRuntimeState).where(SharedRuntimeState.key == source_key))
            if previous_values is not None:
                db.add(SharedRuntimeState(key=source_key, **previous_values))
            await db.commit()

    from app.models.teaching_content import ContentSubject, ContentTaxonomy

    asyncio.run(scenario())


def test_paper_backfill_reuses_an_existing_paper_version_with_a_different_release_id() -> None:
    suffix = uuid4().hex[:10]
    run_id = f"paper-version-reuse-{suffix}"
    teacher = f"paper-version-teacher-{suffix}"
    paper_id = f"paper-version-{suffix}"
    existing_release_id = f"paper-version-existing-{suffix}"
    incoming_release_id = f"paper-version-incoming-{suffix}"
    bank_id = f"paper-version-bank-{suffix}"
    question_id = f"paper-version-question-{suffix}"
    payload = [{
        "id": incoming_release_id,
        "releaseId": incoming_release_id,
        "paperId": paper_id,
        "version": 1,
        "name": "兼容快照中的重复版本",
        "subject": "PMP",
        "status": "published",
        "publishedBy": teacher,
        "questions": [{
            "bankId": bank_id,
            "questionId": question_id,
            "order": 1,
        }],
        "questionSnapshots": [{
            "bankId": bank_id,
            "questionId": question_id,
            "question": {"id": question_id, "bankId": bank_id, "title": "兼容快照题目"},
        }],
    }]

    async def scenario() -> None:
        previous_values = None
        async with AsyncSessionLocal() as db:
            previous = await db.get(SharedRuntimeState, PUBLISHED_PAPERS_KEY)
            if previous is not None:
                previous_values = {"value": previous.value, "updated_by": previous.updated_by}
                await db.delete(previous)
            db.add(User(username=teacher, password_hash="unused", role="teacher", status="active"))
            await db.flush()
            db.add(ExamPaper(id=paper_id, owner_id=teacher, name="关系域既有试卷", subject="PMP"))
            db.add(PaperRelease(
                id=existing_release_id,
                paper_id=paper_id,
                version=1,
                status="published",
                name="关系域权威版本",
                subject="PMP",
                publisher_id=teacher,
                access_level="free",
                enabled_modes=[],
                allowed_roles=[],
                release_metadata={},
                source_payload={},
                question_count=0,
                published_at=datetime.now(timezone.utc),
            ))
            db.add(SharedRuntimeState(
                key=PUBLISHED_PAPERS_KEY,
                value=__import__("json").dumps(payload),
                updated_by=teacher,
            ))
            await db.commit()

        try:
            report = await _run("backfill", run_id, {PUBLISHED_PAPERS_KEY})
            async with AsyncSessionLocal() as db:
                item = await db.scalar(select(RuntimeMigrationItem).where(
                    RuntimeMigrationItem.run_id == run_id
                ))
                assert report["status"] == "verified", {
                    "report": report,
                    "item_status": item.status if item else None,
                    "item_error": item.error if item else None,
                }
                existing = await db.get(PaperRelease, existing_release_id)
                assert existing is not None
                assert existing.name == "关系域权威版本"
                assert await db.get(PaperRelease, incoming_release_id) is None
        finally:
            async with AsyncSessionLocal() as db:
                await db.execute(delete(RuntimeMigrationRun).where(RuntimeMigrationRun.id == run_id))
                await db.execute(delete(PaperRelease).where(PaperRelease.paper_id == paper_id))
                await db.execute(delete(SharedRuntimeState).where(
                    SharedRuntimeState.key == PUBLISHED_PAPERS_KEY
                ))
                if previous_values is not None:
                    db.add(SharedRuntimeState(key=PUBLISHED_PAPERS_KEY, **previous_values))
                await db.execute(delete(ExamPaper).where(ExamPaper.id == paper_id))
                await db.execute(delete(User).where(User.username == teacher))
                await db.commit()

    asyncio.run(scenario())


def test_concurrent_scan_upserts_one_run_and_item() -> None:
    run_id = f"concurrent-ledger-{uuid4().hex}"
    sources = [{
        "source_type": "runtime",
        "source_key": "kg_concurrent_v1",
        "owner_id": "teacher-a",
        "payload": {"items": [1]},
        "required": True,
    }]

    async def scenario() -> None:
        async with AsyncSessionLocal() as first_db, AsyncSessionLocal() as second_db:
            first, second = await asyncio.gather(
                scan(first_db, run_id=run_id, sources=sources),
                scan(second_db, run_id=run_id, sources=sources),
            )
            assert first["items"] == 1
            assert second["items"] == 1

        async with AsyncSessionLocal() as db:
            run_count = await db.scalar(
                select(func.count()).select_from(RuntimeMigrationRun).where(
                    RuntimeMigrationRun.id == run_id
                )
            )
            item_count = await db.scalar(
                select(func.count()).select_from(RuntimeMigrationItem).where(
                    RuntimeMigrationItem.run_id == run_id
                )
            )
            assert run_count == 1
            assert item_count == 1
            await db.execute(delete(RuntimeMigrationRun).where(RuntimeMigrationRun.id == run_id))
            await db.commit()

    asyncio.run(scenario())


def test_empty_scan_never_verifies_or_allows_drop() -> None:
    run_id = f"empty-ledger-{uuid4().hex}"

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            scanned = await scan(db, run_id=run_id, sources=[])
            assert scanned["status"] == "empty"
            report = await verify(db, run_id)
            assert report["status"] == "verification_failed"
            assert report["required_failures"] == 1
            assert await can_drop_runtime(db, run_id) is False
            assert report_exit_code("verify", report) == 1
            await db.execute(delete(RuntimeMigrationRun).where(RuntimeMigrationRun.id == run_id))
            await db.commit()

    asyncio.run(scenario())


def test_paper_release_mappers_materialize_shared_catalog_and_history() -> None:
    suffix = uuid4().hex[:10]
    run_id = f"paper-release-mapper-{suffix}"
    teacher = f"mapper-teacher-{suffix}"
    bank_id = f"mapper-bank-{suffix}"
    paper_id = f"mapper-paper-{suffix}"
    question_id = f"mapper-question-{suffix}"
    current_id = f"mapper-current-{suffix}"
    history_id = f"mapper-history-{suffix}"

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            from app.models.user import User
            from app.services.runtime_domain_migration_service import (
                PAPER_RELEASE_HISTORY_KEY,
                PUBLISHED_PAPERS_KEY,
            )

            db.add(User(username=teacher, password_hash="unused", role="teacher", status="active"))
            await db.flush()
            db.add(QuestionBank(id=bank_id, owner_id=teacher, name="迁移题库", subject="PMP"))
            db.add(ExamPaper(id=paper_id, owner_id=teacher, name="迁移试卷", subject="PMP"))
            await db.flush()
            db.add(Question(id=question_id, bank_id=bank_id, title="冻结题目", scope="internal"))
            await db.flush()
            snapshot = {"id": question_id, "bankId": bank_id, "title": "冻结题目", "revision": 1}
            catalog = [{
                "id": current_id, "releaseId": current_id, "paperId": paper_id,
                "version": 2, "name": "迁移试卷", "subject": "PMP", "status": "published",
                "publishedBy": teacher, "enabledModes": ["practice_mode"],
                "allowedRoles": ["student"], "questions": [{"bankId": bank_id, "questionId": question_id, "order": 1}],
                "questionSnapshots": [{"bankId": bank_id, "questionId": question_id, "question": snapshot}],
            }]
            history = [{
                **catalog[0], "id": history_id, "releaseId": history_id,
                "version": 1, "status": "superseded",
            }]
            previous_shared = {}
            for key in (PUBLISHED_PAPERS_KEY, PAPER_RELEASE_HISTORY_KEY):
                previous = await db.get(SharedRuntimeState, key)
                if previous is not None:
                    previous_shared[key] = {
                        "value": previous.value,
                        "updated_by": previous.updated_by,
                    }
                    await db.delete(previous)
            db.add_all([
                SharedRuntimeState(key=PUBLISHED_PAPERS_KEY, value=__import__("json").dumps(catalog), updated_by=teacher),
                SharedRuntimeState(key=PAPER_RELEASE_HISTORY_KEY, value=__import__("json").dumps(history), updated_by=teacher),
            ])
            await db.commit()
            await scan(db, run_id=run_id, sources=[
                {"source_type": "shared_runtime", "source_key": PUBLISHED_PAPERS_KEY, "owner_scope": "shared", "payload": catalog},
                {"source_type": "shared_runtime", "source_key": PAPER_RELEASE_HISTORY_KEY, "owner_scope": "shared", "payload": history},
            ])
            report = await migrate(db, run_id)
            assert report["migrated"] == 2
            releases = (await db.scalars(select(PaperRelease).where(PaperRelease.paper_id == paper_id))).all()
            assert {(row.id, row.status) for row in releases} == {
                (current_id, "published"), (history_id, "superseded")
            }
            paper = await db.get(ExamPaper, paper_id)
            assert paper is not None
            assert paper.status == "published"
            assert paper.published_version == 2
            assert paper.published_release_id == current_id
            rows = (await db.scalars(select(PaperReleaseQuestion).where(
                PaperReleaseQuestion.release_id.in_([current_id, history_id])
            ))).all()
            assert len(rows) == 2
            assert all(row.snapshot["title"] == "冻结题目" for row in rows)
            verified = await verify(db, run_id)
            assert verified["status"] == "verified"
            assert await can_drop_runtime(db, run_id) is True

            overlap_run_id = f"paper-release-overlap-{suffix}"
            await scan(db, run_id=overlap_run_id, sources=[
                {"source_type": "shared_runtime", "source_key": PUBLISHED_PAPERS_KEY, "owner_scope": "shared", "payload": catalog},
                {"source_type": "shared_runtime", "source_key": PAPER_RELEASE_HISTORY_KEY, "owner_scope": "shared", "payload": catalog},
            ])
            overlap_items = list((await db.scalars(select(RuntimeMigrationItem).where(
                RuntimeMigrationItem.run_id == overlap_run_id
            ))).all())
            assert len(overlap_items) == 2
            for item in overlap_items:
                item.status = "migrated"
            await db.commit()
            overlap_verified = await verify(db, overlap_run_id)
            assert overlap_verified["status"] == "verified"

            current_release = await db.get(PaperRelease, current_id)
            assert current_release is not None
            current_release.name = "关系域合法改名"
            paper.status = "draft"
            paper.published_version = 0
            paper.published_release_id = None
            paper.published_at = None
            await db.commit()
            repeated = await _run(
                "backfill",
                run_id,
                {PUBLISHED_PAPERS_KEY, PAPER_RELEASE_HISTORY_KEY},
            )
            assert repeated["status"] == "verified", repeated
            await db.refresh(current_release)
            assert current_release.name == "关系域合法改名"
            await db.refresh(paper)
            assert paper.status == "published"
            assert paper.published_version == 2
            assert paper.published_release_id == current_id

            rows[0].snapshot = {**rows[0].snapshot, "title": "被污染"}
            await db.commit()
            blocked_drop = await drop_check(db, run_id)
            assert blocked_drop["can_drop"] is False
            polluted = await verify(db, run_id)
            assert polluted["status"] == "verification_failed"
            assert await can_drop_runtime(db, run_id) is False

            await db.execute(delete(RuntimeMigrationRun).where(RuntimeMigrationRun.id == overlap_run_id))
            await db.execute(delete(RuntimeMigrationRun).where(RuntimeMigrationRun.id == run_id))
            await db.execute(delete(PaperReleaseQuestion).where(PaperReleaseQuestion.release_id.in_([current_id, history_id])))
            await db.execute(delete(PaperRelease).where(PaperRelease.paper_id == paper_id))
            await db.execute(delete(SharedRuntimeState).where(SharedRuntimeState.key.in_([
                PUBLISHED_PAPERS_KEY, PAPER_RELEASE_HISTORY_KEY
            ])))
            for key, values in previous_shared.items():
                db.add(SharedRuntimeState(key=key, **values))
            await db.execute(delete(Question).where(Question.id == question_id))
            await db.execute(delete(ExamPaper).where(ExamPaper.id == paper_id))
            await db.execute(delete(QuestionBank).where(QuestionBank.id == bank_id))
            await db.execute(delete(User).where(User.username == teacher))
            await db.commit()

    asyncio.run(scenario())


def test_release_migration_serializes_against_permanent_question_delete() -> None:
    suffix = uuid4().hex[:10]
    run_id = f"release-delete-lock-{suffix}"
    teacher = f"release-delete-teacher-{suffix}"
    bank_id = f"release-delete-bank-{suffix}"
    paper_id = f"release-delete-paper-{suffix}"
    question_id = f"release-delete-question-{suffix}"
    release_id = f"release-delete-history-{suffix}"
    mapper_flushed = asyncio.Event()
    permit_migration_commit = asyncio.Event()

    source = [{
        "id": release_id,
        "releaseId": release_id,
        "paperId": paper_id,
        "version": 1,
        "name": "迁移删除互斥试卷",
        "subject": "PMP",
        "status": "withdrawn",
        "publishedBy": teacher,
        "enabledModes": ["practice_mode"],
        "allowedRoles": ["student"],
        "questions": [{
            "bankId": bank_id,
            "questionId": question_id,
            "order": 1,
        }],
        "questionSnapshots": [{
            "bankId": bank_id,
            "questionId": question_id,
            "question": {"id": question_id, "bankId": bank_id, "title": "迁移冻结题"},
        }],
    }]

    async def scenario() -> None:
        async with AsyncSessionLocal() as setup_db:
            setup_db.add(User(username=teacher, password_hash="unused", role="teacher", status="active"))
            await setup_db.flush()
            setup_db.add(QuestionBank(id=bank_id, owner_id=teacher, name="迁移删除题库", subject="PMP"))
            setup_db.add(ExamPaper(id=paper_id, owner_id=teacher, name="迁移删除试卷", subject="PMP"))
            await setup_db.flush()
            setup_db.add(Question(id=question_id, bank_id=bank_id, title="迁移删除题", scope="internal"))
            await setup_db.commit()
            await scan(setup_db, run_id=run_id, sources=[{
                "source_type": "shared_runtime",
                "source_key": PAPER_RELEASE_HISTORY_KEY,
                "owner_scope": "shared",
                "payload": source,
            }])

        real_mapper = runtime_domain_migration_service._paper_release_mapper

        async def paused_mapper(db, item):
            result = await real_mapper(db, item)
            mapper_flushed.set()
            await permit_migration_commit.wait()
            return result

        async with AsyncSessionLocal() as migration_db, AsyncSessionLocal() as delete_db:
            migration_task = asyncio.create_task(migrate(
                migration_db,
                run_id,
                target_mappers={PAPER_RELEASE_HISTORY_KEY: paused_mapper},
            ))
            await mapper_flushed.wait()
            actor = await delete_db.get(User, teacher)

            async def attempt_delete() -> int:
                try:
                    await question_service.delete_question(delete_db, actor, question_id)
                except HTTPException as error:
                    return error.status_code
                return 200

            delete_task = asyncio.create_task(attempt_delete())
            with pytest.raises(asyncio.TimeoutError):
                await asyncio.wait_for(asyncio.shield(delete_task), timeout=0.1)
            permit_migration_commit.set()
            assert (await migration_task)["migrated"] == 1
            assert await delete_task == 409

        async with AsyncSessionLocal() as cleanup_db:
            assert await cleanup_db.get(Question, question_id) is not None
            release_reference = await cleanup_db.get(PaperReleaseQuestion, (release_id, 0))
            assert release_reference is not None
            assert release_reference.question_id == question_id
            await cleanup_db.execute(delete(RuntimeMigrationRun).where(RuntimeMigrationRun.id == run_id))
            await cleanup_db.execute(delete(PaperReleaseQuestion).where(PaperReleaseQuestion.release_id == release_id))
            await cleanup_db.execute(delete(PaperRelease).where(PaperRelease.id == release_id))
            await cleanup_db.execute(delete(Question).where(Question.id == question_id))
            await cleanup_db.execute(delete(ExamPaper).where(ExamPaper.id == paper_id))
            await cleanup_db.execute(delete(QuestionBank).where(QuestionBank.id == bank_id))
            await cleanup_db.execute(delete(User).where(User.username == teacher))
            await cleanup_db.commit()

    asyncio.run(scenario())


def test_migration_reacquires_teaching_lock_after_mapper_rollback(monkeypatch) -> None:
    suffix = uuid4().hex[:10]
    run_id = f"migration-reacquire-{suffix}"
    first_key = PUBLISHED_PAPERS_KEY
    second_key = PAPER_RELEASE_HISTORY_KEY
    lock_calls: list[bool] = []
    original_acquire = teaching_content_revision_service.acquire_lock

    async def recording_acquire(db) -> None:
        lock_calls.append(True)
        await original_acquire(db)

    monkeypatch.setattr(teaching_content_revision_service, "acquire_lock", recording_acquire)

    mapper_attempt = 0

    async def rollback_then_succeed_mapper(db, item):
        nonlocal mapper_attempt
        mapper_attempt += 1
        if mapper_attempt == 1:
            raise ValueError("expected mapper rollback")
        return {"canonical_payload": [{"id": item.id}]}

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            await scan(db, run_id=run_id, sources=[
                {"source_type": "runtime", "source_key": first_key, "owner_scope": "shared", "payload": []},
                {"source_type": "runtime", "source_key": second_key, "owner_scope": "shared", "payload": []},
            ])
            result = await migrate(db, run_id, target_mappers={
                first_key: rollback_then_succeed_mapper,
                second_key: rollback_then_succeed_mapper,
            })
            items = list((await db.scalars(
                select(RuntimeMigrationItem)
                .where(RuntimeMigrationItem.run_id == run_id)
                .order_by(RuntimeMigrationItem.source_key)
            )).all())
            evidence = (result, lock_calls, mapper_attempt, [(item.source_key, item.status) for item in items])
            assert result["migrated"] == 1, evidence
            assert lock_calls == [True, True], evidence
            assert sorted(item.status for item in items) == ["failed", "migrated"]
            await db.execute(delete(RuntimeMigrationRun).where(RuntimeMigrationRun.id == run_id))
            await db.commit()

    asyncio.run(scenario())


def test_scan_without_explicit_sources_reads_runtime_tables() -> None:
    run_id = f"database-scan-{uuid4().hex}"

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            db.add(SharedRuntimeState(key=f"scan-{run_id}", value='{"items":[]}'))
            await db.commit()
            report = await scan(db, run_id=run_id)
            assert report["items"] > 0
            assert report["status"] == "scanned"
            await db.execute(delete(RuntimeMigrationRun).where(RuntimeMigrationRun.id == run_id))
            await db.execute(
                delete(SharedRuntimeState).where(SharedRuntimeState.key == f"scan-{run_id}")
            )
            await db.commit()

    asyncio.run(scenario())
