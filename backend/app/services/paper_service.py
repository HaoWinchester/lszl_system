"""Paper draft aggregate persistence."""

from __future__ import annotations

from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import uid
from app.core.security import now_utc
from app.models.paper import PaperCategory
from app.models.question import ExamPaper, PaperQuestion, Question
from app.models.user import User
from app.schemas.paper import (
    PaperCategoryCreateRequest,
    PaperCategoryUpdateRequest,
    PaperCreateRequest,
    PaperQuestionReplaceRequest,
    PaperReference,
    PaperUpdateRequest,
)
from app.services import teaching_content_revision_service


def _iso(value) -> str | None:
    return value.isoformat() if value else None


def _score(value: object) -> float:
    if isinstance(value, Decimal):
        return float(value)
    return float(value or 0)


def require_revision(value: object) -> int:
    if isinstance(value, bool):
        revision = 0
    elif isinstance(value, int):
        revision = value
    elif isinstance(value, str):
        candidate = value.strip()
        revision = (
            int(candidate)
            if candidate.isascii()
            and candidate.isdigit()
            and len(candidate) <= 10
            else 0
        )
    else:
        revision = 0
    if not 1 <= revision < 2_147_483_647:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "REVISION_REQUIRED",
                "message": "修改公共试卷必须提供有效的修订号",
            },
        )
    return revision


async def cas_paper_mutation(
    db: AsyncSession,
    actor: User,
    paper_id: str,
    expected_revision: object,
    values: dict,
) -> str | None:
    revision = require_revision(expected_revision)
    updated_id = (
        await db.execute(
            update(ExamPaper)
            .where(
                ExamPaper.id == paper_id,
                ExamPaper.deleted_at.is_(None),
                ExamPaper.revision == revision,
            )
            .values(
                **values,
                revision=ExamPaper.revision + 1,
                updated_by=actor.username,
            )
            .returning(ExamPaper.id)
        )
    ).scalar_one_or_none()
    if updated_id is not None:
        return str(updated_id)
    current = (
        await db.execute(
            select(ExamPaper.revision, ExamPaper.deleted_at).where(
                ExamPaper.id == paper_id
            )
        )
    ).first()
    if current is None:
        return None
    raise HTTPException(
        status_code=409,
        detail={
            "code": "REVISION_CONFLICT",
            "message": "试卷已被其他用户更新，请刷新后重试",
            "currentRevision": current.revision,
            "deleted": current.deleted_at is not None,
        },
    )


def serialize_paper(
    paper: ExamPaper,
    *,
    question_count: int = 0,
    questions: list[dict] | None = None,
) -> dict:
    payload = {
        "id": paper.id,
        "ownerId": paper.owner_id,
        "name": paper.name,
        "subject": paper.subject,
        "description": paper.description,
        "categoryId": paper.category_id,
        "totalCount": paper.total_count,
        "questionCount": question_count,
        "status": paper.status,
        "quotas": paper.quotas or {},
        "accessPolicy": paper.access_policy or {},
        "enabledModes": paper.enabled_modes or [],
        "modeConfigVersion": paper.mode_config_version,
        "purpose": paper.purpose,
        "revision": paper.revision,
        "createdBy": paper.created_by,
        "updatedBy": paper.updated_by,
        "publishedAt": _iso(paper.published_at),
        "archivedAt": _iso(paper.archived_at),
        "restoredAt": _iso(paper.restored_at),
        "withdrawnAt": _iso(paper.withdrawn_at),
        "publishedReleaseId": paper.published_release_id,
        "publishedVersion": paper.published_version,
        "generationBatchId": paper.generation_batch_id,
        "variantCode": paper.variant_code,
        "generationConfig": paper.generation_config or {},
        "importMetadata": paper.import_metadata or {},
        "createdAt": _iso(paper.created_at),
        "updatedAt": _iso(paper.updated_at),
    }
    if questions is not None:
        payload["questions"] = questions
    return payload


