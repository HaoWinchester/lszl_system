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
    question_answer_service,
    question_catalog_service,
    question_content_service,
    teaching_content_revision_service,
)
from app.services.question_cleanup_reference_service import (
    relational_question_reference_counts,
    repair_current_question_references,
)


def bank_to_dict(b: QuestionBank, question_count: int = 0) -> dict:
    return {
        "id": b.id,
        "sourceId": b.source_id,
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


def _import_source_identity(item) -> str:
    """Prefer the stable source identity retained in catalog export payloads."""
    return str(getattr(item, "source_id", None) or getattr(item, "id", "") or "").strip()


def paper_to_dict(p: ExamPaper, question_count: int = 0) -> dict:
    from app.services import paper_service

    return paper_service.serialize_paper(p, question_count=question_count)


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
    bank_id = uid("b_")
    b = QuestionBank(
        id=bank_id,
        source_id=bank_id,
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
        "content": int(fields_changed((
            "title",
            "type",
            "difficulty",
            "domain",
            "topic",
            "stemParts",
            "options",
            "correctAnswer",
            "correctOptionIds",
        ))),
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
    target.correct_answer_ids = normalized.get("correctOptionIds") or []
    target.correct_answer = (
        None
        if target.type == "multiple_choice"
        else str(normalized.get("correctAnswer") or "") or None
    )
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


def _validate_normalized_question(normalized: dict) -> None:
    issues = question_answer_service.validate_multiple_choice(normalized)
    if issues:
        raise _import_validation_error(issues[0]["message"])


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

    source_bank_ids = [_import_source_identity(item) for item in request.banks]
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
        source_bank_id = _import_source_identity(imported_bank)
        for imported_question in imported_bank.questions:
            source_question_id = _import_source_identity(imported_question)
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
                str(bank.source_id or bank.id): bank for bank in existing_banks
            }
            existing_questions = (
                await db.execute(
                    select(Question).join(QuestionBank, Question.bank_id == QuestionBank.id).where(QuestionBank.owner_id == actor_username)
                )
            ).scalars().all()
            question_sources = {
                str(question.source_id or question.id): question
                for question in existing_questions
            }
            actions: list[dict] = []
            prepared_banks: list[dict] = []
            for imported_bank in request.banks:
                source_bank_id = _import_source_identity(imported_bank)
                bank_values = _normalized_import_bank_values(imported_bank)
                existing_bank = existing_by_source.get(source_bank_id)
                normalized_questions: list[tuple[str, dict, Question | None]] = []
                has_change = existing_bank is None
                added_questions = removed_questions = modified_questions = unchanged_questions = 0
                group_counts = {key: 0 for key in ("content", "analysis", "keywords", "tags", "principles", "knowledge", "reasoning", "family")}
                existing_by_question_source = {}
                if existing_bank is not None:
                    rows = await db.execute(select(Question).where(Question.bank_id == existing_bank.id))
                    existing_by_question_source = {
                        str(item.source_id or item.id): item for item in rows.scalars().all()
                    }
                incoming_source_ids = {
                    _import_source_identity(item)
                    for item in imported_bank.questions
                }
                existing_duplicate_signatures = {
                    question_content_service.duplicate_question_signature(question_to_dict(item)): item
                    for item in existing_by_question_source.values()
                    if str(item.source_id or item.id) not in incoming_source_ids
                }
                retained_duplicate_signatures: dict[str, dict] = {}
                duplicate_questions: list[dict] = []
                deduplicated_existing_source_ids: set[str] = set()
                preserved_existing_source_ids: set[str] = set()
                candidates: list[tuple[int, str, dict, Question | None, str]] = []
                for imported_index, imported_question in enumerate(imported_bank.questions):
                    source_question_id = _import_source_identity(imported_question)
                    owner_question = question_sources.get(source_question_id)
                    if owner_question is not None and (existing_bank is None or owner_question.bank_id != existing_bank.id):
                        actions.append({"type": "conflict", "sourceBankId": source_bank_id, "sourceQuestionId": source_question_id})
                        continue
                    raw_question = imported_question.model_dump(by_alias=True)
                    raw_question.pop("sourceId", None)
                    normalized = question_content_service.normalize_question_payload(
                        {**raw_question, "id": owner_question.id if owner_question else uid("q_")},
                        subject=str(bank_values["subject"]),
                    )
                    normalized["scope"] = "internal"
                    _validate_normalized_question(normalized)
                    current = existing_by_question_source.get(source_question_id)
                    duplicate_signature = question_content_service.duplicate_question_signature(normalized)
                    candidates.append((imported_index, source_question_id, normalized, current, duplicate_signature))

                retained_questions: list[tuple[int, str, dict, Question | None]] = []
                # Existing source rows win over new rows regardless of input
                # order; otherwise the first incoming row wins.  Old content
                # for a source that is itself being replaced is deliberately
                # excluded from existing_duplicate_signatures above.
                for imported_index, source_question_id, normalized, current, duplicate_signature in sorted(
                    candidates,
                    key=lambda item: (item[3] is None, item[0]),
                ):
                    existing_match = existing_duplicate_signatures.get(duplicate_signature)
                    retained_match = retained_duplicate_signatures.get(duplicate_signature)
                    kept_source_id = ""
                    kept_question_id = ""
                    duplicate_source = ""
                    if existing_match is not None:
                        duplicate_source = "existing"
                        kept_source_id = str(existing_match.source_id or existing_match.id)
                        kept_question_id = existing_match.id
                    elif retained_match is not None:
                        duplicate_source = "existing" if retained_match["questionId"] else "batch"
                        kept_source_id = retained_match["sourceQuestionId"]
                        kept_question_id = retained_match["questionId"]
                    if duplicate_source:
                        duplicate_questions.append({
                            "sourceQuestionId": source_question_id,
                            "title": normalized["title"],
                            "source": duplicate_source,
                            "reason": "目标题库已有完全相同题目" if duplicate_source == "existing" else "本批已有完全相同题目",
                            "keptQuestionSourceId": kept_source_id,
                            "keptQuestionId": kept_question_id,
                        })
                        if kept_question_id:
                            preserved_existing_source_ids.add(kept_source_id)
                        if current is not None:
                            deduplicated_existing_source_ids.add(source_question_id)
                            has_change = True
                        continue
                    retained_duplicate_signatures[duplicate_signature] = {
                        "sourceQuestionId": source_question_id,
                        "questionId": current.id if current is not None else "",
                    }
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
                    retained_questions.append((imported_index, source_question_id, normalized, current))
                normalized_questions = [
                    (source_question_id, normalized, current)
                    for _, source_question_id, normalized, current in sorted(retained_questions)
                ]
                if existing_bank is not None:
                    removed_questions = len(
                        (
                            (set(existing_by_question_source) - incoming_source_ids)
                            | deduplicated_existing_source_ids
                        )
                        - preserved_existing_source_ids
                    )
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
                prepared_banks.append({"sourceBankId": source_bank_id, "input": imported_bank, "values": bank_values, "existing": existing_bank, "questions": normalized_questions, "duplicateQuestions": duplicate_questions})
            plan = _import_plan(actions)
            duplicate_rows = [
                {"sourceBankId": prepared["sourceBankId"], **{key:value for key,value in row.items() if key != "keptQuestionId"}}
                for prepared in prepared_banks
                for row in prepared.get("duplicateQuestions", [])
            ]
            plan["duplicateQuestions"] = duplicate_rows
            plan["duplicateQuestionCount"] = len(duplicate_rows)
            plan["duplicateExistingCount"] = sum(row["source"] == "existing" for row in duplicate_rows)
            plan["duplicateBatchCount"] = sum(row["source"] == "batch" for row in duplicate_rows)
            if plan["hasConflicts"]:
                raise _import_conflict_error("IMPORT_QUESTION_ID_CONFLICT", "导入题目 ID 与其他题库冲突，已取消。", plan)
            if plan["replace"] and not request.confirm_replace:
                raise _import_conflict_error("IMPORT_REPLACEMENT_CONFIRMATION_REQUIRED", "导入包含同一来源题库的内容更新，需要确认覆盖。", plan)
            if duplicate_rows and not request.confirm_duplicate_cleanup:
                raise _import_conflict_error("QUESTION_DUPLICATES_CONFIRMATION_REQUIRED", "检测到完全重复题目，请确认自动清除后继续导入。", plan)
            source_bank_id_map: dict[str, str] = {}
            source_question_id_map: dict[str, str] = {}
            imported_rows: list[tuple[QuestionBank, list[Question]]] = []
            content_changes: list[dict[str, str]] = []
            teacher_number_states: dict[str, dict] = {}

            def teacher_number_state(subject: str) -> dict:
                key = str(subject or "PMP")
                if key in teacher_number_states:
                    return teacher_number_states[key]
                prefix = re.sub(r"[^A-Z0-9]+", "", key.upper())[:8] or "Q"
                used = {
                    str(question.teacher_number or "").strip().upper()
                    for question in existing_questions
                    if str(question.subject or "PMP") == key and str(question.teacher_number or "").strip()
                }
                pattern = re.compile(rf"^{re.escape(prefix)}-(\d+)$", re.IGNORECASE)
                maximum = max(
                    (int(match.group(1)) for number in used if (match := pattern.match(number))),
                    default=0,
                )
                teacher_number_states[key] = {"prefix": prefix, "used": used, "maximum": maximum}
                return teacher_number_states[key]

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
                        source_question_id_map[
                            f"{source_bank_id}::{row.source_id or row.id}"
                        ] = row.id
                    for duplicate_row in prepared.get("duplicateQuestions", []):
                        kept_id = str(duplicate_row.get("keptQuestionId") or "") or source_question_id_map.get(
                            f"{source_bank_id}::{duplicate_row.get('keptQuestionSourceId') or ''}",
                            "",
                        )
                        if kept_id:
                            source_question_id_map[
                                f"{source_bank_id}::{duplicate_row.get('sourceQuestionId') or ''}"
                            ] = kept_id
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

                # Assign one stable teacher number to every retained imported
                # question; skipped duplicates never consume a number.
                number_state = teacher_number_state(str(bank.subject or "PMP"))
                prefix = number_state["prefix"]
                used_numbers = number_state["used"]

                incoming_question_sources = {
                    str(row.get("keptQuestionSourceId") or "")
                    for row in prepared.get("duplicateQuestions", [])
                    if row.get("keptQuestionSourceId")
                }
                for row in prepared.get("duplicateQuestions", []):
                    if row.get("keptQuestionId"):
                        source_question_id_map[f"{source_bank_id}::{row['sourceQuestionId']}"] = str(row["keptQuestionId"])
                for source_question_id, normalized, existing_question in prepared["questions"]:
                    incoming_question_sources.add(source_question_id)
                    requested_number = str(normalized.get("teacherNumber") or "").strip().upper()
                    current_number = str(existing_question.teacher_number or "").strip().upper() if existing_question else ""
                    if current_number:
                        requested_number = current_number
                    if not requested_number or (requested_number in used_numbers and requested_number != current_number):
                        while True:
                            number_state["maximum"] += 1
                            requested_number = f"{prefix}-{number_state['maximum']:06d}"
                            if requested_number not in used_numbers:
                                break
                    used_numbers.add(requested_number)
                    normalized["teacherNumber"] = requested_number
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
                        correct_answer_ids=normalized.get("correctOptionIds") or [],
                        correct_answer=(
                            None
                            if normalized["type"] == "multiple_choice"
                            else str(normalized.get("correctAnswer") or "") or None
                        ),
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
                # Papers in the same bundle may still refer to an incoming
                # duplicate source ID.  Point every skipped alias at the
                # retained database question so deduplication never breaks a
                # paper-question relationship.
                for duplicate_row in prepared.get("duplicateQuestions", []):
                    skipped_source_id = str(duplicate_row.get("sourceQuestionId") or "")
                    kept_question_id = str(duplicate_row.get("keptQuestionId") or "")
                    kept_source_id = str(duplicate_row.get("keptQuestionSourceId") or "")
                    resolved_question_id = kept_question_id or source_question_id_map.get(
                        f"{source_bank_id}::{kept_source_id}",
                        "",
                    )
                    if skipped_source_id and resolved_question_id:
                        source_question_id_map[
                            f"{source_bank_id}::{skipped_source_id}"
                        ] = resolved_question_id
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
    _validate_normalized_question(normalized)
    content_hash = question_content_service.canonical_question_hash(normalized)
    q = Question(
        id=question_id,
        source_id=question_id,
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
        correct_answer_ids=normalized.get("correctOptionIds") or [],
        correct_answer=(
            None
            if normalized["type"] == "multiple_choice"
            else str(normalized.get("correctAnswer") or "") or None
        ),
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


async def import_questions_into_bank(
    db: AsyncSession,
    owner: User | str,
    bank_id: str,
    items: list[dict],
    *,
    confirm_duplicate_cleanup: bool,
) -> dict:
    """Atomically de-duplicate and number a question batch for one bank."""

    actor = await _resolve_actor(db, owner)
    if actor is None:
        raise ValueError("用户不存在")
    await teaching_content_revision_service.acquire_lock(db)
    bank = await question_access_service.require_bank_access(db, actor, bank_id, edit=True)
    existing = list(
        (
            await db.execute(
                select(Question).where(Question.bank_id == bank.id).order_by(Question.created_at, Question.id)
            )
        ).scalars().all()
    )
    known_signatures = {
        question_content_service.duplicate_question_signature(question_to_dict(question))
        for question in existing
    }
    batch_signatures: set[str] = set()
    prepared: list[dict] = []
    duplicates: list[dict] = []
    for index, raw in enumerate(items):
        question_id = uid("q_")
        normalized = question_content_service.normalize_question_payload(
            {**raw, "id": question_id, "title": raw.get("title") or f"导入题目 {index + 1}"},
            subject=bank.subject,
        )
        _validate_normalized_question(normalized)
        signature = question_content_service.duplicate_question_signature(normalized)
        source = "existing" if signature in known_signatures else "batch" if signature in batch_signatures else ""
        if source:
            duplicates.append(
                {
                    "index": index + 1,
                    "title": normalized["title"],
                    "source": source,
                    "reason": "目标题库已有完全相同题目" if source == "existing" else "本批已有完全相同题目",
                }
            )
            continue
        batch_signatures.add(signature)
        prepared.append(normalized)

    duplicate_plan = {
        "existingCount": sum(item["source"] == "existing" for item in duplicates),
        "batchCount": sum(item["source"] == "batch" for item in duplicates),
        "duplicateCount": len(duplicates),
        "inputCount": len(items),
        "keepCount": len(prepared),
        "duplicates": duplicates,
    }
    if duplicates and not confirm_duplicate_cleanup:
        raise _import_conflict_error(
            "QUESTION_DUPLICATES_CONFIRMATION_REQUIRED",
            "检测到完全重复题目，请确认自动清除后继续导入。",
            duplicate_plan,
        )

    prefix = re.sub(r"[^A-Z0-9]+", "", str(bank.subject or "PMP").upper())[:8] or "Q"
    subject_questions = list(
        (
            await db.execute(
                select(Question)
                .join(QuestionBank, QuestionBank.id == Question.bank_id)
                .where(QuestionBank.owner_id == bank.owner_id, QuestionBank.subject == bank.subject)
            )
        ).scalars().all()
    )
    used_numbers = {
        str(question.teacher_number or "").strip().upper()
        for question in subject_questions
        if str(question.teacher_number or "").strip()
    }
    maximum = 0
    pattern = re.compile(rf"^{re.escape(prefix)}-(\d+)$", re.IGNORECASE)
    for value in used_numbers:
        match = pattern.match(value)
        if match:
            maximum = max(maximum, int(match.group(1)))

    created: list[Question] = []
    for normalized in prepared:
        requested_number = str(normalized.get("teacherNumber") or "").strip().upper()
        if not requested_number or requested_number in used_numbers:
            while True:
                maximum += 1
                requested_number = f"{prefix}-{maximum:06d}"
                if requested_number not in used_numbers:
                    break
        used_numbers.add(requested_number)
        normalized["teacherNumber"] = requested_number
        question = Question(
            id=normalized["id"], source_id=normalized["id"], bank_id=bank.id,
            title=normalized["title"], type=normalized["type"], subject=normalized["subject"],
            difficulty=normalized.get("difficulty"), domain=normalized.get("domain"), topic=normalized.get("topic"),
            teacher_number=requested_number, scope="internal",
            content_hash=question_content_service.canonical_question_hash(normalized),
            created_by=actor.username, updated_by=actor.username, revision=1,
            tags=normalized["tags"], stem_parts=normalized["stemParts"], options=normalized["options"],
            correct_answer_ids=normalized.get("correctOptionIds") or [],
            correct_answer=(
                None
                if normalized["type"] == "multiple_choice"
                else str(normalized.get("correctAnswer") or "") or None
            ),
            analysis=normalized.get("analysis"), clues=normalized["clues"], concepts=normalized["concepts"],
            reasoning_steps=normalized["reasoningSteps"], status=normalized["status"],
            translations=normalized["translations"], content_metadata=normalized["metadata"],
            key_path=normalized["keyPath"], lifecycle=normalized["lifecycle"],
        )
        db.add(question)
        created.append(question)
    if created:
        await teaching_content_revision_service.bump(
            db,
            actor.username,
            [{"entityType": "question", "entityId": question.id, "action": "created"} for question in created],
        )
    await db.commit()
    for question in created:
        await db.refresh(question)
    return {
        "questions": [question_to_dict(question) for question in created],
        "duplicatePlan": duplicate_plan,
    }


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
    _validate_normalized_question(normalized)
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
    q.correct_answer_ids = normalized.get("correctOptionIds") or []
    q.correct_answer = (
        None
        if q.type == "multiple_choice"
        else str(normalized.get("correctAnswer") or "") or None
    )
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
    references = await relational_question_reference_counts(db, question_id)
    if references["draftReferenceCount"] or references["releaseReferenceCount"]:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "QUESTION_REFERENCED",
                "message": "题目仍被试卷引用，不能永久删除",
                **references,
            },
        )
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
    from app.services import paper_service

    return paper_service.require_revision(value)


