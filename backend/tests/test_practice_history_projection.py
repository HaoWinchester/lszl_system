"""History summaries stay small without loading saved practice/report bodies."""

import asyncio
import json
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event

from app.core.security import now_utc
from app.db.session import AsyncSessionLocal, engine
from app.main import app
from app.models.training import LearningEvent, PracticeSession
from app.services import learning_service
from test_practice_sessions import (
    PASSWORD,
    _cleanup_released_pmp_paper,
    _practice_fixture_ids,
    _seed_released_pmp_paper,
)


@pytest.fixture
def history_ids():
    ids = _practice_fixture_ids()
    asyncio.run(_seed_released_pmp_paper(ids, domains=["people"]))
    try:
        yield ids
    finally:
        asyncio.run(_cleanup_released_pmp_paper(ids))


def test_history_projects_large_modern_and_legacy_bodies_and_preserves_report_types(history_ids):
    ids = history_ids
    base_time = now_utc()
    blob = "saved-body-" * 20_000

    async def seed():
        async with AsyncSessionLocal() as db:
            for index, (status, report) in enumerate([
                ("completed", {"saved": blob}), ("completed", {}),
                ("completed", []), ("completed", None),
                ("paused", {"saved": blob}), ("abandoned", {"saved": blob}),
            ]):
                saved_at = base_time + timedelta(seconds=index)
                db.add(PracticeSession(
                    id=f"history-{index}-{ids['release'][-10:]}", owner_id=ids["student"],
                    paper_id=ids["paper"], release_id=ids["release"], mode="practice", status=status,
                    question_order=[{"saved": blob}], answers={"saved": blob},
                    runtime_state={"annotations": blob}, scoring_snapshot={"saved": blob},
                    report_snapshot=report,
                    stats={"total": 10, "answered": 5, "correct": 3, "experience": 24, "durationMs": 120000, "unused": blob},
                    last_saved_at=saved_at,
                    completed_at=saved_at if status == "completed" else None,
                    abandoned_at=saved_at if status == "abandoned" else None,
                ))
            db.add_all([
                LearningEvent(
                    id=f"legacy-{ids['release'][-10:]}", owner_id=ids["student"],
                    event_type=learning_service.PRACTICE_SESSION_EVENT_TYPE,
                    created_at=base_time + timedelta(seconds=10),
                    payload={
                        "sessionId": "legacy-session", "releaseId": ids["release"],
                        "paperId": ids["paper"], "paperName": "Legacy paper", "mode": "challenge",
                        "status": "completed", "total": 9, "answered": 7, "correct": 6,
                        "experience": 0, "durationMs": 60000, "questions": [{"answer": blob}],
                        "answers": {"private": blob}, "reportSnapshot": {"private": blob},
                        "trustedExperience": False, "arbitraryPrivate": blob,
                    },
                ),
                LearningEvent(
                    id=f"duplicate-{ids['release'][-10:]}", owner_id=ids["student"],
                    event_type=learning_service.PRACTICE_SESSION_EVENT_TYPE,
                    payload={"sessionId": f"history-0-{ids['release'][-10:]}", "paperName": "Duplicate"},
                    created_at=base_time + timedelta(seconds=11),
                ),
            ])
            await db.commit()

    asyncio.run(seed())
    statements = []

    def record_sql(connection, cursor, statement, parameters, context, executemany):
        statements.append(statement.lower())

    with TestClient(app) as client:
        assert client.post("/api/v1/auth/login", json={"username": ids["student"], "password": PASSWORD}).status_code == 200
        event.listen(engine.sync_engine, "before_cursor_execute", record_sql)
        try:
            response = client.get("/api/v1/learning/practice/sessions")
        finally:
            event.remove(engine.sync_engine, "before_cursor_execute", record_sql)
        assert response.status_code == 200
        rows = response.json()["sessions"]
        assert len(rows) == 7
        assert len(response.content) < 6000
        allowed = {
            "sessionId", "releaseId", "paperId", "paperName", "mode", "status", "total",
            "answered", "correct", "experience", "durationMs", "reportAvailable", "createdAt", "eventId",
        }
        assert all(set(row) <= allowed for row in rows)
        assert rows[0] == {
            "sessionId": "legacy-session", "releaseId": ids["release"],
            "paperId": ids["paper"], "paperName": "Legacy paper", "mode": "challenge",
            "status": "completed", "total": 9, "answered": 7, "correct": 6,
            "experience": 0, "durationMs": 60000, "eventId": f"legacy-{ids['release'][-10:]}",
            "reportAvailable": False, "createdAt": (base_time + timedelta(seconds=10)).isoformat(),
        }
        modern = {row["sessionId"]: row for row in rows[1:]}
        for index, expected_report in enumerate([True, True, False, False, False, False]):
            row = modern[f"history-{index}-{ids['release'][-10:]}"]
            assert row["reportAvailable"] is expected_report
            assert row["paperName"] == "PMP 会话模拟卷"
            assert (row["total"], row["answered"], row["correct"], row["experience"], row["durationMs"]) == (10, 5, 3, 24, 120000)
        queries = "\n".join(statements)
        for field in ("question_order", "answers", "runtime_state", "scoring_snapshot"):
            assert f"practice_sessions.{field}" not in queries
        assert "jsonb_typeof(practice_sessions.report_snapshot)" in queries
        assert "practice_sessions.report_snapshot," not in queries
        assert "practice_sessions.stats," not in queries
        assert "learning_events.payload," not in queries
        assert client.post("/api/v1/auth/login", json={"username": ids["other_student"], "password": PASSWORD}).status_code == 200
        assert client.get("/api/v1/learning/practice/sessions").json()["sessions"] == []

    async def assert_saved_bodies_unchanged():
        async with AsyncSessionLocal() as db:
            session = await db.get(PracticeSession, f"history-0-{ids['release'][-10:]}")
            assert session.report_snapshot == {"saved": blob}
            assert session.answers == {"saved": blob}
    asyncio.run(assert_saved_bodies_unchanged())


