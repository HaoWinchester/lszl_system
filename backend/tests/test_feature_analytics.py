"""用户功能偏好分析：遥测写入、去标识化聚合与权限回归测试。"""

import pytest
from uuid import uuid4

from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import app
from app.schemas.analytics import FeatureEventCreate


def _name(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:10]}"


def _login(client: TestClient, username: str, password: str = "test1234") -> None:
    response = client.post("/api/v1/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200, response.text


def _create_student(username: str) -> None:
    admin = TestClient(app)
    _login(admin, "admin", "admin123")
    response = admin.post(
        "/api/v1/users",
        json={"username": username, "password": "test1234", "role": "student", "subject": "PMP"},
    )
    assert response.status_code == 200, response.text


def _student_client() -> TestClient:
    username = _name("analytics")
    _create_student(username)
    client = TestClient(app)
    _login(client, username)
    return client


# ---------------------------------------------------------------- Task 1: schema 契约


def test_feature_event_requires_an_allowlisted_feature_action_pair() -> None:
    event = FeatureEventCreate(featureKey="training", eventType="key_action", actionKey="answer_submitted")
    assert event.feature_key == "training"

    with pytest.raises(ValidationError):
        FeatureEventCreate(featureKey="training", eventType="outcome", actionKey="free_text")


def test_engagement_duration_is_only_allowed_for_engaged_events() -> None:
    assert FeatureEventCreate(featureKey="files", eventType="engaged", durationSeconds=12).duration_seconds == 12
    with pytest.raises(ValidationError):
        FeatureEventCreate(featureKey="files", eventType="outcome", durationSeconds=12)


# ---------------------------------------------------------------- Task 2: 写入接口


def test_feature_event_write_uses_the_session_user_and_returns_no_identifier() -> None:
    client = _student_client()
    response = client.post(
        "/api/v1/analytics/feature-events",
        json={"featureKey": "training", "eventType": "key_action", "actionKey": "answer_submitted"},
    )
    assert response.status_code == 201, response.text
    assert response.json() == {"ok": True}


def test_feature_event_write_requires_auth_and_rejects_client_identity_fields() -> None:
    assert (
        TestClient(app)
        .post("/api/v1/analytics/feature-events", json={"featureKey": "files", "eventType": "opened"})
        .status_code
        == 401
    )
    client = _student_client()
    response = client.post(
        "/api/v1/analytics/feature-events",
        json={"featureKey": "files", "eventType": "opened", "ownerId": "admin"},
    )
    assert response.status_code == 422
