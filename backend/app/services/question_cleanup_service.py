"""Content-addressed reporting and guarded apply for shared-question cleanup.

Report construction is read-only.  The separate apply entrypoint requires an
approved closed manifest, verified backup receipt, locked snapshot recheck,
transactional repairs, and an append-only audit before it commits.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal
from enum import Enum
import hashlib
import hmac
import json
import os
from pathlib import Path
import stat
from typing import Any

from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.content_prep import (
    QuestionAuditLog,
    QuestionEditLock,
    QuestionUploadBatch,
)
from app.models.question import Question, QuestionBank, QuestionCleanupAudit
from app.models.training import LearningEvent, RecallProgress, TrainingProgress
from app.schemas.question_cleanup import (
    QuestionCleanupDecision,
    QuestionCleanupReport,
    QuestionCleanupReviewDecisionFile,
    QuestionCleanupSummary,
)
from app.services.question_cleanup_reference_service import (
    QuestionCleanupReferenceRepairError,
    inventory_question_references,
    repair_current_question_references,
)
from app.services import teaching_content_revision_service


CLEANUP_POLICY_VERSION = "question-cleanup-v1"

VERIFIED_IMPORT_ACTIONS = frozenset(
    {
        "question_created",
        "question_updated",
        "legacy_import_verified",
    }
)

SEEDED_TEST_BATCH_IDS = frozenset(
    {
        "seeded-test-question-batch-v1",
        "seeded-e2e-question-batch-v1",
        "seeded-pytest-question-batch-v1",
    }
)

_TEST_ENVIRONMENTS = frozenset({"test", "e2e", "pytest"})
_TEST_PREFIXES = ("__test__", "__e2e__", "pytest-")
_SEEDED_FIXTURE_TITLE_PREFIXES = ("__test_fixture__", "__e2e_fixture__")
_KNOWN_NON_IMPORTED_ORIGINS = frozenset(
    {
        "manual",
        "manual_entry",
        "direct_entry",
        "teacher_manual",
        "admin_manual",
    }
)


def _field(record: object | None, *names: str, default: Any = None) -> Any:
    if record is None:
        return default
    if isinstance(record, Mapping):
        for name in names:
            if name in record:
                return record[name]
        return default
    for name in names:
        if hasattr(record, name):
            return getattr(record, name)
    return default


def _question_metadata(question: object) -> dict[str, Any]:
    if isinstance(question, Mapping):
        raw = question.get("content_metadata", question.get("metadata", {}))
    else:
        raw = getattr(question, "content_metadata", None)
        if raw is None:
            raw = getattr(question, "metadata", {})
    return dict(raw) if isinstance(raw, Mapping) else {}


def _normalized_token(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().casefold()
    return normalized or None


def _origin_token(metadata: Mapping[str, Any]) -> str | None:
    origin = metadata.get("origin")
    if isinstance(origin, Mapping):
        for key in ("source", "type", "channel"):
            normalized = _normalized_token(origin.get(key))
            if normalized:
                return normalized
        return None
    return _normalized_token(origin)


def _external_id(question: object, metadata: Mapping[str, Any]) -> str | None:
    direct = _field(question, "external_id", "externalId")
    if direct is None:
        direct = metadata.get("externalId", metadata.get("external_id"))
    return direct if isinstance(direct, str) else None


def _starts_with_test_prefix(value: Any) -> bool:
    normalized = _normalized_token(value)
    return bool(normalized and normalized.startswith(_TEST_PREFIXES))


def _canonical_value(value: Any) -> Any:
    """Convert classifier sources to deterministic JSON-compatible values."""

    if isinstance(value, Mapping):
        return {
            str(key): _canonical_value(item)
            for key, item in sorted(value.items(), key=lambda pair: str(pair[0]))
        }
    if isinstance(value, (list, tuple)):
        return [_canonical_value(item) for item in value]
    if isinstance(value, (set, frozenset)):
        normalized = [_canonical_value(item) for item in value]
        return sorted(
            normalized,
            key=lambda item: json.dumps(
                item,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ),
        )
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, Enum):
        return _canonical_value(value.value)
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def _audit_source(audit: object) -> dict[str, Any]:
    detail = _field(audit, "detail", default={})
    return {
        "action": _field(audit, "action"),
        "batchId": _field(audit, "batch_id", "batchId"),
        "detail": dict(detail) if isinstance(detail, Mapping) else {},
        "outcome": _field(audit, "outcome"),
    }


def _source_fingerprint(
    question: object,
    metadata: Mapping[str, Any],
    audits: Sequence[object],
    batch: object | None,
) -> str:
    audit_sources = [_canonical_value(_audit_source(audit)) for audit in audits]
    audit_sources.sort(
        key=lambda row: json.dumps(
            row,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
    )
    payload = {
        "policyVersion": CLEANUP_POLICY_VERSION,
        "question": {
            "id": _field(question, "id"),
            "title": _field(question, "title"),
            "externalId": _external_id(question, metadata),
            "metadata": dict(metadata),
        },
        "audits": audit_sources,
        "batch": (
            {
                "id": _field(batch, "id"),
                "status": _field(batch, "status"),
            }
            if batch is not None
            else None
        ),
    }
    canonical = json.dumps(
        _canonical_value(payload),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _explicit_test_evidence(
    question: object,
    metadata: Mapping[str, Any],
    audits: Sequence[object],
    batch: object | None,
) -> set[str]:
    evidence: set[str] = set()

    environment = _normalized_token(metadata.get("environment"))
    if environment in _TEST_ENVIRONMENTS:
        evidence.add("explicit_test:metadata_environment")
    if metadata.get("fixture") is True:
        evidence.add("explicit_test:metadata_fixture")
    title = _normalized_token(_field(question, "title"))
    if title and title.startswith((*_TEST_PREFIXES, *_SEEDED_FIXTURE_TITLE_PREFIXES)):
        evidence.add("explicit_test:title_prefix")
    if _starts_with_test_prefix(_external_id(question, metadata)):
        evidence.add("explicit_test:external_id_prefix")

    batch_ids = {
        str(value)
        for value in (
            [_field(batch, "id")] if batch is not None else []
        )
        if value is not None
    }
    for audit in audits:
        batch_id = _field(audit, "batch_id", "batchId")
        if batch_id is not None:
            batch_ids.add(str(batch_id))
        detail = _field(audit, "detail", default={})
        if isinstance(detail, Mapping) and detail.get("testFixture") is True:
            evidence.add("explicit_test:audit_fixture")
    if batch_ids & SEEDED_TEST_BATCH_IDS:
        evidence.add("explicit_test:seeded_batch")

    return evidence


def _verified_import_evidence(
    audits: Sequence[object], batch: object | None
) -> tuple[set[str], bool, bool]:
    actions = {
        str(action)
        for action in (_field(audit, "action") for audit in audits)
        if action is not None
    }
    verified_actions = actions & VERIFIED_IMPORT_ACTIONS
    committed_import = (
        batch is not None
        and _normalized_token(_field(batch, "status")) == "committed"
        and bool(verified_actions)
    )
    verified_legacy = "legacy_import_verified" in actions

    evidence: set[str] = set()
    if committed_import:
        evidence.add("verified_import:committed_batch")
        evidence.update(f"verified_import:audit_{action}" for action in verified_actions)
    elif verified_legacy:
        evidence.add("verified_import:audit_legacy_import_verified")
    return evidence, committed_import, verified_legacy


def classify_question(
    question: object,
    audit_rows: Sequence[object],
    batch: object | None,
) -> QuestionCleanupDecision:
    """Classify one question using explicit, ordered provenance evidence.

    Apparent origin metadata never proves an import.  A committed upload batch
    plus a recognized audit action, or an explicit legacy-verification audit,
    is required.  Any explicit automated-test signal overrides those proofs.
    """

    question_id = _field(question, "id")
    metadata = _question_metadata(question)
    audits = list(audit_rows)

    explicit_test = _explicit_test_evidence(question, metadata, audits, batch)
    import_evidence, committed_import, verified_legacy = _verified_import_evidence(
        audits, batch
    )
    origin = _origin_token(metadata)

    evidence = set(explicit_test)
    evidence.update(import_evidence)
    if origin in _KNOWN_NON_IMPORTED_ORIGINS:
        evidence.add("source:known_non_imported")

    if explicit_test:
        decision = "delete_explicit_test"
    elif committed_import:
        decision = "keep_formal_import"
    elif verified_legacy:
        decision = "keep_formal_import"
    elif origin in _KNOWN_NON_IMPORTED_ORIGINS:
        decision = "delete_non_imported"
    else:
        decision = "review"
        evidence.add("source:ambiguous")

    return QuestionCleanupDecision(
        questionId=str(question_id or ""),
        decision=decision,
        evidenceCodes=sorted(evidence),
        sourceFingerprint=_source_fingerprint(question, metadata, audits, batch),
        affectedReferenceIds=[],
    )


def _canonical_json(value: object) -> str:
    return json.dumps(
        _canonical_value(value),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def _sha256(value: object) -> str:
    return hashlib.sha256(_canonical_json(value).encode("utf-8")).hexdigest()


def _live_question_fingerprint(
    question: Question,
    source_fingerprint: str,
) -> str:
    """Hash all mutable business fields, excluding server timestamps."""

    excluded = {"created_at", "updated_at"}
    values = {
        column.name: getattr(question, column.key)
        for column in Question.__table__.columns
        if column.key not in excluded
    }
    return _sha256(
        {
            "policyVersion": CLEANUP_POLICY_VERSION,
            "question": values,
            "sourceFingerprint": source_fingerprint,
        }
    )


def _audit_question_id(audit: QuestionAuditLog, live_ids: set[str]) -> str | None:
    if audit.question_id and audit.question_id in live_ids:
        return str(audit.question_id)
    if audit.entity_type == "question" and audit.entity_id in live_ids:
        return str(audit.entity_id)
    return None


def _batch_for_question(
    audits: Sequence[QuestionAuditLog],
    batches: Mapping[str, QuestionUploadBatch],
) -> QuestionUploadBatch | None:
    candidates: dict[str, QuestionUploadBatch] = {}
    for audit in audits:
        batch_id = str(audit.batch_id) if audit.batch_id is not None else ""
        batch = batches.get(batch_id)
        if (
            batch is not None
            and audit.action in VERIFIED_IMPORT_ACTIONS
            and _normalized_token(batch.status) == "committed"
        ):
            candidates[batch_id] = batch
    if not candidates:
        return None
    return sorted(candidates.values(), key=lambda row: str(row.id))[0]


def _manifest_payload(report: QuestionCleanupReport) -> dict[str, Any]:
    payload = report.model_dump(mode="json", by_alias=True)
    payload.pop("generatedAt", None)
    payload.pop("manifestHash", None)
    return payload


def calculate_manifest_hash(report: QuestionCleanupReport) -> str:
    """Hash canonical report content while excluding time and the hash itself."""

    return _sha256(_manifest_payload(report))


class QuestionCleanupReviewDecisionError(ValueError):
    """The human-review file does not exactly resolve one report's review set."""