async def sync_published_projection(
    db: AsyncSession,
    *,
    paper_id: str,
    release_id: str,
    version: int,
    published_at,
    updated_by: str,
) -> bool:
    """Keep the editable paper aggregate aligned with its active release."""
    paper = (
        await db.execute(
            select(ExamPaper)
            .where(ExamPaper.id == paper_id, ExamPaper.deleted_at.is_(None))
            .with_for_update()
        )
    ).scalar_one_or_none()
    if paper is None:
        return False
    if (
        paper.status == "published"
        and paper.published_release_id == release_id
        and paper.published_version == version
        and paper.published_at == published_at
        and paper.withdrawn_at is None
    ):
        return False
    paper.status = "published"
    paper.published_release_id = release_id
    paper.published_version = version
    paper.published_at = published_at
    paper.withdrawn_at = None
    paper.revision += 1
    paper.updated_by = updated_by
    await db.flush()
    return True


async def validate_references(
    db: AsyncSession,
    references: list[PaperReference],
) -> list[tuple[PaperReference, Question]]:
    if not references:
        return []
    question_ids = [item.question_id for item in references]
    rows = (
        await db.execute(select(Question).where(Question.id.in_(question_ids)))
    ).scalars().all()
    by_id = {item.id: item for item in rows}
    validated: list[tuple[PaperReference, Question]] = []
    issues: list[dict] = []
    for reference in references:
        question = by_id.get(reference.question_id)
        if question is None:
            issues.append(
                {
                    "code": "QUESTION_NOT_FOUND",
                    "bankId": reference.bank_id,
                    "questionId": reference.question_id,
                    "order": reference.order,
                }
            )
            continue
        if question.bank_id != reference.bank_id:
            issues.append(
                {
                    "code": "QUESTION_BANK_MISMATCH",
                    "bankId": reference.bank_id,
                    "actualBankId": question.bank_id,
                    "questionId": reference.question_id,
                    "order": reference.order,
                }
            )
            continue
        lifecycle = question.lifecycle if isinstance(question.lifecycle, dict) else {}
        if str(lifecycle.get("status") or "").lower() == "deleted":
            issues.append(
                {
                    "code": "QUESTION_DELETED",
                    "bankId": reference.bank_id,
                    "questionId": reference.question_id,
                    "order": reference.order,
                }
            )
            continue
        validated.append((reference, question))
    if issues:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "PAPER_REFERENCE_INVALID",
                "message": "试卷包含无效题目引用",
                "issues": issues,
            },
        )
    return validated


async def _reference_payloads(db: AsyncSession, paper_id: str) -> list[dict]:
    rows = (
        await db.execute(
            select(Question, PaperQuestion)
            .join(PaperQuestion, PaperQuestion.question_id == Question.id)
            .where(PaperQuestion.paper_id == paper_id)
            .order_by(PaperQuestion.order_index)
        )
    ).all()
    return [
        {
            "bankId": question.bank_id,
            "questionId": link.question_id,
            "order": link.order_index + 1,
            "score": _score(link.score),
            "summary": {
                "title": question.title,
                "domain": question.domain,
                "topic": question.topic,
                "difficulty": question.difficulty,
                "tags": question.tags or [],
            },
        }
        for question, link in rows
    ]


async def create_paper(
    db: AsyncSession,
    actor: User,
    request: PaperCreateRequest,
) -> dict:
    await teaching_content_revision_service.acquire_lock(db)
    validated = await validate_references(db, request.questions)
    paper = ExamPaper(
        id=uid("p_"),
        owner_id=actor.username,
        revision=1,
        created_by=actor.username,
        updated_by=actor.username,
        name=request.name,
        subject=request.subject,
        description=request.description,
        category_id=request.category_id or None,
        total_count=(
            request.total_count
            if request.total_count is not None
            else len(request.questions)
        ),
        quotas=request.quotas,
        access_policy=request.access_policy,
        enabled_modes=request.enabled_modes,
        mode_config_version=request.mode_config_version,
        purpose=request.purpose,
    )
    db.add(paper)
    await db.flush()
    for reference, question in validated:
        db.add(
            PaperQuestion(
                paper_id=paper.id,
                question_id=question.id,
                order_index=reference.order - 1,
                score=reference.score,
            )
        )
    await teaching_content_revision_service.bump(
        db,
        actor.username,
        [{"entityType": "paper", "entityId": paper.id, "action": "created"}],
    )
    await db.commit()
    await db.refresh(paper)
    questions = await _reference_payloads(db, paper.id)
    return serialize_paper(
        paper,
        question_count=len(questions),
        questions=questions,
    )


