from datetime import datetime, timedelta, timezone
import asyncio

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.practice_growth import PracticeGrowthAnswer, PracticeGrowthDay, PracticeGrowthSetting
from app.models.user import User
from app.services import learning_service, practice_growth_service, practice_session_service
from test_practice_sessions import (
    PASSWORD as SESSION_PASSWORD,
    _cleanup_released_pmp_paper,
    _practice_fixture_ids,
    _seed_released_pmp_paper,
)
from test_practice_learning_api import _create_public_question, _create_student


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
    monkeypatch.setattr(practice_session_service, "now_utc", lambda: first_day)
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
        monkeypatch.setattr(practice_session_service, "now_utc", lambda: second_day)
        replay = client.patch(path, json={"revision": saved.json()["session"]["revision"], "answers": {
            question_id: {"selectedAnswer": "B", "selectionIndex": 1}
        }})
        assert replay.status_code == 200
        assert client.get("/api/v1/learning/practice/growth").json()["today"]["answered"] == 0

        completed = client.post(
            f"/api/v1/learning/practice/sessions/{started['id']}/complete",
            json={
                "revision": replay.json()["session"]["revision"],
                "answers": {
                    question_id: {"selectedAnswer": "B", "selectionIndex": 1}
                },
            },
        )
        assert completed.status_code == 200, completed.text
        # The accepted answer was already credited when its draft was saved on D.
        # Grading that immutable draft during completion on D+1 must not credit D+1.
        assert client.get("/api/v1/learning/practice/growth").json()["today"]["answered"] == 0

        another = client.post("/api/v1/learning/practice/sessions/start", json={
            "paperId": ids["paper"], "releaseId": ids["release"],
            "mode": "challenge", "count": 1, "order": "paper",
        }).json()["session"]
        another_save = client.patch(
            f"/api/v1/learning/practice/sessions/{another['id']}/state",
            json={"revision": 1, "answers": {
                question_id: {"selectedAnswer": "A", "selectionIndex": 1}
            }},
        )
        assert another_save.status_code == 200
        assert client.get("/api/v1/learning/practice/growth").json()["today"]["answered"] == 1

        another_complete = client.post(
            f"/api/v1/learning/practice/sessions/{another['id']}/complete",
            json={
                "revision": another_save.json()["session"]["revision"],
                "answers": {question_id: {"selectedAnswer": "A", "selectionIndex": 1}},
            },
        )
        assert another_complete.status_code == 200, another_complete.text
        same_day_session = client.post("/api/v1/learning/practice/sessions/start", json={
            "paperId": ids["paper"], "releaseId": ids["release"],
            "mode": "challenge", "count": 1, "order": "paper",
        }).json()["session"]
        same_day_save = client.patch(
            f"/api/v1/learning/practice/sessions/{same_day_session['id']}/state",
            json={"revision": 1, "answers": {
                question_id: {"selectedAnswer": "A", "selectionIndex": 1}
            }},
        )
        assert same_day_save.status_code == 200
        assert client.get("/api/v1/learning/practice/growth").json()["today"]["answered"] == 1

        third_day = datetime(2026, 9, 15, 16, 0, tzinfo=timezone.utc)
        monkeypatch.setattr(practice_growth_service, "now_utc", lambda: third_day)
        monkeypatch.setattr(practice_session_service, "now_utc", lambda: third_day)
        upgraded = client.post(
            f"/api/v1/learning/practice/sessions/{same_day_session['id']}/answers",
            json={
                "revision": same_day_save.json()["session"]["revision"],
                "questionId": question_id,
                "selectedAnswer": "A",
            },
        )
        assert upgraded.status_code == 200, upgraded.text
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


