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
    ContentPrepActivityImportRequest,
    ContentPrepBatchRequest,
    ContentPrepBatchResult,
    ContentPrepDeleteRequest,
    ContentPrepPrincipleWriteRequest,
    ContentPrepQuestionSaveRequest,
    ContentPrepSharedContentRequest,
    LockGrant,
)
from app.services import (
    content_prep_shared_service,
    content_prep_service,
    question_lock_service,
    teaching_content_projection_service,
)

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


def _raise_shared_error(error: Exception) -> None:
    if isinstance(error, content_prep_shared_service.ContentRevisionConflict):
        raise HTTPException(
            status_code=409,
            detail={
                "code": "CONTENT_REVISION_CONFLICT",
                "message": str(error),
                "currentContentRevision": error.current_revision,
            },
        ) from error
    if isinstance(error, teaching_content_projection_service.PrincipleArchiveConflict):
        reference_counts = dict(sorted(error.reference_counts.items()))
        raise HTTPException(
            status_code=409,
            detail={
                "code": "PRINCIPLE_IN_USE",
                "message": str(error),
                "referencedIds": list(reference_counts),
                "referenceCounts": reference_counts,
            },
        ) from error
    raise HTTPException(
        status_code=422,
        detail={"code": "INVALID_SHARED_CONTENT", "message": str(error)},
    ) from error


@router.get("/shared-content")
async def get_shared_content(subjectId: str, db: DB, actor: PrepEditor):
    try:
        return await content_prep_shared_service.read_shared_content(db, subjectId)
    except ValueError as error:
        _raise_shared_error(error)


@router.put("/shared-content")
async def save_shared_content(
    request: ContentPrepSharedContentRequest,
    db: DB,
    actor: PrepEditor,
):
    try:
        return await content_prep_shared_service.save_shared_content(
            db,
            actor,
            subject_id=request.subject_id,
            content_revision=request.content_revision,
            knowledge_tree=request.knowledge_tree,
            recall_library=request.recall_library,
            principles=request.principles,
            synthesis_presets=request.synthesis_presets,
            tag_config=request.tag_config,
        )
    except (
        ValueError,
        content_prep_shared_service.ContentRevisionConflict,
        teaching_content_projection_service.PrincipleArchiveConflict,
    ) as error:
        _raise_shared_error(error)


@router.get("/principles")
async def list_principles(db: DB, actor: PrepEditor):
    return await content_prep_shared_service.read_principles(db)


@router.post("/principles")
async def create_principle(
    request: ContentPrepPrincipleWriteRequest,
    db: DB,
    actor: PrepEditor,
):
    principle_id = str(request.principle.get("id") or "").strip()
    if not principle_id:
        raise HTTPException(
            status_code=422,
            detail={"code": "INVALID_PRINCIPLE", "message": "原则 ID 不能为空"},
        )
    try:
        return await content_prep_shared_service.upsert_principle(
            db,
            actor,
            principle_id=principle_id,
            content_revision=request.content_revision,
            principle=request.principle,
            preset=request.preset,
        )
    except (ValueError, content_prep_shared_service.ContentRevisionConflict) as error:
        _raise_shared_error(error)


@router.put("/principles/{principle_id}")
async def update_principle(
    principle_id: str,
    request: ContentPrepPrincipleWriteRequest,
    db: DB,
    actor: PrepEditor,
):
    try:
        return await content_prep_shared_service.upsert_principle(
            db,
            actor,
            principle_id=principle_id,
            content_revision=request.content_revision,
            principle=request.principle,
            preset=request.preset,
        )
    except (ValueError, content_prep_shared_service.ContentRevisionConflict) as error:
        _raise_shared_error(error)


@router.delete("/principles/{principle_id}")
async def remove_principle(
    principle_id: str,
    request: ContentPrepDeleteRequest,
    db: DB,
    actor: PrepEditor,
):
    try:
        return await content_prep_shared_service.delete_principle(
            db,
            actor,
            principle_id=principle_id,
            content_revision=request.content_revision,
        )
    except (
        ValueError,
        content_prep_shared_service.ContentRevisionConflict,
        teaching_content_projection_service.PrincipleArchiveConflict,
    ) as error:
        _raise_shared_error(error)


@router.post("/activities/import")
async def import_activities(
    request: ContentPrepActivityImportRequest,
    db: DB,
    actor: PrepEditor,
):
    try:
        return await content_prep_shared_service.import_activities(
            db,
            actor,
            content_revision=request.content_revision,
            activities=request.activities,
        )
    except (ValueError, content_prep_shared_service.ContentRevisionConflict) as error:
        _raise_shared_error(error)


