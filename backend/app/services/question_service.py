"""题库管理业务逻辑：题库/题目/试卷 CRUD、按领域配额组卷、发布。按 owner 隔离。"""

import random

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import now_utc, uid
from app.models.question import DRAFT, ExamPaper, PaperQuestion, PUBLISHED, Question, QuestionBank


def bank_to_dict(b: QuestionBank, question_count: int = 0) -> dict:
    return {
        "id": b.id,
        "name": b.name,
        "subject": b.subject,
        "description": b.description,
        "version": b.version,
        "visibility": b.visibility,
        "questionCount": question_count,
        "createdAt": b.created_at.isoformat() if b.created_at else None,
        "updatedAt": b.updated_at.isoformat() if b.updated_at else None,
    }


def question_to_dict(q: Question) -> dict:
    return {
        "id": q.id,
        "bankId": q.bank_id,
        "title": q.title,
        "type": q.type,
        "subject": q.subject,
        "difficulty": q.difficulty,
        "domain": q.domain,
        "topic": q.topic,
        "tags": q.tags or [],
        "stemParts": q.stem_parts or [],
        "options": q.options or [],
        "correctAnswer": q.correct_answer,
        "analysis": q.analysis,
        "clues": q.clues or [],
        "concepts": q.concepts or [],
        "reasoningSteps": q.reasoning_steps or [],
        "status": q.status or {},
        "createdAt": q.created_at.isoformat() if q.created_at else None,
        "updatedAt": q.updated_at.isoformat() if q.updated_at else None,
    }


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
async def list_banks(db: AsyncSession, owner: str, subject: str | None = None) -> list[dict]:
    q = select(QuestionBank).where(QuestionBank.owner_id == owner)
    if subject:
        q = q.where(QuestionBank.subject == subject)
    banks = (await db.execute(q.order_by(QuestionBank.created_at))).scalars().all()
    result = []
    for b in banks:
        cnt = int(
            (await db.execute(select(func.count()).select_from(Question).where(Question.bank_id == b.id))).scalar() or 0
        )
        result.append(bank_to_dict(b, cnt))
    return result


async def create_bank(db: AsyncSession, owner: str, data: dict) -> QuestionBank:
    b = QuestionBank(
        id=uid("b_"),
        owner_id=owner,
        name=data.get("name", "新题库"),
        subject=data.get("subject", "PMP"),
        description=data.get("description"),
    )
    db.add(b)
    await db.commit()
    await db.refresh(b)
    return b


async def update_bank(db: AsyncSession, owner: str, bank_id: str, patch: dict) -> QuestionBank | None:
    b = await db.get(QuestionBank, bank_id)
    if not b or b.owner_id != owner:
        return None
    for k in ("name", "subject", "description", "version", "visibility"):
        if k in patch:
            setattr(b, k, patch[k])
    await db.commit()
    await db.refresh(b)
    return b


async def delete_bank(db: AsyncSession, owner: str, bank_id: str) -> bool:
    b = await db.get(QuestionBank, bank_id)
    if not b or b.owner_id != owner:
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
    owner: str,
    bank_id: str,
    *,
    query: str | None = None,
    domain: str | None = None,
    difficulty: str | None = None,
    page: int = 1,
    page_size: int = 20,
):
    b = await db.get(QuestionBank, bank_id)
    if not b or b.owner_id != owner:
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


async def create_question(db: AsyncSession, owner: str, bank_id: str, data: dict) -> Question | None:
    b = await db.get(QuestionBank, bank_id)
    if not b or b.owner_id != owner:
        return None
    q = Question(
        id=uid("q_"),
        bank_id=bank_id,
        title=data.get("title", "新题目"),
        type=data.get("type", "single_choice"),
        subject=data.get("subject", b.subject),
        difficulty=data.get("difficulty"),
        domain=data.get("domain"),
        topic=data.get("topic"),
        tags=data.get("tags") or [],
        stem_parts=data.get("stemParts") or [],
        options=data.get("options") or [],
        correct_answer=data.get("correctAnswer"),
        analysis=data.get("analysis"),
        clues=data.get("clues") or [],
        concepts=data.get("concepts") or [],
        reasoning_steps=data.get("reasoningSteps") or [],
        status=data.get("status") or {},
    )
    db.add(q)
    await db.commit()
    await db.refresh(q)
    return q


async def get_question(db: AsyncSession, owner: str, question_id: str) -> Question | None:
    q = await db.get(Question, question_id)
    if not q:
        return None
    b = await db.get(QuestionBank, q.bank_id)
    if not b or b.owner_id != owner:
        return None
    return q


async def update_question(db: AsyncSession, owner: str, question_id: str, patch: dict) -> Question | None:
    q = await get_question(db, owner, question_id)
    if not q:
        return None
    field_map = {
        "title": "title", "type": "type", "difficulty": "difficulty", "domain": "domain", "topic": "topic",
        "tags": "tags", "stemParts": "stem_parts", "options": "options", "correctAnswer": "correct_answer",
        "analysis": "analysis", "clues": "clues", "concepts": "concepts", "reasoningSteps": "reasoning_steps",
        "status": "status",
    }
    for k_in, k_col in field_map.items():
        if k_in in patch:
            setattr(q, k_col, patch[k_in])
    await db.commit()
    await db.refresh(q)
    return q


async def delete_question(db: AsyncSession, owner: str, question_id: str) -> bool:
    q = await get_question(db, owner, question_id)
    if not q:
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
