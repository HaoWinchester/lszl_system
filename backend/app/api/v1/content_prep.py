"""Authenticated API for the standalone Content Prep Studio."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_permissions
from app.db.session import get_db
from app.models.user import User
from app.services import content_prep_service

router = APIRouter(prefix="/content-prep", tags=["content-prep"])
DB = Annotated[AsyncSession, Depends(get_db)]
PrepEditor = Annotated[
    User,
    Depends(
        require_permissions(
            "accessQuestionBank",
            "importData",
            "editQuestions",
        )
    ),
]


@router.post("/banks")
async def create_bank(body: dict, db: DB, actor: PrepEditor):
    try:
        bank = await content_prep_service.create_bank(db, actor, body)
    except content_prep_service.ContentPrepInputError as error:
        raise HTTPException(
            status_code=422,
            detail={"code": error.code, "message": error.message},
        ) from error
    return {"bank": content_prep_service.created_bank_payload(bank)}
