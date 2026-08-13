"""Server-authoritative managed and learning question catalog reads."""

from __future__ import annotations

import hashlib
import json
from typing import Literal

from fastapi import HTTPException
from sqlalchemy import case, cast, func, or_, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.content_prep import QuestionBankCollaborator
from app.models.question import ExamPaper, PaperQuestion, Question, QuestionBank
from app.models.user import User
from app.services import question_access_service


def _iso(value) -> str | None:
    return value.isoformat() if value else None


def _legacy_object_list(values, *, text_key: str) -> list[dict]:
    normalized: list[dict] = []
    for value in values or []:
        if isinstance(value, dict):
            normalized.append(value)
        elif value is not None and str(value).strip():
            normalized.append({text_key: str(value)})
    return normalized


def question_to_payload(question: Question) -> dict:
    """Serialize every canonical question field using the browser contract aliases."""

    return {
        "id": question.id,
        "sourceId": question.source_id,
        "bankId": question.bank_id,
        "title": question.title,
        "type": question.type,
        "subject": question.subject,
        "difficulty": question.difficulty,
        "domain": question.domain,
        "topic": question.topic,
        "teacherNumber": question.teacher_number,
        "scope": question.scope,
        "contentHash": question.content_hash,
        "creatorId": question.creator_id,
        "creatorName": question.creator_name,
        "revision": question.revision,
        "tags": question.tags or [],
        "stemParts": _legacy_object_list(question.stem_parts, text_key="text"),
        "options": question.options or [],
        "correctAnswer": question.correct_answer,
        "analysis": question.analysis,
        "translations": question.translations or {},
        "metadata": question.content_metadata or {},
        "keyPath": question.key_path or {},
        "clues": _legacy_object_list(question.clues, text_key="text"),
        "concepts": _legacy_object_list(question.concepts, text_key="title"),
        "reasoningSteps": _legacy_object_list(question.reasoning_steps, text_key="content"),
        "status": question.status or {},
        "lifecycle": question.lifecycle or {},
        "createdBy": question.created_by,
        "updatedBy": question.updated_by,
        "createdAt": _iso(question.created_at),
        "updatedAt": _iso(question.updated_at),
    }


def bank_to_payload(
    bank: QuestionBank,
    *,
    question_count: int,
    access_mode: str,
) -> dict:
    return {
        "id": bank.id,
        "sourceId": bank.source_id,
        "ownerId": bank.owner_id,
        "name": bank.name,
        "subject": bank.subject,
        "description": bank.description,
        "version": bank.version,
        "visibility": bank.visibility,
        "revision": bank.revision,
        "questionCount": question_count,
        "accessMode": access_mode,
        "createdBy": bank.created_by,
        "updatedBy": bank.updated_by,
        "createdAt": _iso(bank.created_at),
        "updatedAt": _iso(bank.updated_at),
    }


def _access_mode(user: User, bank: QuestionBank, collaborator_permission: str | None) -> str:
    if user.role == "admin":
        return "admin"
    if bank.owner_id == user.username:
        return "owner"
    if user.role == "teacher":
        return "teacher"
    return collaborator_permission or "none"


async def list_catalog_banks(
    db: AsyncSession,
    user: User,
    *,
    mode: Literal["writable", "managed"],
    subject: str | None = None,
) -> list[dict]:
    question_count = (
        select(func.count(Question.id))
        .where(Question.bank_id == QuestionBank.id)
        .correlate(QuestionBank)
        .scalar_subquery()
    )
    query = (
        select(QuestionBank, question_count, QuestionBankCollaborator.permission)
        .outerjoin(
            QuestionBankCollaborator,
            (QuestionBankCollaborator.bank_id == QuestionBank.id)
            & (QuestionBankCollaborator.username == user.username),
        )
    )
    if user.role not in question_access_service.TEACHING_MANAGER_ROLES:
        allowed_permissions = ["edit"] if mode == "writable" else ["view", "edit"]
        query = query.where(
            or_(
                QuestionBank.owner_id == user.username,
                QuestionBankCollaborator.permission.in_(allowed_permissions),
            )
        )
    if subject:
        query = query.where(QuestionBank.subject == subject)
    query = query.order_by(
        case((QuestionBank.visibility == "published", 1), else_=0),
        QuestionBank.updated_at.desc(),
        QuestionBank.id,
    )
    rows = (await db.execute(query)).all()
    return [
        bank_to_payload(
            bank,
            question_count=int(count or 0),
            access_mode=_access_mode(user, bank, collaborator_permission),
        )
        for bank, count, collaborator_permission in rows
    ]


