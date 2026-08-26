"""Persistent, resumable practice session contracts."""

import asyncio
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select

from app.core.security import hash_password, now_utc
from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.paper_release import PaperRelease, PaperReleaseQuestion
from app.models.question import Question, QuestionBank
from app.models.training import (
    LearningEvent,
    PracticeMistake,
    PracticeSession,
    TrainingProgress,
)
from app.models.user import User
from app.services import question_catalog_service
from app.services import practice_session_service


PASSWORD = "practice-session-pass"


def _practice_fixture_ids() -> dict[str, str]:
    token = uuid4().hex[:10]
    return {
        "teacher": f"practice-session-teacher-{token}",
        "student": f"practice-session-student-{token}",
        "other_student": f"practice-session-other-{token}",
        "bank": f"practice-session-bank-{token}",
        "paper": f"practice-session-paper-{token}",
        "release": f"practice-session-release-{token}",
    }


async def _seed_released_pmp_paper(ids: dict[str, str]) -> None:
    async with AsyncSessionLocal() as db:
        db.add_all(
            [
                User(
                    username=ids["teacher"],
                    password_hash=hash_password(PASSWORD),
                    role="teacher",
                    status="active",
                ),
                User(
                    username=ids["student"],
                    password_hash=hash_password(PASSWORD),
                    role="student",
                    status="active",
                ),
                User(
                    username=ids["other_student"],
                    password_hash=hash_password(PASSWORD),
                    role="student",
                    status="active",
                ),
            ]
        )
        await db.flush()
        db.add(
            QuestionBank(
                id=ids["bank"],
                source_id=f"source-{ids['bank']}",
                owner_id=ids["teacher"],
                name="PMP 会话题库",
                subject="PMP",
                visibility="published",
                created_by=ids["teacher"],
                updated_by=ids["teacher"],
            )
        )
        await db.flush()
        questions: list[Question] = []
        domains = ["people"] * 25 + ["process"] * 30 + ["business-environment"] * 5
        for index, domain in enumerate(domains):
            question_id = f"practice-session-q-{ids['release'][-10:]}-{index:03d}"
            question = Question(
                id=question_id,
                source_id=f"source-{question_id}",
                bank_id=ids["bank"],
                title=f"PMP 会话题目 {index + 1}",
                subject="PMP",
                scope="internal",
                stem_parts=[{"text": f"题干 {index + 1}"}],
                options=[
                    {"id": "A", "text": "正确答案", "correct": True},
                    {"id": "B", "text": "干扰项", "correct": False},
                ],
                correct_answer="A",
                content_metadata={
                    "subjectFacets": [
                        {"dimensionId": "exam-domain", "valueId": domain}
                    ]
                },
                created_by=ids["teacher"],
                updated_by=ids["teacher"],
            )
            db.add(question)
            questions.append(question)
        await db.flush()
        db.add(
            PaperRelease(
                id=ids["release"],
                paper_id=ids["paper"],
                version=1,
                status="published",
                name="PMP 会话模拟卷",
                subject="PMP",
                publisher_id=ids["teacher"],
                access_level="free",
                enabled_modes=["practice_mode"],
                allowed_roles=["student"],
                release_metadata={},
                source_payload={},
                question_count=len(questions),
                published_at=now_utc(),
            )
        )
        await db.flush()
        for index, question in enumerate(questions):
            db.add(
                PaperReleaseQuestion(
                    release_id=ids["release"],
                    order_index=index,
                    bank_id=ids["bank"],
                    question_id=question.id,
                    snapshot=question_catalog_service.question_to_payload(question),
                )
            )
        await db.commit()


