from datetime import datetime, timezone
import asyncio

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.practice_growth import PracticeGrowthAnswer, PracticeGrowthDay, PracticeGrowthSetting
from app.services import practice_growth_service
from test_practice_sessions import (
    PASSWORD as SESSION_PASSWORD,
    _cleanup_released_pmp_paper,
    _practice_fixture_ids,
    _seed_released_pmp_paper,
)


def _login(client: TestClient, username="学生", password="111111"):
    assert client.post("/api/v1/auth/login", json={"username": username, "password": password}).status_code == 200


def test_empty_record_dedup_rollover_goal_and_streak():
    async def scenario():
      owner = "学生"
      async with AsyncSessionLocal() as db:
        await db.execute(delete(PracticeGrowthAnswer).where(PracticeGrowthAnswer.owner_id == owner))
        await db.execute(delete(PracticeGrowthDay).where(PracticeGrowthDay.owner_id == owner))
        await db.execute(delete(PracticeGrowthSetting).where(PracticeGrowthSetting.owner_id == owner))
        await db.commit()
        before = datetime(2026, 1, 31, 15, 59, 59, tzinfo=timezone.utc)
        summary = await practice_growth_service.growth_summary(db, owner, before)
        assert summary["today"] == {"answered": 0, "goal": 10, "completed": False}
        assert len(summary["week"]) == 7
        assert [item["date"] for item in summary["week"]] == [
            "2026-01-26", "2026-01-27", "2026-01-28", "2026-01-29",
            "2026-01-30", "2026-01-31", "2026-02-01",
        ]
        assert [item["days"] for item in summary["milestones"]] == [7, 30, 100]
        assert await practice_growth_service.record_answers(db, owner, ["q1", "q1"], before) == 1
        await db.commit()
        assert await practice_growth_service.record_answers(db, owner, ["q1"], before) == 0
        await db.commit()
        assert (await practice_growth_service.growth_summary(db, owner, before))["today"]["answered"] == 1
        assert (await practice_growth_service.growth_summary(db, "admin", before))["today"]["answered"] == 0
        await practice_growth_service.record_answers(db, owner, ["rolled-back"], before)
        await db.rollback()
        assert (await practice_growth_service.growth_summary(db, owner, before))["today"]["answered"] == 1
        after = datetime(2026, 1, 31, 16, 0, 0, tzinfo=timezone.utc)
        assert (await practice_growth_service.growth_summary(db, owner, after))["date"] == "2026-02-01"
        changed = await practice_growth_service.update_goal(db, owner, 5, after)
        assert changed["today"]["goal"] == 10
        assert changed["configuredGoal"] == 5
        assert changed["goalEffectiveDate"] == "2026-02-02"
        next_day = datetime(2026, 2, 1, 16, 0, tzinfo=timezone.utc)
        assert (await practice_growth_service.growth_summary(db, owner, next_day))["today"]["goal"] == 5
        changed_again = await practice_growth_service.update_goal(db, owner, 20, next_day)
        assert changed_again["today"]["goal"] == 5
        assert changed_again["configuredGoal"] == 20
        assert changed_again["goalEffectiveDate"] == "2026-02-03"
    asyncio.run(scenario())


def test_concurrent_duplicate_answer_is_credited_once():
    async def scenario():
      owner = "乔治008"
      now = datetime(2026, 4, 2, 4, tzinfo=timezone.utc)
      async with AsyncSessionLocal() as db:
        await db.execute(delete(PracticeGrowthAnswer).where(PracticeGrowthAnswer.owner_id == owner))
        await db.execute(delete(PracticeGrowthDay).where(PracticeGrowthDay.owner_id == owner))
        await db.commit()
      async def save():
        async with AsyncSessionLocal() as db:
          credited = await practice_growth_service.record_answers(db, owner, ["shared-question"], now)
          await db.commit()
          return credited
      assert sorted(await asyncio.gather(save(), save())) == [0, 1]
      async with AsyncSessionLocal() as db:
        assert (await practice_growth_service.growth_summary(db, owner, now))["today"]["answered"] == 1
    asyncio.run(scenario())


