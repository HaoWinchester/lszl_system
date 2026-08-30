import asyncio
from copy import deepcopy
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from uuid import uuid4

import pytest
from sqlalchemy import delete, select, text

from app.db.session import AsyncSessionLocal
from app.cli import runtime_retirement as runtime_retirement_cli
from app.models.course_management import CourseDraft, CourseRelease, LearningTask
from app.models.engagement import (
    Announcement,
    AnnouncementAudience,
    Feedback,
    FeedbackReceipt,
    FeedbackReply,
    MessageReceipt,
)
from app.models.file import CurrentFile, FileContent, FileTag, Folder, GraphFile, Tag
from app.models.runtime_migration import RuntimeMigrationItem, RuntimeMigrationRun
from app.models.runtime_state import RuntimeState
from app.models.teaching_content import ContentSubject, RecallAssociationLibrary
from app.models.user import User
from app.services import files_runtime_migration_service, runtime_retirement_service as service


def test_canonical_hash_is_stable_and_uses_compact_utf8_json() -> None:
    assert service.canonical_hash({"b": 2, "a": 1}) == (
        "43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777"
    )
    assert service.canonical_hash({"b": 2, "a": 1}) == service.canonical_hash(
        {"a": 1, "b": 2}
    )


def test_public_report_contains_no_business_payload() -> None:
    report = service.sanitize_public_report(
        {
            "run_id": "retirement-test",
            "status": "blocked",
            "source_count": 1,
            "source_hash": "a" * 64,
            "source_payload": {"secret": "never-report-this"},
            "nested": {
                "canonical_payload": ["never-report-this-either"],
                "target_hash": "b" * 64,
                "target_count": 1,
            },
        }
    )

    rendered = json.dumps(report, ensure_ascii=False)
    assert "never-report" not in rendered
    assert report == {
        "run_id": "retirement-test",
        "status": "blocked",
        "source_count": 1,
        "source_hash": "a" * 64,
        "nested": {"target_hash": "b" * 64, "target_count": 1},
    }


def test_drop_gate_requires_zero_blockers_and_both_empty_runtime_policies() -> None:
    with TemporaryDirectory(prefix="runtime-retirement-policy-") as directory:
        root = Path(directory)
        backend_policy = root / "backend-policy.json"
        frontend_policy = root / "frontend-policy.json"
        backend_policy.write_text('{"runtimePages": []}\n', encoding="utf-8")
        frontend_policy.write_text('{"runtimePages": []}\n', encoding="utf-8")
        clean = {
            "unknown": 0,
            "parseErrors": 0,
            "hashMismatches": 0,
            "unresolvedConflicts": 0,
            "sourceCount": 2,
            "verifiedCount": 2,
        }

        assert service.evaluate_drop_gate(
            clean,
            policy_paths=(backend_policy, frontend_policy),
        )["ready"] is True

        blocked = service.evaluate_drop_gate(
            {**clean, "unknown": 1, "hashMismatches": 1},
            policy_paths=(backend_policy, frontend_policy),
        )
        assert blocked["ready"] is False
        assert set(blocked["blockers"]) == {"unknown", "hashMismatch"}

        frontend_policy.write_text(
            '{"runtimePages": ["admin-console.html"]}\n', encoding="utf-8"
        )
        policy_blocked = service.evaluate_drop_gate(
            clean,
            policy_paths=(backend_policy, frontend_policy),
        )
        assert policy_blocked["ready"] is False
        assert policy_blocked["blockers"] == ["runtimePolicies"]


def test_cli_exit_codes_and_external_integrity_blockers() -> None:
    assert runtime_retirement_cli.report_exit_code(
        "scan", {"status": "planned", "unknown": 1}
    ) == 2
    assert runtime_retirement_cli.report_exit_code(
        "scan",
        {
            "status": "planned",
            "unknown": 0,
            "parseErrors": 0,
            "hashMismatches": 0,
            "unresolvedConflicts": 0,
        },
    ) == 0
    assert runtime_retirement_cli.report_exit_code(
        "migrate", {"status": "applied", "pending": 1}
    ) == 2
    assert runtime_retirement_cli.report_exit_code(
        "migrate",
        {
            "status": "applied",
            "pending": 0,
            "unknown": 0,
            "parseErrors": 0,
            "hashMismatches": 0,
            "unresolvedConflicts": 0,
        },
    ) == 0
    assert runtime_retirement_cli.report_exit_code("verify", {"status": "blocked"}) == 2
    assert runtime_retirement_cli.report_exit_code("verify", {"status": "verified"}) == 0
    assert runtime_retirement_cli.report_exit_code("drop-check", {"ready": False}) == 2
    assert runtime_retirement_cli.report_exit_code(
        "drop-check", {"status": "ready", "ready": True}
    ) == 0
    scan_args = runtime_retirement_cli.build_parser().parse_args(
        ["scan", "--report-json", "report.json"]
    )
    assert scan_args.command == "scan"
    assert scan_args.run_id is None
    with pytest.raises(SystemExit):
        runtime_retirement_cli.build_parser().parse_args(
            ["migrate", "--report-json", "report.json"]
        )
    migrate_args = runtime_retirement_cli.build_parser().parse_args(
        ["migrate", "--run-id", "required-run", "--report-json", "report.json"]
    )
    assert migrate_args.run_id == "required-run"
    with TemporaryDirectory(prefix="runtime-retirement-cli-report-") as directory:
        report_path = Path(directory) / "nested" / "report.json"
        runtime_retirement_cli.write_report(
            report_path,
            {"status": "blocked", "source_payload": {"secret": "must-not-leak"}},
        )
        rendered = report_path.read_text(encoding="utf-8")
        assert "must-not-leak" not in rendered
        assert json.loads(rendered) == {"status": "blocked"}


