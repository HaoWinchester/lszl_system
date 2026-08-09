"""Authenticated API for the standalone Content Prep Studio."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_permissions, require_role
from app.db.session import get_db
from app.models.question import Question
from app.models.user import User
from app.schemas.content_prep import (
    ContentPrepBatchRequest,
    ContentPrepBatchResult,
    ContentPrepQuestionSaveRequest,
    LockGrant,
)
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


def _raise_upload_error(error: content_prep_service.ContentPrepOperationError) -> None:
    raise HTTPException(
        status_code=error.status_code,
        detail=error.error_payload(),
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


@router.post("/batches", response_model=ContentPrepBatchResult)
async def upload_batch(request: ContentPrepBatchRequest, db: DB, actor: PrepEditor):
    try:
        return await content_prep_service.upload_bundle(db, actor, request)
    except content_prep_service.ContentPrepOperationError as error:
        _raise_upload_error(error)


@router.get("/batches/{batch_id}")
async def get_batch(batch_id: str, db: DB, actor: PrepEditor):
    return {"batch": await content_prep_service.get_batch(db, actor, batch_id)}


@router.put("/questions/{question_id}")
async def save_question(
    question_id: str,
    request: ContentPrepQuestionSaveRequest,
    db: DB,
    actor: PrepEditor,
):
    if request.question.id != question_id:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "QUESTION_ID_MISMATCH",
                "message": "路径题目 ID 与请求内容不一致",
            },
        )
    question = await db.get(Question, question_id)
    if question is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "QUESTION_NOT_FOUND", "message": "题目不存在"},
        )
    batch_request = ContentPrepBatchRequest(
        idempotencyKey=request.idempotency_key,
        clientInstanceId=request.client_instance_id,
        targetBankId=question.bank_id,
        creatorId=request.creator_id,
        prepVersion=request.prep_version,
        workspaceVersion=request.workspace_version,
        questions=[
            {
                "question": request.question,
                "baseRevision": request.base_revision,
                "lockToken": request.lock_token,
            }
        ],
        principles=request.principles,
        synthesisPresets=request.synthesis_presets,
        tagConfig=request.tag_config,
    )
    try:
        result = await content_prep_service.upload_bundle(db, actor, batch_request)
    except content_prep_service.ContentPrepOperationError as error:
        _raise_upload_error(error)
    return {
        "batchId": result.batch_id,
        "bankId": result.bank_id,
        "bankRevision": result.bank_revision,
        "question": result.questions[0].model_dump(by_alias=True),
    }
