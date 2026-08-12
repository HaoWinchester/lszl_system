"""题库管理业务逻辑：题库/题目/试卷 CRUD、按领域配额组卷、发布。"""

import random
import re

from fastapi import HTTPException
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import now_utc, uid
from app.models.content_prep import QuestionEditLock, QuestionUploadBatch
from app.models.question import DRAFT, ExamPaper, PaperQuestion, PUBLISHED, Question, QuestionBank
from app.models.training import LearningEvent, RecallProgress, TrainingProgress
from app.models.user import User
from app.schemas.question_catalog import QuestionBankImportRequest
from app.services import (
    question_access_service,
    question_catalog_service,
    question_content_service,
    teaching_content_revision_service,
)
from app.services.question_cleanup_reference_service import (
    repair_current_question_references,
)


_PAPER_REVISION_PATTERN = re.compile(r"[0-9]+", re.ASCII)
_POSTGRES_INTEGER_MAX = 2_147_483_647
_MAX_MUTABLE_PAPER_REVISION = _POSTGRES_INTEGER_MAX - 1
_MAX_PAPER_REVISION_DIGITS = len(str(_POSTGRES_INTEGER_MAX))


def bank_to_dict(b: QuestionBank, question_count: int = 0) -> dict:
    return {
        "id": b.id,
        "ownerId": b.owner_id,
        "name": b.name,
        "subject": b.subject,
        "description": b.description,
        "version": b.version,
        "visibility": b.visibility,
        "revision": b.revision,
        "questionCount": question_count,
        "createdBy": b.created_by,
        "updatedBy": b.updated_by,
        "createdAt": b.created_at.isoformat() if b.created_at else None,
        "updatedAt": b.updated_at.isoformat() if b.updated_at else None,
    }


def question_to_dict(q: Question) -> dict:
    return question_catalog_service.question_to_payload(q)


def paper_to_dict(p: ExamPaper, question_count: int = 0) -> dict:
    return {
        "id": p.id,
        "ownerId": p.owner_id,
        "name": p.name,
        "subject": p.subject,
        "description": p.description,
        "totalCount": p.total_count,
        "status": p.status,
        "quotas": p.quotas or {},
        "questionCount": question_count,
        "revision": p.revision,
        "createdBy": p.created_by,
        "updatedBy": p.updated_by,
        "publishedAt": p.published_at.isoformat() if p.published_at else None,
        "createdAt": p.created_at.isoformat() if p.created_at else None,
        "updatedAt": p.updated_at.isoformat() if p.updated_at else None,
    }


# ---------- 题库 ----------
async def _resolve_actor(db: AsyncSession, actor: User | str) -> User | None:
    if isinstance(actor, User):
        return actor
    return await db.get(User, actor)


async def list_banks(db: AsyncSession, owner: User | str, subject: str | None = None) -> list[dict]:
    actor = await _resolve_actor(db, owner)
    if actor is None:
        return []
    return await question_catalog_service.list_catalog_banks(
        db,
        actor,
        mode="managed",
        subject=subject,
    )


async def create_bank(db: AsyncSession, owner: User | str, data: dict) -> QuestionBank:
    actor = await _resolve_actor(db, owner)
    if actor is None:
        raise ValueError("用户不存在")
    await teaching_content_revision_service.acquire_lock(db)
    visibility = str(data.get("visibility") or "private")
    if visibility not in {"private", "published"}:
        visibility = "private"
    b = QuestionBank(
        id=uid("b_"),
        owner_id=actor.username,
        name=data.get("name", "新题库"),
        subject=data.get("subject", "PMP"),
        description=data.get("description"),
        visibility=visibility,
        revision=1,
        created_by=actor.username,
        updated_by=actor.username,
    )
    db.add(b)
    await teaching_content_revision_service.bump(
        db,
        actor.username,
        [{"entityType": "bank", "entityId": b.id, "action": "created"}],
    )
    await db.commit()
    await db.refresh(b)
    return b


def _import_validation_error(message: str) -> HTTPException:
    return HTTPException(
        status_code=422,
        detail={"code": "IMPORT_VALIDATION_FAILED", "message": message},
    )


def _import_conflict_error(code: str, message: str, import_plan: dict) -> HTTPException:
    return HTTPException(
        status_code=409,
        detail={"code": code, "message": message, "importPlan": import_plan},
    )


