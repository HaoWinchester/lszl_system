from app.services.idempotency_service import advisory_key


def test_idempotency_advisory_key_is_actor_scoped_and_stable() -> None:
    assert advisory_key("teacher-a", "submit-1") == advisory_key(
        "teacher-a",
        "submit-1",
    )
    assert advisory_key("teacher-a", "submit-1") != advisory_key(
        "teacher-b",
        "submit-1",
    )
    assert advisory_key("teacher-a", "submit-1") != advisory_key(
        "teacher-a",
        "submit-2",
    )


def test_idempotency_advisory_key_is_a_signed_postgres_bigint() -> None:
    value = advisory_key("老师", "导入-001")

    assert -(2**63) <= value < 2**63
