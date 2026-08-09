"""题库管理业务逻辑：题库/题目/试卷 CRUD、按领域配额组卷、发布。按 owner 隔离。"""

import random

from fastapi import HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import now_utc, uid
from app.models.question import DRAFT, ExamPaper, PaperQuestion, PUBLISHED, Question, QuestionBank
from app.models.user import User
from app.services import (
    question_access_service,
    question_catalog_service,
    question_content_service,
)


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
        "name": p.name,
        "subject": p.subject,
        "description": p.description,
        "totalCount": p.total_count,
        "status": p.status,
        "quotas": p.quotas or {},
        "questionCount": question_count,
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
    await db.commit()
    await db.refresh(b)
    return b


async def update_bank(db: AsyncSession, owner: User | str, bank_id: str, patch: dict) -> QuestionBank | None:
    actor = await _resolve_actor(db, owner)
    if actor is None:
        return None
    try:
        b = await question_access_service.require_bank_access(db, actor, bank_id, edit=True)
    except HTTPException:
        return None
    for k in ("name", "subject", "description", "version", "visibility"):
        if k in patch:
            setattr(b, k, patch[k])
    b.revision += 1
    b.updated_by = actor.username
    await db.commit()
    await db.refresh(b)
    return b


async def delete_bank(db: AsyncSession, owner: User | str, bank_id: str) -> bool:
    actor = await _resolve_actor(db, owner)
    if actor is None:
        return False
    try:
        b = await question_access_service.require_bank_access(db, actor, bank_id, edit=True)
    except HTTPException:
        return False
    qs = (await db.execute(select(Question).where(Question.bank_id == bank_id))).scalars().all()
    for q in qs:
        await db.delete(q)
    await db.delete(b)
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
    await db.commit()
    await db.refresh(q)
    return q


async def delete_question(db: AsyncSession, owner: User | str, question_id: str) -> bool:
    actor = await _resolve_actor(db, owner)
    if actor is None:
        return False
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
    await db.commit()
    return True


# ---------- 试卷 ----------
async def list_papers(db: AsyncSession, owner: str, status: str | None = None) -> list[dict]:
    q = select(ExamPaper).where(ExamPaper.owner_id == owner)
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


async def create_paper(db: AsyncSession, owner: str, data: dict) -> ExamPaper:
    p = ExamPaper(
        id=uid("p_"),
        owner_id=owner,
        name=data.get("name", "新试卷"),
        subject=data.get("subject", "PMP"),
        description=data.get("description"),
        total_count=data.get("totalCount", 0),
        quotas=data.get("quotas") or {},
    )
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return p


async def update_paper(db: AsyncSession, owner: str, paper_id: str, patch: dict) -> ExamPaper | None:
    p = await db.get(ExamPaper, paper_id)
    if not p or p.owner_id != owner:
        return None
    for k in ("name", "subject", "description", "quotas"):
        if k in patch:
            setattr(p, k, patch[k])
    await db.commit()
    await db.refresh(p)
    return p


async def delete_paper(db: AsyncSession, owner: str, paper_id: str) -> bool:
    p = await db.get(ExamPaper, paper_id)
    if not p or p.owner_id != owner:
        return False
    links = (await db.execute(select(PaperQuestion).where(PaperQuestion.paper_id == paper_id))).scalars().all()
    for l in links:
        await db.delete(l)
    await db.delete(p)
    await db.commit()
    return True


async def compose_paper(
    db: AsyncSession, owner: str, paper_id: str, bank_ids: list[str], quotas: dict
) -> int:
    """按领域配额从 owner 的题库随机抽题。"""
    p = await db.get(ExamPaper, paper_id)
    if not p or p.owner_id != owner:
        return -1
    q = select(Question).join(QuestionBank, QuestionBank.id == Question.bank_id).where(
        QuestionBank.owner_id == owner
    )
    if bank_ids:
        q = q.where(Question.bank_id.in_(bank_ids))
    all_qs = (await db.execute(q)).scalars().all()

    picked: list[Question] = []
    for domain, count in (quotas or {}).items():
        pool = [x for x in all_qs if (x.domain or "其他") == domain]
        random.shuffle(pool)
        picked.extend(pool[: int(count)])

    old = (await db.execute(select(PaperQuestion).where(PaperQuestion.paper_id == paper_id))).scalars().all()
    for o in old:
        await db.delete(o)
    for i, question in enumerate(picked):
        db.add(PaperQuestion(paper_id=paper_id, question_id=question.id, order_index=i))
    p.total_count = len(picked)
    p.quotas = quotas or {}
    await db.commit()
    return len(picked)


async def set_published(db: AsyncSession, owner: str, paper_id: str, published: bool) -> ExamPaper | None:
    p = await db.get(ExamPaper, paper_id)
    if not p or p.owner_id != owner:
        return None
    p.status = PUBLISHED if published else DRAFT
    p.published_at = now_utc() if published else None
    await db.commit()
    await db.refresh(p)
    return p


async def get_paper_with_questions(db: AsyncSession, owner: str, paper_id: str) -> dict | None:
    p = await db.get(ExamPaper, paper_id)
    if not p or p.owner_id != owner:
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