async def list_bank_questions(
    db: AsyncSession,
    user: User,
    bank_id: str,
    *,
    page: int,
    page_size: int,
) -> tuple[list[dict], int]:
    await question_access_service.require_bank_access(db, user, bank_id, edit=False)
    base = select(Question).where(Question.bank_id == bank_id)
    total = int(
        (await db.execute(select(func.count()).select_from(base.subquery()))).scalar_one()
    )
    rows = (
        await db.execute(
            base.order_by(Question.created_at, Question.id)
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).scalars().all()
    return [question_to_payload(question) for question in rows], total


async def get_catalog_question(
    db: AsyncSession,
    user: User,
    question_id: str,
) -> dict:
    question = await db.get(Question, question_id)
    if question is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "QUESTION_NOT_FOUND", "message": "题目不存在"},
        )
    await question_access_service.require_bank_access(
        db,
        user,
        question.bank_id,
        edit=False,
    )
    return question_to_payload(question)


def _learning_visibility_clause():
    return (
        QuestionBank.visibility == "published",
        Question.scope == "public",
        or_(
            Question.lifecycle.is_(None),
            Question.lifecycle == cast({}, JSONB),
            Question.lifecycle["status"].astext.is_(None),
            Question.lifecycle["status"].astext == "active",
        ),
    )


async def is_learning_question_visible(db: AsyncSession, question_id: str) -> bool:
    query = (
        select(Question.id)
        .join(QuestionBank, QuestionBank.id == Question.bank_id)
        .where(Question.id == question_id, *_learning_visibility_clause())
        .limit(1)
    )
    return (await db.execute(query)).scalar_one_or_none() is not None


async def list_learning_questions(
    db: AsyncSession,
    *,
    subject: str | None = None,
    bank_id: str | None = None,
    paper_id: str | None = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[dict], int]:
    query = select(Question).join(QuestionBank, QuestionBank.id == Question.bank_id)
    order_by = [Question.created_at, Question.id]
    if paper_id:
        query = (
            query.join(PaperQuestion, PaperQuestion.question_id == Question.id)
            .join(ExamPaper, ExamPaper.id == PaperQuestion.paper_id)
            .where(PaperQuestion.paper_id == paper_id, ExamPaper.status == "published")
        )
        order_by = [PaperQuestion.order_index, Question.id]
    query = query.where(*_learning_visibility_clause())
    if subject:
        query = query.where(func.coalesce(Question.subject, QuestionBank.subject) == subject)
    if bank_id:
        query = query.where(Question.bank_id == bank_id)

    total = int(
        (await db.execute(select(func.count()).select_from(query.subquery()))).scalar_one()
    )
    rows = (
        await db.execute(
            query.order_by(*order_by)
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).scalars().all()
    return [question_to_payload(question) for question in rows], total


async def list_learning_banks(
    db: AsyncSession,
    *,
    subject: str | None = None,
) -> list[dict]:
    visible_count = (
        select(func.count(Question.id))
        .where(Question.bank_id == QuestionBank.id, *_learning_visibility_clause()[1:])
        .correlate(QuestionBank)
        .scalar_subquery()
    )
    query = select(QuestionBank, visible_count).where(QuestionBank.visibility == "published")
    if subject:
        query = query.where(QuestionBank.subject == subject)
    query = query.order_by(QuestionBank.updated_at.desc(), QuestionBank.id)
    rows = (await db.execute(query)).all()
    return [
        bank_to_payload(
            bank,
            question_count=int(count or 0),
            access_mode="learning",
        )
        for bank, count in rows
        if int(count or 0) > 0
    ]


def catalog_revision(banks: list[dict], questions: list[dict]) -> str:
    revision_input = {
        "banks": [
            {
                "id": bank["id"],
                "revision": bank.get("revision"),
                "updatedAt": bank.get("updatedAt"),
            }
            for bank in banks
        ],
        "questions": [
            {
                "id": question["id"],
                "revision": question.get("revision"),
                "contentHash": question.get("contentHash"),
                "updatedAt": question.get("updatedAt"),
            }
            for question in questions
        ],
    }
    canonical = json.dumps(
        revision_input,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