async def _cleanup_released_pmp_paper(ids: dict[str, str]) -> None:
    async with AsyncSessionLocal() as db:
        await db.execute(
            delete(LearningEvent).where(
                LearningEvent.owner_id.in_([ids["student"], ids["other_student"]])
            )
        )
        await db.execute(
            delete(PracticeMistake).where(PracticeMistake.release_id == ids["release"])
        )
        await db.execute(
            delete(TrainingProgress).where(
                TrainingProgress.release_id == ids["release"]
            )
        )
        await db.execute(
            delete(PracticeSession).where(PracticeSession.release_id == ids["release"])
        )
        await db.execute(
            delete(PaperReleaseQuestion).where(
                PaperReleaseQuestion.release_id == ids["release"]
            )
        )
        await db.execute(delete(PaperRelease).where(PaperRelease.id == ids["release"]))
        await db.execute(delete(Question).where(Question.bank_id == ids["bank"]))
        await db.execute(delete(QuestionBank).where(QuestionBank.id == ids["bank"]))
        await db.execute(
            delete(User).where(
                User.username.in_(
                    [ids["teacher"], ids["student"], ids["other_student"]]
                )
            )
        )
        await db.commit()


async def _remove_business_environment_inventory(release_id: str) -> None:
    async with AsyncSessionLocal() as db:
        rows = (
            await db.execute(
                select(PaperReleaseQuestion).where(
                    PaperReleaseQuestion.release_id == release_id
                )
            )
        ).scalars().all()
        for row in rows:
            snapshot = dict(row.snapshot or {})
            metadata = dict(snapshot.get("metadata") or {})
            facets = [
                dict(facet)
                for facet in metadata.get("subjectFacets") or []
                if isinstance(facet, dict)
            ]
            changed = False
            for facet in facets:
                if (
                    facet.get("dimensionId") == "exam-domain"
                    and facet.get("valueId") == "business-environment"
                ):
                    facet["valueId"] = "people"
                    changed = True
            if changed:
                metadata["subjectFacets"] = facets
                snapshot["metadata"] = metadata
                row.snapshot = snapshot
        await db.commit()


async def _completion_event_count(owner: str, session_id: str) -> int:
    async with AsyncSessionLocal() as db:
        return int(
            (
                await db.execute(
                    select(func.count(LearningEvent.id)).where(
                        LearningEvent.owner_id == owner,
                        LearningEvent.event_type == "PRACTICE_SESSION_COMPLETED",
                        LearningEvent.payload["sessionId"].astext == session_id,
                    )
                )
            ).scalar_one()
        )


def test_practice_session_model_has_resumable_and_frozen_report_fields() -> None:
    columns = PracticeSession.__table__.columns

    assert {
        "id",
        "owner_id",
        "paper_id",
        "release_id",
        "mode",
        "status",
        "question_order",
        "answers",
        "runtime_state",
        "stats",
        "scoring_snapshot",
        "report_snapshot",
        "revision",
        "started_at",
        "last_saved_at",
        "paused_at",
        "completed_at",
        "abandoned_at",
    }.issubset(columns.keys())

    constraint_names = {
        constraint.name for constraint in PracticeSession.__table__.constraints
    }
    index_names = {index.name for index in PracticeSession.__table__.indexes}
    assert "ck_practice_sessions_mode" in constraint_names
    assert "ck_practice_sessions_status" in constraint_names
    assert "ck_practice_sessions_revision" in constraint_names
    assert "uq_practice_sessions_one_resumable" in index_names


def test_start_session_freezes_42_50_8_order_and_rejects_duplicate_resumable() -> None:
    ids = _practice_fixture_ids()
    asyncio.run(_seed_released_pmp_paper(ids))
    start_payload = {
        "paperId": ids["paper"],
        "releaseId": ids["release"],
        "mode": "challenge",
        "count": 60,
        "order": "paper",
    }
    try:
        with TestClient(app) as client:
            login = client.post(
                "/api/v1/auth/login",
                json={"username": ids["student"], "password": PASSWORD},
            )
            assert login.status_code == 200

            response = client.post(
                "/api/v1/learning/practice/sessions/start", json=start_payload
            )
            assert response.status_code == 200, response.text
            session = response.json()["session"]
            assert session["domainTargets"] == {
                "people": 25,
                "process": 30,
                "business-environment": 5,
            }
            assert session["domainWeights"] == {
                "people": 42,
                "process": 50,
                "business-environment": 8,
            }
            assert len(session["questions"]) == 60
            assert session["revision"] == 1
            assert session["status"] == "active"

            duplicate = client.post(
                "/api/v1/learning/practice/sessions/start", json=start_payload
            )
            assert duplicate.status_code == 409
            assert duplicate.json()["detail"]["code"] == "RESUMABLE_SESSION_EXISTS"
    finally:
        asyncio.run(_cleanup_released_pmp_paper(ids))