def _question_change_summary(existing: Question, incoming: dict) -> dict:
    current = question_to_dict(existing)
    current_metadata = (
        current.get("metadata") if isinstance(current.get("metadata"), dict) else {}
    )
    incoming_metadata = (
        incoming.get("metadata") if isinstance(incoming.get("metadata"), dict) else {}
    )

    def fields_changed(fields: tuple[str, ...]) -> bool:
        return any(current.get(field) != incoming.get(field) for field in fields)

    def metadata_changed(fields: tuple[str, ...]) -> bool:
        return any(
            current_metadata.get(field) != incoming_metadata.get(field)
            for field in fields
        )

    # Keep the confirmation dialog human-meaningful: source imports retain a
    # broad metadata object, but only the relevant metadata paths should mark a
    # product-facing category as changed.
    changed = {
        "content": int(fields_changed(("title", "type", "difficulty", "domain", "topic", "stemParts", "options", "correctAnswer"))),
        "analysis": int(fields_changed(("analysis", "translations"))),
        "keywords": int(fields_changed(("clues", "status")) or metadata_changed(("keywordSystemV2",))),
        "tags": int(fields_changed(("tags",)) or metadata_changed(("tagPaths", "subjectFacets"))),
        "principles": int(metadata_changed(("principleIds", "stemPrincipleIds", "optionPrincipleMap"))),
        "knowledge": int(fields_changed(("concepts",)) or metadata_changed(("knowledge",))),
        "reasoning": int(fields_changed(("reasoningSteps", "keyPath"))),
        "family": int(metadata_changed(("questionFamily",))),
    }
    return changed


def _import_plan(actions: list[dict]) -> dict:
    counts = {"add": 0, "replace": 0, "skip": 0, "conflict": 0}
    summaries: list[dict] = []
    for action in actions:
        action_type = action["type"]
        counts[action_type] += 1
        if action_type == "replace":
            summaries.append(action["summary"])
    return {**counts, "hasChanges": bool(counts["add"] or counts["replace"]), "hasConflicts": bool(counts["conflict"]), "summaries": summaries}


def _normalized_import_bank_values(imported_bank: object) -> dict[str, str | None]:
    """Use one canonical bank representation for preview, skip, and write."""

    visibility = str(getattr(imported_bank, "visibility", None) or "private")
    return {
        "name": str(getattr(imported_bank, "name", None) or "").strip(),
        "subject": str(getattr(imported_bank, "subject", None) or "PMP").strip(),
        "description": getattr(imported_bank, "description", None),
        "version": str(getattr(imported_bank, "version", None) or "1.0"),
        "visibility": visibility if visibility in {"private", "published"} else "private",
    }


def _apply_normalized_question(target: Question, normalized: dict, actor_username: str) -> None:
    target.title = normalized["title"]
    target.type = normalized["type"]
    target.subject = normalized["subject"]
    target.difficulty = normalized.get("difficulty")
    target.domain = normalized.get("domain")
    target.topic = normalized.get("topic")
    target.teacher_number = normalized.get("teacherNumber")
    target.scope = "internal"
    target.tags = normalized["tags"]
    target.stem_parts = normalized["stemParts"]
    target.options = normalized["options"]
    target.correct_answer = str(normalized.get("correctAnswer") or "") or None
    target.analysis = normalized.get("analysis")
    target.clues = normalized["clues"]
    target.concepts = normalized["concepts"]
    target.reasoning_steps = normalized["reasoningSteps"]
    target.status = normalized["status"]
    target.translations = normalized["translations"]
    target.content_metadata = normalized["metadata"]
    target.key_path = normalized["keyPath"]
    target.lifecycle = normalized["lifecycle"]
    target.content_hash = question_content_service.canonical_question_hash(normalized)
    target.updated_by = actor_username