async def _cas_paper_mutation(
    db: AsyncSession,
    actor: User,
    paper_id: str,
    expected_revision: object,
    values: dict,
) -> str | None:
    from app.services import paper_service

    return await paper_service.cas_paper_mutation(
        db,
        actor,
        paper_id,
        expected_revision,
        values,
    )


async def list_papers(db: AsyncSession, actor: User, status: str | None = None) -> list[dict]:
    from app.services import paper_service

    return await paper_service.list_papers(db, actor, status)


async def create_paper(db: AsyncSession, actor: User, data: dict) -> ExamPaper:
    from app.schemas.paper import PaperCreateRequest
    from app.services import paper_service

    payload = await paper_service.create_paper(
        db,
        actor,
        PaperCreateRequest.model_validate(data),
    )
    paper = await db.get(ExamPaper, payload["id"])
    assert paper is not None
    await db.refresh(paper)
    return paper


async def update_paper(db: AsyncSession, actor: User, paper_id: str, patch: dict) -> ExamPaper | None:
    from app.schemas.paper import PaperUpdateRequest
    from app.services import paper_service

    payload = await paper_service.update_paper(
        db,
        actor,
        paper_id,
        PaperUpdateRequest.model_validate(patch),
    )
    if payload is None:
        return None
    paper = await db.get(ExamPaper, paper_id)
    if paper is None:
        return None
    await db.refresh(paper)
    return paper