def test_active_and_detail_sessions_are_owner_scoped() -> None:
    ids = _practice_fixture_ids()
    asyncio.run(_seed_released_pmp_paper(ids))
    try:
        owner_client = TestClient(app)
        owner_login = owner_client.post(
            "/api/v1/auth/login",
            json={"username": ids["student"], "password": PASSWORD},
        )
        assert owner_login.status_code == 200
        created = owner_client.post(
            "/api/v1/learning/practice/sessions/start",
            json={
                "paperId": ids["paper"],
                "releaseId": ids["release"],
                "mode": "scholar",
                "count": 60,
                "order": "paper",
            },
        )
        assert created.status_code == 200, created.text
        session_id = created.json()["session"]["id"]

        active = owner_client.get(
            "/api/v1/learning/practice/sessions/active",
            params={"releaseId": ids["release"], "mode": "scholar"},
        )
        assert active.status_code == 200
        assert [row["id"] for row in active.json()["sessions"]] == [session_id]
        detail = owner_client.get(
            f"/api/v1/learning/practice/sessions/{session_id}"
        )
        assert detail.status_code == 200
        assert detail.json()["session"]["id"] == session_id

        other_client = TestClient(app)
        other_login = other_client.post(
            "/api/v1/auth/login",
            json={"username": ids["other_student"], "password": PASSWORD},
        )
        assert other_login.status_code == 200
        assert other_client.get(
            "/api/v1/learning/practice/sessions/active"
        ).json()["sessions"] == []
        assert (
            other_client.get(
                f"/api/v1/learning/practice/sessions/{session_id}"
            ).status_code
            == 404
        )
    finally:
        asyncio.run(_cleanup_released_pmp_paper(ids))


def test_start_session_rejects_domain_shortage_without_cross_domain_fill() -> None:
    ids = _practice_fixture_ids()
    asyncio.run(_seed_released_pmp_paper(ids))
    asyncio.run(_remove_business_environment_inventory(ids["release"]))
    try:
        with TestClient(app) as client:
            login = client.post(
                "/api/v1/auth/login",
                json={"username": ids["student"], "password": PASSWORD},
            )
            assert login.status_code == 200
            response = client.post(
                "/api/v1/learning/practice/sessions/start",
                json={
                    "paperId": ids["paper"],
                    "releaseId": ids["release"],
                    "mode": "challenge",
                    "count": 60,
                    "order": "paper",
                },
            )
        assert response.status_code == 422
        detail = response.json()["detail"]
        assert detail["code"] == "PRACTICE_DOMAIN_SHORTAGE"
        assert detail["shortages"] == {"business-environment": 5}
    finally:
        asyncio.run(_cleanup_released_pmp_paper(ids))


def test_random_order_is_seeded_and_frozen_across_modes(monkeypatch) -> None:
    ids = _practice_fixture_ids()
    asyncio.run(_seed_released_pmp_paper(ids))
    monkeypatch.setattr(practice_session_service.secrets, "token_hex", lambda _: "stable-seed")
    try:
        with TestClient(app) as client:
            login = client.post(
                "/api/v1/auth/login",
                json={"username": ids["student"], "password": PASSWORD},
            )
            assert login.status_code == 200
            orders = []
            for mode in ("challenge", "scholar"):
                response = client.post(
                    "/api/v1/learning/practice/sessions/start",
                    json={
                        "paperId": ids["paper"],
                        "releaseId": ids["release"],
                        "mode": mode,
                        "count": 60,
                        "order": "random",
                    },
                )
                assert response.status_code == 200, response.text
                orders.append(
                    [
                        item["questionId"]
                        for item in response.json()["session"]["questionOrder"]
                    ]
                )
        assert orders[0] == orders[1]
        assert orders[0] != sorted(orders[0])
    finally:
        asyncio.run(_cleanup_released_pmp_paper(ids))