def test_actual_session_save_counts_wrong_once_and_rejects_replays_events_and_other_owner(monkeypatch):
    ids = _practice_fixture_ids()
    asyncio.run(_seed_released_pmp_paper(ids, domains=["people"]))
    first_day = datetime(2026, 9, 14, 15, 59, tzinfo=timezone.utc)
    monkeypatch.setattr(practice_growth_service, "now_utc", lambda: first_day)
    try:
      with TestClient(app) as client:
        _login(client, ids["student"], SESSION_PASSWORD)
        started = client.post("/api/v1/learning/practice/sessions/start", json={
            "paperId": ids["paper"], "releaseId": ids["release"],
            "mode": "challenge", "count": 1, "order": "paper",
        }).json()["session"]
        question_id = started["questions"][0]["questionId"]
        path = f"/api/v1/learning/practice/sessions/{started['id']}/state"
        invalid = client.patch(path, json={"revision": 1, "answers": {
            question_id: {"selectedAnswer": "forged", "selectionIndex": 1}
        }})
        assert invalid.status_code == 422
        assert client.get("/api/v1/learning/practice/growth").json()["today"]["answered"] == 0

        saved = client.patch(path, json={"revision": 1, "answers": {
            question_id: {"selectedAnswer": "B", "selectionIndex": 1}
        }})
        assert saved.status_code == 200
        assert client.get("/api/v1/learning/practice/growth").json()["today"]["answered"] == 1

        arbitrary = client.post("/api/v1/learning/events", json={
            "eventType": "CLIENT_CLAIMED_ANSWER", "questionId": question_id,
            "payload": {"answered": 999},
        })
        assert arbitrary.status_code == 200
        assert client.get("/api/v1/learning/practice/growth").json()["today"]["answered"] == 1

        second_day = datetime(2026, 9, 14, 16, 0, tzinfo=timezone.utc)
        monkeypatch.setattr(practice_growth_service, "now_utc", lambda: second_day)
        replay = client.patch(path, json={"revision": saved.json()["session"]["revision"], "answers": {
            question_id: {"selectedAnswer": "B", "selectionIndex": 1}
        }})
        assert replay.status_code == 200
        assert client.get("/api/v1/learning/practice/growth").json()["today"]["answered"] == 0

      with TestClient(app) as other:
        _login(other, ids["other_student"], SESSION_PASSWORD)
        assert other.get("/api/v1/learning/practice/growth").json()["today"]["answered"] == 0
    finally:
      asyncio.run(_cleanup_released_pmp_paper(ids))


def test_growth_api_auth_validation_and_default():
    with TestClient(app) as client:
        assert client.get("/api/v1/learning/practice/growth").status_code == 401
        _login(client)
        payload = client.get("/api/v1/learning/practice/growth").json()
        assert payload["timezone"] == "Asia/Shanghai"
        assert client.put("/api/v1/learning/practice/growth/goal", json={"goal": 9}).status_code == 422
        changed = client.put("/api/v1/learning/practice/growth/goal", json={"goal": 20})
        assert changed.status_code == 200
        assert changed.json()["configuredGoal"] == 20


def test_streak_can_end_yesterday_and_handles_year_boundary():
    async def scenario():
      owner = "admin"
      async with AsyncSessionLocal() as db:
        await db.execute(delete(PracticeGrowthAnswer).where(PracticeGrowthAnswer.owner_id == owner))
        await db.execute(delete(PracticeGrowthDay).where(PracticeGrowthDay.owner_id == owner))
        await db.execute(delete(PracticeGrowthSetting).where(PracticeGrowthSetting.owner_id == owner))
        for day in (datetime(2025, 12, 30, 4, tzinfo=timezone.utc), datetime(2025, 12, 31, 4, tzinfo=timezone.utc)):
            await practice_growth_service.record_answers(db, owner, [f"q{i}" for i in range(10)], day)
        await db.commit()
        result = await practice_growth_service.growth_summary(db, owner, datetime(2026, 1, 1, 4, tzinfo=timezone.utc))
        assert result["currentStreak"] == 2
        assert result["longestStreak"] == 2
        assert result["totalCompletedDays"] == 2
    asyncio.run(scenario())
