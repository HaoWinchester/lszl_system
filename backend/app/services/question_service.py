"""题库管理业务逻辑：题库/题目/试卷 CRUD、按领域配额组卷、发布。"""

import random
import re

from fastapi import HTTPException
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import now_utc, uid
from app.models.content_prep import QuestionUploadBatch
from app.models.question import DRAFT, ExamPaper, PaperQuestion, PUBLISHED, Question, QuestionBank
from app.models.user import User
from app.services import (
    question_access_service,
    question_catalog_service,
    question_content_service,
    teaching_content_revision_service,
)


_PAPER_REVISION_PATTERN = re.compile(r"[0-9]+", re.ASCII)
_POSTGRES_INTEGER_MAX = 2_147_483_647
_MAX_MUTABLE_PAPER_REVISION = _POSTGRES_INTEGER_MAX - 1
_MAX_PAPER_REVISION_DIGITS = len(str(_POSTGRES_INTEGER_MAX))


def bank_to_dict(b: QuestionBank, question_count: int = 0) -> dict:
    return {
        "id": b.id,
        "ownerId": b.owner_id,
        "name": b.name,
        "subject": b.subject,
        "description": b.description,
        "version": b.version,
        "visibility": b.visibility,
        "revision": b.revision,
        "questionCount": question_count,
        "createdBy": b.created_by,
        "updatedBy": b.updated_by,
        "createdAt": b.created_at.isoformat() if b.created_at else None,
        "updatedAt": b.updated_at.isoformat() if b.updated_at else None,
    }


def question_to_dict(q: Question) -> dict:
    return question_catalog_service.question_to_payload(q)


def paper_to_dict(p: ExamPaper, question_count: int = 0) -> dict:
    return {
        "id": p.id,
        "ownerId": p.owner_id,
        "name": p.name,
        "subject": p.subject,
        "description": p.description,
        "totalCount": p.total_count,
        "status": p.status,
        "quotas": p.quotas or {},
        "questionCount": question_count,
        "revision": p.revision,
        "createdBy": p.created_by,
        "updatedBy": p.updated_by,
        "publishedAt": p.published_at.isoformat() if p.published_at else None,
        "createdAt": p.created_at.isoformat() if p.created_at else None,
        "updatedAt": p.updated_at.isoformat() if p.updated_at else None,
    }


# ---------- 题库 ----------
async def _resolve_actor(db: AsyncSession, actor: User | str) -> User | None:
    if isinstance(actor, User):
        return actor
    return await db.get(User, actor)


async def list_banks(db: AsyncSession, owner: User | str, subject: str | None = None) -> list[dict]:
    actor = await _resolve_actor(db, owner)
    if actor is None:
        return []
    return await question_catalog_service.list_catalog_banks(
        db,
        actor,
        mode="managed",
        subject=subject,
    )


async def create_bank(db: AsyncSession, owner: User | str, data: dict) -> QuestionBank:
    actor = await _resolve_actor(db, owner)
    if actor is None:
        raise ValueError("用户不存在")
    await teaching_content_revision_service.acquire_lock(db)
    visibility = str(data.get("visibility") or "private")
    if visibility not in {"private", "published"}:
        visibility = "private"
    b = QuestionBank(
        id=uid("b_"),
        owner_id=actor.username,
        name=data.get("name", "新题库"),
        subject=data.get("subject", "PMP"),
        description=data.get("description"),
        visibility=visibility,
        revision=1,
        created_by=actor.username,
        updated_by=actor.username,
    )
    db.add(b)
    await teaching_content_revision_service.bump(
        db,
        actor.username,
        [{"entityType": "bank", "entityId": b.id, "action": "created"}],
    )
    await db.commit()
    await db.refresh(b)
    return b