def test_session_answer_uses_server_truth_locks_answer_and_increments_revision() -> None:
    ids = _practice_fixture_ids()
    asyncio.run(_seed_released_pmp_paper(ids))
    try:
        with TestClient(app) as client:
            login = client.post(
                "/api/v1/auth/login",
                json={"username": ids["student"], "password": PASSWORD},
            )
            assert login.status_code == 200
            started = client.post(
                "/api/v1/learning/practice/sessions/start",
                json={
                    "paperId": ids["paper"],
                    "releaseId": ids["release"],
                    "mode": "challenge",
                    "count": 60,
                    "order": "paper",
                },
            ).json()["session"]
            question_id = started["questionOrder"][0]["questionId"]

            response = client.post(
                f"/api/v1/learning/practice/sessions/{started['id']}/answers",
                json={
                    "revision": 1,
                    "questionId": question_id,
                    "selectedAnswer": "B",
                    "correct": True,
                    "score": 999,
                },
            )
            assert response.status_code == 200, response.text
            body = response.json()
            assert body["answer"] == {
                "questionId": question_id,
                "selectedAnswer": "B",
                "correctAnswer": "A",
                "correct": False,
                "submittedAt": body["answer"]["submittedAt"],
            }
            assert body["session"]["revision"] == 2
            assert body["session"]["answers"][question_id]["correct"] is False
            assert body["session"]["stats"] == {
                "total": 60,
                "answered": 1,
                "correct": 0,
                "wrong": 1,
                "unanswered": 59,
                "experience": 0,
                "durationMs": 0,
            }

            persisted = client.get(
                f"/api/v1/learning/practice/sessions/{started['id']}"
            ).json()["session"]
            assert persisted["revision"] == 2
            assert persisted["answers"][question_id]["selectedAnswer"] == "B"
    finally:
        asyncio.run(_cleanup_released_pmp_paper(ids))


def test_session_answer_retry_is_idempotent_but_changes_and_stale_writes_conflict() -> None:
    ids = _practice_fixture_ids()
    asyncio.run(_seed_released_pmp_paper(ids))
    try:
        with TestClient(app) as client:
            login = client.post(
                "/api/v1/auth/login",
                json={"username": ids["student"], "password": PASSWORD},
            )
            assert login.status_code == 200
            started = client.post(
                "/api/v1/learning/practice/sessions/start",
                json={
                    "paperId": ids["paper"],
                    "releaseId": ids["release"],
                    "mode": "challenge",
                    "count": 60,
                    "order": "paper",
                },
            ).json()["session"]
            first_question = started["questionOrder"][0]["questionId"]
            second_question = started["questionOrder"][1]["questionId"]
            first_payload = {
                "revision": 1,
                "questionId": first_question,
                "selectedAnswer": "B",
            }
            accepted = client.post(
                f"/api/v1/learning/practice/sessions/{started['id']}/answers",
                json=first_payload,
            )
            assert accepted.status_code == 200

            retry = client.post(
                f"/api/v1/learning/practice/sessions/{started['id']}/answers",
                json=first_payload,
            )
            assert retry.status_code == 200
            assert retry.json()["idempotent"] is True
            assert retry.json()["session"]["revision"] == 2

            changed = client.post(
                f"/api/v1/learning/practice/sessions/{started['id']}/answers",
                json={
                    "revision": 2,
                    "questionId": first_question,
                    "selectedAnswer": "A",
                },
            )
            assert changed.status_code == 409
            assert changed.json()["detail"]["code"] == "PRACTICE_ANSWER_LOCKED"

            stale = client.post(
                f"/api/v1/learning/practice/sessions/{started['id']}/answers",
                json={
                    "revision": 1,
                    "questionId": second_question,
                    "selectedAnswer": "A",
                },
            )
            assert stale.status_code == 409
            assert stale.json()["detail"] == {
                "code": "PRACTICE_SESSION_REVISION_CONFLICT",
                "message": "练习进度已在其他页面更新，请加载最新进度",
                "currentRevision": 2,
            }

            overview = client.get("/api/v1/learning/practice/overview").json()
            mistake = next(
                row for row in overview["mistakes"] if row["questionId"] == first_question
            )
            assert mistake["wrongCount"] == 1
    finally:
        asyncio.run(_cleanup_released_pmp_paper(ids))


