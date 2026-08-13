"""Database-backed shared drafts for Content Prep Studio."""

from __future__ import annotations

from typing import Any

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import uid
from app.models.content_prep import ContentPrepDraft
from app.models.question import Question
from app.models.user import User
from app.schemas.content_prep import ContentPrepBatchRequest, ContentPrepBatchResult
from app.services import content_prep_service, question_lock_service


class ContentPrepDraftError(ValueError):
    def __init__(self, code: str, message: str, *, status_code: int = 422, current_revision: int | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.current_revision = current_revision


def _summary(draft: ContentPrepDraft) -> dict[str, Any]:
    return {
        "id": draft.id,
        "title": draft.title,
        "revision": draft.revision,
        "createdBy": draft.created_by,
        "updatedBy": draft.updated_by,
        "createdAt": draft.created_at.isoformat() if draft.created_at else None,
        "updatedAt": draft.updated_at.isoformat() if draft.updated_at else None,
    }


def draft_payload(draft: ContentPrepDraft, *, include_payload: bool = False) -> dict[str, Any]:
    value = _summary(draft)
    if include_payload:
        value["payload"] = draft.payload
    return value


def _clean_title(value: str) -> str:
    title = str(value or "").strip()
    if not title:
        raise ContentPrepDraftError("DRAFT_TITLE_REQUIRED", "草稿名称不能为空")
    return title[:160]


async def list_drafts(db: AsyncSession) -> list[dict[str, Any]]:
    rows = (
        await db.execute(
            select(ContentPrepDraft).order_by(
                ContentPrepDraft.updated_at.desc(), ContentPrepDraft.id.desc()
            )
        )
    ).scalars().all()
    return [draft_payload(draft) for draft in rows]


async def get_draft(db: AsyncSession, draft_id: str) -> ContentPrepDraft:
    draft = await db.get(ContentPrepDraft, draft_id)
    if draft is None:
        raise ContentPrepDraftError("DRAFT_NOT_FOUND", "共享草稿不存在", status_code=404)
    return draft


async def create_draft(
    db: AsyncSession, actor: User, *, title: str, payload: dict[str, Any]
) -> ContentPrepDraft:
    draft = ContentPrepDraft(
        id=uid("cpd_"),
        title=_clean_title(title),
        payload=payload,
        revision=1,
        created_by=actor.username,
        updated_by=actor.username,
    )
    db.add(draft)
    await db.commit()
    await db.refresh(draft)
    return draft


async def update_draft(
    db: AsyncSession,
    actor: User,
    draft_id: str,
    *,
    title: str,
    payload: dict[str, Any],
    revision: int,
) -> ContentPrepDraft:
    draft = (
        await db.execute(
            select(ContentPrepDraft)
            .where(ContentPrepDraft.id == draft_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if draft is None:
        raise ContentPrepDraftError("DRAFT_NOT_FOUND", "共享草稿不存在", status_code=404)
    if draft.revision != revision:
        raise ContentPrepDraftError(
            "DRAFT_REVISION_CONFLICT",
            "草稿已被其他管理员或教师更新，请重新打开后再保存",
            status_code=409,
            current_revision=draft.revision,
        )
    draft.title = _clean_title(title)
    draft.payload = payload
    draft.revision += 1
    draft.updated_by = actor.username
    await db.commit()
    await db.refresh(draft)
    return draft


async def delete_draft(db: AsyncSession, draft_id: str) -> None:
    draft = await get_draft(db, draft_id)
    await db.delete(draft)
    await db.commit()


def _sync_request(draft: ContentPrepDraft, creator_id: str) -> ContentPrepBatchRequest:
    workspace = draft.payload if isinstance(draft.payload, dict) else {}
    bank = workspace.get("questionBank") if isinstance(workspace.get("questionBank"), dict) else {}
    server = workspace.get("server") if isinstance(workspace.get("server"), dict) else {}
    questions = bank.get("questions") if isinstance(bank.get("questions"), list) else []
    raw_questions = [
        {
            "question": question,
            "baseRevision": question.get("serverRevision") if isinstance(question, dict) else None,
        }
        for question in questions
    ]
    try:
        return ContentPrepBatchRequest.model_validate(
            {
                "idempotencyKey": f"draft-sync:{draft.id}:r{draft.revision}",
                "clientInstanceId": str(server.get("clientInstanceId") or f"draft-{draft.id}"),
                "targetBankId": str(server.get("serverBankId") or ""),
                "creatorId": creator_id,
                "prepVersion": str(workspace.get("prepStudioVersion") or "0.4.0"),
                "workspaceVersion": str(workspace.get("prepStudioWorkspaceVersion") or "4"),
                "subjectId": str(bank.get("subject") or "PMP"),
                "questions": raw_questions,
                "knowledgeTree": workspace.get("knowledgeTree"),
                "recallLibrary": workspace.get("recallLibrary"),
                "principles": workspace.get("principles") or {},
                "synthesisPresets": workspace.get("synthesisPresets") or {},
                "tagConfig": workspace.get("tagConfig") or {},
            }
        )
    except ValidationError as error:
        raise ContentPrepDraftError(
            "DRAFT_SYNC_INVALID",
            "草稿尚未满足同步条件：" + error.errors()[0]["msg"],
        ) from error


async def _attach_fresh_question_locks(
    db: AsyncSession,
    actor: content_prep_service._ActorContext,
    request: ContentPrepBatchRequest,
    *,
    creator_id: str,
) -> list[dict[str, str]]:
    """Acquire final-sync leases for every existing question in a draft.

    A shared draft can be saved, closed, and reopened after the browser's
    five-minute edit lease has expired.  The final sync therefore obtains a
    fresh lock and revision immediately before the all-or-nothing formal
    transaction.  New questions do not require a lease.
    """

    question_ids = list({item.question.id for item in request.questions})
    if not question_ids:
        return []
    existing_ids = set(
        (
            await db.execute(
                select(Question.id).where(
                    Question.id.in_(question_ids),
                    Question.bank_id == request.target_bank_id,
                )
            )
        ).scalars()
    )
    if db.in_transaction():
        await db.rollback()

    acquired: list[dict[str, str]] = []
    try:
        for item in request.questions:
            question_id = item.question.id
            if question_id not in existing_ids:
                continue
            grant = await question_lock_service.acquire_lock(
                db,
                question_id,
                actor,
                client_instance_id=request.client_instance_id,
                creator_id=creator_id,
            )
            revision = await db.scalar(
                select(Question.revision).where(Question.id == question_id)
            )
            item.lock_token = str(grant["lockToken"])
            item.base_revision = int(revision)
            acquired.append(
                {
                    "question_id": question_id,
                    "lock_token": str(grant["lockToken"]),
                }
            )
        return acquired
    except question_lock_service.QuestionLockError as error:
        for grant in acquired:
            try:
                await question_lock_service.release_lock(
                    db,
                    grant["question_id"],
                    actor,
                    client_instance_id=request.client_instance_id,
                    lock_token=grant["lock_token"],
                )
            except question_lock_service.QuestionLockError:
                pass
        raise ContentPrepDraftError(
            error.code,
            error.message,
            status_code=error.status_code,
        ) from error


async def sync_draft(
    db: AsyncSession,
    actor: User,
    draft_id: str,
    *,
    revision: int,
    creator_id: str,
) -> ContentPrepBatchResult:
    # The request dependency owns this AsyncSession.  A rollback expires ORM
    # attributes, so capture the small immutable actor context before opening
    # the transaction that performs the final formal write.
    actor_context = content_prep_service._actor_context(actor)
    if db.in_transaction():
        await db.rollback()
    draft = await get_draft(db, draft_id)
    if draft.revision != revision:
        raise ContentPrepDraftError(
            "DRAFT_REVISION_CONFLICT",
            "草稿已被其他管理员或教师更新，请重新打开后再同步",
            status_code=409,
            current_revision=draft.revision,
        )
    request = _sync_request(draft, creator_id)
    if db.in_transaction():
        await db.rollback()
    await _attach_fresh_question_locks(
        db,
        actor_context,
        request,
        creator_id=creator_id,
    )
    if db.in_transaction():
        await db.rollback()
    async with db.begin():
        draft = (
            await db.execute(
                select(ContentPrepDraft)
                .where(ContentPrepDraft.id == draft_id)
                .with_for_update()
            )
        ).scalar_one_or_none()
        if draft is None:
            raise ContentPrepDraftError("DRAFT_NOT_FOUND", "共享草稿不存在", status_code=404)
        if draft.revision != revision:
            raise ContentPrepDraftError(
                "DRAFT_REVISION_CONFLICT",
                "草稿已被其他管理员或教师更新，请重新打开后再同步",
                status_code=409,
                current_revision=draft.revision,
            )
        result = await content_prep_service.upload_bundle_in_transaction(
            db,
            actor_context,
            request,
            require_existing_locks=True,
        )
        await db.delete(draft)
    return result
