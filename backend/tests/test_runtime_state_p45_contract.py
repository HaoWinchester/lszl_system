"""P4.5 runtime-state compatibility contract coverage."""

import pytest

from app.services import runtime_state_service


@pytest.mark.parametrize(
    "key",
    [
        "kg_practice_mistakes_v1__user__learner",
        "kg_recall_association_management_v1__subject__PMP",
        "kg_recall_association_library_v1__subject__PMP",
    ],
)
def test_p45_runtime_key_is_accepted(key: str) -> None:
    """Catches a P4.5 browser compatibility key being rejected at the API boundary."""
    assert runtime_state_service.key_allowed(key)


def test_unknown_p45_key_is_rejected() -> None:
    """Catches accidental broad runtime-key acceptance while adding P4.5 keys."""
    assert not runtime_state_service.key_allowed("kg_p45_unregistered_payload_v1")


def test_p45_recall_library_uses_shared_teacher_storage() -> None:
    """Catches the shared recall library reverting to per-owner storage."""
    key = "kg_recall_association_library_v1__subject__PMP"
    assert (
        runtime_state_service.canonical_teacher_shared_key(key, "teacher", "teacher")
        == key
    )
