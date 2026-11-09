"""History summaries stay small without loading saved practice/report bodies."""

import asyncio
import base64
import json
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event

from app.core.security import now_utc
from app.db.session import AsyncSessionLocal, engine
from app.main import app
from app.models.training import LearningEvent, PracticeSession
from app.models.paper_release import PaperRelease
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


HISTORY_URL = "/api/v1/learning/practice/sessions"


def _login_history_owner(client, ids, key="student"):
    assert client.post("/api/v1/auth/login", json={
        "username": ids[key], "password": PASSWORD,
    }).status_code == 200


def test_history_cursor_reads_all_224_unique_records_with_global_deduplication(history_ids):
    ids = history_ids
    base_time = now_utc()
    token = ids["release"][-10:]

    async def seed():
        async with AsyncSessionLocal() as db:
            for index in range(112):
                db.add(PracticeSession(
                    id=f"paged-modern-{index:03}-{token}", owner_id=ids["student"],
                    paper_id=ids["paper"], release_id=ids["release"],
                    mode="practice", status="completed", stats={"total": index},
                    completed_at=base_time + timedelta(seconds=2 * index),
                    last_saved_at=base_time + timedelta(seconds=2 * index),
                ))
                db.add(LearningEvent(
                    id=f"paged-legacy-{index:03}-{token}", owner_id=ids["student"],
                    event_type=learning_service.PRACTICE_SESSION_EVENT_TYPE,
                    payload={"sessionId": f"paged-legacy-session-{index:03}", "paperName": "Legacy"},
                    created_at=base_time + timedelta(seconds=2 * index + 1),
                ))
            hidden_id = f"paged-hidden-{token}"
            db.add(PracticeSession(
                id=hidden_id, owner_id=ids["student"], paper_id=ids["paper"],
                release_id=ids["release"], mode="practice", status="completed",
                stats={"historyHidden": True}, last_saved_at=base_time + timedelta(seconds=999),
            ))
            for suffix, session_id, offset in [
                ("modern-duplicate", f"paged-modern-000-{token}", 1000),
                ("hidden-duplicate", hidden_id, 1001),
                ("legacy-duplicate", "paged-legacy-session-000", -1),
            ]:
                db.add(LearningEvent(
                    id=f"{suffix}-{token}", owner_id=ids["student"],
                    event_type=learning_service.PRACTICE_SESSION_EVENT_TYPE,
                    payload={"sessionId": session_id}, created_at=base_time + timedelta(seconds=offset),
                ))
            db.add(LearningEvent(
                id=f"other-owner-{token}", owner_id=ids["other_student"],
                event_type=learning_service.PRACTICE_SESSION_EVENT_TYPE,
                payload={"sessionId": f"paged-modern-000-{token}"}, created_at=base_time,
            ))
            await db.commit()

    asyncio.run(seed())
    with TestClient(app) as client:
        _login_history_owner(client, ids)
        response = client.get(HISTORY_URL, params={"limit": 20})
        assert response.status_code == 200
        page = response.json()
        assert len(page["sessions"]) == 20
        assert page["total"] == 224
        assert isinstance(page["nextCursor"], str)
        rows = list(page["sessions"])
        while page["nextCursor"] is not None:
            response = client.get(HISTORY_URL, params={"limit": 17, "cursor": page["nextCursor"]})
            assert response.status_code == 200, response.text
            page = response.json()
            assert len(page["sessions"]) <= 17
            assert page["total"] == 224
            rows.extend(page["sessions"])
        expected = [
            session_id for index in range(111, -1, -1)
            for session_id in (f"paged-legacy-session-{index:03}", f"paged-modern-{index:03}-{token}")
        ]
        assert [row["sessionId"] for row in rows] == expected
        assert len({row["sessionId"] for row in rows}) == 224
        assert rows[-2]["eventId"] == f"paged-legacy-000-{token}"
        _login_history_owner(client, ids, "other_student")
        other = client.get(HISTORY_URL).json()
        assert other["total"] == 1
        assert other["sessions"][0]["sessionId"] == f"paged-modern-000-{token}"


def test_history_cursor_is_stable_for_equal_times_and_new_insertions(history_ids):
    ids = history_ids
    base_time = now_utc()
    token = ids["release"][-10:]

    async def seed(start, stop, saved_at):
        async with AsyncSessionLocal() as db:
            db.add_all([PracticeSession(
                id=f"tied-{index:03}-{token}", owner_id=ids["student"],
                paper_id=ids["paper"], release_id=ids["release"],
                mode="practice", status="completed", completed_at=saved_at, last_saved_at=saved_at,
            ) for index in range(start, stop)])
            await db.commit()

    asyncio.run(seed(0, 45, base_time))
    with TestClient(app) as client:
        _login_history_owner(client, ids)
        first = client.get(HISTORY_URL, params={"limit": 7}).json()
        assert first.get("total") == 45
        assert len(first["sessions"]) == 7
        assert [row["sessionId"] for row in first["sessions"]] == [f"tied-{index:03}-{token}" for index in range(44, 37, -1)]
        asyncio.run(seed(45, 46, base_time + timedelta(seconds=1)))
        rows = list(first["sessions"])
        page = first
        while page["nextCursor"]:
            page = client.get(HISTORY_URL, params={"limit": 7, "cursor": page["nextCursor"]}).json()
            assert page["total"] == 46
            rows.extend(page["sessions"])
        assert [row["sessionId"] for row in rows] == [f"tied-{index:03}-{token}" for index in range(44, -1, -1)]
        assert client.get(HISTORY_URL, params={"limit": 1}).json()["sessions"][0]["sessionId"] == f"tied-045-{token}"