def test_external_proof_identity_includes_source_type() -> None:
    owner = f"proof-source-type-{uuid4().hex[:10]}"
    key = f"kg_question_banks_v1__user__{owner}"
    items = [
        RuntimeMigrationItem(
            run_id="proof-run", source_type=source_type, source_key=key,
            owner_scope=owner, source_hash=source_type * 8, source_payload=[],
        )
        for source_type in ("runtime", "shared_runtime")
    ]

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            question_proofs, _ = await service._external_item_proofs(db, items)
            assert set(question_proofs) == {
                f"runtime\0{key}\0{owner}",
                f"shared_runtime\0{key}\0{owner}",
            }

    asyncio.run(scenario())


def test_external_integrity_blocker_counts_are_exact() -> None:
    summary = service._external_summary(
        {
            "owners": 1,
            "files": 1,
            "warnings": 0,
            "failures": 0,
            "verified": True,
            "verificationHash": "f" * 64,
        },
        {
            "snapshotHash": "q" * 64,
            "conflicts": [],
            "invalidRecords": [],
            "nullContentHashes": 2,
            "verified": False,
        },
        {
            "snapshotHash": "p" * 64,
            "conflicts": [],
            "invalidRecords": [],
            "missingQuestionCount": 1,
            "questionsWithMissingRefs": 1,
            "missingCategoryCount": 1,
            "referenceGaps": 1,
            "scoreGaps": 1,
            "verified": False,
        },
    )
    assert summary["hashMismatches"] == 2
    assert summary["unresolvedConflicts"] == 5


def test_cli_main_exits_two_for_a_blocked_scan_and_writes_safe_report() -> None:
    async def blocked_scan(_command: str, _run_id: str | None) -> dict:
        return {
            "status": "planned",
            "unknown": 1,
            "parseErrors": 0,
            "hashMismatches": 0,
            "unresolvedConflicts": 0,
            "source_payload": {"secret": "must-not-leak"},
        }

    with TemporaryDirectory(prefix="runtime-retirement-main-") as directory:
        report_path = Path(directory) / "scan.json"
        with patch.object(runtime_retirement_cli, "_run", blocked_scan), patch(
            "sys.argv",
            [
                "runtime-retirement",
                "scan",
                "--report-json",
                str(report_path),
            ],
        ):
            with pytest.raises(SystemExit) as raised:
                runtime_retirement_cli.main()
        assert raised.value.code == 2
        rendered = report_path.read_text(encoding="utf-8")
        assert "must-not-leak" not in rendered
        assert json.loads(rendered)["unknown"] == 1


