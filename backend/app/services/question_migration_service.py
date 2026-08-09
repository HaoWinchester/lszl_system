"""Repeatable Runtime State to relational question-catalog migration."""

from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.question import Question, QuestionBank
from app.models.runtime_state import RuntimeState
from app.models.shared_runtime_state import SharedRuntimeState
from app.models.user import User
from app.schemas.question_catalog import QuestionPayload
from app.services.question_catalog_service import question_to_payload
from app.services.question_content_service import (
    canonical_question_hash,
    normalize_question_payload,
)

PRIVATE_BANK_PREFIX = "kg_question_banks_v1__"
PUBLISHED_BANK_KEY = "kg_question_banks_published_v1"
SOURCE_PRIORITY = {"relational": 0, "runtimeState": 1, "sharedPublished": 2}


class BankMigrationMapping(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    owner_id: str = Field(alias="ownerId")
    old_bank_id: str = Field(alias="oldBankId")
    new_bank_id: str = Field(alias="newBankId")
    old_name: str = Field(alias="oldName")
    new_name: str = Field(alias="newName")
    ordinal: int


class MigrationReport(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    snapshot_hash: str = Field(alias="snapshotHash")
    source_counts: dict[str, dict[str, int]] = Field(alias="sourceCounts")
    bank_count: int = Field(alias="bankCount")
    question_count: int = Field(alias="questionCount")
    public_count: int = Field(alias="publicCount")
    internal_count: int = Field(alias="internalCount")
    deduplicated: int = Field(alias="deduplicatedCount")
    conflicts: list[dict[str, Any]]
    invalid_records: list[dict[str, Any]] = Field(alias="invalidRecords")
    bank_mappings: list[BankMigrationMapping] = Field(
        default_factory=list,
        alias="bankMappings",
    )
    null_content_hashes: int = Field(alias="nullContentHashes")
    applied: bool = False
    started_at: str = Field(alias="startedAt")
    completed_at: str = Field(alias="completedAt")
    duration_ms: int = Field(alias="durationMs")


@dataclass
class _BankCandidate:
    id: str
    owner_id: str
    name: str
    subject: str
    description: str | None
    version: str
    visibility: str
    revision: int
    source: str


@dataclass
class _QuestionCandidate:
    id: str
    bank_id: str
    owner_id: str
    payload: dict[str, Any]
    content_hash: str
    revision: int
    source: str


@dataclass
class _LogicalBank:
    owner_id: str
    old_bank_id: str
    name: str
    preferred_source: str
    has_relational: bool


@dataclass
class _BankMappingPlan:
    by_identity: dict[tuple[str, str], BankMigrationMapping]
    report: list[BankMigrationMapping]


@dataclass
class _Snapshot:
    report: MigrationReport
    banks: dict[str, _BankCandidate]
    questions: dict[str, _QuestionCandidate]


def _utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _decode_json(raw: Any) -> Any:
    return json.loads(raw) if isinstance(raw, str) else raw


def _filtered(bank_id: str, bank_ids: set[str] | None) -> bool:
    return bank_ids is None or bank_id in bank_ids


def _bank_name(raw_bank: dict[str, Any]) -> str:
    return str(raw_bank.get("name") or raw_bank.get("bankName") or "未命名题库").strip()[:200]


def _candidate_id_status(
    candidate_id: str,
    *,
    owner_id: str,
    expected_name: str,
    logical_by_id: dict[str, list[_LogicalBank]],
    assigned_ids: set[str],
) -> tuple[bool, tuple[str, str] | None]:
    existing = logical_by_id.get(candidate_id, [])
    if not existing and candidate_id not in assigned_ids:
        return True, None
    if len(existing) == 1:
        logical = existing[0]
        if (
            logical.has_relational
            and logical.owner_id == owner_id
            and logical.name == expected_name
        ):
            return True, (logical.owner_id, logical.old_bank_id)
    return False, None


def _mapped_bank_id(
    old_id: str,
    owner_id: str,
    ordinal: int,
    expected_name: str,
    logical_by_id: dict[str, list[_LogicalBank]],
    assigned_ids: set[str],
) -> tuple[str, tuple[str, str] | None]:
    direct = f"{old_id}-{ordinal}"
    if len(direct) <= 64:
        available, absorbed = _candidate_id_status(
            direct,
            owner_id=owner_id,
            expected_name=expected_name,
            logical_by_id=logical_by_id,
            assigned_ids=assigned_ids,
        )
        if available:
            return direct, absorbed

    digest = hashlib.sha256(
        f"{old_id}\0{owner_id}\0{ordinal}".encode("utf-8")
    ).hexdigest()
    for hash_length in range(8, 53, 4):
        suffix = f"-{ordinal}-{digest[:hash_length]}"
        candidate = f"{old_id[: 64 - len(suffix)]}{suffix}"
        available, absorbed = _candidate_id_status(
            candidate,
            owner_id=owner_id,
            expected_name=expected_name,
            logical_by_id=logical_by_id,
            assigned_ids=assigned_ids,
        )
        if available:
            return candidate, absorbed
    raise ValueError(f"无法为题库 {old_id} 分配唯一迁移 ID")


def _plan_bank_mappings(
    records: list[tuple[str, str | None, dict[str, Any]]],
    user_ids: set[str],
) -> _BankMappingPlan:
    logical_records: dict[tuple[str, str], list[tuple[str, dict[str, Any]]]] = {}
    for source, owner_id, raw_bank in records:
        old_bank_id = str(raw_bank.get("id") or raw_bank.get("bankId") or "").strip()
        if (
            not old_bank_id
            or len(old_bank_id) > 64
            or not owner_id
            or owner_id not in user_ids
        ):
            continue
        logical_records.setdefault((owner_id, old_bank_id), []).append((source, raw_bank))

    logical: dict[tuple[str, str], _LogicalBank] = {}
    for identity, variants in logical_records.items():
        preferred_source, preferred_bank = min(
            variants,
            key=lambda item: SOURCE_PRIORITY.get(item[0], 99),
        )
        logical[identity] = _LogicalBank(
            owner_id=identity[0],
            old_bank_id=identity[1],
            name=_bank_name(preferred_bank),
            preferred_source=preferred_source,
            has_relational=any(source == "relational" for source, _ in variants),
        )

    logical_by_id: dict[str, list[_LogicalBank]] = {}
    for item in logical.values():
        logical_by_id.setdefault(item.old_bank_id, []).append(item)

    by_identity: dict[tuple[str, str], BankMigrationMapping] = {}
    report: list[BankMigrationMapping] = []
    assigned_ids: set[str] = set()
    absorbed_identities: set[tuple[str, str]] = set()

    for old_bank_id in sorted(logical_by_id):
        group = [
            item
            for item in logical_by_id[old_bank_id]
            if (item.owner_id, item.old_bank_id) not in absorbed_identities
        ]
        if len({item.owner_id for item in group}) <= 1:
            continue
        group.sort(
            key=lambda item: (
                0 if item.has_relational else 1,
                item.owner_id,
                SOURCE_PRIORITY.get(item.preferred_source, 99),
                item.old_bank_id,
            )
        )
        seen_names: set[str] = set()
        for ordinal, item in enumerate(group, start=1):
            normalized_name = item.name.strip()
            new_name = (
                f"{normalized_name}（{ordinal}）"
                if normalized_name in seen_names
                else normalized_name
            )
            seen_names.add(normalized_name)
            absorbed: tuple[str, str] | None = None
            if ordinal == 1:
                new_bank_id = old_bank_id
            else:
                new_bank_id, absorbed = _mapped_bank_id(
                    old_bank_id,
                    item.owner_id,
                    ordinal,
                    new_name,
                    logical_by_id,
                    assigned_ids,
                )
            mapping = BankMigrationMapping(
                ownerId=item.owner_id,
                oldBankId=old_bank_id,
                newBankId=new_bank_id,
                oldName=item.name,
                newName=new_name,
                ordinal=ordinal,
            )
            identity = (item.owner_id, item.old_bank_id)
            by_identity[identity] = mapping
            if absorbed is not None and absorbed != identity:
                by_identity[absorbed] = mapping
                absorbed_identities.add(absorbed)
            assigned_ids.add(new_bank_id)
            report.append(mapping)
    return _BankMappingPlan(by_identity=by_identity, report=report)


def _has_internal_marker(payload: dict[str, Any]) -> bool:
    if str(payload.get("scope") or "").casefold() == "internal":
        return True
    values: list[str] = []
    for tag in payload.get("tags") or []:
        if isinstance(tag, str):
            values.append(tag)
        elif isinstance(tag, dict):
            values.extend(str(tag.get(key) or "") for key in ("label", "name"))
    metadata = payload.get("metadata")
    if isinstance(metadata, dict):
        for path in metadata.get("tagPaths") or []:
            if isinstance(path, dict):
                values.append(str(path.get("label") or ""))
    return any(value.strip().casefold() in {"internal", "内部使用"} for value in values)


def _canonical_payload(
    raw: dict[str, Any],
    *,
    subject: str,
    force_public: bool,
) -> dict[str, Any]:
    normalized = normalize_question_payload(raw, subject=subject)
    normalized = QuestionPayload.model_validate(normalized).model_dump(by_alias=True)
    if force_public and not _has_internal_marker(raw):
        normalized["scope"] = "public"
    return normalized


def _invalid(
    invalid_records: list[dict[str, Any]],
    *,
    source: str,
    code: str,
    message: str,
    owner_id: str | None = None,
    key: str | None = None,
    record_id: str | None = None,
) -> None:
    invalid_records.append(
        {
            "source": source,
            "code": code,
            "message": message,
            "ownerId": owner_id,
            "key": key,
            "recordId": record_id,
        }
    )


async def _collect_sources(
    db: AsyncSession,
    *,
    owner_ids: set[str] | None,
    bank_ids: set[str] | None,
) -> tuple[
    list[tuple[str, str | None, dict[str, Any]]],
    dict[str, dict[str, int]],
    list[dict[str, Any]],
    int,
    list[dict[str, Any]],
]:
    records: list[tuple[str, str | None, dict[str, Any]]] = []
    source_counts = {
        "relational": {"banks": 0, "questions": 0},
        "runtimeState": {"banks": 0, "questions": 0},
        "sharedPublished": {"banks": 0, "questions": 0},
    }
    invalid_records: list[dict[str, Any]] = []
    raw_snapshot: list[dict[str, Any]] = []
    null_content_hashes = 0

    relational_query = select(QuestionBank)
    if owner_ids is not None:
        relational_query = relational_query.where(QuestionBank.owner_id.in_(owner_ids))
    if bank_ids is not None:
        relational_query = relational_query.where(QuestionBank.id.in_(bank_ids))
    relational_banks = (
        await db.execute(relational_query.order_by(QuestionBank.id))
    ).scalars().all()
    for bank in relational_banks:
        questions = (
            await db.execute(
                select(Question)
                .where(Question.bank_id == bank.id)
                .order_by(Question.id)
            )
        ).scalars().all()
        null_content_hashes += sum(question.content_hash is None for question in questions)
        raw_bank = {
            "id": bank.id,
            "name": bank.name,
            "subject": bank.subject,
            "description": bank.description,
            "version": bank.version,
            "visibility": bank.visibility,
            "revision": bank.revision,
            "questions": [question_to_payload(question) for question in questions],
        }
        records.append(("relational", bank.owner_id, raw_bank))
        raw_snapshot.append({"source": "relational", "ownerId": bank.owner_id, "bank": raw_bank})
        source_counts["relational"]["banks"] += 1
        source_counts["relational"]["questions"] += len(questions)

    runtime_query = select(RuntimeState).order_by(RuntimeState.owner_id)
    if owner_ids is not None:
        runtime_query = runtime_query.where(RuntimeState.owner_id.in_(owner_ids))
    runtime_rows = (await db.execute(runtime_query)).scalars().all()
    for runtime in runtime_rows:
        for key, raw_value in sorted((runtime.storage or {}).items()):
            if not str(key).startswith(PRIVATE_BANK_PREFIX):
                continue
            try:
                decoded = _decode_json(raw_value)
                if not isinstance(decoded, list):
                    raise ValueError("question bank value is not a list")
            except (TypeError, ValueError, json.JSONDecodeError) as error:
                _invalid(
                    invalid_records,
                    source="runtimeState",
                    code="INVALID_JSON",
                    message=str(error),
                    owner_id=runtime.owner_id,
                    key=str(key),
                )
                raw_snapshot.append(
                    {
                        "source": "runtimeState",
                        "ownerId": runtime.owner_id,
                        "key": key,
                        "invalidValue": str(raw_value),
                    }
                )
                continue
            for raw_bank in decoded:
                if not isinstance(raw_bank, dict):
                    _invalid(
                        invalid_records,
                        source="runtimeState",
                        code="INVALID_BANK_RECORD",
                        message="题库记录必须是对象",
                        owner_id=runtime.owner_id,
                        key=str(key),
                    )
                    continue
                bank_id = str(raw_bank.get("id") or raw_bank.get("bankId") or "")
                if not _filtered(bank_id, bank_ids):
                    continue
                records.append(("runtimeState", runtime.owner_id, raw_bank))
                raw_snapshot.append(
                    {
                        "source": "runtimeState",
                        "ownerId": runtime.owner_id,
                        "key": key,
                        "bank": raw_bank,
                    }
                )
                source_counts["runtimeState"]["banks"] += 1
                source_counts["runtimeState"]["questions"] += len(
                    raw_bank.get("questions") or []
                )

    shared = await db.get(SharedRuntimeState, PUBLISHED_BANK_KEY)
    if shared is not None:
        try:
            decoded = _decode_json(shared.value)
            if not isinstance(decoded, list):
                raise ValueError("published question bank value is not a list")
        except (TypeError, ValueError, json.JSONDecodeError) as error:
            _invalid(
                invalid_records,
                source="sharedPublished",
                code="INVALID_JSON",
                message=str(error),
                key=PUBLISHED_BANK_KEY,
            )
            raw_snapshot.append(
                {
                    "source": "sharedPublished",
                    "key": PUBLISHED_BANK_KEY,
                    "invalidValue": shared.value,
                }
            )
        else:
            for raw_bank in decoded:
                if not isinstance(raw_bank, dict):
                    _invalid(
                        invalid_records,
                        source="sharedPublished",
                        code="INVALID_BANK_RECORD",
                        message="共享题库记录必须是对象",
                        key=PUBLISHED_BANK_KEY,
                    )
                    continue
                bank_id = str(raw_bank.get("id") or raw_bank.get("bankId") or "")
                if not _filtered(bank_id, bank_ids):
                    continue
                owner_id = str(raw_bank.get("publishedBy") or "").strip() or None
                records.append(("sharedPublished", owner_id, raw_bank))
                raw_snapshot.append(
                    {
                        "source": "sharedPublished",
                        "ownerId": owner_id,
                        "bank": raw_bank,
                    }
                )
                source_counts["sharedPublished"]["banks"] += 1
                source_counts["sharedPublished"]["questions"] += len(
                    raw_bank.get("questions") or []
                )
    return records, source_counts, invalid_records, null_content_hashes, raw_snapshot


async def _build_snapshot(
    db: AsyncSession,
    *,
    owner_ids: set[str] | None,
    bank_ids: set[str] | None,
) -> _Snapshot:
    started_monotonic = time.monotonic()
    started_at = _utc_iso()
    (
        records,
        source_counts,
        invalid_records,
        null_content_hashes,
        raw_snapshot,
    ) = await _collect_sources(db, owner_ids=owner_ids, bank_ids=bank_ids)
    snapshot_json = json.dumps(
        raw_snapshot,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )
    snapshot_hash = hashlib.sha256(snapshot_json.encode("utf-8")).hexdigest()
    published_bank_ids = {
        str(raw_bank.get("id") or raw_bank.get("bankId") or "")
        for source, _, raw_bank in records
        if source == "sharedPublished"
    }
    published_public_question_ids = {
        str(question.get("id") or "")
        for source, _, raw_bank in records
        if source == "sharedPublished"
        for question in (raw_bank.get("questions") or [])
        if isinstance(question, dict) and not _has_internal_marker(question)
    }
    user_ids = set((await db.execute(select(User.username))).scalars().all())
    bank_mapping_plan = _plan_bank_mappings(records, user_ids)
    banks: dict[str, _BankCandidate] = {}
    questions: dict[str, _QuestionCandidate] = {}
    conflicts: list[dict[str, Any]] = []
    deduplicated = 0

    for source, owner_id, raw_bank in records:
        old_bank_id = str(raw_bank.get("id") or raw_bank.get("bankId") or "").strip()
        if not old_bank_id or len(old_bank_id) > 64:
            _invalid(
                invalid_records,
                source=source,
                code="BANK_ID_INVALID",
                message="题库 ID 为空或超过 64 字符",
                owner_id=owner_id,
                record_id=old_bank_id or None,
            )
            continue
        if source == "sharedPublished" and not owner_id:
            conflicts.append(
                {
                    "code": "PUBLISHED_OWNER_MISSING",
                    "bankId": old_bank_id,
                    "message": "共享题库缺少 publishedBy，不能推断 owner",
                }
            )
            continue
        if not owner_id or owner_id not in user_ids:
            conflicts.append(
                {
                    "code": "OWNER_NOT_FOUND",
                    "bankId": old_bank_id,
                    "ownerId": owner_id,
                    "message": "题库 owner 不存在",
                }
            )
            continue
        mapping = bank_mapping_plan.by_identity.get((owner_id, old_bank_id))
        bank_id = mapping.new_bank_id if mapping is not None else old_bank_id
        bank_name = mapping.new_name if mapping is not None else _bank_name(raw_bank)
        visibility = (
            "published"
            if old_bank_id in published_bank_ids or source == "sharedPublished"
            else "private"
        )
        candidate = _BankCandidate(
            id=bank_id,
            owner_id=owner_id,
            name=bank_name,
            subject=str(raw_bank.get("subject") or "PMP")[:32],
            description=(
                str(raw_bank.get("description")) if raw_bank.get("description") else None
            ),
            version=str(raw_bank.get("version") or "1.0")[:32],
            visibility=visibility,
            revision=max(1, int(raw_bank.get("revision") or 1)),
            source=source,
        )
        existing_bank = banks.get(bank_id)
        if existing_bank is None:
            banks[bank_id] = candidate
        elif existing_bank.owner_id != candidate.owner_id:
            conflicts.append(
                {
                    "code": "BANK_OWNER_CONFLICT",
                    "bankId": bank_id,
                    "owners": sorted({existing_bank.owner_id, candidate.owner_id}),
                    "message": "同一题库 ID 存在不同 owner",
                }
            )
            continue
        else:
            deduplicated += 1
            if candidate.visibility == "published":
                existing_bank.visibility = "published"
            existing_bank.revision = max(existing_bank.revision, candidate.revision)

        raw_questions = raw_bank.get("questions")
        if not isinstance(raw_questions, list):
            _invalid(
                invalid_records,
                source=source,
                code="QUESTIONS_NOT_LIST",
                message="题库 questions 必须是数组",
                owner_id=owner_id,
                record_id=bank_id,
            )
            continue
        for raw_question in raw_questions:
            if not isinstance(raw_question, dict):
                _invalid(
                    invalid_records,
                    source=source,
                    code="INVALID_QUESTION_RECORD",
                    message="题目记录必须是对象",
                    owner_id=owner_id,
                    record_id=bank_id,
                )
                continue
            question_id = str(raw_question.get("id") or raw_question.get("questionId") or "").strip()
            if not question_id or len(question_id) > 64:
                _invalid(
                    invalid_records,
                    source=source,
                    code="QUESTION_ID_INVALID",
                    message="题目 ID 为空或超过 64 字符",
                    owner_id=owner_id,
                    record_id=question_id or None,
                )
                continue
            try:
                payload = _canonical_payload(
                    raw_question,
                    subject=candidate.subject,
                    force_public=question_id in published_public_question_ids,
                )
            except Exception as error:
                _invalid(
                    invalid_records,
                    source=source,
                    code="QUESTION_PAYLOAD_INVALID",
                    message=str(error),
                    owner_id=owner_id,
                    record_id=question_id,
                )
                continue
            content_hash = canonical_question_hash(payload)
            question_candidate = _QuestionCandidate(
                id=question_id,
                bank_id=bank_id,
                owner_id=owner_id,
                payload=payload,
                content_hash=content_hash,
                revision=max(1, int(raw_question.get("revision") or 1)),
                source=source,
            )
            existing_question = questions.get(question_id)
            if existing_question is None:
                questions[question_id] = question_candidate
            elif existing_question.bank_id != bank_id:
                conflicts.append(
                    {
                        "code": "QUESTION_BANK_CONFLICT",
                        "questionId": question_id,
                        "bankIds": sorted({existing_question.bank_id, bank_id}),
                        "message": "同一题目 ID 出现在不同题库",
                    }
                )
            elif existing_question.content_hash != content_hash:
                conflicts.append(
                    {
                        "code": "QUESTION_CONTENT_CONFLICT",
                        "questionId": question_id,
                        "bankId": bank_id,
                        "sources": [existing_question.source, source],
                        "hashes": [existing_question.content_hash, content_hash],
                        "message": "同一题目 ID 存在不同内容",
                    }
                )
            else:
                deduplicated += 1
                existing_question.revision = max(
                    existing_question.revision,
                    question_candidate.revision,
                )

    public_count = sum(
        candidate.payload.get("scope") == "public" for candidate in questions.values()
    )
    completed_at = _utc_iso()
    report = MigrationReport(
        snapshotHash=snapshot_hash,
        sourceCounts=source_counts,
        bankCount=len(banks),
        questionCount=len(questions),
        publicCount=public_count,
        internalCount=len(questions) - public_count,
        deduplicated=deduplicated,
        conflicts=conflicts,
        invalidRecords=invalid_records,
        bankMappings=bank_mapping_plan.report,
        nullContentHashes=null_content_hashes,
        applied=False,
        startedAt=started_at,
        completedAt=completed_at,
        durationMs=max(0, int((time.monotonic() - started_monotonic) * 1000)),
    )
    return _Snapshot(report=report, banks=banks, questions=questions)


def _assign_migrated_question(
    question: Question,
    candidate: _QuestionCandidate,
    *,
    is_new: bool,
) -> None:
    payload = candidate.payload
    question.bank_id = candidate.bank_id
    question.title = str(payload.get("title") or "")[:500]
    question.type = str(payload.get("type") or "single_choice")[:32]
    question.subject = str(payload.get("subject") or "PMP")[:32]
    question.difficulty = str(payload["difficulty"])[:32] if payload.get("difficulty") else None
    question.domain = str(payload["domain"])[:100] if payload.get("domain") else None
    question.topic = str(payload["topic"])[:100] if payload.get("topic") else None
    question.teacher_number = (
        str(payload["teacherNumber"])[:64] if payload.get("teacherNumber") else None
    )
    question.scope = str(payload.get("scope") or "internal")
    question.content_hash = candidate.content_hash
    if payload.get("creatorId"):
        question.creator_id = str(payload["creatorId"])[:64]
    if payload.get("creatorName"):
        question.creator_name = str(payload["creatorName"])[:120]
    if is_new:
        question.created_by = candidate.owner_id
    question.updated_by = candidate.owner_id
    question.revision = max(question.revision or 1, candidate.revision)
    question.tags = payload.get("tags") or []
    question.stem_parts = payload.get("stemParts") or []
    question.options = payload.get("options") or []
    question.correct_answer = str(payload.get("correctAnswer") or "")[:20] or None
    question.analysis = str(payload["analysis"]) if payload.get("analysis") is not None else None
    question.translations = payload.get("translations") or {}
    question.content_metadata = payload.get("metadata") or {}
    question.key_path = payload.get("keyPath") or {}
    question.clues = payload.get("clues") or []
    question.concepts = payload.get("concepts") or []
    question.reasoning_steps = payload.get("reasoningSteps") or []
    question.status = payload.get("status") or {}
    question.lifecycle = payload.get("lifecycle") or {"status": "active"}


async def _apply_snapshot(db: AsyncSession, snapshot: _Snapshot) -> None:
    for candidate in sorted(snapshot.banks.values(), key=lambda bank: bank.id):
        bank = await db.get(QuestionBank, candidate.id)
        if bank is None:
            bank = QuestionBank(
                id=candidate.id,
                owner_id=candidate.owner_id,
                name=candidate.name,
                subject=candidate.subject,
                description=candidate.description,
                version=candidate.version,
                visibility=candidate.visibility,
                revision=candidate.revision,
                created_by=candidate.owner_id,
                updated_by=candidate.owner_id,
            )
            db.add(bank)
        else:
            if bank.owner_id != candidate.owner_id:
                raise ValueError(f"题库 {candidate.id} 的 owner 与迁移映射不一致")
            bank.name = candidate.name
            bank.subject = candidate.subject
            bank.description = candidate.description
            bank.version = candidate.version
            bank.visibility = candidate.visibility
            bank.revision = max(bank.revision, candidate.revision)
            bank.updated_by = bank.updated_by or candidate.owner_id
            bank.created_by = bank.created_by or candidate.owner_id
    await db.flush()
    for candidate in sorted(snapshot.questions.values(), key=lambda question: question.id):
        question = await db.get(Question, candidate.id)
        is_new = question is None
        if question is None:
            question = Question(
                id=candidate.id,
                bank_id=candidate.bank_id,
                title=str(candidate.payload.get("title") or ""),
                revision=candidate.revision,
            )
            db.add(question)
        _assign_migrated_question(question, candidate, is_new=is_new)
    await db.flush()


async def scan_runtime_question_sources(
    db: AsyncSession,
    *,
    owner_ids: set[str] | None = None,
    bank_ids: set[str] | None = None,
) -> MigrationReport:
    return (
        await _build_snapshot(db, owner_ids=owner_ids, bank_ids=bank_ids)
    ).report


async def migrate_runtime_questions(
    db: AsyncSession,
    *,
    apply: bool,
    owner_ids: set[str] | None = None,
    bank_ids: set[str] | None = None,
) -> MigrationReport:
    snapshot = await _build_snapshot(db, owner_ids=owner_ids, bank_ids=bank_ids)
    if not apply or snapshot.report.conflicts or snapshot.report.invalid_records:
        return snapshot.report
    if db.in_transaction():
        await db.rollback()
    async with db.begin():
        await _apply_snapshot(db, snapshot)
    snapshot.report.applied = True
    snapshot.report.completed_at = _utc_iso()
    return snapshot.report