def test_pc_revenge_and_verification_variant_handlers_account_stable_sources():
    username = f"growth-handler-{__import__('uuid').uuid4().hex[:8]}"
    _create_student(username)
    source = _create_public_question(title="growth source", taxonomy_id="growth-tax", node_id="growth-node")
    variant = _create_public_question(title="growth variant", taxonomy_id="growth-tax", node_id="growth-node")
    with TestClient(app) as client:
      _login(client, username, "test1234")
      wrong = client.post("/api/v1/learning/practice/answers", json={
          "questionId": source["question"]["id"], "bankId": source["bankId"],
          "selectedAnswer": "B", "sourceMode": "workspace",
      })
      assert wrong.status_code == 200, wrong.text
      mistake = wrong.json()["mistake"]
      assert client.get("/api/v1/learning/practice/growth").json()["today"]["answered"] == 1
      revenge = client.post(
          f"/api/v1/learning/practice/mistakes/{mistake['id']}/revenge-answer",
          json={"selectedAnswer": "B", "requestId": "growth-revenge"},
      )
      assert revenge.status_code == 200, revenge.text
      # Same stable source question remains one credit today.
      assert client.get("/api/v1/learning/practice/growth").json()["today"]["answered"] == 1
      reviewed = client.post(f"/api/v1/learning/practice/mistakes/{mistake['id']}/remediation-reviewed")
      assert reviewed.status_code == 200, reviewed.text
      candidate = client.get(f"/api/v1/learning/practice/mistakes/{mistake['id']}/verification-candidate")
      assert candidate.status_code == 200, candidate.text
      assert candidate.json()["candidate"]["question"]["id"] == variant["question"]["id"]
      verified = client.post(
          f"/api/v1/learning/practice/mistakes/{mistake['id']}/verification",
          json={"questionId": variant["question"]["id"], "selectedAnswer": "A", "requestId": "growth-variant"},
      )
      assert verified.status_code == 200, verified.text
      assert client.get("/api/v1/learning/practice/growth").json()["today"]["answered"] == 2


def test_streak_gaps_and_all_milestone_thresholds():
    async def scenario():
      owner = "admin"
      today = datetime(2026, 8, 31, 4, tzinfo=timezone.utc)
      end = practice_growth_service._local_day(today)
      async with AsyncSessionLocal() as db:
        await db.execute(delete(PracticeGrowthAnswer).where(PracticeGrowthAnswer.owner_id == owner))
        await db.execute(delete(PracticeGrowthDay).where(PracticeGrowthDay.owner_id == owner))
        # Three runs separated by gaps: 7, 30, then 100 days ending today.
        starts_and_lengths = ((end - timedelta(days=140), 7), (end - timedelta(days=130), 30), (end - timedelta(days=99), 100))
        for start, length in starts_and_lengths:
          db.add_all([
              PracticeGrowthDay(owner_id=owner, local_date=start + timedelta(days=i), goal=10, answered=10)
              for i in range(length)
          ])
        await db.commit()
        summary = await practice_growth_service.growth_summary(db, owner, today)
        assert summary["currentStreak"] == 100
        assert summary["longestStreak"] == 100
        assert summary["totalCompletedDays"] == 137
        assert summary["milestones"] == [
            {"days": 7, "unlocked": True},
            {"days": 30, "unlocked": True},
            {"days": 100, "unlocked": True},
        ]
    asyncio.run(scenario())


def test_whole_paper_and_pc_answer_do_not_invert_growth_and_question_locks(monkeypatch):
    ids = _practice_fixture_ids()
    asyncio.run(_seed_released_pmp_paper(ids, domains=["people", "people"]))
    try:
      with TestClient(app) as client:
        _login(client, ids["student"], SESSION_PASSWORD)
        started = client.post("/api/v1/learning/practice/sessions/start", json={
            "paperId": ids["paper"], "releaseId": ids["release"],
            "mode": "challenge", "count": 2, "order": "paper",
        }).json()["session"]
      q1, q2 = [item["questionId"] for item in started["questions"]]
      original = learning_service.record_practice_answer
      q1_finished = asyncio.Event()
      pc_finished = asyncio.Event()

      async def controlled(*args, **kwargs):
        result = await original(*args, **kwargs)
        data = args[2]
        if kwargs.get("account_growth") is False and data.get("questionId") == q1:
          q1_finished.set()
          await asyncio.wait_for(pc_finished.wait(), timeout=3)
        return result

      monkeypatch.setattr(learning_service, "record_practice_answer", controlled)

      async def scenario():
        async def complete_whole():
          async with AsyncSessionLocal() as db:
            user = await db.get(User, ids["student"])
            assert user is not None
            return await practice_session_service.complete_session(db, ids["student"], user, started["id"], {
                "revision": started["revision"],
                "answers": {
                    q1: {"selectedAnswer": "A", "selectionIndex": 1},
                    q2: {"selectedAnswer": "A", "selectionIndex": 2},
                },
            })
        async def answer_pc():
          await asyncio.wait_for(q1_finished.wait(), timeout=3)
          try:
            async with AsyncSessionLocal() as db:
              user = await db.get(User, ids["student"])
              assert user is not None
              return await learning_service.record_practice_answer(db, ids["student"], {
                  "questionId": q2, "bankId": ids["bank"], "releaseId": ids["release"],
                  "selectedAnswer": "A", "sourceMode": "practice_mode",
              }, current_user=user)
          finally:
            pc_finished.set()
        whole, pc = await asyncio.wait_for(asyncio.gather(complete_whole(), answer_pc()), timeout=8)
        assert whole[0]["status"] == "completed"
        assert pc["correct"] is True
      asyncio.run(scenario())
    finally:
      asyncio.run(_cleanup_released_pmp_paper(ids))


