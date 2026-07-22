"""用户功能偏好分析：遥测写入、去标识化聚合与权限回归测试。"""

import pytest
from pydantic import ValidationError

from app.schemas.analytics import FeatureEventCreate


def test_feature_event_requires_an_allowlisted_feature_action_pair() -> None:
    event = FeatureEventCreate(featureKey="training", eventType="key_action", actionKey="answer_submitted")
    assert event.feature_key == "training"

    with pytest.raises(ValidationError):
        FeatureEventCreate(featureKey="training", eventType="outcome", actionKey="free_text")


def test_engagement_duration_is_only_allowed_for_engaged_events() -> None:
    assert FeatureEventCreate(featureKey="files", eventType="engaged", durationSeconds=12).duration_seconds == 12
    with pytest.raises(ValidationError):
        FeatureEventCreate(featureKey="files", eventType="outcome", durationSeconds=12)