async def import_question_banks(
    db: AsyncSession,
    owner: User | str,
    request: QuestionBankImportRequest,
) -> dict:
    """Persist a normalized JSON import as one all-or-nothing content change."""

    actor = await _resolve_actor(db, owner)
    if actor is None:
        raise _import_validation_error("用户不存在")
    actor_username = str(actor.username)

    source_bank_ids = [str(item.id or "").strip() for item in request.banks]
    if any(not source_bank_id for source_bank_id in source_bank_ids):
        raise _import_validation_error("导入题库缺少源题库 ID")
    duplicate_bank_ids = {
        source_bank_id
        for source_bank_id in source_bank_ids
        if source_bank_ids.count(source_bank_id) > 1
    }
    if duplicate_bank_ids:
        raise _import_validation_error(
            f"导入题库存在重复源 ID：{sorted(duplicate_bank_ids)[0]}"
        )

    source_question_keys: list[str] = []
    source_question_owners: dict[str, str] = {}
    for imported_bank in request.banks:
        source_bank_id = str(imported_bank.id or "").strip()
        for imported_question in imported_bank.questions:
            source_question_id = str(imported_question.id or "").strip()
            if not source_question_id:
                raise _import_validation_error(
                    f"题库 {source_bank_id} 存在缺少源题目 ID 的记录"
                )
            prior_owner = source_question_owners.setdefault(
                source_question_id,
                source_bank_id,
            )
            if prior_owner != source_bank_id:
                raise _import_validation_error(
                    "导入题库之间存在重复源题目 ID："
                    f"{source_question_id}（{prior_owner}、{source_bank_id}）"
                )
            source_question_keys.append(f"{source_bank_id}::{source_question_id}")
    duplicate_question_keys = {
        source_question_key
        for source_question_key in source_question_keys
        if source_question_keys.count(source_question_key) > 1
    }
    if duplicate_question_keys:
        raise _import_validation_error(
            f"导入题库存在重复源题目 ID：{sorted(duplicate_question_keys)[0]}"
        )

    if db.in_transaction():
        await db.rollback()
    try:
        async with db.begin():
            await teaching_content_revision_service.acquire_lock(db)
            existing_banks = (
                await db.execute(
                    select(QuestionBank)
                    .where(QuestionBank.owner_id == actor_username)
                    .with_for_update()
                )
            ).scalars().all()
            existing_by_source = {
                str(bank.source_id): bank for bank in existing_banks if bank.source_id
            }
            existing_questions = (
                await db.execute(
                    select(Question).join(QuestionBank, Question.bank_id == QuestionBank.id).where(QuestionBank.owner_id == actor_username)
                )
            ).scalars().all()
            question_sources = {
                str(question.source_id): question
                for question in existing_questions
                if question.source_id
            }
            actions: list[dict] = []
            prepared_banks: list[dict] = []
            for imported_bank in request.banks:
                source_bank_id = str(imported_bank.id).strip()
                bank_values = _normalized_import_bank_values(imported_bank)
                existing_bank = existing_by_source.get(source_bank_id)
                normalized_questions: list[tuple[str, dict, Question | None]] = []
                has_change = existing_bank is None
                added_questions = removed_questions = modified_questions = unchanged_questions = 0
                group_counts = {key: 0 for key in ("content", "analysis", "keywords", "tags", "principles", "knowledge", "reasoning", "family")}
                existing_by_question_source = {}
                if existing_bank is not None:
                    rows = await db.execute(select(Question).where(Question.bank_id == existing_bank.id))
                    existing_by_question_source = {str(item.source_id): item for item in rows.scalars().all() if item.source_id}
                incoming_source_ids: set[str] = set()
                for imported_question in imported_bank.questions:
                    source_question_id = str(imported_question.id).strip()
                    incoming_source_ids.add(source_question_id)
                    owner_question = question_sources.get(source_question_id)
                    if owner_question is not None and (existing_bank is None or owner_question.bank_id != existing_bank.id):
                        actions.append({"type": "conflict", "sourceBankId": source_bank_id, "sourceQuestionId": source_question_id})
                        continue
                    raw_question = imported_question.model_dump(by_alias=True)
                    normalized = question_content_service.normalize_question_payload(
                        {**raw_question, "id": owner_question.id if owner_question else uid("q_")},
                        subject=str(bank_values["subject"]),
                    )
                    normalized["scope"] = "internal"
                    current = existing_by_question_source.get(source_question_id)
                    if current is None:
                        added_questions += 1
                        has_change = True
                    elif current.content_hash == question_content_service.canonical_question_hash(normalized):
                        unchanged_questions += 1
                    else:
                        modified_questions += 1
                        has_change = True
                        for key, value in _question_change_summary(current, normalized).items():
                            group_counts[key] += value
                    normalized_questions.append((source_question_id, normalized, current))
                if existing_bank is not None:
                    removed_questions = len(set(existing_by_question_source) - incoming_source_ids)
                    has_change = has_change or bool(removed_questions)
                if any(action["type"] == "conflict" and action["sourceBankId"] == source_bank_id for action in actions):
                    continue
                if existing_bank is None:
                    actions.append({"type": "add", "sourceBankId": source_bank_id})
                elif not has_change and all(
                    getattr(existing_bank, key) == value
                    for key, value in bank_values.items()
                ):
                    actions.append({"type": "skip", "sourceBankId": source_bank_id})
                else:
                    actions.append({"type": "replace", "sourceBankId": source_bank_id, "summary": {"bankId": source_bank_id, "bankName": str(bank_values["name"]), "addedQuestions": added_questions, "removedQuestions": removed_questions, "modifiedQuestions": modified_questions, "unchangedQuestions": unchanged_questions, "groups": group_counts}})
                prepared_banks.append({"sourceBankId": source_bank_id, "input": imported_bank, "values": bank_values, "existing": existing_bank, "questions": normalized_questions})
            plan = _import_plan(actions)
            if plan["hasConflicts"]:
                raise _import_conflict_error("IMPORT_QUESTION_ID_CONFLICT", "导入题目 ID 与其他题库冲突，已取消。", plan)
            if plan["replace"] and not request.confirm_replace:
                raise _import_conflict_error("IMPORT_REPLACEMENT_CONFIRMATION_REQUIRED", "导入包含同一来源题库的内容更新，需要确认覆盖。", plan)
            source_bank_id_map: dict[str, str] = {}
            source_question_id_map: dict[str, str] = {}
            imported_rows: list[tuple[QuestionBank, list[Question]]] = []
            content_changes: list[dict[str, str]] = []

            for prepared in prepared_banks:
                imported_bank = prepared["input"]
                source_bank_id = prepared["sourceBankId"]
                bank_values = prepared["values"]
                action = next(item for item in actions if item["sourceBankId"] == source_bank_id)
                existing_bank = prepared["existing"]
                if action["type"] == "skip":
                    source_bank_id_map[source_bank_id] = existing_bank.id
                    rows = await db.execute(select(Question).where(Question.bank_id == existing_bank.id))
                    existing_rows = list(rows.scalars().all())
                    for row in existing_rows:
                        if row.source_id:
                            source_question_id_map[f"{source_bank_id}::{row.source_id}"] = row.id
                    imported_rows.append((existing_bank, existing_rows))
                    continue
                if existing_bank is None:
                    bank = QuestionBank(id=uid("b_"), owner_id=actor_username, source_id=source_bank_id, name=bank_values["name"], subject=bank_values["subject"], description=bank_values["description"], version=bank_values["version"], visibility=bank_values["visibility"], revision=1, created_by=actor_username, updated_by=actor_username)
                    db.add(bank)
                    await db.flush()
                    content_changes.append({"entityType": "bank", "entityId": bank.id, "action": "created"})
                else:
                    bank = existing_bank
                    bank.name = bank_values["name"]; bank.subject = bank_values["subject"]; bank.description = bank_values["description"]; bank.version = bank_values["version"]; bank.visibility = bank_values["visibility"]; bank.revision += 1; bank.updated_by = actor_username
                    content_changes.append({"entityType": "bank", "entityId": bank.id, "action": "updated"})
                source_bank_id_map[source_bank_id] = bank.id
                imported_questions: list[Question] = []

                incoming_question_sources = set()
                for source_question_id, normalized, existing_question in prepared["questions"]:
                    incoming_question_sources.add(source_question_id)
                    if existing_question is None:
                        content_hash = question_content_service.canonical_question_hash(normalized)
                        question = Question(
                        id=normalized["id"], source_id=source_question_id,
                        bank_id=bank.id,
                        title=normalized["title"],
                        type=normalized["type"],
                        subject=normalized["subject"],
                        difficulty=normalized.get("difficulty"),
                        domain=normalized.get("domain"),
                        topic=normalized.get("topic"),
                        teacher_number=normalized.get("teacherNumber"),
                        scope="internal",
                        content_hash=content_hash,
                        created_by=actor_username,
                        updated_by=actor_username,
                        revision=1,
                        tags=normalized["tags"],
                        stem_parts=normalized["stemParts"],
                        options=normalized["options"],
                        correct_answer=str(normalized.get("correctAnswer") or "") or None,
                        analysis=normalized.get("analysis"),
                        clues=normalized["clues"],
                        concepts=normalized["concepts"],
                        reasoning_steps=normalized["reasoningSteps"],
                        status=normalized["status"],
                        translations=normalized["translations"],
                        content_metadata=normalized["metadata"],
                        key_path=normalized["keyPath"],
                        lifecycle=normalized["lifecycle"],
                        )
                        db.add(question)
                        content_changes.append({"entityType": "question", "entityId": question.id, "action": "created"})
                    else:
                        question = existing_question
                        _apply_normalized_question(question, normalized, actor_username)
                        question.revision += 1
                        content_changes.append({"entityType": "question", "entityId": question.id, "action": "updated"})
                    imported_questions.append(question)
                    source_question_id_map[
                        f"{source_bank_id}::{source_question_id}"
                    ] = question.id
                if existing_bank is not None:
                    stale = await db.execute(select(Question).where(Question.bank_id == bank.id, Question.source_id.is_not(None), Question.source_id.not_in(incoming_question_sources)))
                    for stale_question in stale.scalars().all():
                        # Imported source content is authoritative.  Remove only
                        # dependent progress/link records; otherwise PostgreSQL
                        # would reject a legitimate confirmed replacement while
                        # leaving the old source question visible in the bank.
                        await db.execute(
                            delete(PaperQuestion).where(
                                PaperQuestion.question_id == stale_question.id
                            )
                        )
                        await db.execute(
                            delete(TrainingProgress).where(
                                TrainingProgress.question_id == stale_question.id
                            )
                        )
                        await db.execute(
                            delete(RecallProgress).where(
                                RecallProgress.question_id == stale_question.id
                            )
                        )
                        await db.execute(
                            delete(LearningEvent).where(
                                LearningEvent.question_id == stale_question.id
                            )
                        )
                        await db.execute(
                            delete(QuestionEditLock).where(
                                QuestionEditLock.question_id == stale_question.id
                            )
                        )
                        await db.delete(stale_question)
                        content_changes.append({"entityType": "question", "entityId": stale_question.id, "action": "deleted"})
                imported_rows.append((bank, imported_questions))

            if not content_changes:
                return {"banks": [], "sourceBankIdMap": source_bank_id_map, "sourceQuestionIdMap": source_question_id_map, "contentRevision": int((await teaching_content_revision_service.current(db))["revision"]), "importPlan": plan}
            await db.flush()
            revision_state = await teaching_content_revision_service.bump(
                db,
                actor_username,
                content_changes,
            )
            # The response is built inside the transaction.  Explicitly refresh
            # server-managed timestamps so async SQLAlchemy never tries a lazy
            # load after the transaction has committed.
            for bank, questions in imported_rows:
                await db.refresh(bank)
                for question in questions:
                    await db.refresh(question)
            saved_banks = []
            for bank, questions in imported_rows:
                saved_bank = bank_to_dict(bank, question_count=len(questions))
                saved_bank["questions"] = [question_to_dict(question) for question in questions]
                saved_banks.append(saved_bank)

        return {
            "banks": saved_banks,
            "sourceBankIdMap": source_bank_id_map,
            "sourceQuestionIdMap": source_question_id_map,
            "contentRevision": int(revision_state["revision"]),
            "importPlan": plan,
        }
    except HTTPException:
        raise
    except ValueError as error:
        raise _import_validation_error(str(error)) from error