def test_drop_check_requires_existing_run_and_never_mutates_ledger() -> None:
    suffix = uuid4().hex[:10]
    missing_run_id = f"runtime-retirement-missing-{suffix}"
    run_id = f"runtime-retirement-read-only-{suffix}"
    sources = [
        {
            "source_type": "runtime",
            "source_key": "kg_default_entry_mode_v1",
            "owner_id": f"owner-{suffix}",
            "payload": "graph",
            "required": True,
        }
    ]

    async def controlled_sources(_db):
        return list(sources)

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            with TemporaryDirectory(prefix="runtime-retirement-read-only-") as directory:
                policy_paths = (Path(directory) / "backend.json", Path(directory) / "frontend.json")
                for path in policy_paths:
                    path.write_text('{"runtimePages": []}\n', encoding="utf-8")
                with patch.object(
                    service.domain_migration, "_runtime_sources", controlled_sources
                ):
                    missing = await service.drop_check(
                        db, run_id=missing_run_id, policy_paths=policy_paths
                    )
                    assert missing["ready"] is False
                    assert "missingRun" in missing["blockers"]
                    assert await db.get(RuntimeMigrationRun, missing_run_id) is None

                    await service.migrate(db, run_id=run_id, sources=sources)
                    await service.verify(db, run_id=run_id)
                    run = await db.get(RuntimeMigrationRun, run_id)
                    item = await db.scalar(
                        select(RuntimeMigrationItem).where(
                            RuntimeMigrationItem.run_id == run_id
                        )
                    )
                    before = {
                        "run": (
                            run.status,
                            deepcopy(run.report),
                            run.source_snapshot_hash,
                            run.updated_at,
                        ),
                        "item": (
                            item.status,
                            item.expected_hash,
                            item.target_hash,
                            deepcopy(item.verification_metadata),
                            item.error,
                            item.updated_at,
                        ),
                    }
                    ready = await service.drop_check(
                        db, run_id=run_id, policy_paths=policy_paths
                    )
                    assert ready["ready"] is False
                    assert "inventoryScope" in ready["blockers"]
                    db.expire_all()
                    run = await db.get(RuntimeMigrationRun, run_id)
                    item = await db.scalar(
                        select(RuntimeMigrationItem).where(
                            RuntimeMigrationItem.run_id == run_id
                        )
                    )
                    after = {
                        "run": (
                            run.status,
                            deepcopy(run.report),
                            run.source_snapshot_hash,
                            run.updated_at,
                        ),
                        "item": (
                            item.status,
                            item.expected_hash,
                            item.target_hash,
                            deepcopy(item.verification_metadata),
                            item.error,
                            item.updated_at,
                        ),
                    }
                    assert after == before
            await db.execute(
                delete(RuntimeMigrationRun).where(
                    RuntimeMigrationRun.id.in_([missing_run_id, run_id])
                )
            )
            await db.commit()

    asyncio.run(scenario())


def test_drop_check_blocks_a_new_runtime_identity_after_verification() -> None:
    suffix = uuid4().hex[:10]
    run_id = f"runtime-retirement-inventory-drift-{suffix}"
    sources = [
        {
            "source_type": "runtime",
            "source_key": "kg_default_entry_mode_v1",
            "owner_id": f"owner-{suffix}",
            "payload": "graph",
            "required": True,
        }
    ]
    live_sources = list(sources)

    async def controlled_sources(_db):
        return list(live_sources)

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            try:
                with patch.object(
                    service.domain_migration, "_runtime_sources", controlled_sources
                ):
                    await service.migrate(db, run_id=run_id, sources=sources)
                    run = await db.get(RuntimeMigrationRun, run_id)
                    run.report = {**(run.report or {}), "source_inventory_scope": "live"}
                    await db.commit()
                    verified = await service.verify(db, run_id=run_id)
                    assert verified["status"] == "verified"
                    live_sources.append(
                        {
                            "source_type": "runtime",
                            "source_key": f"kg_unclassified_after_verify_{suffix}",
                            "owner_id": f"new-owner-{suffix}",
                            "payload": {"must": "remain-private"},
                            "required": True,
                        }
                    )
                    with TemporaryDirectory(prefix="runtime-retirement-drift-") as directory:
                        policy_paths = (
                            Path(directory) / "backend.json",
                            Path(directory) / "frontend.json",
                        )
                        for path in policy_paths:
                            path.write_text('{"runtimePages": []}\n', encoding="utf-8")
                        blocked = await service.drop_check(
                            db, run_id=run_id, policy_paths=policy_paths
                        )
                    assert blocked["ready"] is False
                    assert blocked["inventoryDrift"] == 1
                    assert blocked["unknown"] >= 1
                    assert runtime_retirement_cli.report_exit_code(
                        "drop-check", blocked
                    ) == 2
                    assert "must" not in json.dumps(blocked)
            finally:
                await db.execute(
                    delete(RuntimeMigrationRun).where(RuntimeMigrationRun.id == run_id)
                )
                await db.commit()

    asyncio.run(scenario())


def test_drop_check_rejects_a_provided_source_inventory_even_when_verified() -> None:
    suffix = uuid4().hex[:10]
    run_id = f"runtime-retirement-provided-scope-{suffix}"
    sources = [{
        "source_type": "runtime",
        "source_key": "kg_default_entry_mode_v1",
        "owner_id": f"owner-{suffix}",
        "payload": "graph",
        "required": True,
    }]

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            try:
                await service.migrate(db, run_id=run_id, sources=sources)
                verified = await service.verify(db, run_id=run_id)
                assert verified["status"] == "verified"
                with TemporaryDirectory(prefix="runtime-retirement-provided-") as directory:
                    policy_paths = (Path(directory) / "backend.json", Path(directory) / "frontend.json")
                    for path in policy_paths:
                        path.write_text('{"runtimePages": []}\n', encoding="utf-8")
                    blocked = await service.drop_check(db, run_id=run_id, policy_paths=policy_paths)
                assert blocked["ready"] is False
                assert blocked["inventoryScopeInvalid"] == 1
                assert "inventoryScope" in blocked["blockers"]
                assert runtime_retirement_cli.report_exit_code("drop-check", blocked) == 2
            finally:
                await db.execute(delete(RuntimeMigrationRun).where(RuntimeMigrationRun.id == run_id))
                await db.commit()

    asyncio.run(scenario())


