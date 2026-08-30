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
    ContentPrepDraftCreateRequest,
    ContentPrepDraftSyncRequest,
    ContentPrepDraftUpdateRequest,
    ContentPrepDeleteRequest,
    ContentPrepPrincipleWriteRequest,
    ContentPrepQuestionSaveRequest,
    ContentPrepSharedContentRequest,
    LockGrant,
    SubjectFacetSchemaWriteRequest,
)
from app.schemas.teaching_content import (
    ActivityOverrideWriteRequest,
    RecallLibraryWriteRequest,
    SubjectWriteRequest,
    TaxonomyReleaseRequest,
)
from app.services import (
    content_prep_shared_service,
    content_prep_draft_service,
    content_prep_service,
    question_lock_service,
    subject_facet_service,
    teaching_content_projection_service,
    teaching_content_revision_service,
    teaching_content_service,
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

AUTHORING_CONTRACT = {"id": "pmp-authoring-contract-v1", "version": "1.0.0"}
REGISTRY_MANIFEST = {
    "id": "pmp-authoring-registries",
    "version": "1.0.0",
    "hash": "sha256:8d641db17cc2cf6ccccab5332f25fa11419f318ed7f08c9d67796402899dd030",
}
AUTHORING_POLICIES = {
    "keywordLocation": "source-isolated-derived",
    "recallBinding": "optional-existing-id-only",
    "deepRecallReveal": "click-to-reveal-all-keywords",
    "keywordCorePriority": "overlap-match-priority-only",
}


def _principle_conflict_detail(
    error: teaching_content_projection_service.PrincipleArchiveConflict,
) -> dict:
    reference_questions = {
        principle_id: error.reference_questions[principle_id]
        for principle_id in sorted(error.reference_questions)
    }
    return {
        "code": "PRINCIPLE_IN_USE",
        "referencedIds": list(reference_questions),
        "referenceCounts": {
            principle_id: len(rows)
            for principle_id, rows in reference_questions.items()
        },
        "referenceQuestions": reference_questions,
    }


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


def _raise_draft_error(error: content_prep_draft_service.ContentPrepDraftError) -> None:
    detail = {"code": error.code, "message": error.message}
    if error.current_revision is not None:
        detail["currentRevision"] = error.current_revision
    raise HTTPException(status_code=error.status_code, detail=detail) from error


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
        raise HTTPException(
            status_code=409,
            detail={
                "message": str(error),
                **_principle_conflict_detail(error),
            },
        ) from error
    if isinstance(
        error, content_prep_shared_service.PrincipleMergeValidationError
    ):
        raise HTTPException(
            status_code=422,
            detail={"code": error.code, "message": str(error)},
        ) from error
    raise HTTPException(
        status_code=422,
        detail={"code": "INVALID_SHARED_CONTENT", "message": str(error)},
    ) from error


def _raise_subject_facet_error(error: Exception) -> None:
    if isinstance(error, subject_facet_service.SubjectFacetRevisionConflict):
        raise HTTPException(
            status_code=409,
            detail={
                "code": "CONTENT_REVISION_CONFLICT",
                "message": str(error),
                "currentContentRevision": error.current_revision,
            },
        ) from error
    if isinstance(error, subject_facet_service.SubjectFacetValidationError):
        raise HTTPException(
            status_code=422,
            detail={"code": error.code, "message": str(error)},
        ) from error
    raise HTTPException(
        status_code=422,
        detail={"code": "INVALID_SUBJECT_FACET_SCHEMA", "message": str(error)},
    ) from error


def _bulk_content_revision(body: object) -> int:
    if not isinstance(body, dict):
        raise HTTPException(status_code=422, detail={"code": "INVALID_SHARED_CONTENT", "message": "请求必须是 JSON 对象"})
    value = body.get("contentRevision")
    if type(value) is not int or value < 0:
        raise HTTPException(status_code=422, detail={"code": "INVALID_CONTENT_REVISION", "message": "contentRevision 必须是非负整数"})
    return value


def _retired_catalog_mutation() -> None:
    raise HTTPException(
        status_code=410,
        detail={
            "code": "LEGACY_TEACHING_MUTATION_RETIRED",
            "message": "该教学目录写入入口已退役，请使用 shared-content API",
        },
    )


@router.post("/subjects", status_code=410, deprecated=True, responses={410: {"description": "Legacy teaching mutation retired"}})
async def create_teaching_subject(request: SubjectWriteRequest, db: DB, actor: PrepEditor):
    _retired_catalog_mutation()


@router.post("/taxonomies/{taxonomy_id}/release", status_code=410, deprecated=True, responses={410: {"description": "Legacy teaching mutation retired"}})
async def release_teaching_taxonomy(taxonomy_id: str, request: TaxonomyReleaseRequest, db: DB, actor: PrepEditor):
    _retired_catalog_mutation()


@router.put("/activity-overrides/{collection_id}/{activity_id}", status_code=410, deprecated=True, responses={410: {"description": "Legacy teaching mutation retired"}})
async def write_activity_override(collection_id: str, activity_id: str, request: ActivityOverrideWriteRequest, db: DB, actor: PrepEditor):
    _retired_catalog_mutation()



@router.put("/recall-libraries/{subject_id}")
async def write_recall_library(subject_id: str, request: RecallLibraryWriteRequest, db: DB, actor: PrepEditor):
    try:
        return await teaching_content_service.upsert_recall_library(db, subject_id=subject_id, content_revision=request.content_revision, version=request.version, nodes=request.nodes, edges=request.edges, metadata=request.metadata, actor=actor.username)
    except teaching_content_revision_service.ContentRevisionConflict as error:
        _raise_shared_error(error)
    except ValueError as error:
        raise HTTPException(status_code=422, detail={"code": "INVALID_RECALL_LIBRARY", "message": str(error)}) from error


@router.delete("/taxonomies/{taxonomy_id}", status_code=410, deprecated=True, responses={410: {"description": "Legacy teaching mutation retired"}})
async def remove_teaching_taxonomy(taxonomy_id: str, subjectId: str, contentRevision: int, db: DB, actor: PrepEditor):
    _retired_catalog_mutation()


@router.delete("/activity-overrides/{collection_id}/{activity_id}", status_code=410, deprecated=True, responses={410: {"description": "Legacy teaching mutation retired"}})
async def remove_activity_override(collection_id: str, activity_id: str, contentRevision: int, db: DB, actor: PrepEditor):
    _retired_catalog_mutation()



async def list_teaching_subjects(offset: int = 0, limit: int = 50, db: DB = None, actor: PrepEditor = None):
    if limit > 200:
        raise HTTPException(status_code=422, detail="limit must be <= 200")
    return await teaching_content_service.list_subjects(db, offset=offset, limit=limit)


@router.get("/taxonomies")
async def list_teaching_taxonomies(subjectId: str, offset: int = 0, limit: int = 50, db: DB = None, actor: PrepEditor = None):
    if limit > 200:
        raise HTTPException(status_code=422, detail="limit must be <= 200")
    return await teaching_content_service.list_taxonomies(db, subject_id=subjectId, offset=offset, limit=limit)


@router.get("/recall-libraries")
async def list_teaching_recall_libraries(subjectId: str, offset: int = 0, limit: int = 50, db: DB = None, actor: PrepEditor = None):
    if limit > 200:
        raise HTTPException(status_code=422, detail="limit must be <= 200")
    return await teaching_content_service.list_recall_libraries(db, subject_id=subjectId, offset=offset, limit=limit)


@router.get("/audits")
async def list_teaching_content_audits(entityType: str | None = None, entityId: str | None = None, offset: int = 0, limit: int = 50, db: DB = None, actor: PrepEditor = None):
    if limit > 200:
        raise HTTPException(status_code=422, detail="limit must be <= 200")
    return await teaching_content_service.list_audits(db, entity_type=entityType, entity_id=entityId, offset=offset, limit=limit)



@router.get("/build-metadata")
async def get_build_metadata(db: DB, actor: PrepEditor):
    revision = await teaching_content_revision_service.current(db)
    return {
        "serverBuild": "backend-api-v1",
        "authoringContract": AUTHORING_CONTRACT,
        "registryManifest": REGISTRY_MANIFEST,
        "policies": AUTHORING_POLICIES,
        "contentRevision": int(revision["revision"]),
    }


@router.get("/shared-content")
async def get_shared_content(subjectId: str, db: DB, actor: PrepEditor):
    try:
        return await content_prep_shared_service.read_shared_content(db, subjectId)
    except ValueError as error:
        _raise_shared_error(error)


@router.get("/drafts")
async def list_content_prep_drafts(db: DB, actor: PrepEditor):
    return {"drafts": await content_prep_draft_service.list_drafts(db)}


@router.post("/drafts", status_code=201)
async def create_content_prep_draft(
    request: ContentPrepDraftCreateRequest, db: DB, actor: PrepEditor
):
    draft = await content_prep_draft_service.create_draft(
        db, actor, title=request.title, payload=request.payload
    )
    return {"draft": content_prep_draft_service.draft_payload(draft, include_payload=True)}


@router.get("/drafts/{draft_id}")
async def get_content_prep_draft(draft_id: str, db: DB, actor: PrepEditor):
    try:
        draft = await content_prep_draft_service.get_draft(db, draft_id)
    except content_prep_draft_service.ContentPrepDraftError as error:
        _raise_draft_error(error)
    return {"draft": content_prep_draft_service.draft_payload(draft, include_payload=True)}


@router.put("/drafts/{draft_id}")
async def update_content_prep_draft(
    draft_id: str,
    request: ContentPrepDraftUpdateRequest,
    db: DB,
    actor: PrepEditor,
):
    try:
        draft = await content_prep_draft_service.update_draft(
            db,
            actor,
            draft_id,
            title=request.title,
            payload=request.payload,
            revision=request.revision,
        )
    except content_prep_draft_service.ContentPrepDraftError as error:
        _raise_draft_error(error)
    return {"draft": content_prep_draft_service.draft_payload(draft, include_payload=True)}


@router.delete("/drafts/{draft_id}")
async def delete_content_prep_draft(draft_id: str, db: DB, actor: PrepEditor):
    try:
        await content_prep_draft_service.delete_draft(db, draft_id)
    except content_prep_draft_service.ContentPrepDraftError as error:
        _raise_draft_error(error)
    return {"ok": True}


@router.post("/drafts/{draft_id}/sync")
async def sync_content_prep_draft(
    draft_id: str,
    request: ContentPrepDraftSyncRequest,
    db: DB,
    actor: PrepEditor,
):
    try:
        result = await content_prep_draft_service.sync_draft(
            db,
            actor,
            draft_id,
            revision=request.revision,
            creator_id=request.creator_id,
        )
    except content_prep_draft_service.ContentPrepDraftError as error:
        _raise_draft_error(error)
    except content_prep_service.ContentPrepOperationError as error:
        _raise_upload_error(error)
    return {"result": result.model_dump(by_alias=True)}


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
            subjects=request.subjects,
            taxonomies=request.taxonomies,
            activity_overrides=request.activity_overrides,
            activity_tags=request.activity_tags,
            activity_collections=request.activity_collections,
        )
    except (
        ValueError,
        content_prep_shared_service.ContentRevisionConflict,
        teaching_content_projection_service.PrincipleArchiveConflict,
    ) as error:
        _raise_shared_error(error)