async def update_bank(db: AsyncSession, owner: User | str, bank_id: str, patch: dict) -> QuestionBank | None:
    actor = await _resolve_actor(db, owner)
    if actor is None:
        return None
    await teaching_content_revision_service.acquire_lock(db)
    try:
        b = await question_access_service.require_bank_access(db, actor, bank_id, edit=True)
    except HTTPException:
        return None
    for k in ("name", "subject", "description", "version", "visibility"):
        if k in patch:
            setattr(b, k, patch[k])
    b.revision += 1
    b.updated_by = actor.username
    await teaching_content_revision_service.bump(
        db,
        actor.username,
        [{"entityType": "bank", "entityId": b.id, "action": "updated"}],
    )
    await db.commit()
    await db.refresh(b)
    return b


async def delete_bank(db: AsyncSession, owner: User | str, bank_id: str) -> bool:
    actor = await _resolve_actor(db, owner)
    if actor is None:
        return False
    await teaching_content_revision_service.acquire_lock(db)
    try:
        b = await question_access_service.require_bank_access(db, actor, bank_id, edit=True)
    except HTTPException:
        return False
    qs = (
        await db.execute(
            select(Question).where(Question.bank_id == bank_id).order_by(Question.id)
        )
    ).scalars().all()
    question_ids = [question.id for question in qs]
    question_domains = {
        str(question_id): domain
        for question_id, domain in (
            await db.execute(select(Question.id, Question.domain))
        ).all()
    }
    repair_summary = await repair_current_question_references(
        db,
        set(question_ids),
        actor_username=actor.username,
        question_domains=question_domains,
    )
    await db.execute(
        delete(QuestionUploadBatch).where(QuestionUploadBatch.bank_id == bank_id)
    )
    for q in qs:
        await db.delete(q)
    await db.delete(b)
    await teaching_content_revision_service.bump(
        db,
        actor.username,
        [
            *[
                {"entityType": "question", "entityId": q.id, "action": "deleted"}
                for q in qs
            ],
            *[
                {"entityType": "paper", "entityId": paper_id, "action": "updated"}
                for paper_id in repair_summary["relationalPaperIds"]
            ],
            {"entityType": "bank", "entityId": b.id, "action": "deleted"},
        ],
    )
    await db.commit()
    return True