class QuestionCleanupApplyError(ValueError):
    """The approved cleanup cannot be safely applied to the current snapshot."""


@dataclass
class QuestionCleanupBackupReceipt:
    """Verified backup evidence supplied by the separately gated caller."""

    path: str
    sha256: str
    confirmation: str
    device: int | None = None
    inode: int | None = None


@dataclass(frozen=True)
class QuestionCleanupApplyResult:
    """Committed cleanup identity and the counts needed by later verification."""

    audit_id: str
    manifest_hash: str
    snapshot_hash: str
    deleted_question_ids: list[str]
    repaired_reference_count: int
    preserved_reference_count: int
    teaching_revision: int
    repair_summary: dict[str, object]
    completed_at: datetime


def _validate_apply_report(report: QuestionCleanupReport) -> None:
    if calculate_manifest_hash(report) != report.manifest_hash:
        raise QuestionCleanupApplyError(
            "report manifest hash does not match its current content"
        )
    if report.summary.review_count or report.review:
        raise QuestionCleanupApplyError(
            "cleanup report still contains unresolved review rows"
        )
    all_rows = [*report.keep, *report.delete, *report.review]
    duplicate_ids = sorted(
        question_id
        for question_id, count in Counter(
            item.question_id for item in all_rows
        ).items()
        if count > 1
    )
    if duplicate_ids:
        raise QuestionCleanupApplyError(
            f"cleanup report contains duplicate question IDs: {duplicate_ids}"
        )
    if any(item.decision != "keep_formal_import" for item in report.keep):
        raise QuestionCleanupApplyError("cleanup keep section has an invalid decision")
    if any(
        item.decision not in {"delete_explicit_test", "delete_non_imported"}
        for item in report.delete
    ):
        raise QuestionCleanupApplyError("cleanup delete section has an invalid decision")
    repair_reference_count = sum(
        row.repair_action == "remove_question_and_recalculate"
        for row in report.references
    )
    preserved_reference_count = sum(
        row.repair_action == "preserve_historical_snapshot"
        for row in report.references
    )
    expected_counts = {
        "total": len(all_rows),
        "keep": len(report.keep),
        "delete": len(report.delete),
        "review": len(report.review),
        "references": len(report.references),
        "repairReferences": repair_reference_count,
        "preservedReferences": preserved_reference_count,
    }
    actual_counts = {
        "total": report.summary.total_count,
        "keep": report.summary.keep_count,
        "delete": report.summary.delete_count,
        "review": report.summary.review_count,
        "references": report.summary.reference_count,
        "repairReferences": report.summary.repair_reference_count,
        "preservedReferences": report.summary.preserved_reference_count,
    }
    if actual_counts != expected_counts:
        raise QuestionCleanupApplyError("cleanup report summary counts are inconsistent")


