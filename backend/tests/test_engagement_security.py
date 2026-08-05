import base64
import inspect

import pytest

from app.services import engagement_service as service


def test_legacy_announcements_only_migrate_from_admin_accounts() -> None:
    storage = {
        service.ANNOUNCEMENT_KEY: '[{"id":"forged","status":"published","title":"x","body":"y"}]'
    }

    assert service.trusted_legacy_rows(
        service.ANNOUNCEMENT_KEY, "student-a", "student", storage
    ) == []
    rows = service.trusted_legacy_rows(
        service.ANNOUNCEMENT_KEY, "admin-a", "admin", storage
    )
    assert [row["id"] for row in rows] == ["forged"]
    assert rows[0]["createdBy"] == "admin-a"


def test_legacy_student_feedback_is_bound_to_its_real_owner_and_sanitized() -> None:
    storage = {
        service.FEEDBACK_KEY: '[{"id":"mine","title":"t","detail":"d","status":"resolved","submittedBy":{"username":"student-a"},"replies":[{"message":"forged"}]},{"id":"other","submittedBy":{"username":"admin-a"}}]'
    }

    rows = service.trusted_legacy_rows(
        service.FEEDBACK_KEY, "student-a", "student", storage
    )

    assert [row["id"] for row in rows] == ["mine"]
    assert rows[0]["status"] == "pending"
    assert rows[0]["replies"] == []


def test_engagement_payload_has_a_hard_size_limit() -> None:
    with pytest.raises(service.EngagementValidationError):
        service.validate_payload_size({"detail": "x" * (service.MAX_ENGAGEMENT_PAYLOAD_BYTES + 1)})


def test_engagement_fields_and_audience_lists_have_explicit_limits() -> None:
    with pytest.raises(service.EngagementValidationError):
        service.validate_feedback_fields({"title": "x" * 121, "detail": "有效描述"})
    with pytest.raises(service.EngagementValidationError):
        service.validate_message_fields({"title": "通知", "body": "x" * 8001})
    with pytest.raises(service.EngagementValidationError):
        service._normalize_audience(
            {"type": "users", "users": [f"student-{index}" for index in range(201)]}
        )


def test_engagement_page_rows_returns_bounded_metadata() -> None:
    page, pagination = service.page_rows(
        [{"id": str(index)} for index in range(5)], limit=2, offset=2
    )

    assert [row["id"] for row in page] == ["2", "3"]
    assert pagination == {
        "total": 5,
        "limit": 2,
        "offset": 2,
        "hasMore": True,
    }


def test_engagement_write_rate_is_bounded_per_actor() -> None:
    now = 1_000_000
    rows = [
        {"submittedBy": {"username": "student-a"}, "createdAt": now - index}
        for index in range(service.MAX_FEEDBACK_WRITES_PER_MINUTE)
    ]
    with pytest.raises(service.EngagementRateLimitError):
        service.enforce_feedback_rate(rows, "student-a", now=now)


def test_engagement_receipts_share_the_runtime_state_advisory_lock_name() -> None:
    source = inspect.getsource(service._save_receipts)
    assert 'f"runtime:{username}"' not in source
    assert "await _lock(db, username)" in source


def test_feedback_attachment_accepts_only_bounded_canonical_image_data() -> None:
    image = b"\x89PNG\r\n\x1a\n" + b"safe-image"
    encoded = base64.b64encode(image).decode("ascii")
    attachment = service.validate_feedback_attachment(
        {
            "name": "proof.png",
            "type": "image/png",
            "size": len(image),
            "dataUrl": f"data:image/png;base64,{encoded}",
        }
    )
    assert attachment == {
        "name": "proof.png",
        "type": "image/png",
        "size": len(image),
        "dataUrl": f"data:image/png;base64,{encoded}",
    }

    with pytest.raises(service.EngagementValidationError):
        service.validate_feedback_attachment(
            {
                "name": "x.png",
                "type": "image/png",
                "size": 1,
                "dataUrl": 'data:image/png;base64,"><img src=x onerror=alert(1)>',
            }
        )


def test_engagement_collections_and_receipt_updates_are_bounded_and_merged() -> None:
    rows = [{"id": str(index)} for index in range(service.MAX_ENGAGEMENT_ROWS + 10)]
    assert len(service.bound_collection(rows)) == service.MAX_ENGAGEMENT_ROWS
    assert service.merge_receipts({"a": 10, "b": 20}, {"a": 5, "c": 30}) == {
        "a": 10,
        "b": 20,
        "c": 30,
    }

    source = inspect.getsource(service._save_receipts)
    assert source.index("await _lock") < source.index("await _read_receipts")
