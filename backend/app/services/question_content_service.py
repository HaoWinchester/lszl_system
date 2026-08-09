from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from typing import Any, Literal


_INTERNAL_SCOPE_MARKERS = {"internal", "内部使用"}
_PUBLIC_SCOPE_MARKERS = {"public", "可公开"}

_HASH_EXCLUDED_FIELDS = {
    "id",
    "questionId",
    "bankId",
    "sourceQuestionId",
    "sourceBankId",
    "contentHash",
    "revision",
    "serverRevision",
    "serverContentHash",
    "lastSyncedAt",
    "lockToken",
    "lock",
    "createdAt",
    "updatedAt",
    "createdBy",
    "updatedBy",
    "actorUsername",
    "actorRole",
    "creatorId",
    "creatorName",
}

_HASH_EXCLUDED_METADATA_FIELDS = {"origin", "lastImport", "idSystem"}


def _scope_values(payload: dict[str, Any]) -> list[str]:
    values: list[str] = []
    explicit_scope = payload.get("scope")
    if isinstance(explicit_scope, str):
        values.append(explicit_scope)

    for tag in payload.get("tags") or []:
        if isinstance(tag, str):
            values.append(tag)
        elif isinstance(tag, dict):
            for key in ("label", "name", "id"):
                value = tag.get(key)
                if isinstance(value, str):
                    values.append(value)

    metadata = payload.get("metadata")
    if isinstance(metadata, dict):
        for path in metadata.get("tagPaths") or []:
            if not isinstance(path, dict):
                continue
            for key in ("label", "name", "id"):
                value = path.get(key)
                if isinstance(value, str):
                    values.append(value)
    return [value.strip().casefold() for value in values]


def normalize_scope(payload: dict[str, Any]) -> Literal["public", "internal"]:
    values = set(_scope_values(payload))
    if values & _INTERNAL_SCOPE_MARKERS:
        return "internal"
    if values & _PUBLIC_SCOPE_MARKERS:
        return "public"
    return "internal"


def _optional_text(value: Any) -> Any:
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    return deepcopy(value)


def normalize_question_payload(payload: dict[str, Any], *, subject: str) -> dict[str, Any]:
    """Normalize known fields without discarding Content Prep extension data."""

    normalized = deepcopy(payload)
    normalized["id"] = str(payload.get("id") or payload.get("questionId") or "").strip()
    normalized["title"] = str(payload.get("title") or "").strip()
    normalized["type"] = str(payload.get("type") or "single_choice").strip()
    normalized["subject"] = str(payload.get("subject") or subject).strip()
    for field in ("difficulty", "domain", "topic", "stage"):
        normalized[field] = _optional_text(payload.get(field))
    normalized["tags"] = deepcopy(payload.get("tags") or [])
    normalized["stemParts"] = deepcopy(payload.get("stemParts") or [])
    normalized["options"] = deepcopy(payload.get("options") or [])

    correct_answer = payload.get("correctAnswer")
    if correct_answer is None:
        correct_answer = next(
            (
                option.get("id")
                for option in normalized["options"]
                if isinstance(option, dict) and option.get("correct") is True
            ),
            None,
        )
    normalized["correctAnswer"] = deepcopy(correct_answer)
    normalized["analysis"] = deepcopy(payload.get("analysis", payload.get("explanation")))
    normalized["translations"] = deepcopy(payload.get("translations") or {})
    normalized["clues"] = deepcopy(payload.get("clues") or [])
    normalized["concepts"] = deepcopy(payload.get("concepts") or [])
    normalized["reasoningSteps"] = deepcopy(payload.get("reasoningSteps") or [])
    normalized["keyPath"] = deepcopy(payload.get("keyPath") or {})
    normalized["metadata"] = deepcopy(payload.get("metadata") or {})
    normalized["status"] = deepcopy(payload.get("status") or {})
    normalized["lifecycle"] = deepcopy(payload.get("lifecycle") or {"status": "active"})
    normalized["teacherNumber"] = _optional_text(payload.get("teacherNumber"))
    normalized["explanation"] = deepcopy(payload.get("explanation"))
    normalized["scope"] = normalize_scope(payload)
    return normalized


def canonical_question_hash(payload: dict[str, Any]) -> str:
    """Hash semantic question content, excluding identity and sync provenance."""

    normalized = normalize_question_payload(payload, subject=str(payload.get("subject") or "PMP"))
    canonical = {
        key: deepcopy(value)
        for key, value in normalized.items()
        if key not in _HASH_EXCLUDED_FIELDS
    }

    metadata = canonical.get("metadata")
    if isinstance(metadata, dict):
        canonical["metadata"] = {
            key: value
            for key, value in metadata.items()
            if key not in _HASH_EXCLUDED_METADATA_FIELDS
        }

    serialized = json.dumps(
        canonical,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()