def test_history_includes_global_revenge_and_superseded_release_and_clear_preserves_resume(history_ids):
    ids = history_ids
    base_time = now_utc()
    token = ids["release"][-10:]

    async def seed():
        async with AsyncSessionLocal() as db:
            release = await db.get(PaperRelease, ids["release"])
            release.status = "superseded"
            for index, (mode, status, release_id) in enumerate([
                ("revenge", "paused", None), ("revenge", "completed", None),
                ("practice", "abandoned", None), ("scholar", "completed", ids["release"]),
            ]):
                db.add(PracticeSession(
                    id=f"global-history-{index}-{token}", owner_id=ids["student"],
                    paper_id=ids["paper"] if release_id else None, release_id=release_id,
                    mode=mode, status=status, last_saved_at=base_time + timedelta(seconds=index),
                ))
            await db.commit()

    asyncio.run(seed())
    with TestClient(app) as client:
        _login_history_owner(client, ids)
        page = client.get(HISTORY_URL).json()
        assert page.get("total") == 4
        rows = {row["sessionId"]: row for row in page["sessions"]}
        assert rows[f"global-history-0-{token}"]["paperName"] == "复仇错题"
        assert rows[f"global-history-0-{token}"]["status"] == "paused"
        assert rows[f"global-history-1-{token}"]["paperName"] == "复仇错题"
        assert rows[f"global-history-2-{token}"]["paperName"] == "练习试卷"
        assert rows[f"global-history-3-{token}"]["paperName"] == "PMP 会话模拟卷"
        assert client.delete(HISTORY_URL).status_code == 200
        assert client.get(HISTORY_URL).json() == {"sessions": [], "total": 0, "nextCursor": None}

    async def assert_resume_preserved():
        async with AsyncSessionLocal() as db:
            paused = await db.get(PracticeSession, f"global-history-0-{token}")
            assert paused.status == "paused"
            assert paused.stats["historyHidden"] is True
            assert await db.get(PracticeSession, f"global-history-1-{token}") is None
    asyncio.run(assert_resume_preserved())


def test_history_empty_default_max_limit_and_unauthenticated(history_ids):
    with TestClient(app) as client:
        assert client.get(HISTORY_URL).status_code == 401
        _login_history_owner(client, history_ids)
        for params in ({}, {"limit": 1}, {"limit": 100}):
            response = client.get(HISTORY_URL, params=params)
            assert response.status_code == 200
            assert response.json() == {"sessions": [], "total": 0, "nextCursor": None}


@pytest.mark.parametrize("params", [
    {"limit": 0}, {"limit": 101}, {"limit": "invalid"},
    {"cursor": ""}, {"cursor": "%%%"}, {"cursor": "bm90LWpzb24"},
    {"cursor": base64.urlsafe_b64encode(json.dumps(["2026-01-01T00:00:00", "modern:id"]).encode()).decode()},
    {"cursor": base64.urlsafe_b64encode(json.dumps(["2026-01-01T00:00:00+00:00", 12]).encode()).decode()},
    {"cursor": base64.urlsafe_b64encode(json.dumps({"time": "invalid"}).encode()).decode()},
])
def test_history_rejects_invalid_pagination_input(history_ids, params):
    with TestClient(app) as client:
        _login_history_owner(client, history_ids)
        assert client.get(HISTORY_URL, params=params).status_code == 422


def test_history_without_limit_preserves_100_record_compatibility(history_ids):
    ids = history_ids
    base_time = now_utc()
    token = ids["release"][-10:]

    async def seed():
        async with AsyncSessionLocal() as db:
            db.add_all([PracticeSession(
                id=f"compat-history-{index:03}-{token}", owner_id=ids["student"],
                paper_id=ids["paper"], release_id=ids["release"],
                mode="practice", status="completed",
                completed_at=base_time + timedelta(seconds=index),
                last_saved_at=base_time + timedelta(seconds=index),
            ) for index in range(101)])
            await db.commit()

    asyncio.run(seed())
    with TestClient(app) as client:
        _login_history_owner(client, ids)
        response = client.get(HISTORY_URL)
        assert response.status_code == 200
        page = response.json()
        assert len(page["sessions"]) == 100
        assert page["total"] == 101
        assert page["nextCursor"]
        assert [row["sessionId"] for row in page["sessions"]] == [
            f"compat-history-{index:03}-{token}" for index in range(100, 0, -1)
        ]