async def _require_category(db: AsyncSession, category_id: str | None) -> None:
    if not category_id:
        return
    category = await db.get(PaperCategory, category_id)
    if category is None or category.archived_at is not None:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "PAPER_CATEGORY_INVALID",
                "message": "试卷分类不存在或已归档",
            },
        )


async def update_paper(
    db: AsyncSession,
    actor: User,
    paper_id: str,
    request: PaperUpdateRequest,
) -> dict | None:
    await teaching_content_revision_service.acquire_lock(db)
    fields = request.model_dump(exclude_unset=True)
    fields.pop("revision", None)
    mapping = {
        "category_id": "category_id",
        "total_count": "total_count",
        "access_policy": "access_policy",
        "enabled_modes": "enabled_modes",
        "mode_config_version": "mode_config_version",
    }
    values: dict = {}
    for key, value in fields.items():
        values[mapping.get(key, key)] = value
    if "category_id" in values:
        await _require_category(db, values["category_id"])
    if "total_count" in values:
        reference_count = int(
            (
                await db.execute(
                    select(func.count())
                    .select_from(PaperQuestion)
                    .where(PaperQuestion.paper_id == paper_id)
                )
            ).scalar_one()
        )
        if int(values["total_count"]) < reference_count:
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "TOTAL_COUNT_TOO_SMALL",
                    "message": "目标题量不能小于已选题目数量",
                },
            )
    updated_id = await cas_paper_mutation(
        db,
        actor,
        paper_id,
        request.revision,
        values,
    )
    if updated_id is None:
        return None
    await teaching_content_revision_service.bump(
        db,
        actor.username,
        [{"entityType": "paper", "entityId": paper_id, "action": "updated"}],
    )
    await db.commit()
    return await get_paper(db, actor, paper_id)


