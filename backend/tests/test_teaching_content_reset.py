"""Atomic reset coverage for current shared teaching content."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
import subprocess
import sys
from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import delete, func, insert, select

from app.db.session import AsyncSessionLocal
from app.models.content_prep import (
    Principle,
    QuestionAuditLog,
    QuestionBankCollaborator,
    QuestionEditLock,
    QuestionUploadBatch,
    SynthesisPreset,
)
from app.models.question import ExamPaper, PaperQuestion, Question, QuestionBank
from app.models.shared_runtime_state import SharedRuntimeState
from app.models.training import LearningEvent, RecallProgress, TrainingProgress
from app.services import teaching_content_revision_service
from app.services.teaching_content_projection_service import PRINCIPLE_KEY, PRESET_KEY
from app.services import teaching_content_reset_service
from app.services.teaching_content_reset_service import (
    ResetSnapshotMismatch,
    preview_reset,
    reset_current_content,
)


MUTABLE_RUNTIME_KEY = "kg_course_config_drafts_v1"
IMMUTABLE_RUNTIME_KEY = "kg_exam_papers_published_v1"

RESET_STATE_MODELS = (
    QuestionBank,
    Question,
    ExamPaper,
    Principle,
    SynthesisPreset,
    QuestionBankCollaborator,
    QuestionUploadBatch,
    QuestionEditLock,
    TrainingProgress,
    RecallProgress,
    LearningEvent,
    PaperQuestion,
    QuestionAuditLog,
    SharedRuntimeState,
)

RESET_DELETE_ORDER = (
    PaperQuestion,
    LearningEvent,
    TrainingProgress,
    RecallProgress,
    QuestionEditLock,
    QuestionUploadBatch,
    QuestionBankCollaborator,
    QuestionAuditLog,
    Question,
    QuestionBank,
    SynthesisPreset,
    Principle,
    ExamPaper,
    SharedRuntimeState,
)


async def _snapshot_reset_state() -> dict[type, list[dict[str, object]]]:
    async with AsyncSessionLocal() as db:
        return {
            model: [
                dict(row)
                for row in (
                    await db.execute(select(model.__table__))
                ).mappings().all()
            ]
            for model in RESET_STATE_MODELS
        }


async def _restore_reset_state(
    snapshot: dict[type, list[dict[str, object]]],
) -> None:
    async with AsyncSessionLocal() as db:
        for model in RESET_DELETE_ORDER:
            await db.execute(delete(model))
        await db.flush()
        for model in RESET_STATE_MODELS:
            rows = snapshot[model]
            if rows:
                await db.execute(insert(model.__table__), rows)
        await db.commit()


async def _count(db, model) -> int:
    return int((await db.execute(select(func.count()).select_from(model))).scalar() or 0)


async def _seed_reset_fixture() -> dict[str, object]:
    suffix = uuid4().hex[:10]
    bank_ids = [f"reset-bank-a-{suffix}", f"reset-bank-b-{suffix}"]
    question_ids = [
        f"reset-question-a-{suffix}",
        f"reset-question-b-{suffix}",
        f"reset-question-c-{suffix}",
    ]
    principle_id = f"reset-principle-{suffix}"
    preset_id = f"reset-preset-{suffix}"
    paper_id = f"reset-paper-{suffix}"
    audit_id = f"reset-audit-{suffix}"
    immutable_value = json.dumps(
        [
            {
                "releaseId": f"reset-release-{suffix}",
                "paperId": f"reset-published-paper-{suffix}",
                "questions": [
                    {
                        "bankId": bank_ids[0],
                        "questionId": question_ids[0],
                        "snapshot": {"title": "冻结题目，不得修改"},
                    }
                ],
            }
        ],
        ensure_ascii=False,
        indent=2,
    )
    mutable_value = json.dumps(
        [
            {
                "id": f"reset-course-{suffix}",
                "nodes": [
                    {
                        "id": f"reset-node-{suffix}",
                        "questionIds": [question_ids[0], question_ids[2]],
                    }
                ],
            }
        ],
        ensure_ascii=False,
        separators=(",", ":"),
    )
    now = datetime.now(timezone.utc)

    async with AsyncSessionLocal() as db:
        runtime_keys = {
            MUTABLE_RUNTIME_KEY,
            IMMUTABLE_RUNTIME_KEY,
            PRINCIPLE_KEY,
            PRESET_KEY,
        }
        for key in runtime_keys:
            row = await db.get(SharedRuntimeState, key)
            if row is not None:
                await db.delete(row)
        await db.flush()

        db.add_all(
            [
                QuestionBank(
                    id=bank_ids[0],
                    owner_id="admin",
                    name="重置题库 A",
                    subject="PMP",
                    created_by="admin",
                    updated_by="admin",
                ),
                QuestionBank(
                    id=bank_ids[1],
                    owner_id="老师",
                    name="重置题库 B",
                    subject="PMP",
                    created_by="老师",
                    updated_by="老师",
                ),
            ]
        )
        await db.flush()
        db.add(
            QuestionBankCollaborator(
                id=f"reset-collaborator-{suffix}",
                bank_id=bank_ids[0],
                username="老师",
                permission="edit",
                granted_by="admin",
            )
        )
        db.add_all(
            [
                Question(
                    id=question_ids[0],
                    bank_id=bank_ids[0],
                    title="重置题目 A",
                    domain="范围",
                    content_metadata={"principleIds": [principle_id]},
                    created_by="admin",
                    updated_by="admin",
                ),
                Question(
                    id=question_ids[1],
                    bank_id=bank_ids[0],
                    title="重置题目 B",
                    domain="进度",
                    content_metadata={"stemPrincipleIds": [principle_id]},
                    created_by="admin",
                    updated_by="admin",
                ),
                Question(
                    id=question_ids[2],
                    bank_id=bank_ids[1],
                    title="重置题目 C",
                    domain="成本",
                    content_metadata={"optionPrincipleMap": {"A": [principle_id]}},
                    created_by="老师",
                    updated_by="老师",
                ),
            ]
        )
        await db.flush()
        db.add_all(
            [
                QuestionUploadBatch(
                    id=f"reset-batch-{suffix}",
                    idempotency_key=f"reset-batch-key-{suffix}",
                    bank_id=bank_ids[0],
                    actor_username="admin",
                    actor_role="admin",
                    client_instance_id=f"reset-client-{suffix}",
                    manifest_hash="a" * 64,
                    status="committed",
                ),
                QuestionEditLock(
                    question_id=question_ids[0],
                    locked_by="admin",
                    client_instance_id=f"reset-lock-{suffix}",
                    token_hash="b" * 64,
                    acquired_at=now,
                    heartbeat_at=now,
                    expires_at=now,
                ),
                TrainingProgress(
                    id=f"reset-training-{suffix}",
                    owner_id="学生",
                    question_id=question_ids[0],
                    bank_id=bank_ids[0],
                ),
                RecallProgress(
                    owner_id="学生",
                    question_id=question_ids[1],
                ),
                LearningEvent(
                    id=f"reset-event-{suffix}",
                    owner_id="学生",
                    question_id=question_ids[2],
                    event_type="answer",
                    payload={},
                ),
                LearningEvent(
                    id=f"reset-event-null-{suffix}",
                    owner_id="学生",
                    question_id=None,
                    event_type="session_opened",
                    payload={"sourceQuestionId": question_ids[0]},
                ),
                Principle(
                    id=principle_id,
                    name="重置原则",
                    status="active",
                    created_by="admin",
                    updated_by="admin",
                ),
            ]
        )
        await db.flush()
        db.add(
            SynthesisPreset(
                id=preset_id,
                principle_id=principle_id,
                title="原则：重置原则",
                content="重置归纳卡内容",
                status="active",
                created_by="admin",
                updated_by="admin",
            )
        )
        db.add(
            ExamPaper(
                id=paper_id,
                owner_id="admin",
                name="待修复当前试卷",
                total_count=2,
                quotas={"范围": 1, "成本": 1},
                revision=7,
            )
        )
        await db.flush()
        db.add_all(
            [
                PaperQuestion(
                    paper_id=paper_id,
                    question_id=question_ids[0],
                    order_index=0,
                ),
                PaperQuestion(
                    paper_id=paper_id,
                    question_id=question_ids[2],
                    order_index=1,
                ),
                QuestionAuditLog(
                    id=audit_id,
                    entity_type="question",
                    entity_id=question_ids[0],
                    action="question_created",
                    actor_username="admin",
                    actor_role="admin",
                    bank_id=bank_ids[0],
                    question_id=question_ids[0],
                    outcome="success",
                    detail={"fixture": "teaching-reset"},
                ),
                SharedRuntimeState(
                    key=MUTABLE_RUNTIME_KEY,
                    value=mutable_value,
                    schema_version=1,
                    updated_by="admin",
                ),
                SharedRuntimeState(
                    key=IMMUTABLE_RUNTIME_KEY,
                    value=immutable_value,
                    schema_version=1,
                    updated_by="admin",
                ),
                SharedRuntimeState(
                    key=PRINCIPLE_KEY,
                    value=json.dumps(
                        {
                            "schemaVersion": 1,
                            "items": [{"id": principle_id, "name": "重置原则"}],
                            "updatedAt": 1,
                        },
                        ensure_ascii=False,
                        separators=(",", ":"),
                    ),
                    schema_version=1,
                    updated_by="admin",
                ),
                SharedRuntimeState(
                    key=PRESET_KEY,
                    value=json.dumps(
                        {
                            "schemaVersion": 1,
                            "items": [
                                {
                                    "id": preset_id,
                                    "principleId": principle_id,
                                    "title": "原则：重置原则",
                                }
                            ],
                            "updatedAt": 1,
                        },
                        ensure_ascii=False,
                        separators=(",", ":"),
                    ),
                    schema_version=1,
                    updated_by="admin",
                ),
            ]
        )
        await db.commit()
        before_revision = int((await teaching_content_revision_service.current(db))["revision"])
        before_audit_count = await _count(db, QuestionAuditLog)

    return {
        "suffix": suffix,
        "bankIds": bank_ids,
        "questionIds": question_ids,
        "principleId": principle_id,
        "presetId": preset_id,
        "paperId": paper_id,
        "auditId": audit_id,
        "immutableValue": immutable_value,
        "mutableValue": mutable_value,
        "beforeRevision": before_revision,
        "beforeAuditCount": before_audit_count,
    }


def test_reset_current_content_deletes_current_rows_and_preserves_history_and_audit():
    snapshot = asyncio.run(_snapshot_reset_state())

    async def scenario() -> None:
        fixture = await _seed_reset_fixture()
        async with AsyncSessionLocal() as db:
            preview = await preview_reset(db)
            assert preview["counts"]["questionBanks"] == len(snapshot[QuestionBank]) + 2
            assert preview["counts"]["questions"] == len(snapshot[Question]) + 3
            assert preview["counts"]["principles"] == len(snapshot[Principle]) + 1
            assert preview["counts"]["synthesisPresets"] == len(snapshot[SynthesisPreset]) + 1
            await db.rollback()

            result = await reset_current_content(
                db,
                actor_username="admin",
                expected_snapshot_hash=str(preview["snapshotHash"]),
            )
            assert result["deleted"] == {
                "questionBanks": len(snapshot[QuestionBank]) + 2,
                "questions": len(snapshot[Question]) + 3,
                "principles": len(snapshot[Principle]) + 1,
                "synthesisPresets": len(snapshot[SynthesisPreset]) + 1,
            }

        async with AsyncSessionLocal() as verify_db:
            assert await _count(verify_db, QuestionBank) == 0
            assert await _count(verify_db, Question) == 0
            assert await _count(verify_db, QuestionBankCollaborator) == 0
            assert await _count(verify_db, QuestionUploadBatch) == 0
            assert await _count(verify_db, QuestionEditLock) == 0
            assert await _count(verify_db, TrainingProgress) == 0
            assert await _count(verify_db, RecallProgress) == 0
            assert await _count(verify_db, LearningEvent) == 0
            assert await _count(verify_db, Principle) == 0
            assert await _count(verify_db, SynthesisPreset) == 0

            paper = await verify_db.get(ExamPaper, fixture["paperId"])
            assert paper is not None
            assert paper.total_count == 0
            assert paper.quotas == {}
            assert paper.revision == 8
            assert (
                await verify_db.execute(
                    select(PaperQuestion).where(PaperQuestion.paper_id == fixture["paperId"])
                )
            ).scalars().all() == []

            mutable_row = await verify_db.get(SharedRuntimeState, MUTABLE_RUNTIME_KEY)
            assert mutable_row is not None
            assert mutable_row.value == fixture["mutableValue"]
            immutable_row = await verify_db.get(SharedRuntimeState, IMMUTABLE_RUNTIME_KEY)
            assert immutable_row is not None
            assert immutable_row.value == fixture["immutableValue"]
            assert await _count(verify_db, QuestionAuditLog) == fixture["beforeAuditCount"]
            assert await verify_db.get(QuestionAuditLog, fixture["auditId"]) is not None

            principle_projection = await verify_db.get(SharedRuntimeState, PRINCIPLE_KEY)
            preset_projection = await verify_db.get(SharedRuntimeState, PRESET_KEY)
            assert json.loads(principle_projection.value)["items"][0]["id"] == fixture["principleId"]
            assert json.loads(preset_projection.value)["items"][0]["id"] == fixture["presetId"]
            after_revision = await teaching_content_revision_service.current(verify_db)
            assert after_revision["revision"] == fixture["beforeRevision"] + 1

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(_restore_reset_state(snapshot))


def test_reset_current_content_rejects_stale_snapshot_before_any_mutation():
    snapshot = asyncio.run(_snapshot_reset_state())

    async def scenario() -> None:
        fixture = await _seed_reset_fixture()
        async with AsyncSessionLocal() as db:
            preview = await preview_reset(db)
            await db.rollback()
            try:
                await reset_current_content(
                    db,
                    actor_username="admin",
                    expected_snapshot_hash="0" * 64,
                )
            except ResetSnapshotMismatch as error:
                assert error.preview["snapshotHash"] == preview["snapshotHash"]
            else:
                raise AssertionError("stale reset snapshot must be rejected")

        async with AsyncSessionLocal() as verify_db:
            assert await _count(verify_db, QuestionBank) == len(snapshot[QuestionBank]) + 2
            assert await _count(verify_db, Question) == len(snapshot[Question]) + 3
            assert await _count(verify_db, Principle) == len(snapshot[Principle]) + 1
            assert await _count(verify_db, SynthesisPreset) == len(snapshot[SynthesisPreset]) + 1
            immutable_row = await verify_db.get(SharedRuntimeState, IMMUTABLE_RUNTIME_KEY)
            assert immutable_row is not None
            assert immutable_row.value == fixture["immutableValue"]
            assert await _count(verify_db, QuestionAuditLog) == fixture["beforeAuditCount"]

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(_restore_reset_state(snapshot))


def test_reset_current_content_rolls_back_all_rows_when_revision_write_fails(monkeypatch):
    snapshot = asyncio.run(_snapshot_reset_state())

    async def scenario() -> None:
        fixture = await _seed_reset_fixture()
        original_write = teaching_content_reset_service.teaching_content_revision_service.bump

        async def fail_revision_write(db, actor_username, changes):
            await db.flush()
            raise RuntimeError("injected revision failure")

        monkeypatch.setattr(
            teaching_content_reset_service.teaching_content_revision_service,
            "bump",
            fail_revision_write,
        )
        async with AsyncSessionLocal() as db:
            preview = await preview_reset(db)
            await db.rollback()
            try:
                await reset_current_content(
                    db,
                    actor_username="admin",
                    expected_snapshot_hash=str(preview["snapshotHash"]),
                )
            except RuntimeError as error:
                assert str(error) == "injected revision failure"
            else:
                raise AssertionError("injected failure must abort reset")

        async with AsyncSessionLocal() as verify_db:
            assert await _count(verify_db, QuestionBank) == len(snapshot[QuestionBank]) + 2
            assert await _count(verify_db, Question) == len(snapshot[Question]) + 3
            assert await _count(verify_db, QuestionBankCollaborator) == len(snapshot[QuestionBankCollaborator]) + 1
            assert await _count(verify_db, QuestionUploadBatch) == len(snapshot[QuestionUploadBatch]) + 1
            assert await _count(verify_db, QuestionEditLock) == len(snapshot[QuestionEditLock]) + 1
            assert await _count(verify_db, TrainingProgress) == len(snapshot[TrainingProgress]) + 1
            assert await _count(verify_db, RecallProgress) == len(snapshot[RecallProgress]) + 1
            assert await _count(verify_db, LearningEvent) == len(snapshot[LearningEvent]) + 2
            assert await _count(verify_db, Principle) == len(snapshot[Principle]) + 1
            assert await _count(verify_db, SynthesisPreset) == len(snapshot[SynthesisPreset]) + 1
            assert await _count(verify_db, PaperQuestion) == len(snapshot[PaperQuestion]) + 2
            mutable_row = await verify_db.get(SharedRuntimeState, MUTABLE_RUNTIME_KEY)
            immutable_row = await verify_db.get(SharedRuntimeState, IMMUTABLE_RUNTIME_KEY)
            assert mutable_row is not None
            assert len(json.loads(mutable_row.value)[0]["nodes"][0]["questionIds"]) == 2
            assert immutable_row is not None
            assert immutable_row.value == fixture["immutableValue"]
            assert await _count(verify_db, QuestionAuditLog) == fixture["beforeAuditCount"]

        monkeypatch.setattr(
            teaching_content_reset_service.teaching_content_revision_service,
            "bump",
            original_write,
        )

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(_restore_reset_state(snapshot))


def test_reset_cli_previews_rejects_teacher_and_applies_for_admin():
    snapshot = asyncio.run(_snapshot_reset_state())

    try:
        fixture = asyncio.run(_seed_reset_fixture())
        backend_root = Path(__file__).resolve().parents[1]
        script = backend_root / "scripts" / "reset_teaching_content.py"

        preview_process = subprocess.run(
            [sys.executable, str(script), "preview"],
            cwd=backend_root,
            check=False,
            capture_output=True,
            text=True,
        )
        assert preview_process.returncode == 0, preview_process.stderr
        preview = json.loads(preview_process.stdout)
        assert preview["counts"]["questionBanks"] == len(snapshot[QuestionBank]) + 2
        assert preview["counts"]["questions"] == len(snapshot[Question]) + 3

        teacher_process = subprocess.run(
            [
                sys.executable,
                str(script),
                "apply",
                "--actor",
                "老师",
                "--snapshot-hash",
                preview["snapshotHash"],
                "--confirm",
                preview["confirmToken"],
            ],
            cwd=backend_root,
            check=False,
            capture_output=True,
            text=True,
        )
        assert teacher_process.returncode != 0
        assert "管理员" in teacher_process.stderr

        async def verify_teacher_rejection() -> None:
            async with AsyncSessionLocal() as db:
                assert await _count(db, QuestionBank) == len(snapshot[QuestionBank]) + 2
                assert await _count(db, Question) == len(snapshot[Question]) + 3
                immutable_row = await db.get(SharedRuntimeState, IMMUTABLE_RUNTIME_KEY)
                assert immutable_row is not None
                assert immutable_row.value == fixture["immutableValue"]

        asyncio.run(verify_teacher_rejection())

        admin_process = subprocess.run(
            [
                sys.executable,
                str(script),
                "apply",
                "--actor",
                "admin",
                "--snapshot-hash",
                preview["snapshotHash"],
                "--confirm",
                preview["confirmToken"],
            ],
            cwd=backend_root,
            check=False,
            capture_output=True,
            text=True,
        )
        assert admin_process.returncode == 0, admin_process.stderr
        result = json.loads(admin_process.stdout)
        assert result["deleted"] == {
            "questionBanks": len(snapshot[QuestionBank]) + 2,
            "questions": len(snapshot[Question]) + 3,
            "principles": len(snapshot[Principle]) + 1,
            "synthesisPresets": len(snapshot[SynthesisPreset]) + 1,
        }
    finally:
        asyncio.run(_restore_reset_state(snapshot))