def test_composed_migrate_surfaces_required_mapper_failures_and_cli_blocks() -> None:
    run_id = f"runtime-retirement-mapper-failure-{uuid4().hex[:10]}"
    source_key = "kg_runtime_retirement_broken_mapper_v1"

    async def broken_mapper(_db, _item):
        raise ValueError("mapper rejected canonical source")

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            try:
                with patch.dict(
                    service.domain_migration.TARGET_MAPPER_REGISTRY,
                    {source_key: broken_mapper},
                ):
                    report = await service.migrate(db, run_id=run_id, sources=[{
                        "source_type": "runtime", "source_key": source_key,
                        "owner_id": "teacher-a", "payload": {"id": "broken"},
                        "required": True,
                    }])
                assert report["status"] == "verification_failed"
                assert report["requiredFailures"] == 1
                assert runtime_retirement_cli.report_exit_code("migrate", report) == 2
            finally:
                await db.execute(delete(RuntimeMigrationRun).where(RuntimeMigrationRun.id == run_id))
                await db.commit()

    asyncio.run(scenario())


def test_shared_file_runtime_identity_is_never_aggregate_verified() -> None:
    run_id = f"runtime-retirement-shared-files-{uuid4().hex[:10]}"
    sources = [
        {
            "source_type": "shared_runtime",
            "source_key": files_runtime_migration_service.INDEX_KEY,
            "owner_scope": "shared",
            "payload": [],
            "required": True,
        }
    ]

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            try:
                report = await service.migrate(db, run_id=run_id, sources=sources)
                item = await db.scalar(
                    select(RuntimeMigrationItem).where(
                        RuntimeMigrationItem.run_id == run_id
                    )
                )
                assert item is not None
                assert item.status == "failed"
                assert item.target_hash is None
                assert report["verifiedCount"] == 0
                assert report["unresolvedConflicts"] >= 1
            finally:
                await db.execute(
                    delete(RuntimeMigrationRun).where(RuntimeMigrationRun.id == run_id)
                )
                await db.commit()

    asyncio.run(scenario())


def test_owner_named_shared_file_source_type_cannot_borrow_runtime_proof() -> None:
    suffix = uuid4().hex[:10]
    run_id = f"runtime-retirement-shared-file-owner-{suffix}"
    owner = f"shared-file-owner-{suffix}"
    key = files_runtime_migration_service.INDEX_KEY

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            db.add(User(username=owner, password_hash="test-only", role="teacher", status="active"))
            await db.flush()
            db.add(RuntimeState(owner_id=owner, revision=1, storage={key: []}))
            await db.commit()
            try:
                report = await service.migrate(db, run_id=run_id, sources=[{
                    "source_type": "shared_runtime", "source_key": key,
                    "owner_id": owner, "payload": [], "required": True,
                }])
                item = await db.scalar(select(RuntimeMigrationItem).where(RuntimeMigrationItem.run_id == run_id))
                assert item.status == "failed"
                assert item.target_hash is None
                assert report["requiredFailures"] == 1
                assert report["unresolvedConflicts"] >= 1
            finally:
                await db.execute(delete(RuntimeMigrationRun).where(RuntimeMigrationRun.id == run_id))
                await db.execute(delete(RuntimeState).where(RuntimeState.owner_id == owner))
                await db.execute(delete(User).where(User.username == owner))
                await db.commit()

    asyncio.run(scenario())