async def clear_bank_test_learning_records(
    db: AsyncSession,
    owner: User | str,
    bank_id: str,
) -> dict[str, object] | None:
    """Remove every learner record belonging to one editable test question bank."""

    actor = await _resolve_actor(db, owner)
    if actor is None:
        return None
    await teaching_content_revision_service.acquire_lock(db)
    try:
        bank = await question_access_service.require_bank_access(
            db,
            actor,
            bank_id,
            edit=True,
        )
    except HTTPException:
        return None

    question_ids = select(Question.id).where(Question.bank_id == bank.id)
    question_count = int(
        (
            await db.execute(
                select(func.count())
                .select_from(Question)
                .where(Question.bank_id == bank.id)
            )
        ).scalar_one()
    )
    training_result = await db.execute(
        delete(TrainingProgress).where(TrainingProgress.question_id.in_(question_ids))
    )
    recall_result = await db.execute(
        delete(RecallProgress).where(RecallProgress.question_id.in_(question_ids))
    )
    event_result = await db.execute(
        delete(LearningEvent).where(LearningEvent.question_id.in_(question_ids))
    )
    await db.commit()
    return {
        "questionCount": question_count,
        "cleared": {
            "trainingProgress": max(0, int(training_result.rowcount or 0)),
            "recallProgress": max(0, int(recall_result.rowcount or 0)),
            "learningEvents": max(0, int(event_result.rowcount or 0)),
        },
    }


