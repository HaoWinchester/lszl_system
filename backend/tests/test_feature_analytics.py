"""用户功能偏好分析：遥测写入、去标识化聚合与权限回归测试。

聚合测试使用独立月份窗口（避开 now() 事件所在的当月）并在用例结束时清理自己
写入的事件，避免共享开发库的跨用例/跨运行数据污染。
"""

import asyncio
import pytest
from datetime import datetime
from uuid import uuid4
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import delete

from app.db.session import AsyncSessionLocal
from app.core.security import uid
from app.main import app
from app.models.analytics import FeatureUsageEvent
from app.schemas.analytics import ALLOWED_FEATURES, FeatureEventCreate

SHANGHAI = ZoneInfo("Asia/Shanghai")


def _name(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:10]}"


def _login(client: TestClient, username: str, password: str = "test1234") -> None:
    response = client.post("/api/v1/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200, response.text


def _create_user(username: str, role: str = "student") -> None:
    admin = TestClient(app)
    _login(admin, "admin", "jbgsnmm~123")
    response = admin.post(
        "/api/v1/users",
        json={"username": username, "password": "test1234", "role": role, "subject": "PMP"},
    )
    assert response.status_code == 200, response.text


def _student_client() -> TestClient:
    username = _name("analytics")
    _create_user(username, "student")
    client = TestClient(app)
    _login(client, username)
    return client


def _admin_client() -> TestClient:
    client = TestClient(app)
    _login(client, "admin", "jbgsnmm~123")
    return client


def _event(
    owner: str,
    feature_key: str,
    event_type: str,
    *,
    occurred_at: datetime,
    action_key: str | None = None,
    duration: int | None = None,
) -> FeatureUsageEvent:
    return FeatureUsageEvent(
        id=uid("fue_"),
        owner_id=owner,
        feature_key=feature_key,
        event_type=event_type,
        action_key=action_key,
        duration_seconds=duration,
        occurred_at=occurred_at,
    )


async def _seed_feature_events(rows: list[FeatureUsageEvent]) -> None:
    async with AsyncSessionLocal() as db:
        for row in rows:
            db.add(row)
        await db.commit()


def _seed(rows: list[FeatureUsageEvent]) -> None:
    asyncio.run(_seed_feature_events(rows))


async def _delete_events_for(owners: list[str]) -> None:
    async with AsyncSessionLocal() as db:
        await db.execute(delete(FeatureUsageEvent).where(FeatureUsageEvent.owner_id.in_(owners)))
        await db.commit()


def _cleanup(owners: list[str]) -> None:
    asyncio.run(_delete_events_for(owners))


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


# ---------------------------------------------------------------- Task 3: 聚合接口


def test_admin_feature_analytics_groups_metrics_without_leaking_users() -> None:
    student = _name("analytics")
    teacher = _name("analytics")
    _create_user(student, "student")
    _create_user(teacher, "teacher")
    mid = datetime(2026, 3, 15, 10, 0, tzinfo=SHANGHAI)
    _seed([
        _event(student, "training", "key_action", action_key="answer_submitted", occurred_at=mid),
        _event(student, "training", "outcome", action_key="answer_correct", occurred_at=mid),
        _event(student, "files", "key_action", action_key="library_saved", occurred_at=mid),
        _event(teacher, "training", "outcome", action_key="answer_incorrect", occurred_at=mid),
    ])
    try:
        response = _admin_client().get(
            "/api/v1/system/feature-analytics",
            params={"start": "2026-03-01", "end": "2026-03-31", "role": "student"},
        )
        assert response.status_code == 200, response.text
        data = response.json()
        training = next(item for item in data["features"] if item["featureKey"] == "training")
        assert training["activeUsers"] == 1
        assert training["outcomeUserRate"] == 1.0
        assert "username" not in str(data)
    finally:
        _cleanup([student, teacher])


def test_feature_analytics_is_admin_only_and_validates_dates() -> None:
    assert (
        _student_client()
        .get("/api/v1/system/feature-analytics?start=2026-07-01&end=2026-07-31")
        .status_code
        == 403
    )
    admin = _admin_client()
    assert (
        admin.get("/api/v1/system/feature-analytics?start=2026-07-31&end=2026-07-01").status_code
        == 422
    )
    assert (
        admin.get("/api/v1/system/feature-analytics?start=2025-01-01&end=2026-01-03").status_code
        == 422
    )
    assert (
        admin.get(
            "/api/v1/system/feature-analytics?start=2026-07-01&end=2026-07-31&role=admin"
        ).status_code
        == 422
    )


def test_feature_analytics_date_boundary_is_inclusive_in_shanghai_timezone() -> None:
    student = _name("analytics")
    _create_user(student, "student")
    last_second = datetime(2026, 6, 30, 23, 59, 59, tzinfo=SHANGHAI)  # 6 月最后 1 秒
    next_midnight = datetime(2026, 7, 1, 0, 0, 0, tzinfo=SHANGHAI)  # 次日凌晨（超出 6 月）
    _seed([
        _event(student, "learning_path", "key_action", action_key="node_completed", occurred_at=last_second),
        _event(student, "learning_path", "key_action", action_key="node_completed", occurred_at=next_midnight),
    ])
    try:
        response = _admin_client().get(
            "/api/v1/system/feature-analytics",
            params={"start": "2026-06-01", "end": "2026-06-30"},
        )
        assert response.status_code == 200, response.text
        learning_path = next(
            item for item in response.json()["features"] if item["featureKey"] == "learning_path"
        )
        # 仅 6/30 当天最后 1 秒的事件进入 6 月区间；7/1 凌晨被排除。
        assert learning_path["activeUsers"] == 1
    finally:
        _cleanup([student])


def test_feature_analytics_returns_all_six_features_for_empty_period() -> None:
    response = _admin_client().get(
        "/api/v1/system/feature-analytics",
        params={"start": "2025-01-01", "end": "2025-01-02"},
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["sampleSize"] == 0
    assert [item["featureKey"] for item in data["features"]] == list(ALLOWED_FEATURES)
    for feature in data["features"]:
        assert feature["activeUsers"] == 0
        assert feature["outcomeUserRate"] == 0.0
        assert feature["quality"]["value"] is None
    assert data["trends"] == []
    assert data["insights"] == []
