"""Guarded, atomic reset of current question and principle content."""

from __future__ import annotations

import hashlib
import json
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.content_prep import (
    Principle,
    QuestionBankCollaborator,
    QuestionEditLock,
    QuestionUploadBatch,
    SynthesisPreset,
)
from app.models.question import PaperQuestion, Question, QuestionBank
from app.models.training import LearningEvent, RecallProgress, TrainingProgress
from app.services import teaching_content_revision_service
from app.services.question_cleanup_reference_service import (
    repair_current_question_references,
)
from app.services.teaching_content_projection_service import (
    write_principle_projection,
)


CONFIRM_PREFIX = "RESET-TEACHING-CONTENT"


class ResetSnapshotMismatch(ValueError):
    """The destructive reset preview no longer matches current content."""

    def __init__(self, preview: dict[str, object]):
        super().__init__("教学内容已变化，请重新预览后再清空")
        self.preview = preview


def _canonical_json(value: object) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


async def _count(db: AsyncSession, model: type[Any]) -> int:
    return int(
        (await db.execute(select(func.count()).select_from(model))).scalar() or 0
    )


async def _sorted_ids(db: AsyncSession, column: Any) -> list[str]:
    return [
        str(value)
        for value in (await db.execute(select(column).order_by(column))).scalars().all()
    ]


async def _build_preview(db: AsyncSession) -> dict[str, object]:
    counts = {
        "questionBanks": await _count(db, QuestionBank),
        "questions": await _count(db, Question),
        "principles": await _count(db, Principle),
        "synthesisPresets": await _count(db, SynthesisPreset),
        "questionBankCollaborators": await _count(db, QuestionBankCollaborator),
        "questionUploadBatches": await _count(db, QuestionUploadBatch),
        "questionEditLocks": await _count(db, QuestionEditLock),
        "trainingProgress": await _count(db, TrainingProgress),
        "recallProgress": await _count(db, RecallProgress),
        "learningEvents": await _count(db, LearningEvent),
        "paperQuestions": await _count(db, PaperQuestion),
    }
    ids = {
        "questionBanks": await _sorted_ids(db, QuestionBank.id),
        "questions": await _sorted_ids(db, Question.id),
        "principles": await _sorted_ids(db, Principle.id),
        "synthesisPresets": await _sorted_ids(db, SynthesisPreset.id),
    }
    snapshot_hash = hashlib.sha256(
        _canonical_json({"counts": counts, "ids": ids}).encode("utf-8")
    ).hexdigest()
    return {
        "counts": counts,
        "ids": ids,
        "snapshotHash": snapshot_hash,
        "confirmToken": f"{CONFIRM_PREFIX}:{snapshot_hash[:12]}",
    }


async def preview_reset(db: AsyncSession) -> dict[str, object]:
    """Return a deterministic, read-only snapshot for an operator to review."""

    return await _build_preview(db)


async def reset_current_content(
    db: AsyncSession,
    actor_username: str,
    expected_snapshot_hash: str,
) -> dict[str, object]:
    """Delete all current question/principle data in one locked transaction."""

    actor = str(actor_username or "").strip()
    expected = str(expected_snapshot_hash or "").strip().lower()
    if not actor:
        raise ValueError("清空操作必须提供操作者")
    if len(expected) != 64 or any(char not in "0123456789abcdef" for char in expected):
        raise ValueError("snapshotHash 必须是完整 SHA-256")

    try:
        await teaching_content_revision_service.acquire_cleanup_lock(db)
        preview = await _build_preview(db)
        if preview["snapshotHash"] != expected:
            raise ResetSnapshotMismatch(preview)

        question_ids = set(preview["ids"]["questions"])
        bank_ids = set(preview["ids"]["questionBanks"])
        question_domains = {
            str(question_id): domain
            for question_id, domain in (
                await db.execute(select(Question.id, Question.domain))
            ).all()
        }
        repair_summary = await repair_current_question_references(
            db,
            question_ids,
            actor_username=actor,
            question_domains=question_domains,
        )

        await db.execute(delete(LearningEvent))
        if question_ids:
            await db.execute(
                delete(TrainingProgress).where(
                    TrainingProgress.question_id.in_(question_ids)
                )
            )
            await db.execute(
                delete(RecallProgress).where(RecallProgress.question_id.in_(question_ids))
            )
            await db.execute(
                delete(QuestionEditLock).where(
                    QuestionEditLock.question_id.in_(question_ids)
                )
            )
            await db.execute(
                delete(PaperQuestion).where(PaperQuestion.question_id.in_(question_ids))
            )
        if bank_ids:
            await db.execute(
                delete(QuestionUploadBatch).where(
                    QuestionUploadBatch.bank_id.in_(bank_ids)
                )
            )
            await db.execute(
                delete(QuestionBankCollaborator).where(
                    QuestionBankCollaborator.bank_id.in_(bank_ids)
                )
            )

        await db.execute(delete(Question))
        await db.execute(delete(QuestionBank))
        await db.execute(delete(SynthesisPreset))
        await db.execute(delete(Principle))
        await db.flush()
        await write_principle_projection(db, actor)
        revision = await teaching_content_revision_service.bump(
            db,
            actor,
            [
                {
                    "entityType": "teaching_content",
                    "entityId": expected,
                    "action": "reset",
                }
            ],
        )
        await db.commit()
    except BaseException:
        await db.rollback()
        raise

    return {
        "snapshotHash": expected,
        "deleted": {
            "questionBanks": int(preview["counts"]["questionBanks"]),
            "questions": int(preview["counts"]["questions"]),
            "principles": int(preview["counts"]["principles"]),
            "synthesisPresets": int(preview["counts"]["synthesisPresets"]),
        },
        "repairSummary": repair_summary,
        "contentRevision": int(revision["revision"]),
    }


__all__ = [
    "CONFIRM_PREFIX",
    "ResetSnapshotMismatch",
    "preview_reset",
    "reset_current_content",
]