# ---------- 题目 ----------
async def list_questions(
    db: AsyncSession,
    owner: User | str,
    bank_id: str,
    *,
    query: str | None = None,
    domain: str | None = None,
    difficulty: str | None = None,
    page: int = 1,
    page_size: int = 20,
):
    actor = await _resolve_actor(db, owner)
    if actor is None:
        return [], 0
    try:
        await question_access_service.require_bank_access(db, actor, bank_id, edit=False)
    except HTTPException:
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


async def create_question(db: AsyncSession, owner: User | str, bank_id: str, data: dict) -> Question | None:
    actor = await _resolve_actor(db, owner)
    if actor is None:
        return None
    await teaching_content_revision_service.acquire_lock(db)
    try:
        b = await question_access_service.require_bank_access(db, actor, bank_id, edit=True)
    except HTTPException:
        return None
    question_id = uid("q_")
    normalized = question_content_service.normalize_question_payload(
        {**data, "id": question_id, "title": data.get("title", "新题目")},
        subject=b.subject,
    )
    normalized["scope"] = "internal"
    content_hash = question_content_service.canonical_question_hash(normalized)
    q = Question(
        id=question_id,
        bank_id=bank_id,
        title=normalized["title"],
        type=normalized["type"],
        subject=normalized["subject"],
        difficulty=normalized.get("difficulty"),
        domain=normalized.get("domain"),
        topic=normalized.get("topic"),
        teacher_number=normalized.get("teacherNumber"),
        scope="internal",
        content_hash=content_hash,
        created_by=actor.username,
        updated_by=actor.username,
        revision=1,
        tags=normalized["tags"],
        stem_parts=normalized["stemParts"],
        options=normalized["options"],
        correct_answer=str(normalized.get("correctAnswer") or "") or None,
        analysis=normalized.get("analysis"),
        clues=normalized["clues"],
        concepts=normalized["concepts"],
        reasoning_steps=normalized["reasoningSteps"],
        status=normalized["status"],
        translations=normalized["translations"],
        content_metadata=normalized["metadata"],
        key_path=normalized["keyPath"],
        lifecycle=normalized["lifecycle"],
    )
    db.add(q)
    await teaching_content_revision_service.bump(
        db,
        actor.username,
        [{"entityType": "question", "entityId": q.id, "action": "created"}],
    )
    await db.commit()
    await db.refresh(q)
    return q


async def get_question(db: AsyncSession, owner: User | str, question_id: str) -> Question | None:
    actor = await _resolve_actor(db, owner)
    if actor is None:
        return None
    q = await db.get(Question, question_id)
    if not q:
        return None
    try:
        await question_access_service.require_bank_access(db, actor, q.bank_id, edit=False)
    except HTTPException:
        return None
    return q