@router.get("/subject-facets")
async def list_subject_facet_schemas(db: DB, actor: PrepEditor):
    return await subject_facet_service.list_schemas(db)


@router.put("/subject-facets")
async def upsert_subject_facet_schema(
    request: SubjectFacetSchemaWriteRequest,
    db: DB,
    actor: PrepEditor,
):
    try:
        return await subject_facet_service.upsert_schema(
            db,
            actor,
            content_revision=request.content_revision,
            schema=request.facet_schema,
        )
    except (
        ValueError,
        subject_facet_service.SubjectFacetRevisionConflict,
        subject_facet_service.SubjectFacetValidationError,
    ) as error:
        _raise_subject_facet_error(error)


@router.get("/principles")
async def list_principles(db: DB, actor: PrepEditor):
    return await content_prep_shared_service.read_principles(db)


@router.post("/principle-merges/preview")
async def preview_principle_merge(body: dict, db: DB, actor: PrepEditor):
    try:
        return await content_prep_shared_service.preview_principle_merge(
            db, body.get("bundle")
        )
    except ValueError as error:
        _raise_shared_error(error)


@router.post("/principle-merges/apply")
async def apply_principle_merge(body: dict, db: DB, actor: PrepEditor):
    try:
        return await content_prep_shared_service.apply_principle_merge(
            db,
            actor,
            content_revision=int(body.get("contentRevision", -1)),
            bundle=body.get("bundle"),
            resolutions=body.get("resolutions")
            if isinstance(body.get("resolutions"), list)
            else [],
        )
    except (
        ValueError,
        content_prep_shared_service.ContentRevisionConflict,
        teaching_content_projection_service.PrincipleArchiveConflict,
    ) as error:
        _raise_shared_error(error)


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
            content_revision=_bulk_content_revision(body),
        )
    except teaching_content_revision_service.ContentRevisionConflict as error:
        _raise_shared_error(error)
    except teaching_content_projection_service.PrincipleArchiveConflict as error:
        raise HTTPException(status_code=409, detail=_principle_conflict_detail(error)) from error
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
            content_revision=_bulk_content_revision(body),
        )
    except teaching_content_revision_service.ContentRevisionConflict as error:
        _raise_shared_error(error)
    except teaching_content_projection_service.PrincipleArchiveConflict as error:
        raise HTTPException(status_code=409, detail=_principle_conflict_detail(error)) from error
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
            content_revision=_bulk_content_revision(body),
        )
    except teaching_content_revision_service.ContentRevisionConflict as error:
        _raise_shared_error(error)
    except teaching_content_projection_service.PrincipleArchiveConflict as error:
        raise HTTPException(status_code=409, detail=_principle_conflict_detail(error)) from error
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
            content_revision=_bulk_content_revision(body),
            principle_status=body.get("principleStatus"),
            preset_status=body.get("presetStatus"),
        )
    except teaching_content_revision_service.ContentRevisionConflict as error:
        _raise_shared_error(error)
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
    # P4.5.29 差异 16：外部批次导入一律强制 qualityConfirmed=false，只有教师人工确认可为 true。
    # 教师编辑流（共享草稿同步）不走这里，保留教师已确认的状态。
    for item in request.questions:
        family = item.question.metadata.get("questionFamily")
        if isinstance(family, dict):
            family["qualityConfirmed"] = False
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