async def delete_paper(
    db: AsyncSession,
    actor: User,
    paper_id: str,
    expected_revision: object,
    deletion_reason: str | None = None,
) -> dict | None:
    from app.services import paper_service

    return await paper_service.delete_paper(
        db,
        actor,
        paper_id,
        expected_revision,
        deletion_reason,
    )


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
    from app.services import paper_release_service

    if published:
        await paper_release_service.publish(
            db,
            actor,
            paper_id,
            expected_revision=expected_revision,
            access_level="free",
            enabled_modes=["practice_mode"],
            allowed_roles=["student", "viewer"],
            metadata={},
        )
    else:
        active_release = (
            await db.execute(
                select(paper_release_service.PaperRelease)
                .where(
                    paper_release_service.PaperRelease.paper_id == paper_id,
                    paper_release_service.PaperRelease.status == paper_release_service.ACTIVE_STATUS,
                )
                .order_by(paper_release_service.PaperRelease.version.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if active_release is None:
            _require_paper_revision(expected_revision)
            return None
        await paper_release_service.withdraw(
            db,
            actor,
            active_release.id,
            expected_revision=expected_revision,
        )
    p = await db.get(ExamPaper, paper_id)
    if p is None:
        return None
    await db.refresh(p)
    return p


async def get_paper_with_questions(db: AsyncSession, actor: User, paper_id: str) -> dict | None:
    from app.services import paper_service

    return await paper_service.get_paper(db, actor, paper_id)