async def update_question(db: AsyncSession, owner: User | str, question_id: str, patch: dict) -> Question | None:
    actor = await _resolve_actor(db, owner)
    if actor is None:
        return None
    await teaching_content_revision_service.acquire_lock(db)
    q = await db.get(Question, question_id)
    if q is None:
        return None
    try:
        await question_access_service.require_bank_access(db, actor, q.bank_id, edit=True)
    except HTTPException:
        return None
    current = question_catalog_service.question_to_payload(q)
    merged = {**current, **patch, "id": q.id}
    normalized = question_content_service.normalize_question_payload(
        merged,
        subject=q.subject or "PMP",
    )
    q.title = normalized["title"]
    q.type = normalized["type"]
    q.subject = normalized["subject"]
    q.difficulty = normalized.get("difficulty")
    q.domain = normalized.get("domain")
    q.topic = normalized.get("topic")
    q.teacher_number = normalized.get("teacherNumber")
    q.scope = normalized["scope"]
    q.tags = normalized["tags"]
    q.stem_parts = normalized["stemParts"]
    q.options = normalized["options"]
    q.correct_answer = str(normalized.get("correctAnswer") or "") or None
    q.analysis = normalized.get("analysis")
    q.clues = normalized["clues"]
    q.concepts = normalized["concepts"]
    q.reasoning_steps = normalized["reasoningSteps"]
    q.status = normalized["status"]
    q.translations = normalized["translations"]
    q.content_metadata = normalized["metadata"]
    q.key_path = normalized["keyPath"]
    q.lifecycle = normalized["lifecycle"]
    q.content_hash = question_content_service.canonical_question_hash(normalized)
    q.revision += 1
    q.updated_by = actor.username
    await teaching_content_revision_service.bump(
        db,
        actor.username,
        [{"entityType": "question", "entityId": q.id, "action": "updated"}],
    )
    await db.commit()
    await db.refresh(q)
    return q


async def delete_question(db: AsyncSession, owner: User | str, question_id: str) -> bool:
    actor = await _resolve_actor(db, owner)
    if actor is None:
        return False
    await teaching_content_revision_service.acquire_lock(db)
    q = await db.get(Question, question_id)
    if q is None:
        return False
    try:
        await question_access_service.require_bank_access(db, actor, q.bank_id, edit=True)
    except HTTPException:
        return False
    links = (await db.execute(select(PaperQuestion).where(PaperQuestion.question_id == question_id))).scalars().all()
    for l in links:
        await db.delete(l)
    await db.delete(q)
    await teaching_content_revision_service.bump(
        db,
        actor.username,
        [{"entityType": "question", "entityId": q.id, "action": "deleted"}],
    )
    await db.commit()
    return True


# ---------- 试卷 ----------
def _require_paper_revision(value: object) -> int:
    revision = 0
    if isinstance(value, bool):
        pass
    elif isinstance(value, int):
        revision = value
    elif isinstance(value, str):
        candidate = value.strip()
        if (
            0 < len(candidate) <= _MAX_PAPER_REVISION_DIGITS
            and _PAPER_REVISION_PATTERN.fullmatch(candidate) is not None
        ):
            try:
                revision = int(candidate)
            except (OverflowError, ValueError):
                revision = 0
    if not 1 <= revision <= _MAX_MUTABLE_PAPER_REVISION:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "REVISION_REQUIRED",
                "message": "修改公共试卷必须提供有效的修订号",
            },
        )
    return revision


async def _cas_paper_mutation(
    db: AsyncSession,
    actor: User,
    paper_id: str,
    expected_revision: object,
    values: dict,
) -> str | None:
    revision = _require_paper_revision(expected_revision)
    mutation_values = {
        **values,
        "revision": ExamPaper.revision + 1,
        "updated_by": actor.username,
    }
    updated_id = (
        await db.execute(
            update(ExamPaper)
            .where(
                ExamPaper.id == paper_id,
                ExamPaper.deleted_at.is_(None),
                ExamPaper.revision == revision,
            )
            .values(**mutation_values)
            .returning(ExamPaper.id)
        )
    ).scalar_one_or_none()
    if updated_id is not None:
        return updated_id

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


async def list_papers(db: AsyncSession, actor: User, status: str | None = None) -> list[dict]:
    q = select(ExamPaper).where(ExamPaper.deleted_at.is_(None))
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