def test_session_verification_request_replay_does_not_credit_later_day(monkeypatch):
    username = f"growth-session-verify-{__import__('uuid').uuid4().hex[:8]}"
    _create_student(username)
    source = _create_public_question(title="session verify source", taxonomy_id="session-growth-tax", node_id="session-growth-node")
    variant = _create_public_question(title="session verify variant", taxonomy_id="session-growth-tax", node_id="session-growth-node")
    day_one = datetime(2026, 10, 1, 4, tzinfo=timezone.utc)
    monkeypatch.setattr(practice_growth_service, "now_utc", lambda: day_one)
    monkeypatch.setattr(practice_session_service, "now_utc", lambda: day_one)
    monkeypatch.setattr(learning_service, "now_utc", lambda: day_one)
    with TestClient(app) as client:
      _login(client, username, "test1234")
      wrong = client.post("/api/v1/learning/practice/answers", json={
          "questionId": source["question"]["id"], "bankId": source["bankId"], "selectedAnswer": "B"
      }).json()
      started = client.post("/api/v1/learning/practice/sessions/start", json={
          "mode": "revenge", "count": 1, "order": "paper"
      }).json()["session"]
      answered = client.post(f"/api/v1/learning/practice/sessions/{started['id']}/answers", json={
          "revision": started["revision"], "questionId": source["question"]["id"], "selectedAnswer": "B"
      })
      assert answered.status_code == 200, answered.text
      mistake_id = wrong["mistake"]["id"]
      reviewed = client.post(
          f"/api/v1/learning/practice/sessions/{started['id']}/mistakes/{mistake_id}/remediation",
          json={"revision": answered.json()["session"]["revision"]},
      )
      assert reviewed.status_code == 200, reviewed.text
      verify_path = f"/api/v1/learning/practice/sessions/{started['id']}/mistakes/{mistake_id}/verification"
      verify_body = {
          "revision": reviewed.json()["session"]["revision"],
          "questionId": variant["question"]["id"], "selectedAnswer": "A", "requestId": "session-growth-replay",
      }
      first = client.post(verify_path, json=verify_body)
      assert first.status_code == 200, first.text
      assert client.get("/api/v1/learning/practice/growth").json()["today"]["answered"] == 2
      day_two = datetime(2026, 10, 2, 4, tzinfo=timezone.utc)
      monkeypatch.setattr(practice_growth_service, "now_utc", lambda: day_two)
      monkeypatch.setattr(practice_session_service, "now_utc", lambda: day_two)
      monkeypatch.setattr(learning_service, "now_utc", lambda: day_two)
      replay = client.post(verify_path, json={**verify_body, "revision": first.json()["session"]["revision"]})
      assert replay.status_code == 200, replay.text
      assert replay.json()["verification"]["id"] == first.json()["verification"]["id"]
      assert client.get("/api/v1/learning/practice/growth").json()["today"]["answered"] == 0


def test_abandon_and_pc_answer_do_not_invert_growth_and_question_locks(monkeypatch):
    ids = _practice_fixture_ids()
    asyncio.run(_seed_released_pmp_paper(ids, domains=["people", "people"]))
    try:
      with TestClient(app) as client:
        _login(client, ids["student"], SESSION_PASSWORD)
        started = client.post("/api/v1/learning/practice/sessions/start", json={
            "paperId": ids["paper"], "releaseId": ids["release"],
            "mode": "challenge", "count": 2, "order": "paper",
        }).json()["session"]
      q1, q2 = [item["questionId"] for item in started["questions"]]
      original = learning_service.record_practice_answer
      q1_finished = asyncio.Event()
      pc_finished = asyncio.Event()
      async def controlled(*args, **kwargs):
        result = await original(*args, **kwargs)
        if kwargs.get("account_growth") is False and args[2].get("questionId") == q1:
          q1_finished.set()
          await asyncio.wait_for(pc_finished.wait(), timeout=3)
        return result
      monkeypatch.setattr(learning_service, "record_practice_answer", controlled)
      async def scenario():
        async def abandon():
          async with AsyncSessionLocal() as db:
            user = await db.get(User, ids["student"])
            return await practice_session_service.abandon_session(db, ids["student"], started["id"], {
                "revision": started["revision"],
                "answers": {
                    q1: {"selectedAnswer": "A", "selectionIndex": 1},
                    q2: {"selectedAnswer": "A", "selectionIndex": 2},
                },
            }, user=user)
        async def pc():
          await asyncio.wait_for(q1_finished.wait(), timeout=3)
          try:
            async with AsyncSessionLocal() as db:
              user = await db.get(User, ids["student"])
              return await learning_service.record_practice_answer(db, ids["student"], {
                  "questionId": q2, "bankId": ids["bank"], "releaseId": ids["release"], "selectedAnswer": "A"
              }, current_user=user)
          finally:
            pc_finished.set()
        abandoned, pc_result = await asyncio.wait_for(asyncio.gather(abandon(), pc()), timeout=8)
        assert abandoned["status"] == "abandoned"
        assert pc_result["correct"] is True
      asyncio.run(scenario())
    finally:
      asyncio.run(_cleanup_released_pmp_paper(ids))


