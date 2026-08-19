import asyncio
import inspect
from uuid import uuid4

import pytest
from sqlalchemy import delete, func, select

from app.cli.runtime_domain_migration import report_exit_code
from app.db.session import AsyncSessionLocal
from app.models.paper_release import PaperRelease, PaperReleaseQuestion
from app.models.question import ExamPaper, Question, QuestionBank
from app.models.runtime_migration import RuntimeMigrationItem, RuntimeMigrationRun
from app.models.shared_runtime_state import SharedRuntimeState
from app.services.runtime_domain_migration_service import (
    can_drop_runtime,
    canonical_json_hash,
    drop_check,
    migrate,
    scan,
    verify,
)


def test_canonical_json_hash_ignores_object_key_order() -> None:
    assert canonical_json_hash({"b": 2, "a": [1, {"d": 4, "c": 3}]}) == canonical_json_hash(
        {"a": [1, {"c": 3, "d": 4}], "b": 2}
    )


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
            rows = (await db.scalars(select(PaperReleaseQuestion).where(
                PaperReleaseQuestion.release_id.in_([current_id, history_id])
            ))).all()
            assert len(rows) == 2
            assert all(row.snapshot["title"] == "冻结题目" for row in rows)
            verified = await verify(db, run_id)
            assert verified["status"] == "verified"
            assert await can_drop_runtime(db, run_id) is True

            rows[0].snapshot = {**rows[0].snapshot, "title": "被污染"}
            await db.commit()
            polluted = await verify(db, run_id)
            assert polluted["status"] == "verification_failed"
            assert await can_drop_runtime(db, run_id) is False

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
