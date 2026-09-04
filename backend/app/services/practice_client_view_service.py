"""Transport-aware practice response projection.

The website's signed-cookie client keeps its historical payload. Native mini-
program Bearer clients receive a defensive copy with scoring facts removed
until the mode's reveal point.
"""

from copy import deepcopy
from typing import Any


HIDDEN_KEYS = {
    "correct",
    "isCorrect",
    "is_correct",
    "correctAnswer",
    "correct_answer",
    "correctAnswerIds",
    "correct_answer_ids",
    "correctOptionIds",
    "correct_option_ids",
    "analysis",
    "explanation",
    "reasoningSteps",
    "reasoning_steps",
}
IMMEDIATE_REVEAL_MODES = {"practice", "normal", "revenge"}
COMPLETED_STATUSES = {"completed", "complete"}


def _session_context(payload: Any) -> tuple[str, str]:
    if not isinstance(payload, dict):
        return "", ""
    session = payload.get("session")
    candidate = session if isinstance(session, dict) else payload
    return (
        str(candidate.get("mode") or "").strip().lower(),
        str(candidate.get("status") or "").strip().lower(),
    )


def _strip_hidden(value: Any) -> Any:
    if isinstance(value, list):
        return [_strip_hidden(item) for item in value]
    if isinstance(value, dict):
        return {
            key: _strip_hidden(item)
            for key, item in value.items()
            if key not in HIDDEN_KEYS
        }
    return deepcopy(value)


def _reveal_submitted_question(source: dict, projected: dict) -> dict:
    answer = source.get("answer")
    if not isinstance(answer, dict):
        return projected
    projected["answer"] = deepcopy(answer)
    question_id = str(answer.get("questionId") or answer.get("question_id") or "")
    source_session = source.get("session")
    projected_session = projected.get("session")
    if not question_id or not isinstance(source_session, dict) or not isinstance(projected_session, dict):
        return projected
    source_questions = source_session.get("questions")
    projected_questions = projected_session.get("questions")
    if not isinstance(source_questions, list) or not isinstance(projected_questions, list):
        return projected
    for source_entry, projected_entry in zip(source_questions, projected_questions):
        if not isinstance(source_entry, dict) or not isinstance(projected_entry, dict):
            continue
        entry_id = str(
            source_entry.get("questionId")
            or source_entry.get("question_id")
            or (source_entry.get("question") or {}).get("id")
            or ""
        )
        if entry_id == question_id and isinstance(source_entry.get("question"), dict):
            projected_entry["question"] = deepcopy(source_entry["question"])
            break
    return projected


def project_practice_payload(
    payload: Any,
    *,
    transport: str,
    allow_current_reveal: bool = False,
    force_completed_reveal: bool = False,
) -> Any:
    """Return the payload view permitted for the authenticated transport."""

    if transport != "bearer":
        return payload
    if force_completed_reveal:
        return deepcopy(payload)
    mode, status = _session_context(payload)
    if status in COMPLETED_STATUSES:
        return deepcopy(payload)
    projected = _strip_hidden(payload)
    if allow_current_reveal and mode in IMMEDIATE_REVEAL_MODES and isinstance(payload, dict):
        return _reveal_submitted_question(payload, projected)
    return projected