async def update_bank(db: AsyncSession, owner: User | str, bank_id: str, patch: dict) -> QuestionBank | None:
    actor = await _resolve_actor(db, owner)
    if actor is None:
        return None
    await teaching_content_revision_service.acquire_lock(db)
    try:
        b = await question_access_service.require_bank_access(db, actor, bank_id, edit=True)
    except HTTPException:
        return None
    for k in ("name", "subject", "description", "version", "visibility"):
        if k in patch:
            setattr(b, k, patch[k])
    b.revision += 1
    b.updated_by = actor.username
    await teaching_content_revision_service.bump(
        db,
        actor.username,
        [{"entityType": "bank", "entityId": b.id, "action": "updated"}],
    )
    await db.commit()
    await db.refresh(b)
    return b


async def delete_bank(db: AsyncSession, owner: User | str, bank_id: str) -> bool:
    actor = await _resolve_actor(db, owner)
    if actor is None:
        return False
    await teaching_content_revision_service.acquire_lock(db)
    try:
        b = await question_access_service.require_bank_access(db, actor, bank_id, edit=True)
    except HTTPException:
        return False
    qs = (
        await db.execute(
            select(Question).where(Question.bank_id == bank_id).order_by(Question.id)
        )
    ).scalars().all()
    await db.execute(
        delete(QuestionUploadBatch).where(QuestionUploadBatch.bank_id == bank_id)
    )
    for q in qs:
        await db.delete(q)
    await db.delete(b)
    await teaching_content_revision_service.bump(
        db,
        actor.username,
        [
            *[
                {"entityType": "question", "entityId": q.id, "action": "deleted"}
                for q in qs
            ],
            {"entityType": "bank", "entityId": b.id, "action": "deleted"},
        ],
    )
    await db.commit()
    return True


# ---------- 题目 ----------
async def list_questions(
    db: AsyncSession,
    owner: User | str,
    bank_id: str,
    *,
    query: str | None = None,
    domain: str | None = None,
    difficulty: str | None = None,
    page: int = 1,
    page_size: int = 20,
):
    actor = await _resolve_actor(db, owner)
    if actor is None:
        return [], 0
    try:
        await question_access_service.require_bank_access(db, actor, bank_id, edit=False)
    except HTTPException:
        return [], 0
    q = select(Question).where(Question.bank_id == bank_id)
    if query:
        like = f"%{query}%"
        q = q.where(or_(Question.title.ilike(like), Question.analysis.ilike(like)))
    if domain:
        q = q.where(Question.domain == domain)
    if difficulty:
        q = q.where(Question.difficulty == difficulty)
    total = int((await db.execute(select(func.count()).select_from(q.subquery()))).scalar() or 0)
    q = q.order_by(Question.created_at).offset((page - 1) * page_size).limit(page_size)
    rows = (await db.execute(q)).scalars().all()
    return [question_to_dict(r) for r in rows], total


async def create_question(db: AsyncSession, owner: User | str, bank_id: str, data: dict) -> Question | None:
    actor = await _resolve_actor(db, owner)
    if actor is None:
        return None
    await teaching_content_revision_service.acquire_lock(db)
    try:
        b = await question_access_service.require_bank_access(db, actor, bank_id, edit=True)
    except HTTPException:
        return None
    question_id = uid("q_")
    normalized = question_content_service.normalize_question_payload(
        {**data, "id": question_id, "title": data.get("title", "新题目")},
        subject=b.subject,
    )
    normalized["scope"] = "internal"
    content_hash = question_content_service.canonical_question_hash(normalized)
    q = Question(
        id=question_id,
        bank_id=bank_id,
        title=normalized["title"],
        type=normalized["type"],
        subject=normalized["subject"],
        difficulty=normalized.get("difficulty"),
        domain=normalized.get("domain"),
        topic=normalized.get("topic"),
        teacher_number=normalized.get("teacherNumber"),
        scope="internal",
        content_hash=content_hash,
        created_by=actor.username,
        updated_by=actor.username,
        revision=1,
        tags=normalized["tags"],
        stem_parts=normalized["stemParts"],
        options=normalized["options"],
        correct_answer=str(normalized.get("correctAnswer") or "") or None,
        analysis=normalized.get("analysis"),
        clues=normalized["clues"],
        concepts=normalized["concepts"],
        reasoning_steps=normalized["reasoningSteps"],
        status=normalized["status"],
        translations=normalized["translations"],
        content_metadata=normalized["metadata"],
        key_path=normalized["keyPath"],
        lifecycle=normalized["lifecycle"],
    )
    db.add(q)
    await teaching_content_revision_service.bump(
        db,
        actor.username,
        [{"entityType": "question", "entityId": q.id, "action": "created"}],
    )
    await db.commit()
    await db.refresh(q)
    return q