async def replace_questions(
    db: AsyncSession,
    actor: User,
    paper_id: str,
    request: PaperQuestionReplaceRequest,
) -> dict | None:
    await teaching_content_revision_service.acquire_lock(db)
    validated = await validate_references(db, request.questions)
    current_total = (
        await db.execute(
            select(ExamPaper.total_count).where(
                ExamPaper.id == paper_id,
                ExamPaper.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if current_total is None:
        return None
    updated_id = await cas_paper_mutation(
        db,
        actor,
        paper_id,
        request.revision,
        {"total_count": max(int(current_total or 0), len(request.questions))},
    )
    if updated_id is None:
        return None
    await db.execute(delete(PaperQuestion).where(PaperQuestion.paper_id == paper_id))
    await db.flush()
    for reference, question in validated:
        db.add(
            PaperQuestion(
                paper_id=paper_id,
                question_id=question.id,
                order_index=reference.order - 1,
                score=reference.score,
            )
        )
    await teaching_content_revision_service.bump(
        db,
        actor.username,
        [{"entityType": "paper", "entityId": paper_id, "action": "questions_replaced"}],
    )
    await db.commit()
    return await get_paper(db, actor, paper_id)


async def list_papers(
    db: AsyncSession,
    actor: User,
    status: str | None = None,
) -> list[dict]:
    query = select(ExamPaper).where(ExamPaper.deleted_at.is_(None))
    if status:
        query = query.where(ExamPaper.status == status)
    rows = (await db.execute(query.order_by(ExamPaper.updated_at.desc()))).scalars().all()
    result: list[dict] = []
    for paper in rows:
        count = int(
            (
                await db.execute(
                    select(func.count())
                    .select_from(PaperQuestion)
                    .where(PaperQuestion.paper_id == paper.id)
                )
            ).scalar_one()
        )
        result.append(serialize_paper(paper, question_count=count))
    return result


async def get_paper(db: AsyncSession, actor: User, paper_id: str) -> dict | None:
    paper = (
        await db.execute(
            select(ExamPaper).where(
                ExamPaper.id == paper_id,
                ExamPaper.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if paper is None:
        return None
    questions = await _reference_payloads(db, paper.id)
    return serialize_paper(
        paper,
        question_count=len(questions),
        questions=questions,
    )


async def delete_paper(
    db: AsyncSession,
    actor: User,
    paper_id: str,
    expected_revision: object,
    deletion_reason: str | None = None,
) -> dict | None:
    await teaching_content_revision_service.acquire_lock(db)
    revision = require_revision(expected_revision)
    current = (
        await db.execute(select(ExamPaper.status).where(ExamPaper.id == paper_id))
    ).scalar_one_or_none()
    if current is None:
        return None
    reference_count = int(
        (
            await db.execute(
                select(func.count())
                .select_from(PaperQuestion)
                .where(PaperQuestion.paper_id == paper_id)
            )
        ).scalar_one()
    )
    deleted_at = now_utc()
    reason = str(deletion_reason or "").strip() or "未提供删除原因"
    updated_id = await cas_paper_mutation(
        db,
        actor,
        paper_id,
        revision,
        {
            "status": "deleted",
            "deleted_by": actor.username,
            "deleted_at": deleted_at,
            "deletion_reason": reason,
        },
    )
    if updated_id is None:
        return None
    await teaching_content_revision_service.bump(
        db,
        actor.username,
        [{"entityType": "paper", "entityId": updated_id, "action": "deleted"}],
    )
    await db.commit()
    return {
        "paperId": updated_id,
        "revision": revision + 1,
        "deletedBy": actor.username,
        "deletedAt": deleted_at.isoformat(),
        "reason": reason,
        "previousStatus": current,
        "references": {"paperQuestions": reference_count},
    }


async def set_archived(
    db: AsyncSession,
    actor: User,
    paper_id: str,
    archived: bool,
    expected_revision: object,
) -> dict | None:
    await teaching_content_revision_service.acquire_lock(db)
    current = (
        await db.execute(
            select(ExamPaper.status).where(
                ExamPaper.id == paper_id,
                ExamPaper.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if current is None:
        return None
    if archived and current == "published":
        raise HTTPException(
            status_code=409,
            detail={
                "code": "PAPER_MUST_BE_WITHDRAWN",
                "message": "已发布试卷必须先取消发布再归档",
            },
        )
    expected_status = "archived" if not archived else None
    if expected_status is not None and current != expected_status:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "PAPER_NOT_ARCHIVED",
                "message": "只有已归档试卷可以恢复",
            },
        )
    changed_at = now_utc()
    values = (
        {
            "status": "archived",
            "archived_at": changed_at,
            "restored_at": None,
            "published_release_id": None,
        }
        if archived
        else {
            "status": "draft",
            "archived_at": None,
            "restored_at": changed_at,
            "withdrawn_at": None,
            "published_release_id": None,
        }
    )
    updated_id = await cas_paper_mutation(
        db,
        actor,
        paper_id,
        expected_revision,
        values,
    )
    if updated_id is None:
        return None
    action = "archived" if archived else "restored"
    await teaching_content_revision_service.bump(
        db,
        actor.username,
        [{"entityType": "paper", "entityId": paper_id, "action": action}],
    )
    await db.commit()
    return await get_paper(db, actor, paper_id)


def serialize_category(category: PaperCategory) -> dict:
    return {
        "id": category.id,
        "ownerId": category.owner_id,
        "name": category.name,
        "description": category.description,
        "orderIndex": category.order_index,
        "revision": category.revision,
        "archivedAt": _iso(category.archived_at),
        "createdBy": category.created_by,
        "updatedBy": category.updated_by,
        "createdAt": _iso(category.created_at),
        "updatedAt": _iso(category.updated_at),
    }


async def list_categories(db: AsyncSession, actor: User) -> list[dict]:
    rows = (
        await db.execute(
            select(PaperCategory)
            .where(PaperCategory.archived_at.is_(None))
            .order_by(PaperCategory.order_index, PaperCategory.created_at)
        )
    ).scalars().all()
    return [serialize_category(item) for item in rows]


async def create_category(
    db: AsyncSession,
    actor: User,
    request: PaperCategoryCreateRequest,
) -> dict:
    await teaching_content_revision_service.acquire_lock(db)
    category = PaperCategory(
        id=uid("pc_"),
        owner_id=actor.username,
        name=request.name,
        description=request.description,
        order_index=request.order_index,
        revision=1,
        created_by=actor.username,
        updated_by=actor.username,
    )
    db.add(category)
    await teaching_content_revision_service.bump(
        db,
        actor.username,
        [{"entityType": "paperCategory", "entityId": category.id, "action": "created"}],
    )
    await db.commit()
    await db.refresh(category)
    return serialize_category(category)


async def update_category(
    db: AsyncSession,
    actor: User,
    category_id: str,
    request: PaperCategoryUpdateRequest,
) -> dict | None:
    await teaching_content_revision_service.acquire_lock(db)
    values = request.model_dump(exclude={"revision"}, exclude_unset=True)
    updated_id = (
        await db.execute(
            update(PaperCategory)
            .where(
                PaperCategory.id == category_id,
                PaperCategory.archived_at.is_(None),
                PaperCategory.revision == request.revision,
            )
            .values(
                **values,
                revision=PaperCategory.revision + 1,
                updated_by=actor.username,
            )
            .returning(PaperCategory.id)
        )
    ).scalar_one_or_none()
    if updated_id is None:
        current = await db.get(PaperCategory, category_id)
        if current is None or current.archived_at is not None:
            return None
        raise HTTPException(
            status_code=409,
            detail={
                "code": "REVISION_CONFLICT",
                "message": "试卷分类已被其他用户更新，请刷新后重试",
                "currentRevision": current.revision,
            },
        )
    await teaching_content_revision_service.bump(
        db,
        actor.username,
        [{"entityType": "paperCategory", "entityId": category_id, "action": "updated"}],
    )
    await db.commit()
    category = await db.get(PaperCategory, category_id)
    if category is None:
        return None
    await db.refresh(category)
    return serialize_category(category)


async def delete_category(
    db: AsyncSession,
    actor: User,
    category_id: str,
    expected_revision: object,
) -> dict | None:
    await teaching_content_revision_service.acquire_lock(db)
    revision = require_revision(expected_revision)
    reference_count = int(
        (
            await db.execute(
                select(func.count())
                .select_from(ExamPaper)
                .where(
                    ExamPaper.category_id == category_id,
                    ExamPaper.deleted_at.is_(None),
                )
            )
        ).scalar_one()
    )
    if reference_count:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "PAPER_CATEGORY_IN_USE",
                "message": "该分类仍有关联试卷，请先移动试卷",
                "paperCount": reference_count,
            },
        )
    archived_at = now_utc()
    updated_id = (
        await db.execute(
            update(PaperCategory)
            .where(
                PaperCategory.id == category_id,
                PaperCategory.archived_at.is_(None),
                PaperCategory.revision == revision,
            )
            .values(
                archived_at=archived_at,
                revision=PaperCategory.revision + 1,
                updated_by=actor.username,
            )
            .returning(PaperCategory.id)
        )
    ).scalar_one_or_none()
    if updated_id is None:
        current = await db.get(PaperCategory, category_id)
        if current is None or current.archived_at is not None:
            return None
        raise HTTPException(
            status_code=409,
            detail={
                "code": "REVISION_CONFLICT",
                "message": "试卷分类已被其他用户更新，请刷新后重试",
                "currentRevision": current.revision,
            },
        )
    await teaching_content_revision_service.bump(
        db,
        actor.username,
        [{"entityType": "paperCategory", "entityId": category_id, "action": "archived"}],
    )
    await db.commit()
    return {
        "categoryId": category_id,
        "revision": revision + 1,
        "archivedAt": archived_at.isoformat(),
    }
