"""Authenticated API for the standalone Content Prep Studio."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_permissions, require_role
from app.db.session import get_db
from app.models.user import User
from app.schemas.content_prep import LockGrant
from app.services import content_prep_service, question_lock_service

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
AdminUser = Annotated[User, Depends(require_role("admin"))]


def _raise_lock_error(error: question_lock_service.QuestionLockError) -> None:
    raise HTTPException(
        status_code=error.status_code,
        detail={"code": error.code, "message": error.message},
    ) from error


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


@router.post("/locks/{question_id}", response_model=LockGrant)
async def acquire_question_lock(question_id: str, body: dict, db: DB, actor: PrepEditor):
    try:
        return await question_lock_service.acquire_lock(
            db,
            question_id,
            actor,
            client_instance_id=str(body.get("clientInstanceId") or ""),
            creator_id=(str(body["creatorId"]) if body.get("creatorId") else None),
        )
    except question_lock_service.QuestionLockError as error:
        _raise_lock_error(error)


@router.put("/locks/{question_id}/heartbeat", response_model=LockGrant)
async def heartbeat_question_lock(question_id: str, body: dict, db: DB, actor: PrepEditor):
    try:
        return await question_lock_service.heartbeat_lock(
            db,
            question_id,
            actor,
            client_instance_id=str(body.get("clientInstanceId") or ""),
            lock_token=str(body.get("lockToken") or ""),
        )
    except question_lock_service.QuestionLockError as error:
        _raise_lock_error(error)


@router.delete("/locks/{question_id}")
async def release_question_lock(question_id: str, body: dict, db: DB, actor: PrepEditor):
    try:
        await question_lock_service.release_lock(
            db,
            question_id,
            actor,
            client_instance_id=str(body.get("clientInstanceId") or ""),
            lock_token=str(body.get("lockToken") or ""),
        )
    except question_lock_service.QuestionLockError as error:
        _raise_lock_error(error)
    return {"ok": True}


@router.delete("/locks/{question_id}/force")
async def force_release_question_lock(question_id: str, db: DB, actor: AdminUser):
    try:
        await question_lock_service.force_release_lock(db, question_id, actor)
    except question_lock_service.QuestionLockError as error:
        _raise_lock_error(error)
    return {"ok": True}