async def get_question(db: AsyncSession, owner: User | str, question_id: str) -> Question | None:
    actor = await _resolve_actor(db, owner)
    if actor is None:
        return None
    q = await db.get(Question, question_id)
    if not q:
        return None
    try:
        await question_access_service.require_bank_access(db, actor, q.bank_id, edit=False)
    except HTTPException:
        return None
    return q


async def update_question(db: AsyncSession, owner: User | str, question_id: str, patch: dict) -> Question | None:
    actor = await _resolve_actor(db, owner)
    if actor is None:
        return None
    await teaching_content_revision_service.acquire_lock(db)
    q = await db.get(Question, question_id)
    if q is None:
        return None
    try:
        await question_access_service.require_bank_access(db, actor, q.bank_id, edit=True)
    except HTTPException:
        return None
    current = question_catalog_service.question_to_payload(q)
    merged = {**current, **patch, "id": q.id}
    normalized = question_content_service.normalize_question_payload(
        merged,
        subject=q.subject or "PMP",
    )
    q.title = normalized["title"]
    q.type = normalized["type"]
    q.subject = normalized["subject"]
    q.difficulty = normalized.get("difficulty")
    q.domain = normalized.get("domain")
    q.topic = normalized.get("topic")
    q.teacher_number = normalized.get("teacherNumber")
    q.scope = normalized["scope"]
    q.tags = normalized["tags"]
    q.stem_parts = normalized["stemParts"]
    q.options = normalized["options"]
    q.correct_answer = str(normalized.get("correctAnswer") or "") or None
    q.analysis = normalized.get("analysis")
    q.clues = normalized["clues"]
    q.concepts = normalized["concepts"]
    q.reasoning_steps = normalized["reasoningSteps"]
    q.status = normalized["status"]
    q.translations = normalized["translations"]
    q.content_metadata = normalized["metadata"]
    q.key_path = normalized["keyPath"]
    q.lifecycle = normalized["lifecycle"]
    q.content_hash = question_content_service.canonical_question_hash(normalized)
    q.revision += 1
    q.updated_by = actor.username
    await teaching_content_revision_service.bump(
        db,
        actor.username,
        [{"entityType": "question", "entityId": q.id, "action": "updated"}],
    )
    await db.commit()
    await db.refresh(q)
    return q


async def delete_question(db: AsyncSession, owner: User | str, question_id: str) -> bool:
    actor = await _resolve_actor(db, owner)
    if actor is None:
        return False
    await teaching_content_revision_service.acquire_lock(db)
    q = await db.get(Question, question_id)
    if q is None:
        return False
    try:
        await question_access_service.require_bank_access(db, actor, q.bank_id, edit=True)
    except HTTPException:
        return False
    links = (await db.execute(select(PaperQuestion).where(PaperQuestion.question_id == question_id))).scalars().all()
    for l in links:
        await db.delete(l)
    await db.delete(q)
    await teaching_content_revision_service.bump(
        db,
        actor.username,
        [{"entityType": "question", "entityId": q.id, "action": "deleted"}],
    )
    await db.commit()
    return True


# ---------- 试卷 ----------
def _require_paper_revision(value: object) -> int:
    revision = 0
    if isinstance(value, bool):
        pass
    elif isinstance(value, int):
        revision = value
    elif isinstance(value, str):
        candidate = value.strip()
        if (
            0 < len(candidate) <= _MAX_PAPER_REVISION_DIGITS
            and _PAPER_REVISION_PATTERN.fullmatch(candidate) is not None
        ):
            try:
                revision = int(candidate)
            except (OverflowError, ValueError):
                revision = 0
    if not 1 <= revision <= _MAX_MUTABLE_PAPER_REVISION:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "REVISION_REQUIRED",
                "message": "修改公共试卷必须提供有效的修订号",
            },
        )
    return revision


