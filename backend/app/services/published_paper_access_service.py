"""Server-side access checks for relational frozen paper-release snapshots."""

from __future__ import annotations

from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.paper_release import PaperRelease, PaperReleaseQuestion
from app.models.question import Question
from app.models.user import User
from app.services import paper_release_service


async def load_published_question_snapshot(
    db: AsyncSession,
    user: User,
    release_id: str,
    question_id: str,
    *,
    mode: str,
) -> dict | None:
    """读取指定发布版本中的权威快照；授权始终绑定 release_id。"""
    release = await db.get(PaperRelease, release_id)
    if release is None or release.status not in {"published", "superseded"}:
        return None
    if mode not in set(release.enabled_modes or []):
        return None
    entitled = await paper_release_service.entitlement_for_request(db, user)
    if not paper_release_service.can_access_with_entitlement(user, release, entitled):
        return None
    row = (
        await db.execute(
            select(PaperReleaseQuestion)
            .where(
                PaperReleaseQuestion.release_id == release_id,
                PaperReleaseQuestion.question_id == question_id,
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    return dict(row.snapshot) if row is not None else None


def question_from_snapshot(snapshot: dict) -> Question:
    """构造只读 Question 视图，避免学习链路回读已变化的题库正文。"""
    question = Question()
    question.id = str(snapshot.get("id") or "")
    question.bank_id = str(snapshot.get("bankId") or "")
    question.source_id = snapshot.get("sourceId")
    question.title = str(snapshot.get("title") or "")
    question.type = str(snapshot.get("type") or "single_choice")
    question.subject = snapshot.get("subject")
    question.difficulty = snapshot.get("difficulty")
    question.domain = snapshot.get("domain")
    question.topic = snapshot.get("topic")
    question.teacher_number = snapshot.get("teacherNumber")
    question.scope = str(snapshot.get("scope") or "internal")
    question.content_hash = snapshot.get("contentHash")
    question.creator_id = snapshot.get("creatorId")
    question.creator_name = snapshot.get("creatorName")
    question.revision = max(1, int(snapshot.get("revision") or 1))
    question.tags = list(snapshot.get("tags") or [])
    question.stem_parts = list(snapshot.get("stemParts") or [])
    question.options = list(snapshot.get("options") or [])
    question.correct_answer = snapshot.get("correctAnswer")
    question.analysis = snapshot.get("analysis")
    question.clues = list(snapshot.get("clues") or [])
    question.concepts = list(snapshot.get("concepts") or [])
    question.reasoning_steps = list(snapshot.get("reasoningSteps") or [])
    question.status = dict(snapshot.get("status") or {})
    question.translations = dict(snapshot.get("translations") or {})
    question.content_metadata = dict(snapshot.get("metadata") or {})
    question.key_path = dict(snapshot.get("keyPath") or {})
    question.lifecycle = dict(snapshot.get("lifecycle") or {})
    return question


async def load_published_question(
    db: AsyncSession,
    user: User,
    release_id: str,
    question_id: str,
    *,
    mode: str,
) -> Question | None:
    snapshot = await load_published_question_snapshot(
        db, user, release_id, question_id, mode=mode
    )
    return question_from_snapshot(snapshot) if snapshot is not None else None


async def load_or_project_published_question(
    db: AsyncSession,
    user: User,
    question_id: str,
) -> None:
    """旧调用签名仅保留 fail-closed 兼容；请求链不再投影 runtime 快照。"""
    return None


async def can_learn_published_question(
    db: AsyncSession,
    user: User,
    question_id: str,
    *,
    release_id: str | None = None,
    mode: str = "deep_recall",
) -> bool:
    if not release_id:
        return False
    release = await db.get(PaperRelease, release_id)
    if release is None or release.status not in {"published", "superseded"} or mode not in set(release.enabled_modes or []):
        return False
    entitled = await paper_release_service.entitlement_for_request(db, user)
    if not paper_release_service.can_access_with_entitlement(user, release, entitled):
        return False
    return bool(await db.scalar(select(exists().where(
        PaperReleaseQuestion.release_id == release_id,
        PaperReleaseQuestion.question_id == question_id,
    ))))