def _validate_backup_receipt(
    report: QuestionCleanupReport,
    receipt: QuestionCleanupBackupReceipt,
) -> Path:
    candidate = Path(str(receipt.path or "")).expanduser()
    try:
        path_stat = candidate.lstat()
    except OSError as exc:
        raise QuestionCleanupApplyError(
            "verified backup path does not exist"
        ) from exc
    if stat.S_ISLNK(path_stat.st_mode):
        raise QuestionCleanupApplyError(
            "verified backup path must not be a symbolic link"
        )
    if not stat.S_ISREG(path_stat.st_mode):
        raise QuestionCleanupApplyError(
            "verified backup must be a regular file"
        )
    try:
        resolved = candidate.resolve(strict=True)
    except OSError as exc:
        raise QuestionCleanupApplyError(
            "verified backup path changed during validation"
        ) from exc
    flags = os.O_RDONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(candidate, flags)
    except OSError as exc:
        try:
            changed_to_symlink = stat.S_ISLNK(candidate.lstat().st_mode)
        except OSError:
            changed_to_symlink = False
        if changed_to_symlink:
            raise QuestionCleanupApplyError(
                "verified backup path changed to a symbolic link"
            ) from exc
        raise QuestionCleanupApplyError(
            "verified backup must open as a regular file"
        ) from exc
    try:
        file_stat = os.fstat(descriptor)
        if not stat.S_ISREG(file_stat.st_mode):
            raise QuestionCleanupApplyError(
                "verified backup must be a regular file"
            )
        if (
            receipt.device is not None
            and receipt.inode is not None
            and (
                int(receipt.device) != int(file_stat.st_dev)
                or int(receipt.inode) != int(file_stat.st_ino)
            )
        ):
            raise QuestionCleanupApplyError(
                "verified backup file identity changed after CLI validation"
            )
        digest = hashlib.sha256()
        while chunk := os.read(descriptor, 1024 * 1024):
            digest.update(chunk)
        actual_hash = digest.hexdigest()

        try:
            final_path_stat = candidate.lstat()
        except OSError as exc:
            raise QuestionCleanupApplyError(
                "verified backup path changed during validation"
            ) from exc
        if stat.S_ISLNK(final_path_stat.st_mode):
            raise QuestionCleanupApplyError(
                "verified backup path changed to a symbolic link"
            )
        if (
            int(final_path_stat.st_dev) != int(file_stat.st_dev)
            or int(final_path_stat.st_ino) != int(file_stat.st_ino)
        ):
            raise QuestionCleanupApplyError(
                "verified backup path identity changed during validation"
            )
    finally:
        os.close(descriptor)
    if not hmac.compare_digest(actual_hash, str(receipt.sha256 or "")):
        raise QuestionCleanupApplyError("backup SHA-256 does not match its bytes")
    expected_confirmation = f"DELETE-QUESTION-POOL:{report.manifest_hash[:12]}"
    if not hmac.compare_digest(
        expected_confirmation,
        str(receipt.confirmation or ""),
    ):
        raise QuestionCleanupApplyError("typed confirmation token does not match")
    return resolved