async def _cas_paper_mutation(
    db: AsyncSession,
    actor: User,
    paper_id: str,
    expected_revision: object,
    values: dict,
) -> str | None:
    revision = _require_paper_revision(expected_revision)
    mutation_values = {
        **values,
        "revision": ExamPaper.revision + 1,
        "updated_by": actor.username,
    }
    updated_id = (
        await db.execute(
            update(ExamPaper)
            .where(
                ExamPaper.id == paper_id,
                ExamPaper.deleted_at.is_(None),
                ExamPaper.revision == revision,
            )
            .values(**mutation_values)
            .returning(ExamPaper.id)
        )
    ).scalar_one_or_none()
    if updated_id is not None:
        return updated_id

    current = (
        await db.execute(
            select(ExamPaper.revision, ExamPaper.deleted_at).where(
                ExamPaper.id == paper_id
            )
        )
    ).first()
    if current is None:
        return None
    raise HTTPException(
        status_code=409,
        detail={
            "code": "REVISION_CONFLICT",
            "message": "试卷已被其他用户更新，请刷新后重试",
            "currentRevision": current.revision,
            "deleted": current.deleted_at is not None,
        },
    )


async def list_papers(db: AsyncSession, actor: User, status: str | None = None) -> list[dict]:
    q = select(ExamPaper).where(ExamPaper.deleted_at.is_(None))
    if status:
        q = q.where(ExamPaper.status == status)
    papers = (await db.execute(q.order_by(ExamPaper.created_at))).scalars().all()
    result = []
    for p in papers:
        cnt = int(
            (await db.execute(select(func.count()).select_from(PaperQuestion).where(PaperQuestion.paper_id == p.id))).scalar() or 0
        )
        result.append(paper_to_dict(p, cnt))
    return result


async def create_paper(db: AsyncSession, actor: User, data: dict) -> ExamPaper:
    await teaching_content_revision_service.acquire_lock(db)
    p = ExamPaper(
        id=uid("p_"),
        owner_id=actor.username,
        revision=1,
        created_by=actor.username,
        updated_by=actor.username,
        name=data.get("name", "新试卷"),
        subject=data.get("subject", "PMP"),
        description=data.get("description"),
        total_count=data.get("totalCount", 0),
        quotas=data.get("quotas") or {},
    )
    db.add(p)
    await teaching_content_revision_service.bump(
        db,
        actor.username,
        [{"entityType": "paper", "entityId": p.id, "action": "created"}],
    )
    await db.commit()
    await db.refresh(p)
    return p


async def update_paper(db: AsyncSession, actor: User, paper_id: str, patch: dict) -> ExamPaper | None:
    await teaching_content_revision_service.acquire_lock(db)
    values = {
        k: patch[k]
        for k in ("name", "subject", "description", "quotas")
        if k in patch
    }
    updated_id = await _cas_paper_mutation(
        db,
        actor,
        paper_id,
        patch.get("revision"),
        values,
    )
    if updated_id is None:
        return None
    await teaching_content_revision_service.bump(
        db,
        actor.username,
        [{"entityType": "paper", "entityId": updated_id, "action": "updated"}],
    )
    await db.commit()
    p = await db.get(ExamPaper, updated_id)
    if p is None:
        return None
    await db.refresh(p)
    return p


