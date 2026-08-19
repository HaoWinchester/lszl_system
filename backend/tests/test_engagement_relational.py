import inspect

from sqlalchemy import UniqueConstraint

from app.models.engagement import (
    Announcement,
    AnnouncementAudience,
    Feedback,
    FeedbackReceipt,
    FeedbackReply,
    MessageReceipt,
)
from app.services import engagement_service
from app.services import engagement_migration
from app.services.runtime_domain_migration_service import TARGET_MAPPER_REGISTRY


def test_engagement_models_have_relational_tables_and_idempotent_receipts() -> None:
    assert Announcement.__tablename__ == "announcements"
    assert AnnouncementAudience.__tablename__ == "announcement_audiences"
    assert Feedback.__tablename__ == "feedback"
    assert FeedbackReply.__tablename__ == "feedback_replies"
    assert MessageReceipt.__tablename__ == "message_receipts"
    assert FeedbackReceipt.__tablename__ == "feedback_receipts"
    for model in (MessageReceipt, FeedbackReceipt):
        constraints = {
            tuple(constraint.columns.keys())
            for constraint in model.__table__.constraints
            if isinstance(constraint, UniqueConstraint)
        }
        assert any(len(columns) == 2 for columns in constraints)


def test_engagement_service_has_no_runtime_state_dependency() -> None:
    source = inspect.getsource(engagement_service)
    assert "RuntimeState" not in source
    assert "SharedRuntimeState" not in source
    assert "runtime_domain_migration_service" not in source


def test_engagement_migration_mappers_are_registered() -> None:
    assert engagement_service.ANNOUNCEMENT_KEY in TARGET_MAPPER_REGISTRY
    assert engagement_service.FEEDBACK_KEY in TARGET_MAPPER_REGISTRY
    assert "kg_user_message_reads_v1__" in TARGET_MAPPER_REGISTRY
    assert "kg_user_feedback_reply_reads_v1__" in TARGET_MAPPER_REGISTRY
    assert engagement_migration.expected_canonical([{"id":"m","title":"t","body":"b","audience":{"type":"all"}}], engagement_service.ANNOUNCEMENT_KEY)[0]["audience"]["type"] == "all"


def test_patch_audience_without_audience_preserves_existing_target() -> None:
    assert engagement_service._normalize_audience_patch({}, {"type": "users", "users": ["student-a"]}) == {"type": "users", "users": ["student-a"], "roles": []}


def test_engagement_links_and_reply_lengths_are_validated() -> None:
    import pytest
    with pytest.raises(engagement_service.EngagementValidationError):
        engagement_service.validate_message_fields({"title": "t", "body": "b", "link": "javascript:alert(1)"})
    with pytest.raises(engagement_service.EngagementValidationError):
        engagement_service.validate_reply_message("x" * 4001)