def _canonical_reference_rows(report: QuestionCleanupReport) -> list[dict[str, Any]]:
    rows = [
        row.model_dump(mode="json", by_alias=True)
        for row in report.references
    ]
    return sorted(rows, key=_canonical_json)


def _validate_approved_report_against_current(
    approved: QuestionCleanupReport,
    current: QuestionCleanupReport,
) -> None:
    if _canonical_reference_rows(approved) != _canonical_reference_rows(current):
        raise QuestionCleanupApplyError(
            "approved cleanup references do not match the locked report"
        )

    approved_rows = {
        row.question_id: row
        for row in [*approved.keep, *approved.delete, *approved.review]
    }
    current_rows = {
        row.question_id: row
        for row in [*current.keep, *current.delete, *current.review]
    }
    if set(approved_rows) != set(current_rows):
        raise QuestionCleanupApplyError(
            "approved cleanup question set is not closed over the locked report"
        )

    current_review_ids = {row.question_id for row in current.review}
    for question_id in sorted(current_rows):
        automatic = current_rows[question_id]
        approved_row = approved_rows[question_id]
        if question_id not in current_review_ids:
            if approved_row != automatic:
                raise QuestionCleanupApplyError(
                    "approved cleanup classification differs from locked automatic evidence"
                )
            continue

        if approved_row.decision not in {
            "keep_formal_import",
            "delete_non_imported",
        }:
            raise QuestionCleanupApplyError(
                "approved cleanup review classification is invalid"
            )
        if (
            approved_row.source_fingerprint != automatic.source_fingerprint
            or approved_row.affected_reference_ids
            != automatic.affected_reference_ids
        ):
            raise QuestionCleanupApplyError(
                "approved cleanup review evidence differs from locked report"
            )
        automatic_codes = set(automatic.evidence_codes)
        approved_codes = set(approved_row.evidence_codes)
        human_codes = {
            code for code in approved_codes if code.startswith("human-review:")
        }
        if (
            automatic_codes - approved_codes
            or approved_codes - automatic_codes != human_codes
            or len(human_codes) != 1
            or next(iter(human_codes)) == "human-review:"
        ):
            raise QuestionCleanupApplyError(
                "approved cleanup review evidence is not one explicit human decision"
            )