async def create_paper(db: AsyncSession, actor: User, data: dict) -> ExamPaper:
    await teaching_content_revision_service.acquire_lock(db)
    p = ExamPaper(
        id=uid("p_"),
        owner_id=actor.username,
        revision=1,
        created_by=actor.username,
        updated_by=actor.username,
        name=data.get("name", "新试卷"),
        subject=data.get("subject", "PMP"),
        description=data.get("description"),
        total_count=data.get("totalCount", 0),
        quotas=data.get("quotas") or {},
    )
    db.add(p)
    await teaching_content_revision_service.bump(
        db,
        actor.username,
        [{"entityType": "paper", "entityId": p.id, "action": "created"}],
    )
    await db.commit()
    await db.refresh(p)
    return p


async def update_paper(db: AsyncSession, actor: User, paper_id: str, patch: dict) -> ExamPaper | None:
    await teaching_content_revision_service.acquire_lock(db)
    values = {
        k: patch[k]
        for k in ("name", "subject", "description", "quotas")
        if k in patch
    }
    updated_id = await _cas_paper_mutation(
        db,
        actor,
        paper_id,
        patch.get("revision"),
        values,
    )
    if updated_id is None:
        return None
    await teaching_content_revision_service.bump(
        db,
        actor.username,
        [{"entityType": "paper", "entityId": updated_id, "action": "updated"}],
    )
    await db.commit()
    p = await db.get(ExamPaper, updated_id)
    if p is None:
        return None
    await db.refresh(p)
    return p


async def delete_paper(
    db: AsyncSession,
    actor: User,
    paper_id: str,
    expected_revision: object,
    deletion_reason: str | None = None,
) -> dict | None:
    await teaching_content_revision_service.acquire_lock(db)
    revision = _require_paper_revision(expected_revision)
    current = (
        await db.execute(
            select(ExamPaper.status).where(ExamPaper.id == paper_id)
        )
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
    updated_id = await _cas_paper_mutation(
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


async def compose_paper(
    db: AsyncSession,
    actor: User,
    paper_id: str,
    bank_ids: list[str],
    quotas: dict,
    expected_revision: object,
) -> int:
    """按领域配额从管理员和教师共同维护的题库随机抽题。"""
    await teaching_content_revision_service.acquire_lock(db)
    revision = _require_paper_revision(expected_revision)
    q = select(Question).join(QuestionBank, QuestionBank.id == Question.bank_id)
    if bank_ids:
        q = q.where(Question.bank_id.in_(bank_ids))
    all_qs = (await db.execute(q)).scalars().all()

    picked: list[Question] = []
    for domain, count in (quotas or {}).items():
        pool = [x for x in all_qs if (x.domain or "其他") == domain]
        random.shuffle(pool)
        picked.extend(pool[: int(count)])

    updated_id = await _cas_paper_mutation(
        db,
        actor,
        paper_id,
        revision,
        {"total_count": len(picked), "quotas": quotas or {}},
    )
    if updated_id is None:
        return -1
    await db.execute(delete(PaperQuestion).where(PaperQuestion.paper_id == paper_id))
    await db.flush()
    for i, question in enumerate(picked):
        db.add(PaperQuestion(paper_id=paper_id, question_id=question.id, order_index=i))
    await teaching_content_revision_service.bump(
        db,
        actor.username,
        [{"entityType": "paper", "entityId": paper_id, "action": "composed"}],
    )
    await db.commit()
    return len(picked)


async def set_published(
    db: AsyncSession,
    actor: User,
    paper_id: str,
    published: bool,
    expected_revision: object,
) -> ExamPaper | None:
    await teaching_content_revision_service.acquire_lock(db)
    updated_id = await _cas_paper_mutation(
        db,
        actor,
        paper_id,
        expected_revision,
        {
            "status": PUBLISHED if published else DRAFT,
            "published_at": now_utc() if published else None,
        },
    )
    if updated_id is None:
        return None
    await teaching_content_revision_service.bump(
        db,
        actor.username,
        [
            {
                "entityType": "paper",
                "entityId": updated_id,
                "action": "published" if published else "unpublished",
            }
        ],
    )
    await db.commit()
    p = await db.get(ExamPaper, updated_id)
    if p is None:
        return None
    await db.refresh(p)
    return p


async def get_paper_with_questions(db: AsyncSession, actor: User, paper_id: str) -> dict | None:
    p = (
        await db.execute(
            select(ExamPaper).where(
                ExamPaper.id == paper_id,
                ExamPaper.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if p is None:
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