async def delete_paper(
    db: AsyncSession,
    actor: User,
    paper_id: str,
    expected_revision: object,
    deletion_reason: str | None = None,
) -> dict | None:
    await teaching_content_revision_service.acquire_lock(db)
    revision = _require_paper_revision(expected_revision)
    current = (
        await db.execute(
            select(ExamPaper.status).where(ExamPaper.id == paper_id)
        )
    ).scalar_one_or_none()
    if current is None:
        return None
    reference_count = int(
        (
            await db.execute(
                select(func.count())
                .select_from(PaperQuestion)
                .where(PaperQuestion.paper_id == paper_id)
            )
        ).scalar_one()
    )
    deleted_at = now_utc()
    reason = str(deletion_reason or "").strip() or "未提供删除原因"
    updated_id = await _cas_paper_mutation(
        db,
        actor,
        paper_id,
        revision,
        {
            "status": "deleted",
            "deleted_by": actor.username,
            "deleted_at": deleted_at,
            "deletion_reason": reason,
        },
    )
    if updated_id is None:
        return None
    await teaching_content_revision_service.bump(
        db,
        actor.username,
        [{"entityType": "paper", "entityId": updated_id, "action": "deleted"}],
    )
    await db.commit()
    return {
        "paperId": updated_id,
        "revision": revision + 1,
        "deletedBy": actor.username,
        "deletedAt": deleted_at.isoformat(),
        "reason": reason,
        "previousStatus": current,
        "references": {"paperQuestions": reference_count},
    }


async def compose_paper(
    db: AsyncSession,
    actor: User,
    paper_id: str,
    bank_ids: list[str],
    quotas: dict,
    expected_revision: object,
) -> int:
    """按领域配额从管理员和教师共同维护的题库随机抽题。"""
    await teaching_content_revision_service.acquire_lock(db)
    revision = _require_paper_revision(expected_revision)
    q = select(Question).join(QuestionBank, QuestionBank.id == Question.bank_id)
    if bank_ids:
        q = q.where(Question.bank_id.in_(bank_ids))
    all_qs = (await db.execute(q)).scalars().all()

    picked: list[Question] = []
    for domain, count in (quotas or {}).items():
        pool = [x for x in all_qs if (x.domain or "其他") == domain]
        random.shuffle(pool)
        picked.extend(pool[: int(count)])

    updated_id = await _cas_paper_mutation(
        db,
        actor,
        paper_id,
        revision,
        {"total_count": len(picked), "quotas": quotas or {}},
    )
    if updated_id is None:
        return -1
    await db.execute(delete(PaperQuestion).where(PaperQuestion.paper_id == paper_id))
    await db.flush()
    for i, question in enumerate(picked):
        db.add(PaperQuestion(paper_id=paper_id, question_id=question.id, order_index=i))
    await teaching_content_revision_service.bump(
        db,
        actor.username,
        [{"entityType": "paper", "entityId": paper_id, "action": "composed"}],
    )
    await db.commit()
    return len(picked)


async def set_published(
    db: AsyncSession,
    actor: User,
    paper_id: str,
    published: bool,
    expected_revision: object,
) -> ExamPaper | None:
    await teaching_content_revision_service.acquire_lock(db)
    updated_id = await _cas_paper_mutation(
        db,
        actor,
        paper_id,
        expected_revision,
        {
            "status": PUBLISHED if published else DRAFT,
            "published_at": now_utc() if published else None,
        },
    )
    if updated_id is None:
        return None
    await teaching_content_revision_service.bump(
        db,
        actor.username,
        [
            {
                "entityType": "paper",
                "entityId": updated_id,
                "action": "published" if published else "unpublished",
            }
        ],
    )
    await db.commit()
    p = await db.get(ExamPaper, updated_id)
    if p is None:
        return None
    await db.refresh(p)
    return p


async def get_paper_with_questions(db: AsyncSession, actor: User, paper_id: str) -> dict | None:
    p = (
        await db.execute(
            select(ExamPaper).where(
                ExamPaper.id == paper_id,
                ExamPaper.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if p is None:
        return None
    rows = (
        await db.execute(
            select(Question, PaperQuestion)
            .join(PaperQuestion, PaperQuestion.question_id == Question.id)
            .where(PaperQuestion.paper_id == paper_id)
            .order_by(PaperQuestion.order_index)
        )
    ).all()
    questions = [question_to_dict(q) for q, _ in rows]
    return {**paper_to_dict(p, len(questions)), "questions": questions}