async def apply_cleanup(
    db: AsyncSession,
    report: QuestionCleanupReport,
    actor: str,
    backup_receipt: QuestionCleanupBackupReceipt,
) -> QuestionCleanupApplyResult:
    """Apply one approved manifest atomically and append its immutable audit."""

    _validate_apply_report(report)
    backup_path = _validate_backup_receipt(report, backup_receipt)
    actor_username = str(actor or "").strip()
    if not actor_username:
        raise QuestionCleanupApplyError("cleanup actor is required")

    started_at = datetime.now(timezone.utc)
    deleted_question_ids = sorted(
        {str(item.question_id) for item in report.delete}
    )
    deleted_question_id_set = set(deleted_question_ids)
    try:
        await teaching_content_revision_service.acquire_cleanup_lock(db)
        prior_audit = (
            await db.execute(
                select(QuestionCleanupAudit.id).where(
                    QuestionCleanupAudit.manifest_hash == report.manifest_hash
                )
            )
        ).scalar_one_or_none()
        if prior_audit is not None:
            raise QuestionCleanupApplyError(
                "this cleanup manifest was already applied successfully"
            )

        current_report = await build_report(db)
        if not hmac.compare_digest(
            current_report.snapshot_hash,
            report.snapshot_hash,
        ):
            raise QuestionCleanupApplyError(
                "database snapshot changed after cleanup approval"
            )
        _validate_approved_report_against_current(report, current_report)

        target_questions = list(
            (
                await db.execute(
                    select(Question)
                    .where(Question.id.in_(deleted_question_ids))
                    .order_by(Question.id)
                    .with_for_update()
                )
            )
            .scalars()
            .all()
        )
        locked_question_ids = {str(row.id) for row in target_questions}
        if locked_question_ids != deleted_question_id_set:
            raise QuestionCleanupApplyError(
                "cleanup target question rows changed after snapshot verification"
            )

        await db.execute(
            select(QuestionEditLock)
            .where(QuestionEditLock.question_id.in_(deleted_question_ids))
            .with_for_update()
        )
        await db.execute(
            select(QuestionAuditLog)
            .where(
                or_(
                    QuestionAuditLog.question_id.in_(deleted_question_ids),
                    (
                        (QuestionAuditLog.entity_type == "question")
                        & QuestionAuditLog.entity_id.in_(deleted_question_ids)
                    ),
                )
            )
            .with_for_update()
        )
        for model in (TrainingProgress, RecallProgress, LearningEvent):
            await db.execute(
                select(model)
                .where(model.question_id.in_(deleted_question_ids))
                .with_for_update()
            )

        question_domains = {
            str(question_id): domain
            for question_id, domain in (
                await db.execute(select(Question.id, Question.domain))
            ).all()
        }
        repair_summary = await repair_current_question_references(
            db,
            deleted_question_id_set,
            actor_username=actor_username,
            question_domains=question_domains,
        )

        repaired_references = sorted(
            (
                reference
                for reference in report.references
                if reference.question_id in deleted_question_id_set
                and reference.repair_action
                == "remove_question_and_recalculate"
            ),
            key=lambda row: row.reference_id,
        )
        preserved_references = sorted(
            (
                reference
                for reference in report.references
                if reference.question_id in deleted_question_id_set
                and reference.repair_action == "preserve_historical_snapshot"
            ),
            key=lambda row: row.reference_id,
        )
        repair_summary = {
            **repair_summary,
            "repairedReferenceIds": [
                row.reference_id for row in repaired_references
            ],
            "publishedHistoricalReferences": [
                row.model_dump(mode="json", by_alias=True)
                for row in preserved_references
            ],
        }

        await db.execute(
            delete(TrainingProgress).where(
                TrainingProgress.question_id.in_(deleted_question_ids)
            )
        )
        await db.execute(
            delete(RecallProgress).where(
                RecallProgress.question_id.in_(deleted_question_ids)
            )
        )
        await db.execute(
            delete(LearningEvent).where(
                LearningEvent.question_id.in_(deleted_question_ids)
            )
        )
        await db.execute(
            delete(QuestionEditLock).where(
                QuestionEditLock.question_id.in_(deleted_question_ids)
            )
        )
        await db.execute(
            delete(QuestionAuditLog).where(
                or_(
                    QuestionAuditLog.question_id.in_(deleted_question_ids),
                    (
                        (QuestionAuditLog.entity_type == "question")
                        & QuestionAuditLog.entity_id.in_(deleted_question_ids)
                    ),
                )
            )
        )

        bank_id_by_question = {
            str(question.id): str(question.bank_id)
            for question in target_questions
        }
        for question in target_questions:
            await db.delete(question)
        await db.flush()

        preserved_question_ids = {
            row.question_id for row in preserved_references
        }
        published_dependency_bank_ids = {
            bank_id_by_question[question_id]
            for question_id in preserved_question_ids
            if question_id in bank_id_by_question
        }
        published_dependency_bank_ids.update(
            str(bank_id)
            for bank_id in repair_summary.get("publishedBankIds", [])
            if str(bank_id) in set(bank_id_by_question.values())
        )
        candidate_bank_ids = sorted(set(bank_id_by_question.values()))
        deleted_bank_ids: list[str] = []
        deleted_upload_batch_ids: list[str] = []
        retained_empty_bank_ids: list[str] = []
        if candidate_bank_ids:
            banks = list(
                (
                    await db.execute(
                        select(QuestionBank)
                        .where(QuestionBank.id.in_(candidate_bank_ids))
                        .order_by(QuestionBank.id)
                        .with_for_update()
                    )
                )
                .scalars()
                .all()
            )
            for bank in banks:
                remaining_count = int(
                    (
                        await db.execute(
                            select(func.count())
                            .select_from(Question)
                            .where(Question.bank_id == bank.id)
                        )
                    ).scalar_one()
                )
                if remaining_count:
                    continue
                if bank.id in published_dependency_bank_ids:
                    retained_empty_bank_ids.append(str(bank.id))
                    continue
                batches = list(
                    (
                        await db.execute(
                            select(QuestionUploadBatch)
                            .where(QuestionUploadBatch.bank_id == bank.id)
                            .order_by(QuestionUploadBatch.id)
                            .with_for_update()
                        )
                    )
                    .scalars()
                    .all()
                )
                batch_ids = [str(batch.id) for batch in batches]
                if batch_ids:
                    await db.execute(
                        select(QuestionAuditLog)
                        .where(QuestionAuditLog.batch_id.in_(batch_ids))
                        .with_for_update()
                    )
                    await db.execute(
                        delete(QuestionAuditLog).where(
                            QuestionAuditLog.batch_id.in_(batch_ids)
                        )
                    )
                    for batch in batches:
                        deleted_upload_batch_ids.append(str(batch.id))
                        await db.delete(batch)
                deleted_bank_ids.append(str(bank.id))
                await db.delete(bank)
        repair_summary["deletedBankIds"] = sorted(deleted_bank_ids)
        repair_summary["deletedUploadBatchIds"] = sorted(
            deleted_upload_batch_ids
        )
        repair_summary["retainedEmptyBankIds"] = sorted(retained_empty_bank_ids)

        revision = await teaching_content_revision_service.bump_cleanup(
            db,
            actor_username,
            report.manifest_hash,
        )
        completed_at = datetime.now(timezone.utc)
        audit = QuestionCleanupAudit(
            id=f"qca_{hashlib.sha256((report.manifest_hash + completed_at.isoformat()).encode()).hexdigest()[:32]}",
            manifest_hash=report.manifest_hash,
            snapshot_hash=report.snapshot_hash,
            actor_username=actor_username,
            backup_path=str(backup_path),
            backup_sha256=backup_receipt.sha256,
            total_count=report.summary.total_count,
            retained_count=report.summary.keep_count,
            deleted_count=len(deleted_question_ids),
            repaired_reference_count=len(repaired_references),
            preserved_reference_count=len(preserved_references),
            deleted_question_ids=deleted_question_ids,
            repair_summary=repair_summary,
            teaching_revision=int(revision["revision"]),
            started_at=started_at,
            completed_at=completed_at,
        )
        db.add(audit)
        await db.flush()
        await db.commit()
        await db.refresh(audit)
        return QuestionCleanupApplyResult(
            audit_id=audit.id,
            manifest_hash=audit.manifest_hash,
            snapshot_hash=audit.snapshot_hash,
            deleted_question_ids=list(audit.deleted_question_ids),
            repaired_reference_count=audit.repaired_reference_count,
            preserved_reference_count=audit.preserved_reference_count,
            teaching_revision=audit.teaching_revision,
            repair_summary=dict(audit.repair_summary),
            completed_at=audit.completed_at,
        )
    except QuestionCleanupReferenceRepairError as exc:
        await db.rollback()
        raise QuestionCleanupApplyError(str(exc)) from exc
    except BaseException:
        await db.rollback()
        raise


