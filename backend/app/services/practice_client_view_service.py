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
    if allow_current_reveal and mode in IMMEDIATE_REVEAL_MODES:
        return deepcopy(payload)
    return _strip_hidden(payload)
