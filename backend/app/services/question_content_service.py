from __future__ import annotations

import hashlib
import json
import unicodedata
from copy import deepcopy
from typing import Any, Literal

from app.services import question_answer_service


_INTERNAL_SCOPE_MARKERS = {"internal", "内部使用"}
_PUBLIC_SCOPE_MARKERS = {"public", "可公开"}

_HASH_EXCLUDED_FIELDS = {
    "id",
    "questionId",
    "bankId",
    "sourceQuestionId",
    "sourceBankId",
    "sourceId",
    "source_id",
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
    "teacherNumber",
    "displayNumber",
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


def _unique_principle_ids(values: Any) -> list[str]:
    if not isinstance(values, list):
        return []
    normalized: list[str] = []
    for value in values:
        principle_id = str(value or "").strip()
        if principle_id and principle_id not in normalized:
            normalized.append(principle_id)
    return normalized


def normalize_question_metadata(
    metadata: Any,
    *,
    option_ids: set[str],
) -> dict[str, Any]:
    """Preserve one canonical stem/option binding and derive its legacy index."""

    normalized = deepcopy(metadata) if isinstance(metadata, dict) else {}
    legacy_ids = _unique_principle_ids(normalized.get("principleIds"))
    stem_ids = _unique_principle_ids(normalized.get("stemPrincipleIds"))
    if not stem_ids:
        stem_ids = legacy_ids

    option_map: dict[str, list[str]] = {}
    raw_option_map = normalized.get("optionPrincipleMap")
    if isinstance(raw_option_map, dict):
        for option_id, values in raw_option_map.items():
            normalized_option_id = str(option_id or "").strip()
            if normalized_option_id not in option_ids:
                continue
            principle_ids = _unique_principle_ids(values)
            option_map[normalized_option_id] = principle_ids

    principle_ids = list(stem_ids)
    for option_principles in option_map.values():
        for principle_id in option_principles:
            if principle_id not in principle_ids:
                principle_ids.append(principle_id)

    normalized["stemPrincipleIds"] = stem_ids
    normalized["optionPrincipleMap"] = option_map
    normalized["principleIds"] = principle_ids
    return normalized


def _normalize_correct_answer(
    value: Any,
    *,
    question_type: str,
    option_ids: set[str],
) -> Any:
    if isinstance(value, list):
        members = [str(item).strip() for item in value]
        if (
            question_type == "multiple_choice"
            and len(members) >= 2
            and len(members) == len(set(members))
            and all(
                len(member) == 1 and member in option_ids
                for member in members
            )
        ):
            return "".join(members)
        return deepcopy(value)
    return deepcopy(value)


_DIFFICULTY_ALIASES: dict[str, str] = {
    "基础": "简单",
    "简单": "简单",
    "初级": "简单",
    "easy": "简单",
    "simple": "简单",
    "l1": "简单",
    "1": "简单",
    "中等": "中等",
    "中级": "中等",
    "常规": "中等",
    "medium": "中等",
    "l2": "中等",
    "2": "中等",
    "困难": "困难",
    "难点": "困难",
    "复杂": "困难",
    "高阶": "困难",
    "hard": "困难",
    "l3": "困难",
    "l4": "困难",
    "3": "困难",
    "4": "困难",
}


def normalize_difficulty(value: object) -> str:
    """P4.5.29 差异 21：正式难度统一 简单/中等/困难 三档（Runtime 映射 easy/medium/hard）。

    旧“基础”与英文/L1–L4 只在导入迁移层归一；Question Family 的 difficultyLevel
    是独立的 L1–L4 诊断层级，不走这个字段。
    """
    token = str(value or "").strip().lower()
    return _DIFFICULTY_ALIASES.get(token, "中等")


def normalize_question_payload(payload: dict[str, Any], *, subject: str) -> dict[str, Any]:
    """Normalize known fields without discarding Content Prep extension data."""

    normalized = deepcopy(payload)
    normalized["id"] = str(payload.get("id") or payload.get("questionId") or "").strip()
    normalized["title"] = str(payload.get("title") or "").strip()
    normalized["type"] = str(payload.get("type") or "single_choice").strip()
    normalized["subject"] = str(payload.get("subject") or subject).strip()
    normalized["difficulty"] = normalize_difficulty(payload.get("difficulty"))
    for field in ("domain", "topic", "stage"):
        normalized[field] = _optional_text(payload.get(field))
    normalized["tags"] = deepcopy(payload.get("tags") or [])
    normalized["stemParts"] = deepcopy(payload.get("stemParts") or [])
    normalized["options"] = deepcopy(payload.get("options") or [])

    correct_answer = payload.get("correctAnswer")
    if normalized["type"] == "multiple_choice":
        answer_source = {
            "options": normalized["options"],
            "correctOptionIds": payload.get("correctOptionIds"),
            "correctAnswer": correct_answer,
        }
        if answer_source["correctOptionIds"] is None and correct_answer is None:
            answer_source.pop("correctOptionIds")
        normalized["correctOptionIds"] = question_answer_service.correct_option_ids(
            answer_source
        )
        normalized["correctAnswer"] = None
        correct_ids = set(normalized["correctOptionIds"])
        for option in normalized["options"]:
            if isinstance(option, dict):
                option["correct"] = str(option.get("id") or "") in correct_ids
    else:
        if correct_answer is None:
            correct_answer = next(
                (
                    option.get("id")
                    for option in normalized["options"]
                    if isinstance(option, dict) and option.get("correct") is True
                ),
                None,
            )
        normalized["correctAnswer"] = _normalize_correct_answer(
            correct_answer,
            question_type=normalized["type"],
            option_ids={
                str(option.get("id"))
                for option in normalized["options"]
                if isinstance(option, dict) and option.get("id")
            },
        )
        normalized["correctOptionIds"] = []
    normalized["analysis"] = deepcopy(payload.get("analysis", payload.get("explanation")))
    normalized["translations"] = deepcopy(payload.get("translations") or {})
    normalized["clues"] = deepcopy(payload.get("clues") or [])
    normalized["concepts"] = deepcopy(payload.get("concepts") or [])
    normalized["reasoningSteps"] = deepcopy(payload.get("reasoningSteps") or [])
    normalized["keyPath"] = deepcopy(payload.get("keyPath") or {})
    normalized["metadata"] = normalize_question_metadata(
        payload.get("metadata"),
        option_ids={
            str(option.get("id"))
            for option in normalized["options"]
            if isinstance(option, dict) and option.get("id")
        },
    )
    normalized["status"] = deepcopy(payload.get("status") or {})
    if (
        normalized["type"] == "multiple_choice"
        and not str(normalized["analysis"] or "").strip()
    ):
        normalized["status"]["contentReady"] = False
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


def _duplicate_text(value: Any) -> str:
    normalized = unicodedata.normalize("NFKC", str(value or ""))
    return " ".join(normalized.strip().split()).casefold()


def duplicate_question_signature(payload: dict[str, Any]) -> str:
    """Exact import duplicate key: primary stem, ordered options, answer."""

    normalized = normalize_question_payload(
        payload,
        subject=str(payload.get("subject") or "PMP"),
    )
    stem = "".join(
        str(part.get("text") or "")
        for part in normalized.get("stemParts") or []
        if isinstance(part, dict)
    )
    if not stem:
        translations = normalized.get("translations")
        english = translations.get("en") if isinstance(translations, dict) else {}
        stem = "".join(
            str(part.get("text") or "")
            for part in (english.get("stemParts") or [])
            if isinstance(part, dict)
        )
    signature = {
        "stem": _duplicate_text(stem),
        "options": [
            [_duplicate_text(option.get("id")), _duplicate_text(option.get("text"))]
            for option in normalized.get("options") or []
            if isinstance(option, dict)
        ],
        "answer": (
            normalized.get("correctOptionIds")
            if normalized.get("type") == "multiple_choice"
            else _duplicate_text(normalized.get("correctAnswer"))
        ),
    }
    return json.dumps(signature, ensure_ascii=False, separators=(",", ":"))