def test_session_runtime_state_is_validated_owner_scoped_and_revisioned() -> None:
    ids = _practice_fixture_ids()
    asyncio.run(_seed_released_pmp_paper(ids))
    try:
        with TestClient(app) as client:
            assert client.post(
                "/api/v1/auth/login",
                json={"username": ids["student"], "password": PASSWORD},
            ).status_code == 200
            started = client.post(
                "/api/v1/learning/practice/sessions/start",
                json={
                    "paperId": ids["paper"],
                    "releaseId": ids["release"],
                    "mode": "scholar",
                    "count": 60,
                    "order": "paper",
                },
            ).json()["session"]
            runtime_state = {
                "currentIndex": 6,
                "health": 2,
                "streak": 3,
                "maxStreak": 4,
                "experience": 42,
                "remainingMs": 48321,
                "durationMs": 12000,
                "languageMode": "bilingual",
                "autoExplain": False,
            }
            saved = client.patch(
                f"/api/v1/learning/practice/sessions/{started['id']}/state",
                json={"revision": 1, "runtimeState": runtime_state},
            )
            assert saved.status_code == 200
            saved_session = saved.json()["session"]
            assert saved_session["revision"] == 2
            assert saved_session["runtimeState"] == {"order": "paper", **runtime_state}
            assert saved_session["stats"]["experience"] == 42
            assert saved_session["stats"]["durationMs"] == 12000

            stale = client.patch(
                f"/api/v1/learning/practice/sessions/{started['id']}/state",
                json={"revision": 1, "runtimeState": {"currentIndex": 7}},
            )
            assert stale.status_code == 409
            assert stale.json()["detail"] == {
                "code": "PRACTICE_SESSION_REVISION_CONFLICT",
                "message": "练习进度已在其他页面更新，请加载最新进度",
                "currentRevision": 2,
            }

            forbidden = client.patch(
                f"/api/v1/learning/practice/sessions/{started['id']}/state",
                json={"revision": 2, "runtimeState": {"answers": {"fake": True}}},
            )
            assert forbidden.status_code == 422
            assert forbidden.json()["detail"]["code"] == "INVALID_RUNTIME_STATE_FIELD"

            assert client.post("/api/v1/auth/logout").status_code == 200
            assert client.post(
                "/api/v1/auth/login",
                json={"username": ids["other_student"], "password": PASSWORD},
            ).status_code == 200
            hidden = client.patch(
                f"/api/v1/learning/practice/sessions/{started['id']}/state",
                json={"revision": 2, "runtimeState": {"currentIndex": 7}},
            )
            assert hidden.status_code == 404
    finally:
        asyncio.run(_cleanup_released_pmp_paper(ids))


def test_scholar_pause_freezes_time_and_first_write_resumes_without_offline_deduction() -> None:
    ids = _practice_fixture_ids()
    asyncio.run(_seed_released_pmp_paper(ids))
    try:
        with TestClient(app) as client:
            assert client.post(
                "/api/v1/auth/login",
                json={"username": ids["student"], "password": PASSWORD},
            ).status_code == 200
            started = client.post(
                "/api/v1/learning/practice/sessions/start",
                json={
                    "paperId": ids["paper"],
                    "releaseId": ids["release"],
                    "mode": "scholar",
                    "count": 60,
                    "order": "paper",
                },
            ).json()["session"]
            paused = client.post(
                f"/api/v1/learning/practice/sessions/{started['id']}/pause",
                json={
                    "revision": 1,
                    "runtimeState": {
                        "currentIndex": 4,
                        "remainingMs": 43210,
                        "durationMs": 6789,
                    },
                },
            )
            assert paused.status_code == 200
            paused_session = paused.json()["session"]
            assert paused_session["status"] == "paused"
            assert paused_session["runtimeState"]["remainingMs"] == 43210
            assert paused_session["revision"] == 2

            restored = client.get(
                f"/api/v1/learning/practice/sessions/{started['id']}"
            ).json()["session"]
            assert restored["status"] == "paused"
            assert restored["runtimeState"]["remainingMs"] == 43210

            resumed = client.post(
                f"/api/v1/learning/practice/sessions/{started['id']}/answers",
                json={
                    "revision": 2,
                    "questionId": restored["questionOrder"][0]["questionId"],
                    "selectedAnswer": "A",
                },
            )
            assert resumed.status_code == 200
            resumed_session = resumed.json()["session"]
            assert resumed_session["status"] == "active"
            assert resumed_session["runtimeState"]["remainingMs"] == 43210

            abandoned = client.post(
                f"/api/v1/learning/practice/sessions/{started['id']}/abandon",
                json={"revision": resumed_session["revision"]},
            )
            assert abandoned.status_code == 200
            assert abandoned.json()["session"]["status"] == "abandoned"
            cannot_answer = client.post(
                f"/api/v1/learning/practice/sessions/{started['id']}/answers",
                json={
                    "revision": abandoned.json()["session"]["revision"],
                    "questionId": restored["questionOrder"][1]["questionId"],
                    "selectedAnswer": "A",
                },
            )
            assert cannot_answer.status_code == 409
    finally:
        asyncio.run(_cleanup_released_pmp_paper(ids))