@pytest.mark.parametrize('with_request_id', [True, False])
def test_pc_attempt_replay_across_midnight_and_new_attempt(monkeypatch, with_request_id):
    username = f"growth-pc-replay-{__import__('uuid').uuid4().hex[:8]}"
    _create_student(username)
    source = _create_public_question(title="PC attempt", taxonomy_id="pc-growth", node_id="pc-growth")
    now = datetime(2026, 9, 14, 15, 59, 59, tzinfo=timezone.utc)
    monkeypatch.setattr(learning_service, "now_utc", lambda: now)
    monkeypatch.setattr(practice_growth_service, "now_utc", lambda: now)
    body = {"questionId": source["question"]["id"], "bankId": source["bankId"], "selectedAnswer": "B"}
    if with_request_id:
        body["requestId"] = "canvas-attempt-one"
    with TestClient(app) as client:
        _login(client, username, "test1234")
        first = client.post('/api/v1/learning/practice/answers', json=body)
        assert first.status_code == 200, first.text
        assert client.get('/api/v1/learning/practice/growth').json()['today']['answered'] == 1
        now = datetime(2026, 9, 14, 16, 0, 0, tzinfo=timezone.utc)
        replay = client.post('/api/v1/learning/practice/answers', json=body)
        assert replay.status_code == 200, replay.text
        assert client.get('/api/v1/learning/practice/growth').json()['today']['answered'] == 0
        if with_request_id:
            assert replay.json() == first.json()
            conflict = client.post('/api/v1/learning/practice/answers', json={**body, 'selectedAnswer': 'A'})
            assert conflict.status_code == 422
            other_question = _create_public_question(title="different PC question", taxonomy_id="pc-other", node_id="pc-other")
            switched = client.post('/api/v1/learning/practice/answers', json={
                **body, 'questionId': other_question['question']['id'], 'bankId': other_question['bankId'],
            })
            assert switched.status_code == 422
            forged = client.post('/api/v1/learning/events', json={
                'eventType': 'PRACTICE_ANSWER_COMPLETED', 'questionId': body['questionId'],
                'payload': {'requestId': 'canvas-attempt-two', 'response': {}},
            })
            assert forged.status_code == 400
        new = client.post('/api/v1/learning/practice/answers', json={**body, 'requestId': 'canvas-attempt-two'})
        assert new.status_code == 200, new.text
        assert client.get('/api/v1/learning/practice/growth').json()['today']['answered'] == 1
        if with_request_id:
            assert client.post('/api/v1/learning/practice/answers', json=body).json() == first.json()


def test_pc_attempt_receipt_is_atomic_and_serializes_duplicates(monkeypatch):
    username = f"growth-pc-atomic-{__import__('uuid').uuid4().hex[:8]}"
    _create_student(username)
    source = _create_public_question(title="PC atomic", taxonomy_id="pc-atomic", node_id="pc-atomic")
    body = {'questionId': source['question']['id'], 'selectedAnswer': 'B', 'requestId': 'atomic-attempt'}
    original = practice_growth_service.record_answers
    async def fail_after_growth(*args, **kwargs):
        await original(*args, **kwargs)
        raise ValueError('forced transaction rollback')
    with TestClient(app) as client:
        _login(client, username, 'test1234')
        monkeypatch.setattr(practice_growth_service, 'record_answers', fail_after_growth)
        assert client.post('/api/v1/learning/practice/answers', json=body).status_code == 422
        monkeypatch.setattr(practice_growth_service, 'record_answers', original)
        assert client.get('/api/v1/learning/practice/growth').json()['today']['answered'] == 0
    async def scenario():
        async def submit():
            async with AsyncSessionLocal() as db:
                user = await db.get(User, username)
                return await learning_service.record_practice_answer(db, username, body, current_user=user)
        first, second = await asyncio.gather(submit(), submit())
        assert first == second
        assert first['mistake']['wrongCount'] == 1
    asyncio.run(scenario())