def test_composed_domain_mappers_never_overwrite_existing_relational_aggregates() -> None:
    suffix = uuid4().hex[:10]
    run_id = f"runtime-retirement-domain-wins-{suffix}"
    owner = f"runtime-retirement-domain-owner-{suffix}"
    announcement_id = f"announcement-domain-{suffix}"
    feedback_id = f"feedback-domain-{suffix}"
    reply_id = f"reply-domain-{suffix}"
    subject_id = f"subject-domain-{suffix}"
    recall_id = f"recall-domain-{suffix}"
    recall_key = f"kg_recall_association_library_v1__subject__{subject_id}"
    sources = [
        {
            "source_type": "runtime",
            "source_key": "kg_announcements_v1",
            "owner_id": owner,
            "payload": [
                {
                    "id": announcement_id,
                    "title": "runtime title",
                    "body": "runtime body",
                    "createdBy": owner,
                    "audience": {"type": "all"},
                }
            ],
        },
        {
            "source_type": "runtime",
            "source_key": "kg_user_feedback_v1",
            "owner_id": owner,
            "payload": [
                {
                    "id": feedback_id,
                    "title": "runtime feedback",
                    "detail": "runtime detail",
                    "submittedBy": {"username": owner},
                    "replies": [],
                }
            ],
        },
        {
            "source_type": "shared_runtime",
            "source_key": recall_key,
            "owner_scope": "shared",
            "payload": {"nodes": [{"id": "runtime-node"}], "edges": []},
        },
        {
            "source_type": "runtime",
            "source_key": f"kg_user_message_reads_v1__{owner}",
            "owner_id": owner,
            "payload": {announcement_id: 999},
        },
        {
            "source_type": "runtime",
            "source_key": f"kg_user_feedback_reply_reads_v1__{owner}",
            "owner_id": owner,
            "payload": {feedback_id: 999},
        },
    ]

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            db.add(User(username=owner, password_hash="test-only", role="admin", status="active"))
            await db.flush()
            db.add(
                Announcement(
                    id=announcement_id,
                    title="domain title",
                    body="domain body",
                    link="",
                    status="published",
                    publish_at=0,
                    expires_at=0,
                    published_at=1,
                    withdrawn_at=0,
                    created_by=owner,
                    created_at=1,
                    updated_at=2,
                )
            )
            db.add(
                Feedback(
                    id=feedback_id,
                    type="suggestion",
                    title="domain feedback",
                    detail="domain detail",
                    page="",
                    app_version="",
                    contact="",
                    attachment=None,
                    status="pending",
                    submitted_by=owner,
                    created_at=1,
                    updated_at=2,
                )
            )
            db.add(ContentSubject(id=subject_id, code=subject_id, name="Domain", content_metadata={}))
            await db.flush()
            db.add_all(
                [
                    AnnouncementAudience(
                        id=f"aud-domain-{suffix}",
                        announcement_id=announcement_id,
                        audience_type="roles",
                        audience_value="teacher",
                    ),
                    FeedbackReply(
                        id=reply_id,
                        feedback_id=feedback_id,
                        message="domain reply",
                        actor="admin",
                        actor_username=owner,
                        created_at=3,
                    ),
                    RecallAssociationLibrary(
                        id=recall_id,
                        subject_id=subject_id,
                        version=1,
                        nodes=[{"id": "domain-node"}],
                        edges=[],
                        content_metadata={"nodes": [{"id": "domain-node"}], "edges": []},
                        updated_by=owner,
                    ),
                    MessageReceipt(
                        id=f"message-receipt-domain-{suffix}",
                        announcement_id=announcement_id,
                        username=owner,
                        read_at=11,
                    ),
                    FeedbackReceipt(
                        id=f"feedback-receipt-domain-{suffix}",
                        feedback_id=feedback_id,
                        username=owner,
                        read_at=22,
                    ),
                ]
            )
            await db.commit()
            try:
                report = await service.migrate(db, run_id=run_id, sources=sources)
                announcement = await db.get(Announcement, announcement_id)
                audiences = list(
                    (
                        await db.scalars(
                            select(AnnouncementAudience).where(
                                AnnouncementAudience.announcement_id == announcement_id
                            )
                        )
                    ).all()
                )
                feedback = await db.get(Feedback, feedback_id)
                replies = list(
                    (
                        await db.scalars(
                            select(FeedbackReply).where(
                                FeedbackReply.feedback_id == feedback_id
                            )
                        )
                    ).all()
                )
                recall = await db.get(RecallAssociationLibrary, recall_id)
                message_receipt = await db.scalar(
                    select(MessageReceipt).where(
                        MessageReceipt.announcement_id == announcement_id,
                        MessageReceipt.username == owner,
                    )
                )
                feedback_receipt = await db.scalar(
                    select(FeedbackReceipt).where(
                        FeedbackReceipt.feedback_id == feedback_id,
                        FeedbackReceipt.username == owner,
                    )
                )
                assert (announcement.title, announcement.body) == (
                    "domain title",
                    "domain body",
                )
                assert [(row.audience_type, row.audience_value) for row in audiences] == [
                    ("roles", "teacher")
                ]
                assert (feedback.title, feedback.detail) == (
                    "domain feedback",
                    "domain detail",
                )
                assert [(row.id, row.message) for row in replies] == [
                    (reply_id, "domain reply")
                ]
                assert recall.nodes == [{"id": "domain-node"}]
                assert message_receipt.read_at == 11
                assert feedback_receipt.read_at == 22
                assert report["unresolvedConflicts"] == 5
            finally:
                await db.execute(delete(RuntimeMigrationRun).where(RuntimeMigrationRun.id == run_id))
                await db.execute(delete(RecallAssociationLibrary).where(RecallAssociationLibrary.id == recall_id))
                await db.execute(delete(ContentSubject).where(ContentSubject.id == subject_id))
                await db.execute(delete(MessageReceipt).where(MessageReceipt.announcement_id == announcement_id))
                await db.execute(delete(FeedbackReceipt).where(FeedbackReceipt.feedback_id == feedback_id))
                await db.execute(delete(FeedbackReply).where(FeedbackReply.id == reply_id))
                await db.execute(delete(Feedback).where(Feedback.id == feedback_id))
                await db.execute(delete(AnnouncementAudience).where(AnnouncementAudience.announcement_id == announcement_id))
                await db.execute(delete(Announcement).where(Announcement.id == announcement_id))
                await db.execute(delete(User).where(User.username == owner))
                await db.commit()

    asyncio.run(scenario())