def apply_review_decisions(
    report: QuestionCleanupReport,
    decisions: QuestionCleanupReviewDecisionFile | Mapping[str, Any],
) -> QuestionCleanupReport:
    """Resolve every ambiguous row exactly once without mutating stored data."""

    if calculate_manifest_hash(report) != report.manifest_hash:
        raise QuestionCleanupReviewDecisionError(
            "report manifest hash does not match its current content"
        )

    try:
        decision_payload = (
            decisions.model_dump(mode="json", by_alias=True)
            if isinstance(decisions, QuestionCleanupReviewDecisionFile)
            else decisions
        )
        decisions = QuestionCleanupReviewDecisionFile.model_validate(
            decision_payload
        )
    except Exception as exc:
        raise QuestionCleanupReviewDecisionError(
            f"invalid review decisions: {exc}"
        ) from exc

    if decisions.manifest_hash != report.manifest_hash:
        raise QuestionCleanupReviewDecisionError(
            "manifest hash does not match the reviewed report"
        )

    review_ids = [item.question_id for item in report.review]
    duplicate_review_ids = sorted(
        question_id
        for question_id, count in Counter(review_ids).items()
        if count > 1
    )
    if duplicate_review_ids:
        raise QuestionCleanupReviewDecisionError(
            f"report contains duplicate review IDs: {duplicate_review_ids}"
        )

    decision_ids = [item.question_id for item in decisions.decisions]
    duplicate_ids = sorted(
        question_id
        for question_id, count in Counter(decision_ids).items()
        if count > 1
    )
    if duplicate_ids:
        raise QuestionCleanupReviewDecisionError(
            f"duplicate decision IDs: {duplicate_ids}"
        )

    review_set = set(review_ids)
    decision_set = set(decision_ids)
    missing_ids = sorted(review_set - decision_set)
    if missing_ids:
        raise QuestionCleanupReviewDecisionError(
            f"missing decisions for review IDs: {missing_ids}"
        )
    extra_ids = sorted(decision_set - review_set)
    if extra_ids:
        raise QuestionCleanupReviewDecisionError(
            f"extra decisions outside review set: {extra_ids}"
        )

    decisions_by_id = {item.question_id: item for item in decisions.decisions}
    resolved_keep: list[QuestionCleanupDecision] = []
    resolved_delete: list[QuestionCleanupDecision] = []
    for original in report.review:
        human = decisions_by_id[original.question_id]
        resolved = QuestionCleanupDecision.model_validate(
            {
                **original.model_dump(mode="json", by_alias=True),
                "decision": human.decision,
                "evidenceCodes": [
                    *original.evidence_codes,
                    f"human-review:{human.reason}",
                ],
            }
        )
        if resolved.decision == "keep_formal_import":
            resolved_keep.append(resolved)
        else:
            resolved_delete.append(resolved)

    keep = sorted([*report.keep, *resolved_keep], key=lambda item: item.question_id)
    delete_rows = sorted(
        [*report.delete, *resolved_delete], key=lambda item: item.question_id
    )
    summary = QuestionCleanupSummary(
        totalCount=len(keep) + len(delete_rows),
        keepCount=len(keep),
        deleteCount=len(delete_rows),
        reviewCount=0,
        referenceCount=report.summary.reference_count,
        repairReferenceCount=report.summary.repair_reference_count,
        preservedReferenceCount=report.summary.preserved_reference_count,
    )
    resolved_report = report.model_copy(
        deep=True,
        update={
            "summary": summary,
            "keep": keep,
            "delete": delete_rows,
            "review": [],
            "manifest_hash": "0" * 64,
        },
    )
    resolved_report.manifest_hash = calculate_manifest_hash(resolved_report)
    return resolved_report


