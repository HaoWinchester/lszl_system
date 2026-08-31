"""Validation and transactional import for ``kg-paper-package-v1``."""

from __future__ import annotations

import hashlib
import json
import re
from collections import defaultdict
from typing import Any

from fastapi import HTTPException
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import now_utc, uid
from app.models.paper import PaperCategory, PaperImportOperation
from app.models.question import ExamPaper, PaperQuestion, Question, QuestionBank
from app.models.user import User
from app.schemas.paper import PaperImportPreflightRequest, PaperImportRequest
from app.services import idempotency_service, paper_service, teaching_content_revision_service
from app.web.releases import ReleaseNotFoundError, active_release


SUPPORTED_SCHEMA = "kg-paper-package-v1"
SUPPORTED_SCHEMA_VERSION = 1
_PAPER_NUMBER = re.compile(r"模拟卷\s*0*(\d+)", re.IGNORECASE)


def payload_hash(request: PaperImportPreflightRequest) -> str:
    canonical = json.dumps(
        {"fileName": request.file_name, "package": request.package_data},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def _finding(level: str, code: str, message: str, **details: Any) -> dict:
    return {"level": level, "code": code, "message": message, **details}


def _error(status: int, code: str, message: str, **details: Any) -> HTTPException:
    return HTTPException(
        status_code=status,
        detail={"code": code, "message": message, **details},
    )


def _integer(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value


def _score(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    score = float(value)
    return score if 0 <= score <= 1_000_000 else None


async def preflight_package(
    db: AsyncSession,
    actor: User,
    request: PaperImportPreflightRequest,
) -> dict:
    del actor  # Paper management is shared; the route permission is the boundary.
    package = request.package_data
    paper = package.get("paper") if isinstance(package.get("paper"), dict) else {}
    raw_references = paper.get("questions") if isinstance(paper.get("questions"), list) else []
    source_banks = (
        package.get("sourceBanks") if isinstance(package.get("sourceBanks"), list) else []
    )
    errors: list[dict] = []
    warnings: list[dict] = []

    if package.get("schema") != SUPPORTED_SCHEMA:
        errors.append(
            _finding("error", "UNSUPPORTED_SCHEMA", "不支持的试卷包 schema")
        )
    if package.get("schemaVersion") != SUPPORTED_SCHEMA_VERSION:
        errors.append(
            _finding("error", "UNSUPPORTED_SCHEMA_VERSION", "不支持的试卷包版本")
        )
    if not paper:
        errors.append(_finding("error", "PAPER_REQUIRED", "试卷包缺少 paper 对象"))

    paper_id = str(paper.get("id") or "").strip()
    name = str(paper.get("name") or "").strip()
    subject = str(paper.get("subject") or "PMP").strip()
    total_count = _integer(paper.get("totalCount"))
    if not paper_id or len(paper_id) > 64:
        errors.append(_finding("error", "PAPER_ID_INVALID", "试卷 ID 为空或过长"))
    if not name or len(name) > 200:
        errors.append(_finding("error", "PAPER_NAME_INVALID", "试卷名称为空或过长"))
    if not subject or len(subject) > 32:
        errors.append(_finding("error", "PAPER_SUBJECT_INVALID", "试卷科目为空或过长"))

    orders: list[int] = []
    external_pairs: list[tuple[str, str]] = []
    parsed_references: list[dict] = []
    for index, raw in enumerate(raw_references):
        if not isinstance(raw, dict):
            errors.append(
                _finding(
                    "error",
                    "REFERENCE_INVALID",
                    "题目引用必须是对象",
                    index=index,
                )
            )
            continue
        bank_source_id = str(raw.get("bankId") or "").strip()
        question_source_id = str(raw.get("questionId") or "").strip()
        order = _integer(raw.get("order"))
        score = _score(raw.get("score", 1))
        if not bank_source_id or not question_source_id or order is None or order < 1:
            errors.append(
                _finding(
                    "error",
                    "REFERENCE_INVALID",
                    "题目引用缺少有效 bankId、questionId 或 order",
                    index=index,
                )
            )
            continue
        if score is None:
            errors.append(
                _finding(
                    "error",
                    "REFERENCE_SCORE_INVALID",
                    "题目分值超出允许范围",
                    index=index,
                    order=order,
                )
            )
            continue
        orders.append(order)
        external_pairs.append((bank_source_id, question_source_id))
        parsed_references.append(
            {
                "sourceBankId": bank_source_id,
                "sourceQuestionId": question_source_id,
                "order": order,
                "score": score,
            }
        )

    expected_orders = list(range(1, len(raw_references) + 1))
    if orders != expected_orders:
        errors.append(
            _finding(
                "error",
                "REFERENCE_ORDER_INVALID",
                "题目顺序必须按 JSON 原始顺序连续为 1..N",
                actual=orders,
                expected=expected_orders,
            )
        )
    if len(external_pairs) != len(set(external_pairs)):
        errors.append(
            _finding("error", "DUPLICATE_REFERENCE", "同一试卷不能重复引用题目")
        )
    if total_count is None or total_count != len(raw_references):
        errors.append(
            _finding(
                "error",
                "TOTAL_COUNT_MISMATCH",
                "totalCount 必须等于题目引用数量",
                totalCount=paper.get("totalCount"),
                questionCount=len(raw_references),
            )
        )

    filename_match = _PAPER_NUMBER.search(request.file_name)
    name_match = _PAPER_NUMBER.search(name)
    if filename_match and name_match and filename_match.group(1) != name_match.group(1):
        warnings.append(
            _finding(
                "warning",
                "FILE_NAME_MISMATCH",
                "文件名与包内试卷名称编号不一致，以包内名称为准",
                fileName=request.file_name,
                paperName=name,
            )
        )

    compatibility = package.get("programCompatibility")
    target_version = (
        str(compatibility.get("targetMainVersion") or "").strip()
        if isinstance(compatibility, dict)
        else ""
    )
    if target_version:
        try:
            current_version = active_release().version
        except ReleaseNotFoundError:
            current_version = ""
        if current_version and target_version.casefold() != current_version.casefold():
            warnings.append(
                _finding(
                    "warning",
                    "PROGRAM_VERSION_MISMATCH",
                    "试卷包目标版本与当前页面版本不同，已按 schema 合约继续预检",
                    targetVersion=target_version,
                    currentVersion=current_version,
                )
            )

    category_id = str(paper.get("categoryId") or "").strip()
    if category_id and await db.get(PaperCategory, category_id) is None:
        warnings.append(
            _finding(
                "warning",
                "CATEGORY_NOT_FOUND",
                "包内分类不存在，导入时将暂不绑定分类",
                categoryId=category_id,
            )
        )

    source_bank_ids = {item["sourceBankId"] for item in parsed_references}
    source_matches: dict[str, list[QuestionBank]] = defaultdict(list)
    if source_bank_ids:
        banks = list(
            (
                await db.execute(
                    select(QuestionBank).where(
                        QuestionBank.source_id.in_(source_bank_ids)
                    )
                )
            ).scalars().all()
        )
        for bank in banks:
            if bank.source_id:
                source_matches[bank.source_id].append(bank)
        fallback_ids = source_bank_ids - set(source_matches)
        if fallback_ids:
            for bank in (
                await db.execute(select(QuestionBank).where(QuestionBank.id.in_(fallback_ids)))
            ).scalars().all():
                source_matches[bank.id].append(bank)

    resolved_banks: dict[str, QuestionBank] = {}
    for source_bank_id in source_bank_ids:
        matches = source_matches.get(source_bank_id, [])
        if not matches:
            errors.append(
                _finding(
                    "error",
                    "BANK_NOT_FOUND",
                    "找不到题目引用的来源题库",
                    bankId=source_bank_id,
                )
            )
        elif len(matches) > 1:
            errors.append(
                _finding(
                    "error",
                    "BANK_SOURCE_AMBIGUOUS",
                    "来源题库 ID 命中多个共享题库",
                    bankId=source_bank_id,
                    matches=[item.id for item in matches],
                )
            )
        else:
            resolved_banks[source_bank_id] = matches[0]

    question_source_ids = {item["sourceQuestionId"] for item in parsed_references}
    question_rows: list[Question] = []
    if question_source_ids:
        question_rows = list(
            (
                await db.execute(
                    select(Question).where(
                        or_(
                            Question.source_id.in_(question_source_ids),
                            Question.id.in_(question_source_ids),
                        )
                    )
                )
            ).scalars().all()
        )
    by_bank_source: dict[tuple[str, str], list[Question]] = defaultdict(list)
    global_source: dict[str, list[Question]] = defaultdict(list)
    for question in question_rows:
        if question.source_id:
            by_bank_source[(question.bank_id, question.source_id)].append(question)
            global_source[question.source_id].append(question)
        by_bank_source[(question.bank_id, question.id)].append(question)
        global_source[question.id].append(question)

    resolved_references: list[dict] = []
    resolved_question_types: list[str] = []
    for reference in parsed_references:
        bank = resolved_banks.get(reference["sourceBankId"])
        if bank is None:
            continue
        matches = by_bank_source.get(
            (bank.id, reference["sourceQuestionId"]),
            [],
        )
        if not matches:
            code = (
                "QUESTION_BANK_MISMATCH"
                if global_source.get(reference["sourceQuestionId"])
                else "QUESTION_NOT_FOUND"
            )
            errors.append(
                _finding(
                    "error",
                    code,
                    "题目不存在或不属于引用的题库",
                    bankId=reference["sourceBankId"],
                    questionId=reference["sourceQuestionId"],
                    order=reference["order"],
                )
            )
            continue
        question = matches[0]
        lifecycle = question.lifecycle if isinstance(question.lifecycle, dict) else {}
        if str(lifecycle.get("status") or "").casefold() == "deleted":
            errors.append(
                _finding(
                    "error",
                    "QUESTION_DELETED",
                    "题目已被安全删除，不能导入试卷",
                    bankId=reference["sourceBankId"],
                    questionId=reference["sourceQuestionId"],
                    order=reference["order"],
                )
            )
            continue
        resolved_references.append(
            {
                "bankId": bank.id,
                "questionId": question.id,
                "order": reference["order"],
                "score": reference["score"],
                "sourceBankId": reference["sourceBankId"],
                "sourceQuestionId": reference["sourceQuestionId"],
            }
        )
        resolved_question_types.append(str(question.type or "single_choice"))

    declared_paper_type = str(paper.get("paperType") or "").strip()
    if declared_paper_type and declared_paper_type not in {
        "standard",
        "multiple_choice",
    }:
        errors.append(
            _finding("error", "PAPER_TYPE_INVALID", "试卷类型不受支持")
        )
    if declared_paper_type in {"standard", "multiple_choice"}:
        paper_type = declared_paper_type
    elif resolved_question_types and all(
        value == "multiple_choice" for value in resolved_question_types
    ):
        paper_type = "multiple_choice"
    else:
        paper_type = "standard"
    if any(
        not paper_service.question_matches_paper_type(paper_type, question_type)
        for question_type in resolved_question_types
    ):
        errors.append(
            _finding(
                "error",
                "PAPER_TYPE_QUESTION_MISMATCH",
                "试卷类型与引用题目类型不一致",
                paperType=paper_type,
            )
        )

    existing = await db.get(ExamPaper, paper_id) if paper_id else None
    conflict = None
    if existing is not None:
        conflict = {
            "paperId": existing.id,
            "status": existing.status,
            "revision": existing.revision,
            "deleted": existing.deleted_at is not None,
        }
        warnings.append(
            _finding(
                "warning",
                "PAPER_ID_CONFLICT",
                "系统中已存在相同试卷 ID",
                **conflict,
            )
        )

    valid = not errors and len(resolved_references) == len(raw_references)
    replace_allowed = bool(
        valid
        and existing is not None
        and existing.deleted_at is None
        and existing.status == "draft"
    )
    return {
        "valid": valid,
        "payloadHash": payload_hash(request),
        "summary": {
            "paperId": paper_id,
            "name": name,
            "subject": subject,
            "paperType": paper_type,
            "totalCount": paper.get("totalCount"),
            "questionCount": len(raw_references),
            "sourceBankCount": len(source_banks),
        },
        "references": resolved_references,
        "paperType": paper_type,
        "errors": errors,
        "warnings": warnings,
        "paperConflict": conflict,
        "allowedActions": {
            "create": bool(valid and existing is None),
            "copy": valid,
            "replaceDraft": replace_allowed,
        },
    }


def _request_hash(request: PaperImportRequest) -> str:
    canonical = json.dumps(
        {
            "payloadHash": request.preflight_hash,
            "conflictAction": request.conflict_action,
            "expectedRevision": request.expected_revision,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


async def import_package(
    db: AsyncSession,
    actor: User,
    request: PaperImportRequest,
) -> dict:
    request_hash = _request_hash(request)
    await teaching_content_revision_service.acquire_lock(db)
    await idempotency_service.lock(db, actor.username, request.idempotency_key)
    existing_operation = (
        await db.execute(
            select(PaperImportOperation)
            .where(
                PaperImportOperation.actor_username == actor.username,
                PaperImportOperation.idempotency_key == request.idempotency_key,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if existing_operation is not None:
        if existing_operation.request_hash != request_hash:
            raise _error(
                409,
                "IDEMPOTENCY_PAYLOAD_CONFLICT",
                "相同幂等键不能用于不同的试卷导入请求",
            )
        replay = dict(existing_operation.result_payload or {})
        replay["replayed"] = True
        return replay

    preflight_request = PaperImportPreflightRequest(
        fileName=request.file_name,
        package=request.package_data,
    )
    preflight = await preflight_package(db, actor, preflight_request)
    if request.preflight_hash != preflight["payloadHash"]:
        raise _error(
            409,
            "PREFLIGHT_STALE",
            "试卷包已发生变化，请重新预检",
            currentHash=preflight["payloadHash"],
        )
    if not preflight["valid"]:
        raise _error(
            422,
            "PAPER_IMPORT_INVALID",
            "试卷包未通过预检",
            errors=preflight["errors"],
            warnings=preflight["warnings"],
        )

    action_key = {
        "create": "create",
        "copy": "copy",
        "replace_draft": "replaceDraft",
    }[request.conflict_action]
    if not preflight["allowedActions"][action_key]:
        paper_conflict = preflight.get("paperConflict") or {}
        code = (
            "PUBLISHED_PAPER_REPLACE_FORBIDDEN"
            if request.conflict_action == "replace_draft"
            and paper_conflict.get("status") == "published"
            else "PAPER_IMPORT_ACTION_NOT_ALLOWED"
        )
        raise _error(409, code, "当前冲突状态不允许所选导入方式")

    source_paper = request.package_data["paper"]
    source_paper_id = str(source_paper["id"]).strip()
    target_paper_id = (
        uid("p_") if request.conflict_action == "copy" else source_paper_id
    )

    source_category_id = str(source_paper.get("categoryId") or "").strip()
    category = await db.get(PaperCategory, source_category_id) if source_category_id else None
    category_id = (
        category.id
        if category is not None and category.archived_at is None
        else None
    )
    metadata = {
        "sourcePaperId": source_paper_id,
        "sourceStatus": str(source_paper.get("status") or ""),
        "sourceCategoryId": source_category_id,
        "sourceCreatedAt": source_paper.get("createdAt"),
        "sourceUpdatedAt": source_paper.get("updatedAt"),
        "sourcePublishedAt": source_paper.get("publishedAt"),
        "sourceExportedAt": request.package_data.get("exportedAt"),
        "sourceProducer": request.package_data.get("producer") or {},
        "sourceProgramCompatibility": request.package_data.get("programCompatibility")
        or {},
        "payloadHash": preflight["payloadHash"],
        "importedAt": now_utc().isoformat(),
        "conflictAction": request.conflict_action,
    }
    paper_values = {
        "name": str(source_paper["name"]).strip(),
        "subject": str(source_paper.get("subject") or "PMP").strip(),
        "description": (
            str(source_paper.get("description"))
            if source_paper.get("description") is not None
            else None
        ),
        "paper_type": preflight["paperType"],
        "category_id": category_id,
        "total_count": len(preflight["references"]),
        "status": "draft",
        "quotas": (
            source_paper.get("quotas")
            if isinstance(source_paper.get("quotas"), dict)
            else {}
        ),
        "access_policy": (
            source_paper.get("accessPolicy")
            if isinstance(source_paper.get("accessPolicy"), dict)
            else {}
        ),
        "enabled_modes": (
            source_paper.get("enabledModes")
            if isinstance(source_paper.get("enabledModes"), list)
            else []
        ),
        "mode_config_version": (
            source_paper.get("modeConfigVersion")
            if isinstance(source_paper.get("modeConfigVersion"), int)
            else 2
        ),
        "purpose": str(source_paper.get("purpose") or "learning"),
        "import_metadata": metadata,
        "published_at": None,
        "archived_at": None,
        "restored_at": None,
        "withdrawn_at": None,
        "published_release_id": None,
    }
    if request.conflict_action == "replace_draft":
        existing_paper = await db.get(ExamPaper, target_paper_id)
        if (
            existing_paper is not None
            and existing_paper.paper_type != preflight["paperType"]
            and (
                int(existing_paper.published_version or 0)
                or int(
                    await db.scalar(
                        select(func.count())
                        .select_from(PaperQuestion)
                        .where(PaperQuestion.paper_id == target_paper_id)
                    )
                    or 0
                )
            )
        ):
            raise _error(
                409,
                "PAPER_TYPE_LOCKED",
                "试卷已有题目或发布记录，不能切换类型",
            )
        updated_id = await paper_service.cas_paper_mutation(
            db,
            actor,
            target_paper_id,
            request.expected_revision,
            paper_values,
        )
        if updated_id is None:
            raise _error(404, "PAPER_NOT_FOUND", "待覆盖草稿不存在")
        await db.execute(
            delete(PaperQuestion).where(PaperQuestion.paper_id == target_paper_id)
        )
        await db.flush()
        paper = await db.get(ExamPaper, target_paper_id)
        assert paper is not None
        await db.refresh(paper)
    else:
        paper = ExamPaper(
            id=target_paper_id,
            owner_id=actor.username,
            revision=1,
            created_by=actor.username,
            updated_by=actor.username,
            **paper_values,
        )
        db.add(paper)
        await db.flush()
    for reference in preflight["references"]:
        db.add(
            PaperQuestion(
                paper_id=paper.id,
                question_id=reference["questionId"],
                order_index=reference["order"] - 1,
                score=reference["score"],
            )
        )
    await db.flush()
    paper_payload = await paper_service.get_paper(db, actor, paper.id)
    assert paper_payload is not None
    operation = PaperImportOperation(
        id=uid("pio_"),
        owner_id=actor.username,
        actor_username=actor.username,
        idempotency_key=request.idempotency_key,
        request_hash=request_hash,
        conflict_action=request.conflict_action,
        result_paper_id=paper.id,
        result_payload={},
        completed_at=now_utc(),
    )
    result = {
        "operationId": operation.id,
        "paper": paper_payload,
        "warnings": preflight["warnings"],
        "replayed": False,
    }
    operation.result_payload = result
    db.add(operation)
    await teaching_content_revision_service.bump(
        db,
        actor.username,
        [{"entityType": "paper", "entityId": paper.id, "action": "imported"}],
    )
    await db.commit()
    return result