def test_course_domain_wins_and_runtime_only_fills_missing_idempotently() -> None:
    suffix = uuid4().hex[:10]
    run_id = f"runtime-retirement-course-{suffix}"
    owner = f"runtime-retirement-owner-{suffix}"
    existing_id = f"course-existing-{suffix}"
    missing_id = f"course-missing-{suffix}"
    sources = [
        {
            "source_type": "runtime",
            "source_key": "kg_course_config_drafts_v1",
            "owner_id": owner,
            "payload": json.dumps(
                [
                    {
                        "id": existing_id,
                        "name": "runtime must not overwrite",
                        "structure": {"source": "runtime"},
                        "revision": 7,
                    },
                    {
                        "id": missing_id,
                        "name": "runtime fills missing",
                        "structure": {"source": "runtime-only"},
                        "revision": 3,
                    },
                ],
                ensure_ascii=False,
            ),
            "required": True,
        }
    ]

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            db.add(
                User(
                    username=owner,
                    password_hash="test-only",
                    role="teacher",
                    status="active",
                )
            )
            await db.flush()
            db.add(
                CourseDraft(
                    id=existing_id,
                    owner_id=owner,
                    name="domain authority",
                    structure={"source": "domain"},
                    revision=11,
                    status="draft",
                    created_by=owner,
                    updated_by=owner,
                )
            )
            await db.commit()
            try:
                first = await service.migrate(db, run_id=run_id, sources=sources)
                existing = await db.get(CourseDraft, existing_id)
                missing = await db.get(CourseDraft, missing_id)

                assert existing is not None
                assert existing.name == "domain authority"
                assert existing.structure == {"source": "domain"}
                assert existing.revision == 11
                assert missing is not None
                assert missing.name == "runtime fills missing"
                assert missing.structure == {"source": "runtime-only"}
                assert missing.revision == 3
                assert first["unresolvedConflicts"] == 1
                assert first["parseErrors"] == 0
                assert first["hashMismatches"] == 0
                assert first["items"][0]["sourceKey"] == "kg_course_config_drafts_v1"
                assert "payload" not in json.dumps(first["items"])

                second = await service.migrate(db, run_id=run_id, sources=sources)
                assert second["created"] == 0
                assert second["unresolvedConflicts"] == 1
            finally:
                await db.execute(
                    delete(RuntimeMigrationRun).where(RuntimeMigrationRun.id == run_id)
                )
                await db.execute(
                    delete(CourseDraft).where(
                        CourseDraft.id.in_([existing_id, missing_id])
                    )
                )
                await db.execute(delete(User).where(User.username == owner))
                await db.commit()

    asyncio.run(scenario())