@router.post("/principles/archive")
async def archive_principles(body: dict, db: DB, actor: PrepEditor):
    try:
        return await teaching_content_projection_service.archive_principles(
            db,
            actor.username,
            body.get("ids"),
        )
    except teaching_content_projection_service.PrincipleArchiveConflict as error:
        reference_counts = dict(sorted(error.reference_counts.items()))
        raise HTTPException(
            status_code=409,
            detail={
                "code": "PRINCIPLE_IN_USE",
                "referencedIds": list(reference_counts),
                "referenceCounts": reference_counts,
            },
        ) from error
    except ValueError as error:
        raise HTTPException(
            status_code=422,
            detail={"code": "INVALID_PRINCIPLE_ARCHIVE", "message": str(error)},
        ) from error


@router.post("/principles/delete")
async def delete_principles(body: dict, db: DB, actor: PrepEditor):
    try:
        return await teaching_content_projection_service.delete_principles(
            db,
            actor.username,
            body.get("ids"),
        )
    except teaching_content_projection_service.PrincipleArchiveConflict as error:
        reference_counts = dict(sorted(error.reference_counts.items()))
        raise HTTPException(
            status_code=409,
            detail={
                "code": "PRINCIPLE_IN_USE",
                "referencedIds": list(reference_counts),
                "referenceCounts": reference_counts,
            },
        ) from error
    except ValueError as error:
        raise HTTPException(
            status_code=422,
            detail={"code": "INVALID_PRINCIPLE_DELETE", "message": str(error)},
        ) from error


@router.post("/principles/import")
async def import_principle_card_bundle(body: dict, db: DB, actor: PrepEditor):
    try:
        return await teaching_content_projection_service.import_principle_card_bundle(
            db,
            actor.username,
            body,
        )
    except teaching_content_projection_service.PrincipleArchiveConflict as error:
        reference_counts = dict(sorted(error.reference_counts.items()))
        raise HTTPException(
            status_code=409,
            detail={
                "code": "PRINCIPLE_IN_USE",
                "referencedIds": list(reference_counts),
                "referenceCounts": reference_counts,
            },
        ) from error
    except ValueError as error:
        raise HTTPException(
            status_code=422,
            detail={"code": "INVALID_PRINCIPLE_BUNDLE", "message": str(error)},
        ) from error


@router.post("/principles/status")
async def update_principle_statuses(body: dict, db: DB, actor: PrepEditor):
    try:
        return await teaching_content_projection_service.update_principle_statuses(
            db,
            actor.username,
            body.get("ids"),
            principle_status=body.get("principleStatus"),
            preset_status=body.get("presetStatus"),
        )
    except ValueError as error:
        raise HTTPException(
            status_code=422,
            detail={"code": "INVALID_PRINCIPLE_STATUS", "message": str(error)},
        ) from error


@router.post("/banks")
async def create_bank(body: dict, db: DB, actor: PrepEditor):
    try:
        bank, content_revision = await content_prep_service.create_bank(
            db,
            actor,
            body,
            include_content_revision=True,
        )
    except content_prep_service.ContentPrepInputError as error:
        raise HTTPException(
            status_code=422,
            detail={"code": error.code, "message": error.message},
        ) from error
    return {
        "bank": content_prep_service.created_bank_payload(bank),
        "contentRevision": content_revision,
    }


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
    try:
        replayed = await content_prep_service.replay_single_question_save(
            db,
            actor,
            request,
        )
        if replayed is not None:
            return replayed
    except content_prep_service.ContentPrepOperationError as error:
        _raise_upload_error(error)
    question = await db.get(Question, question_id)
    if question is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "QUESTION_NOT_FOUND", "message": "题目不存在"},
        )
    if request.creator_id is None and question.creator_id is None:
        try:
            result = await content_prep_service.save_legacy_question_without_creator(
                db,
                actor,
                request,
            )
            return result
        except content_prep_service.ContentPrepOperationError as error:
            _raise_upload_error(error)
    creator_id = request.creator_id or question.creator_id
    batch_request = ContentPrepBatchRequest(
        idempotencyKey=request.idempotency_key,
        clientInstanceId=request.client_instance_id,
        targetBankId=question.bank_id,
        creatorId=creator_id,
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
        result = await content_prep_service.upload_bundle(
            db,
            actor,
            batch_request,
            require_existing_locks=True,
        )
    except content_prep_service.ContentPrepOperationError as error:
        _raise_upload_error(error)
    return {
        "batchId": result.batch_id,
        "bankId": result.bank_id,
        "bankRevision": result.bank_revision,
        "contentRevision": result.content_revision,
        "question": result.questions[0].model_dump(by_alias=True),
    }