def test_complete_freezes_nonofficial_report_and_is_idempotent_and_owner_scoped() -> None:
    ids = _practice_fixture_ids()
    asyncio.run(_seed_released_pmp_paper(ids))
    try:
        with TestClient(app) as client:
            assert client.post(
                "/api/v1/auth/login",
                json={"username": ids["student"], "password": PASSWORD},
            ).status_code == 200
            started = client.post(
                "/api/v1/learning/practice/sessions/start",
                json={
                    "paperId": ids["paper"],
                    "releaseId": ids["release"],
                    "mode": "challenge",
                    "count": 60,
                    "order": "paper",
                },
            ).json()["session"]
            first_id = started["questionOrder"][0]["questionId"]
            second_id = started["questionOrder"][1]["questionId"]
            first = client.post(
                f"/api/v1/learning/practice/sessions/{started['id']}/answers",
                json={"revision": 1, "questionId": first_id, "selectedAnswer": "B"},
            ).json()["session"]
            second = client.post(
                f"/api/v1/learning/practice/sessions/{started['id']}/answers",
                json={
                    "revision": first["revision"],
                    "questionId": second_id,
                    "selectedAnswer": "A",
                },
            ).json()["session"]

            completed = client.post(
                f"/api/v1/learning/practice/sessions/{started['id']}/complete",
                json={
                    "revision": second["revision"],
                    "score": 100,
                    "passed": True,
                },
            )
            assert completed.status_code == 200
            report = completed.json()["report"]
            assert completed.json()["session"]["status"] == "completed"
            assert report["resultLabel"] == "模拟考试结果：FAIL"
            assert report["official"] is False
            assert report["scorePercent"] == 1.67
            assert report["counts"] == {
                "total": 60,
                "answered": 2,
                "correct": 1,
                "wrong": 1,
                "unanswered": 58,
            }
            assert report["domainWeights"] == {
                "people": 42,
                "process": 50,
                "business-environment": 8,
            }
            assert report["wrongQuestionIds"] == [first_id]
            assert report["disclaimer"] == "幻谱模拟判定，不代表 PMI 官方考试成绩"
            assert set(report["domains"]) == {
                "people",
                "process",
                "business-environment",
            }

            retry = client.post(
                f"/api/v1/learning/practice/sessions/{started['id']}/complete",
                json={"revision": second["revision"]},
            )
            assert retry.status_code == 200
            assert retry.json()["report"] == report
            assert asyncio.run(
                _completion_event_count(ids["student"], started["id"])
            ) == 1

            fetched = client.get(
                f"/api/v1/learning/practice/sessions/{started['id']}/report"
            )
            assert fetched.status_code == 200
            assert fetched.json()["report"] == report

            assert client.post("/api/v1/auth/logout").status_code == 200
            assert client.post(
                "/api/v1/auth/login",
                json={"username": ids["other_student"], "password": PASSWORD},
            ).status_code == 200
            hidden = client.get(
                f"/api/v1/learning/practice/sessions/{started['id']}/report"
            )
            assert hidden.status_code == 404
    finally:
        asyncio.run(_cleanup_released_pmp_paper(ids))
