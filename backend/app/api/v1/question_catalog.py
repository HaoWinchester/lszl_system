"""Unified question catalog routes for managers and learning clients."""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import optional_current_user, require_permissions
from app.core.permissions import can
from app.db.session import get_db
from app.models.user import User
from app.schemas.question_catalog import (
    CatalogBankListResponse,
    CatalogBootstrapResponse,
    CatalogQuestionListResponse,
    CatalogQuestionResponse,
    TeachingContentRevisionResponse,
)
from app.services import question_catalog_service, teaching_content_revision_service

router = APIRouter(prefix="/question-catalog", tags=["question-catalog"])
DB = Annotated[AsyncSession, Depends(get_db)]
CatalogManager = Annotated[User, Depends(require_permissions("accessQuestionBank"))]


@router.get("/revision", response_model=TeachingContentRevisionResponse)
async def teaching_content_revision(db: DB, user: CatalogManager):
    return await teaching_content_revision_service.current(db)


@router.get("/banks", response_model=CatalogBankListResponse)
async def list_banks(
    db: DB,
    user: CatalogManager,
    mode: Literal["writable", "managed"] = Query("managed"),
    subject: str | None = Query(None),
):
    return {
        "banks": await question_catalog_service.list_catalog_banks(
            db,
            user,
            mode=mode,
            subject=subject,
        )
    }


@router.get("/banks/{bank_id}/questions", response_model=CatalogQuestionListResponse)
async def list_bank_questions(
    bank_id: str,
    db: DB,
    user: CatalogManager,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
):
    questions, total = await question_catalog_service.list_bank_questions(
        db,
        user,
        bank_id,
        page=page,
        page_size=page_size,
    )
    return {
        "questions": questions,
        "total": total,
        "page": page,
        "pageSize": page_size,
    }


@router.get("/questions/{question_id}", response_model=CatalogQuestionResponse)
async def get_question(question_id: str, db: DB, user: CatalogManager):
    return {
        "question": await question_catalog_service.get_catalog_question(
            db,
            user,
            question_id,
        )
    }


@router.get("/learning/questions", response_model=CatalogQuestionListResponse)
async def list_learning_questions(
    request: Request,
    db: DB,
    subject: str | None = Query(None),
    bank_id: str | None = Query(None),
    paper_id: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
):
    # Resolve the session so invalid cookies are cleared. Public catalog filters
    # apply identically to anonymous and authenticated readers.
    await optional_current_user(request, db)
    questions, total = await question_catalog_service.list_learning_questions(
        db,
        subject=subject,
        bank_id=bank_id,
        paper_id=paper_id,
        page=page,
        page_size=page_size,
    )
    return {
        "questions": questions,
        "total": total,
        "page": page,
        "pageSize": page_size,
    }


@router.get("/bootstrap", response_model=CatalogBootstrapResponse)
async def bootstrap(
    request: Request,
    db: DB,
    mode: Literal["managed", "learning"] = Query("learning"),
    subject: str | None = Query(None),
    include_questions: bool = Query(False),
    page_size: int = Query(200, ge=1, le=200),
):
    user = await optional_current_user(request, db)
    if mode == "managed":
        if user is None:
            raise HTTPException(status_code=401, detail="未登录")
        if not can(user.role, "accessQuestionBank"):
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "PERMISSION_DENIED",
                    "message": "当前账号缺少所需权限",
                    "permissions": ["accessQuestionBank"],
                },
            )
        banks = await question_catalog_service.list_catalog_banks(
            db,
            user,
            mode="managed",
            subject=subject,
        )
        questions: list[dict] = []
        if include_questions:
            async def _load_bank_questions(bank_id: str) -> list[dict]:
                page = 1
                rows: list[dict] = []
                total = 0
                while True:
                    chunk, total_count = await question_catalog_service.list_bank_questions(
                        db,
                        user,
                        bank_id,
                        page=page,
                        page_size=page_size,
                    )
                    rows.extend(chunk)
                    total = max(total, int(total_count or 0))
                    if len(rows) >= total:
                        break
                    if not chunk:
                        break
                    page += 1
                return rows

            for bank in banks:
                questions.extend(await _load_bank_questions(str(bank["id"])))
    else:
        banks = await question_catalog_service.list_learning_banks(db, subject=subject)
        questions: list[dict] = []
        if include_questions:
            page = 1
            total_questions = 0
            while True:
                chunk, total = await question_catalog_service.list_learning_questions(
                    db,
                    subject=subject,
                    page=page,
                    page_size=page_size,
                )
                questions.extend(chunk)
                total_questions = max(total_questions, int(total or 0))
                if len(questions) >= total_questions:
                    break
                if not chunk:
                    break
                page += 1
    content_revision = await teaching_content_revision_service.current(db)
    return {
        "banks": banks,
        "questions": questions,
        "catalogRevision": question_catalog_service.catalog_revision(banks, questions),
        "contentRevision": content_revision["revision"],
    }