async def build_report(db: AsyncSession) -> QuestionCleanupReport:
    """Build a deterministic cleanup report without mutating business data."""

    await teaching_content_revision_service.acquire_read_lock(db)
    questions = (
        await db.execute(select(Question).order_by(Question.id))
    ).scalars().all()
    live_ids = {str(question.id) for question in questions}

    audits_by_question: dict[str, list[QuestionAuditLog]] = {
        question_id: [] for question_id in live_ids
    }
    audit_rows: list[QuestionAuditLog] = []
    if live_ids:
        audit_rows = (
            await db.execute(
                select(QuestionAuditLog)
                .where(
                    or_(
                        QuestionAuditLog.question_id.in_(live_ids),
                        (
                            (QuestionAuditLog.entity_type == "question")
                            & QuestionAuditLog.entity_id.in_(live_ids)
                        ),
                    )
                )
                .order_by(QuestionAuditLog.id)
            )
        ).scalars().all()
        for audit in audit_rows:
            question_id = _audit_question_id(audit, live_ids)
            if question_id is not None:
                audits_by_question[question_id].append(audit)

    batch_ids = sorted(
        {
            str(audit.batch_id)
            for audit in audit_rows
            if audit.batch_id is not None
        }
    )
    batches: dict[str, QuestionUploadBatch] = {}
    if batch_ids:
        batch_rows = (
            await db.execute(
                select(QuestionUploadBatch)
                .where(QuestionUploadBatch.id.in_(batch_ids))
                .order_by(QuestionUploadBatch.id)
            )
        ).scalars().all()
        batches = {str(row.id): row for row in batch_rows}

    references, reference_snapshot = await inventory_question_references(db)
    reference_ids_by_question: dict[str, list[str]] = {}
    for reference in references:
        reference_ids_by_question.setdefault(reference.question_id, []).append(
            reference.reference_id
        )

    decisions: list[QuestionCleanupDecision] = []
    question_snapshot: list[dict[str, str]] = []
    for question in questions:
        question_id = str(question.id)
        audits = audits_by_question.get(question_id, [])
        batch = _batch_for_question(audits, batches)
        decision = classify_question(question, audits, batch).model_copy(
            update={
                "affected_reference_ids": sorted(
                    set(reference_ids_by_question.get(question_id, []))
                )
            }
        )
        decisions.append(decision)
        question_snapshot.append(
            {
                "questionId": question_id,
                "fingerprint": _live_question_fingerprint(
                    question,
                    decision.source_fingerprint,
                ),
            }
        )

    decisions.sort(key=lambda item: item.question_id)
    keep = [item for item in decisions if item.decision == "keep_formal_import"]
    delete_rows = [
        item
        for item in decisions
        if item.decision in {"delete_explicit_test", "delete_non_imported"}
    ]
    review = [item for item in decisions if item.decision == "review"]
    repair_reference_count = sum(
        item.repair_action == "remove_question_and_recalculate"
        for item in references
    )
    preserved_reference_count = sum(
        item.repair_action == "preserve_historical_snapshot"
        for item in references
    )

    snapshot_hash = _sha256(
        {
            "policyVersion": CLEANUP_POLICY_VERSION,
            "questions": question_snapshot,
            "references": reference_snapshot,
        }
    )
    report = QuestionCleanupReport(
        policyVersion=CLEANUP_POLICY_VERSION,
        generatedAt=datetime.now(timezone.utc),
        summary=QuestionCleanupSummary(
            totalCount=len(decisions),
            keepCount=len(keep),
            deleteCount=len(delete_rows),
            reviewCount=len(review),
            referenceCount=len(references),
            repairReferenceCount=repair_reference_count,
            preservedReferenceCount=preserved_reference_count,
        ),
        keep=keep,
        delete=delete_rows,
        review=review,
        references=references,
        snapshotHash=snapshot_hash,
        manifestHash="0" * 64,
    )
    report.manifest_hash = calculate_manifest_hash(report)
    return report


__all__ = [
    "CLEANUP_POLICY_VERSION",
    "QuestionCleanupReviewDecisionError",
    "QuestionCleanupApplyError",
    "QuestionCleanupBackupReceipt",
    "QuestionCleanupApplyResult",
    "SEEDED_TEST_BATCH_IDS",
    "VERIFIED_IMPORT_ACTIONS",
    "apply_review_decisions",
    "apply_cleanup",
    "build_report",
    "calculate_manifest_hash",
    "classify_question",
]
