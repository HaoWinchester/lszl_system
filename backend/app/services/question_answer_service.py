"""Canonical option-set handling for multiple-choice questions."""

from __future__ import annotations

from typing import Any


def _option_ids(question: dict[str, Any]) -> list[str]:
    return [
        str(option.get("id") or "").strip()
        for option in question.get("options") or []
        if isinstance(option, dict)
    ]


def normalize_option_ids(values: object, option_ids: list[str]) -> list[str]:
    if not isinstance(values, (list, tuple)):
        return []
    order = {value: index for index, value in enumerate(option_ids)}
    normalized = [str(value or "").strip() for value in values]
    if any(not value or value not in order for value in normalized):
        return []
    return sorted(set(normalized), key=order.__getitem__)


def correct_option_ids(question: dict[str, Any]) -> list[str]:
    option_ids = _option_ids(question)
    explicit = question.get("correctOptionIds")
    if isinstance(explicit, (list, tuple)):
        return normalize_option_ids(explicit, option_ids)

    legacy = question.get("correctAnswer")
    if isinstance(legacy, (list, tuple)):
        return normalize_option_ids(legacy, option_ids)
    legacy_text = str(legacy or "").strip()
    if legacy_text in option_ids:
        return [legacy_text]
    if (
        legacy_text
        and option_ids
        and all(len(option_id) == 1 for option_id in option_ids)
    ):
        return normalize_option_ids(list(legacy_text), option_ids)

    flagged = [
        option_id
        for option_id, option in zip(option_ids, question.get("options") or [])
        if isinstance(option, dict) and option.get("correct") is True
    ]
    return normalize_option_ids(flagged, option_ids)


def _issue(field: str, code: str, message: str) -> dict[str, str]:
    return {"field": field, "code": code, "message": message}


def validate_multiple_choice(
    question: dict[str, Any],
    *,
    require_analysis: bool = False,
) -> list[dict[str, str]]:
    if str(question.get("type") or "single_choice") != "multiple_choice":
        return []

    issues: list[dict[str, str]] = []
    option_ids = _option_ids(question)
    if not 3 <= len(option_ids) <= 8:
        issues.append(_issue("options", "MULTIPLE_CHOICE_OPTIONS_COUNT", "多选题必须包含 3–8 个选项"))
    if any(not option_id for option_id in option_ids) or len(option_ids) != len(set(option_ids)):
        issues.append(_issue("options", "MULTIPLE_CHOICE_OPTION_IDS_INVALID", "多选题选项 ID 必须非空且唯一"))

    raw_correct = question.get("correctOptionIds")
    if isinstance(raw_correct, (list, tuple)):
        raw_ids = [str(value or "").strip() for value in raw_correct]
    else:
        raw_ids = correct_option_ids(question)
    correct_ids = correct_option_ids(question)
    if any(not value or value not in option_ids for value in raw_ids):
        issues.append(_issue("correctOptionIds", "MULTIPLE_CHOICE_CORRECT_OPTION_INVALID", "正确答案只能引用现有选项"))
    elif len(raw_ids) != len(set(raw_ids)):
        issues.append(_issue("correctOptionIds", "MULTIPLE_CHOICE_CORRECT_OPTION_INVALID", "正确答案不能重复"))
    elif len(correct_ids) < 2:
        issues.append(_issue("correctOptionIds", "MULTIPLE_CHOICE_CORRECT_COUNT", "多选题至少需要两个正确选项"))
    elif len(correct_ids) >= len(option_ids):
        issues.append(_issue("correctOptionIds", "MULTIPLE_CHOICE_DISTRACTOR_REQUIRED", "多选题至少需要一个错误选项"))

    if require_analysis and not str(question.get("analysis") or "").strip():
        issues.append(_issue("analysis", "MULTIPLE_CHOICE_ANALYSIS_REQUIRED", "多选题发布前必须填写解析"))
    return issues


def grade_selection(
    question: dict[str, Any],
    selected_option_ids: object,
    *,
    timed_out: bool = False,
) -> dict[str, Any]:
    expected = correct_option_ids(question)
    selected = [] if timed_out else normalize_option_ids(
        selected_option_ids,
        _option_ids(question),
    )
    return {
        "correct": bool(expected) and selected == expected and not timed_out,
        "correctOptionIds": expected,
        "selectedOptionIds": selected,
        "missedCorrectIds": [value for value in expected if value not in selected],
        "wrongSelectedIds": [value for value in selected if value not in expected],
    }