def test_history_keeps_owner_isolation_hidden_rows_deduplication_and_merged_limit(history_ids):
    ids = history_ids
    base_time = now_utc()

    async def scenario():
        async with AsyncSessionLocal() as db:
            for index in range(102):
                db.add(PracticeSession(
                    id=f"modern-{index}-{ids['release'][-10:]}", owner_id=ids["student"],
                    paper_id=ids["paper"], release_id=ids["release"], mode="practice", status="completed",
                    stats={"total": index}, last_saved_at=base_time + timedelta(seconds=2 * index),
                    completed_at=base_time + timedelta(seconds=2 * index),
                ))
                db.add(LearningEvent(
                    id=f"legacy-{index}-{ids['release'][-10:]}", owner_id=ids["student"],
                    event_type=learning_service.PRACTICE_SESSION_EVENT_TYPE,
                    payload={"sessionId": f"legacy-{index}", "paperName": "Legacy"},
                    created_at=base_time + timedelta(seconds=2 * index + 1),
                ))
            for owner, suffix, stats in [
                (ids["student"], "hidden", {"historyHidden": True}),
                (ids["other_student"], "other", {}),
            ]:
                db.add(PracticeSession(
                    id=f"{suffix}-{ids['release'][-10:]}", owner_id=owner,
                    paper_id=ids["paper"], release_id=ids["release"], mode="practice", status="completed",
                    stats=stats, last_saved_at=base_time + timedelta(seconds=1000),
                ))
            db.add_all([
                LearningEvent(
                    id=f"duplicate-{ids['release'][-10:]}", owner_id=ids["student"],
                    event_type=learning_service.PRACTICE_SESSION_EVENT_TYPE,
                    payload={"sessionId": f"modern-101-{ids['release'][-10:]}"},
                    created_at=base_time + timedelta(seconds=1001),
                ),
                LearningEvent(
                    id=f"other-{ids['release'][-10:]}", owner_id=ids["other_student"],
                    event_type=learning_service.PRACTICE_SESSION_EVENT_TYPE,
                    payload={"sessionId": "other-private"}, created_at=base_time + timedelta(seconds=1002),
                ),
            ])
            await db.commit()
        async with AsyncSessionLocal() as db:
            rows = await learning_service.list_practice_sessions(db, ids["student"])
            assert len(rows) == 100
            expected = [
                session_id for index in range(101, 51, -1)
                for session_id in (f"legacy-{index}", f"modern-{index}-{ids['release'][-10:]}")
            ]
            assert [row["sessionId"] for row in rows] == expected
            assert len(json.dumps(rows)) < 50_000
    asyncio.run(scenario())
