"""Provenance classifier for the shared question-pool cleanup workflow.

This module intentionally contains no report, apply, delete, or commit logic.
Task 1 is a pure classifier so it can be exercised without touching business
data or a production database.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import date, datetime, timezone
from decimal import Decimal
from enum import Enum
import hashlib
import json
from typing import Any

from app.schemas.question_cleanup import QuestionCleanupDecision


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


__all__ = [
    "CLEANUP_POLICY_VERSION",
    "SEEDED_TEST_BATCH_IDS",
    "VERIFIED_IMPORT_ACTIONS",
    "classify_question",
]