def test_course_sources_run_in_dependency_order_and_verify_from_domain() -> None:
    suffix = uuid4().hex[:10]
    run_id = f"runtime-retirement-course-all-{suffix}"
    owner = f"runtime-retirement-all-owner-{suffix}"
    draft_id = f"course-all-{suffix}"
    release_id = f"release-all-{suffix}"
    task_id = f"task-all-{suffix}"
    published_at = "2026-08-30T01:02:03+00:00"
    sources = [
        {
            "source_type": "shared_runtime",
            "source_key": "kg_course_config_active_release_v1",
            "owner_scope": "shared",
            "payload": {"releaseId": release_id},
        },
        {
            "source_type": "runtime",
            "source_key": "kg_learning_tasks_v1",
            "owner_id": owner,
            "payload": [
                {
                    "id": task_id,
                    "releaseId": release_id,
                    "title": "Task from Runtime",
                    "config": {"mode": "practice"},
                }
            ],
        },
        {
            "source_type": "runtime",
            "source_key": "kg_course_config_releases_v1",
            "owner_id": owner,
            "payload": [
                {
                    "id": release_id,
                    "courseId": draft_id,
                    "version": 1,
                    "status": "published",
                    "course": {"id": draft_id, "nodes": []},
                    "publishedAt": published_at,
                }
            ],
        },
        {
            "source_type": "runtime",
            "source_key": "kg_course_config_drafts_v1",
            "owner_id": owner,
            "payload": [
                {
                    "id": draft_id,
                    "name": "Top-level legacy course",
                    "subjectId": "subject-pmp",
                    "stages": [],
                    "parts": [],
                    "nodes": [],
                }
            ],
        },
    ]

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            db.add(User(username=owner, password_hash="test-only", role="teacher", status="active"))
            await db.commit()
            try:
                migrated = await service.migrate(db, run_id=run_id, sources=sources)
                assert migrated["created"] == 3
                assert migrated["unresolvedConflicts"] == 0
                assert (await db.get(CourseDraft, draft_id)).structure == {
                    "subjectId": "subject-pmp",
                    "stages": [],
                    "parts": [],
                    "nodes": [],
                }
                assert (await db.get(CourseRelease, release_id)) is not None
                assert (await db.get(LearningTask, task_id)).release_id == release_id

                observed_isolation: list[str] = []
                original_verify = service.domain_migration.verify

                async def observe_isolation(session, *args, **kwargs):
                    observed_isolation.append(
                        str(await session.scalar(text("SHOW TRANSACTION ISOLATION LEVEL")))
                    )
                    return await original_verify(session, *args, **kwargs)

                with patch.object(service.domain_migration, "verify", observe_isolation):
                    verified = await service.verify(db, run_id=run_id)
                assert verified["status"] == "verified"
                assert verified["verifiedCount"] == 4
                assert observed_isolation == ["repeatable read"]
                run = await db.get(RuntimeMigrationRun, run_id)
                assert "source_snapshot_payload" in (run.report or {})
                assert "source_snapshot_payload" not in migrated

                with TemporaryDirectory(prefix="runtime-retirement-course-policy-") as directory:
                    policy_paths = (
                        Path(directory) / "backend-policy.json",
                        Path(directory) / "frontend-policy.json",
                    )
                    for path in policy_paths:
                        path.write_text('{"runtimePages": []}\n', encoding="utf-8")
                    ready = await service.drop_check(
                        db, run_id=run_id, policy_paths=policy_paths
                    )
                    assert ready["ready"] is False
                    assert ready["status"] == "blocked"
                    assert "inventoryScope" in ready["blockers"]

                    draft = await db.get(CourseDraft, draft_id)
                    draft.structure = {**draft.structure, "domainChanged": True}
                    await db.commit()
                    blocked = await service.drop_check(
                        db, run_id=run_id, policy_paths=policy_paths
                    )
                    assert blocked["ready"] is False
                    assert set(blocked["blockers"]) >= {
                        "hashMismatch",
                        "unresolvedConflict",
                    }
            finally:
                await db.execute(delete(LearningTask).where(LearningTask.id == task_id))
                await db.execute(delete(CourseRelease).where(CourseRelease.id == release_id))
                await db.execute(delete(CourseDraft).where(CourseDraft.id == draft_id))
                await db.execute(delete(RuntimeMigrationRun).where(RuntimeMigrationRun.id == run_id))
                await db.execute(delete(User).where(User.username == owner))
                await db.commit()

    asyncio.run(scenario())


def test_shared_course_without_real_owner_is_a_parse_blocker() -> None:
    run_id = f"runtime-retirement-owner-block-{uuid4().hex[:10]}"
    draft_id = f"ownerless-{uuid4().hex[:10]}"

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            try:
                report = await service.scan(
                    db,
                    run_id=run_id,
                    sources=[
                        {
                            "source_type": "shared_runtime",
                            "source_key": "kg_course_config_drafts_v1",
                            "owner_scope": "shared",
                            "payload": [{"id": draft_id, "name": "ownerless", "nodes": []}],
                        }
                    ],
                )
                assert report["parseErrors"] == 1
                assert await db.get(CourseDraft, draft_id) is None
                assert await db.get(RuntimeMigrationRun, run_id) is None
            finally:
                await db.execute(delete(RuntimeMigrationRun).where(RuntimeMigrationRun.id == run_id))
                await db.commit()

    asyncio.run(scenario())


def test_files_proof_detects_relational_tampering_in_drop_check() -> None:
    suffix = uuid4().hex[:10]
    run_id = f"runtime-retirement-files-{suffix}"
    owner = f"runtime-retirement-files-owner-{suffix}"
    source_file_id = f"runtime-file-{suffix}"
    folder_id = f"runtime-folder-{suffix}"
    tag_id = f"runtime-tag-{suffix}"
    content_key = f"{files_runtime_migration_service.CONTENT_PREFIX}{owner}__{source_file_id}"
    storage = {
        files_runtime_migration_service.INDEX_KEY: [
            {
                "id": source_file_id,
                "owner": owner,
                "name": "Proof graph",
                "folderId": folder_id,
                "tags": ["proof"],
                "order": 1000,
                "revision": 1,
            }
        ],
        files_runtime_migration_service.FOLDERS_KEY: [
            {"id": folder_id, "owner": owner, "name": "Proof folder", "order": 1000}
        ],
        files_runtime_migration_service.TAGS_KEY: {
            owner: [{"id": tag_id, "name": "proof", "color": "#64748b"}]
        },
        files_runtime_migration_service.CURRENT_KEY: {owner: source_file_id},
        content_key: {
            "revision": 1,
            "graphData": {"meta": {"title": "Proof graph"}, "nodes": [], "links": []},
            "learningState": {},
        },
    }
    sources = [
        {
            "source_type": "runtime",
            "source_key": key,
            "owner_id": owner,
            "payload": value,
        }
        for key, value in storage.items()
    ]

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            db.add(User(username=owner, password_hash="test-only", role="teacher", status="active"))
            await db.flush()
            db.add(RuntimeState(owner_id=owner, storage=storage, revision=1))
            await db.commit()
            try:
                await files_runtime_migration_service.migrate_owner_graph_files(db, owner)
                migrated = await service.migrate(db, run_id=run_id, sources=sources)
                assert migrated["hashMismatches"] == 0
                assert migrated["domains"]["files"]["verificationHash"]
                assert migrated["domains"]["files"]["sourceHash"] == migrated["domains"]["files"]["targetHash"]
                proof_items = {item["sourceKey"]: item for item in migrated["items"]}
                assert proof_items[files_runtime_migration_service.INDEX_KEY]["expectedHash"] != proof_items[content_key]["expectedHash"]
                assert all(
                    item["expectedCount"] == item["targetCount"]
                    and item["expectedHash"] == item["targetHash"]
                    for item in proof_items.values()
                )
                verified = await service.verify(db, run_id=run_id)
                assert verified["status"] == "verified"

                with TemporaryDirectory(prefix="runtime-retirement-files-policy-") as directory:
                    policy_paths = (
                        Path(directory) / "backend-policy.json",
                        Path(directory) / "frontend-policy.json",
                    )
                    for path in policy_paths:
                        path.write_text('{"runtimePages": []}\n', encoding="utf-8")
                    initial_drop = await service.drop_check(
                        db, run_id=run_id, policy_paths=policy_paths
                    )
                    assert initial_drop["ready"] is False, json.dumps(initial_drop)
                    assert "inventoryScope" in initial_drop["blockers"]

                    graph_file = await db.scalar(
                        select(GraphFile).where(
                            GraphFile.owner_id == owner,
                            GraphFile.source_file_id == source_file_id,
                        )
                    )
                    content = await db.get(FileContent, graph_file.id)
                    content.graph_data = {
                        "meta": {"title": "tampered"},
                        "nodes": [{"id": "unexpected"}],
                        "links": [],
                    }
                    await db.commit()
                    blocked = await service.drop_check(
                        db, run_id=run_id, policy_paths=policy_paths
                    )
                    assert blocked["ready"] is False
                    assert "hashMismatch" in blocked["blockers"]
            finally:
                await db.execute(delete(RuntimeMigrationRun).where(RuntimeMigrationRun.id == run_id))
                await db.execute(delete(RuntimeState).where(RuntimeState.owner_id == owner))
                await db.execute(delete(CurrentFile).where(CurrentFile.owner_id == owner))
                await db.execute(
                    delete(FileTag).where(
                        FileTag.file_id.in_(
                            select(GraphFile.id).where(GraphFile.owner_id == owner)
                        )
                    )
                )
                await db.execute(
                    delete(FileContent).where(
                        FileContent.file_id.in_(
                            select(GraphFile.id).where(GraphFile.owner_id == owner)
                        )
                    )
                )
                await db.execute(delete(GraphFile).where(GraphFile.owner_id == owner))
                await db.execute(delete(Folder).where(Folder.owner_id == owner))
                await db.execute(delete(Tag).where(Tag.owner_id == owner))
                await db.execute(delete(User).where(User.username == owner))
                await db.commit()

    asyncio.run(scenario())
