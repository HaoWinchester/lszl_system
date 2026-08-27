"""Persistent, resumable practice session contracts."""

import asyncio
from uuid import uuid4

import pytest
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
                    ],
                    "knowledge": {
                        "taxonomyId": "taxonomy-practice-session",
                        "primaryNodeId": "practice-session-node",
                        "pathSnapshot": ["PMP", "会话验证"],
                    },
                },
                created_by=ids["teacher"],
                updated_by=ids["teacher"],
            )
            db.add(question)
            questions.append(question)
        db.add(
            Question(
                id=f"practice-verification-{ids['release'][-10:]}",
                source_id=f"practice-verification-{ids['release'][-10:]}",
                bank_id=ids["bank"],
                title="PMP 会话验证题",
                subject="PMP",
                scope="public",
                stem_parts=[{"text": "这是一道同知识点验证题"}],
                options=[
                    {"id": "A", "text": "正确答案", "correct": True},
                    {"id": "B", "text": "干扰项", "correct": False},
                ],
                correct_answer="A",
                content_metadata={
                    "knowledge": {
                        "taxonomyId": "taxonomy-practice-session",
                        "primaryNodeId": "practice-session-node",
                        "pathSnapshot": ["PMP", "会话验证"],
                    }
                },
                created_by=ids["teacher"],
                updated_by=ids["teacher"],
            )
        )
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
                release_metadata={
                    "domainWeights": {
                        "people": 42,
                        "process": 50,
                        "business-environment": 8,
                    },
                    "simulationScoring": {
                        "version": 7,
                        "label": "冻结测试判定",
                        "passPercent": 75,
                        "bands": {
                            "needsImprovement": 40,
                            "belowTarget": 55,
                            "target": 85,
                        },
                        "official": False,
                    },
                },
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
                    snapshot={
                        **question_catalog_service.question_to_payload(question),
                        "analysis": f"第 {index + 1} 题解析",
                        "releaseScore": 5 if index == 0 else 1,
                    },
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


async def _remove_first_question_domain(release_id: str) -> None:
    async with AsyncSessionLocal() as db:
        row = (
            await db.execute(
                select(PaperReleaseQuestion)
                .where(PaperReleaseQuestion.release_id == release_id)
                .order_by(PaperReleaseQuestion.order_index)
                .limit(1)
            )
        ).scalar_one()
        snapshot = dict(row.snapshot or {})
        metadata = dict(snapshot.get("metadata") or {})
        metadata["subjectFacets"] = [
            facet
            for facet in metadata.get("subjectFacets") or []
            if not (
                isinstance(facet, dict)
                and facet.get("dimensionId") == "exam-domain"
            )
        ]
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
            assert session["scoringSnapshot"]["version"] == 7
            assert session["scoringSnapshot"]["passPercent"] == 75

            duplicate = client.post(
                "/api/v1/learning/practice/sessions/start", json=start_payload
            )
            assert duplicate.status_code == 409
            assert duplicate.json()["detail"]["code"] == "RESUMABLE_SESSION_EXISTS"

            async def supersede_release() -> None:
                async with AsyncSessionLocal() as db:
                    release = await db.get(PaperRelease, ids["release"])
                    release.status = "superseded"
                    await db.commit()

            asyncio.run(supersede_release())
            old_release_start = client.post(
                "/api/v1/learning/practice/sessions/start",
                json={**start_payload, "mode": "scholar"},
            )
            assert old_release_start.status_code == 404
            assert old_release_start.json()["detail"]["code"] == "PRACTICE_RELEASE_NOT_FOUND"
    finally:
        asyncio.run(_cleanup_released_pmp_paper(ids))


def test_session_payload_reveals_frozen_answer_key_for_every_question() -> None:
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
                    "count": 10,
                    "order": "paper",
                },
            ).json()["session"]

            for entry in started["questions"]:
                question = entry["question"]
                assert question["correctAnswer"] == "A"
                assert question["analysis"]
                assert any(option.get("correct") is True for option in question["options"])

            first_id = started["questionOrder"][0]["questionId"]
            answered = client.post(
                f"/api/v1/learning/practice/sessions/{started['id']}/answers",
                json={
                    "revision": started["revision"],
                    "questionId": first_id,
                    "selectedAnswer": "B",
                },
            ).json()
            first_after = answered["session"]["questions"][0]["question"]
            second_after = answered["session"]["questions"][1]["question"]
            assert first_after["correctAnswer"] == "A"
            assert first_after["analysis"] == "第 1 题解析"
            assert any(option.get("correct") is True for option in first_after["options"])
            assert second_after["correctAnswer"] == "A"
            assert second_after["analysis"]

            abandoned = client.post(
                f"/api/v1/learning/practice/sessions/{started['id']}/abandon",
                json={"revision": answered["session"]["revision"]},
            )
            assert abandoned.status_code == 200, abandoned.text
            abandoned_questions = abandoned.json()["session"]["questions"]
            assert abandoned_questions[0]["question"]["correctAnswer"] == "A"
            assert abandoned_questions[1]["question"]["correctAnswer"] == "A"
            detail = client.get(
                f"/api/v1/learning/practice/sessions/{started['id']}"
            ).json()["session"]
            assert detail["questions"][1]["question"]["correctAnswer"] == "A"
    finally:
        asyncio.run(_cleanup_released_pmp_paper(ids))


def test_short_paper_count_is_supported_by_the_session_api() -> None:
    ids = _practice_fixture_ids()
    asyncio.run(_seed_released_pmp_paper(ids))
    try:
        with TestClient(app) as client:
            assert client.post(
                "/api/v1/auth/login",
                json={"username": ids["student"], "password": PASSWORD},
            ).status_code == 200
            response = client.post(
                "/api/v1/learning/practice/sessions/start",
                json={
                    "paperId": ids["paper"],
                    "releaseId": ids["release"],
                    "mode": "challenge",
                    "count": 7,
                    "order": "paper",
                },
            )
            assert response.status_code == 200, response.text
            assert response.json()["session"]["stats"]["total"] == 7
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


def test_scholar_timeout_is_an_immutable_server_answer_and_reported_as_wrong() -> None:
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
                    "count": 10,
                    "order": "paper",
                },
            ).json()["session"]
            question_id = started["questionOrder"][0]["questionId"]
            timed_out = client.post(
                f"/api/v1/learning/practice/sessions/{started['id']}/answers",
                json={
                    "revision": started["revision"],
                    "questionId": question_id,
                    "timedOut": True,
                },
            )
            assert timed_out.status_code == 200, timed_out.text
            body = timed_out.json()
            assert body["answer"]["selectedAnswer"] == "__timeout__"
            assert body["answer"]["timedOut"] is True
            assert body["answer"]["correct"] is False
            assert body["session"]["stats"]["answered"] == 1
            assert body["session"]["stats"]["wrong"] == 1

            restored = client.get(
                f"/api/v1/learning/practice/sessions/{started['id']}"
            ).json()["session"]
            assert restored["answers"][question_id]["timedOut"] is True
            completed = client.post(
                f"/api/v1/learning/practice/sessions/{started['id']}/complete",
                json={"revision": restored["revision"]},
            ).json()["report"]
            assert completed["counts"] == {
                "total": 10,
                "answered": 1,
                "correct": 0,
                "wrong": 1,
                "unanswered": 9,
            }
            assert completed["wrongQuestionIds"] == [question_id]
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
            assert saved_session["runtimeState"] == {
                "order": "paper",
                **runtime_state,
                "experience": 0,
            }
            assert saved_session["stats"]["experience"] == 0
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
            assert report["scorePercent"] == 1.56
            assert report["rawScore"] == 1
            assert report["maxScore"] == 64
            assert report["passPercent"] == 75
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


def test_report_uses_frozen_question_scores_and_history_reopens_by_session_id() -> None:
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
                    "count": 10,
                    "order": "paper",
                },
            ).json()["session"]
            first_id = started["questionOrder"][0]["questionId"]
            answered = client.post(
                f"/api/v1/learning/practice/sessions/{started['id']}/answers",
                json={
                    "revision": started["revision"],
                    "questionId": first_id,
                    "selectedAnswer": "A",
                },
            ).json()["session"]
            completed = client.post(
                f"/api/v1/learning/practice/sessions/{started['id']}/complete",
                json={"revision": answered["revision"]},
            ).json()
            report = completed["report"]

            assert report["rawScore"] == 5
            assert report["maxScore"] == 14
            assert report["scorePercent"] == 35.71
            assert report["accuracyPercent"] == 10
            assert report["domains"]["people"]["rawScore"] == 5
            assert report["domains"]["people"]["maxScore"] == 8
            assert report["domains"]["people"]["scorePercent"] == 62.5
            assert report["passPercent"] == 75
            assert report["paperName"] == "PMP 会话模拟卷"
            assert report["learner"] == ids["student"]
            assert report["reportNumber"] == started["id"]

            history = client.get("/api/v1/learning/practice/sessions")
            assert history.status_code == 200
            row = next(
                item
                for item in history.json()["sessions"]
                if item.get("sessionId") == started["id"]
            )
            assert row["reportAvailable"] is True
            assert row["status"] == "completed"
            assert row["mode"] == "challenge"
            assert client.delete("/api/v1/learning/practice/sessions").status_code == 200
            cleared = client.get("/api/v1/learning/practice/sessions").json()["sessions"]
            assert not any(item.get("sessionId") == started["id"] for item in cleared)
    finally:
        asyncio.run(_cleanup_released_pmp_paper(ids))


def test_revenge_mode_is_a_resumable_server_session() -> None:
    ids = _practice_fixture_ids()
    asyncio.run(_seed_released_pmp_paper(ids))
    try:
        with TestClient(app) as client:
            assert client.post(
                "/api/v1/auth/login",
                json={"username": ids["student"], "password": PASSWORD},
            ).status_code == 200
            challenge = client.post(
                "/api/v1/learning/practice/sessions/start",
                json={
                    "paperId": ids["paper"],
                    "releaseId": ids["release"],
                    "mode": "challenge",
                    "count": 10,
                    "order": "paper",
                },
            ).json()["session"]
            question_id = challenge["questionOrder"][0]["questionId"]
            answered = client.post(
                f"/api/v1/learning/practice/sessions/{challenge['id']}/answers",
                json={
                    "revision": challenge["revision"],
                    "questionId": question_id,
                    "selectedAnswer": "B",
                },
            ).json()["session"]
            assert client.post(
                f"/api/v1/learning/practice/sessions/{challenge['id']}/complete",
                json={"revision": answered["revision"]},
            ).status_code == 200

            revenge_response = client.post(
                "/api/v1/learning/practice/sessions/start",
                json={
                    "paperId": ids["paper"],
                    "releaseId": ids["release"],
                    "mode": "revenge",
                    "count": 10,
                    "order": "paper",
                },
            )
            assert revenge_response.status_code == 200, revenge_response.text
            revenge = revenge_response.json()["session"]
            assert revenge["mode"] == "revenge"
            assert revenge["stats"]["total"] == 1
            assert revenge["questionOrder"][0]["questionId"] == question_id
            assert revenge["questionOrder"][0]["mistakeId"]
            assert revenge["questions"][0]["question"]["correctAnswer"] == "A"

            revenge_answer = client.post(
                f"/api/v1/learning/practice/sessions/{revenge['id']}/answers",
                json={
                    "revision": revenge["revision"],
                    "questionId": question_id,
                    "selectedAnswer": "B",
                },
            )
            assert revenge_answer.status_code == 200, revenge_answer.text
            body = revenge_answer.json()
            assert body["answer"]["correct"] is False
            assert body["answer"]["mistakeStatus"] == "needs_remediation"
            assert body["session"]["runtimeState"]["revengeState"] == {
                "phase": "remediation",
                "mistakeId": revenge["questionOrder"][0]["mistakeId"],
                "questionId": question_id,
            }

            remediation = client.post(
                f"/api/v1/learning/practice/sessions/{revenge['id']}"
                f"/mistakes/{revenge['questionOrder'][0]['mistakeId']}/remediation",
                json={"revision": body["session"]["revision"]},
            )
            assert remediation.status_code == 200, remediation.text
            remediation_body = remediation.json()
            assert remediation_body["candidate"]["available"] is True
            candidate = remediation_body["candidate"]["question"]
            assert "correctAnswer" not in candidate
            assert remediation_body["session"]["runtimeState"]["revengeState"]["phase"] == "verification"

            verification_revision = remediation_body["session"]["revision"]
            verified = client.post(
                f"/api/v1/learning/practice/sessions/{revenge['id']}"
                f"/mistakes/{revenge['questionOrder'][0]['mistakeId']}/verification",
                json={
                    "revision": verification_revision,
                    "questionId": candidate["id"],
                    "selectedAnswer": "A",
                },
            )
            assert verified.status_code == 200, verified.text
            verified_body = verified.json()
            assert verified_body["verification"]["correct"] is True
            assert verified_body["answer"]["correctAnswer"] == "A"
            assert verified_body["session"]["runtimeState"]["revengeState"]["phase"] == "verification_due"

            duplicate_verification = client.post(
                f"/api/v1/learning/practice/sessions/{revenge['id']}"
                f"/mistakes/{revenge['questionOrder'][0]['mistakeId']}/verification",
                json={
                    "revision": verification_revision,
                    "questionId": candidate["id"],
                    "selectedAnswer": "A",
                },
            )
            assert duplicate_verification.status_code == 409

            paused = client.post(
                f"/api/v1/learning/practice/sessions/{revenge['id']}/pause",
                json={
                    "revision": verified_body["session"]["revision"],
                    "runtimeState": {
                        "currentIndex": 0,
                        "revengeState": {
                            "phase": "verification_due",
                            "mistakeId": revenge["questionOrder"][0]["mistakeId"],
                        },
                    },
                },
            )
            assert paused.status_code == 200, paused.text
            restored = client.get(
                f"/api/v1/learning/practice/sessions/{revenge['id']}"
            ).json()["session"]
            assert restored["status"] == "paused"
            assert restored["runtimeState"]["revengeState"]["phase"] == "verification_due"
    finally:
        asyncio.run(_cleanup_released_pmp_paper(ids))


def test_legacy_domain_gaps_keep_overall_report_truthful_and_disable_breakdown() -> None:
    ids = _practice_fixture_ids()
    asyncio.run(_seed_released_pmp_paper(ids))
    asyncio.run(_remove_first_question_domain(ids["release"]))
    try:
        with TestClient(app) as client:
            assert client.post(
                "/api/v1/auth/login",
                json={"username": ids["student"], "password": PASSWORD},
            ).status_code == 200
            started_response = client.post(
                "/api/v1/learning/practice/sessions/start",
                json={
                    "paperId": ids["paper"],
                    "releaseId": ids["release"],
                    "mode": "challenge",
                    "count": 10,
                    "order": "paper",
                },
            )
            assert started_response.status_code == 200, started_response.text
            started = started_response.json()["session"]
            assert started["scoringSnapshot"]["domainDataComplete"] is False
            question_id = started["questionOrder"][0]["questionId"]
            answered = client.post(
                f"/api/v1/learning/practice/sessions/{started['id']}/answers",
                json={
                    "revision": started["revision"],
                    "questionId": question_id,
                    "selectedAnswer": "A",
                },
            ).json()["session"]
            report = client.post(
                f"/api/v1/learning/practice/sessions/{started['id']}/complete",
                json={"revision": answered["revision"]},
            ).json()["report"]
            assert report["domainDataComplete"] is False
            assert report["counts"] == {
                "total": 10,
                "answered": 1,
                "correct": 1,
                "wrong": 0,
                "unanswered": 9,
            }
            assert report["rawScore"] == 5
            assert report["maxScore"] == 14
            assert report["scorePercent"] == 35.71
    finally:
        asyncio.run(_cleanup_released_pmp_paper(ids))


def test_legacy_completion_payload_cannot_inflate_experience_summary() -> None:
    ids = _practice_fixture_ids()
    asyncio.run(_seed_released_pmp_paper(ids))
    try:
        with TestClient(app) as client:
            assert client.post(
                "/api/v1/auth/login",
                json={"username": ids["student"], "password": PASSWORD},
            ).status_code == 200
            before = client.get(
                "/api/v1/learning/practice/experience-summary"
            ).json()["totalExperience"]
            legacy = client.post(
                "/api/v1/learning/practice/sessions",
                json={
                    "mode": "challenge",
                    "paperId": ids["paper"],
                    "paperName": "伪造摘要",
                    "answered": 180,
                    "correct": 180,
                    "experience": 99999999,
                    "status": "completed",
                },
            )
            assert legacy.status_code == 200, legacy.text
            assert legacy.json()["session"]["experience"] == 0
            after = client.get(
                "/api/v1/learning/practice/experience-summary"
            ).json()["totalExperience"]
            assert after == before
    finally:
        asyncio.run(_cleanup_released_pmp_paper(ids))


# ---------------------------------------------------------------------------
# 客户端即时判题：会话载荷下发冻结答案 + 整卷草稿白名单校验
# ---------------------------------------------------------------------------


@pytest.fixture
def practice_ids():
    ids = _practice_fixture_ids()
    asyncio.run(_seed_released_pmp_paper(ids))
    try:
        yield ids
    finally:
        asyncio.run(_cleanup_released_pmp_paper(ids))


@pytest.fixture
def client(practice_ids):
    with TestClient(app) as test_client:
        login = test_client.post(
            "/api/v1/auth/login",
            json={"username": practice_ids["student"], "password": PASSWORD},
        )
        assert login.status_code == 200
        yield test_client


@pytest.fixture
def active_session(client, practice_ids):
    started = client.post(
        "/api/v1/learning/practice/sessions/start",
        json={
            "paperId": practice_ids["paper"],
            "releaseId": practice_ids["release"],
            "mode": "challenge",
            "count": 10,
            "order": "paper",
        },
    )
    assert started.status_code == 200, started.text
    return started.json()["session"]


def test_active_session_reveals_frozen_answer_key_for_client_grading(
    client, active_session
):
    session = client.get(
        f"/api/v1/learning/practice/sessions/{active_session['id']}"
    ).json()["session"]
    first = session["questions"][0]["question"]
    assert first["correctAnswer"] == "A"
    assert first["analysis"]


def test_pause_rejects_answer_outside_frozen_question_options(client, active_session):
    first_id = active_session["questions"][0]["questionId"]
    response = client.post(
        f"/api/v1/learning/practice/sessions/{active_session['id']}/pause",
        json={
            "revision": active_session["revision"],
            "answers": {first_id: {"selectedAnswer": "Z", "selectionIndex": 1}},
            "runtimeState": {"currentIndex": 0, "durationMs": 1000},
        },
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "PRACTICE_DRAFT_ANSWER_INVALID"


def test_pause_rejects_draft_answer_invalid_payloads(client, active_session):
    session_id = active_session["id"]
    revision = active_session["revision"]
    first_id = active_session["questions"][0]["questionId"]
    second_id = active_session["questions"][1]["questionId"]
    base_runtime = {"currentIndex": 0, "durationMs": 500}
    invalid_cases = [
        # 非会话题号
        {
            "revision": revision,
            "answers": {"not-in-session": {"selectedAnswer": "A", "selectionIndex": 1}},
            "runtimeState": base_runtime,
        },
        # 重复 selectionIndex
        {
            "revision": revision,
            "answers": {
                first_id: {"selectedAnswer": "A", "selectionIndex": 1},
                second_id: {"selectedAnswer": "A", "selectionIndex": 1},
            },
            "runtimeState": base_runtime,
        },
        # 负数 selectionIndex
        {
            "revision": revision,
            "answers": {first_id: {"selectedAnswer": "A", "selectionIndex": -1}},
            "runtimeState": base_runtime,
        },
        # 布尔 selectionIndex
        {
            "revision": revision,
            "answers": {first_id: {"selectedAnswer": "A", "selectionIndex": True}},
            "runtimeState": base_runtime,
        },
        # selectionIndex 超过题目总数
        {
            "revision": revision,
            "answers": {first_id: {"selectedAnswer": "A", "selectionIndex": 99}},
            "runtimeState": base_runtime,
        },
        # 答案值为非对象
        {
            "revision": revision,
            "answers": {first_id: "A"},
            "runtimeState": base_runtime,
        },
        # 冻结选项之外的答案
        {
            "revision": revision,
            "answers": {first_id: {"selectedAnswer": "C", "selectionIndex": 1}},
            "runtimeState": base_runtime,
        },
    ]
    for payload in invalid_cases:
        response = client.post(
            f"/api/v1/learning/practice/sessions/{session_id}/pause", json=payload
        )
        assert response.status_code == 422, response.text
        assert (
            response.json()["detail"]["code"] == "PRACTICE_DRAFT_ANSWER_INVALID"
        ), payload

    # 非学霸模式不允许 timedOut
    timeout = client.post(
        f"/api/v1/learning/practice/sessions/{session_id}/pause",
        json={
            "revision": revision,
            "answers": {
                first_id: {"selectedAnswer": "A", "selectionIndex": 1, "timedOut": True}
            },
            "runtimeState": base_runtime,
        },
    )
    assert timeout.status_code == 422
    assert timeout.json()["detail"]["code"] == "PRACTICE_TIMEOUT_MODE_INVALID"

    # answers 必须是对象
    not_object = client.post(
        f"/api/v1/learning/practice/sessions/{session_id}/pause",
        json={"revision": revision, "answers": ["nope"], "runtimeState": base_runtime},
    )
    assert not_object.status_code == 422
    assert not_object.json()["detail"]["code"] == "INVALID_PRACTICE_DRAFT"

    # currentIndex 超过题目总数（超过题目总数）
    index_overflow = client.post(
        f"/api/v1/learning/practice/sessions/{session_id}/pause",
        json={
            "revision": revision,
            "runtimeState": {"currentIndex": 10, "durationMs": 500},
        },
    )
    assert index_overflow.status_code == 422
    assert index_overflow.json()["detail"]["code"] == "INVALID_RUNTIME_STATE_VALUE"

    unchanged = client.get(
        f"/api/v1/learning/practice/sessions/{session_id}"
    ).json()["session"]
    assert unchanged["revision"] == revision
    assert unchanged["status"] == "active"
    assert unchanged["answers"] == {}


def test_pause_persists_whitelisted_drafts_and_derives_stats(client, active_session):
    session_id = active_session["id"]
    first_id = active_session["questions"][0]["questionId"]
    second_id = active_session["questions"][1]["questionId"]
    paused = client.post(
        f"/api/v1/learning/practice/sessions/{session_id}/pause",
        json={
            "revision": active_session["revision"],
            "answers": {
                # 客户端注入 correct/correctAnswer/score 必须被剥离
                first_id: {
                    "selectedAnswer": "A",
                    "selectionIndex": 1,
                    "correct": True,
                    "correctAnswer": "A",
                    "score": 999,
                },
                second_id: {"selectedAnswer": "B", "selectionIndex": 2},
            },
            "runtimeState": {"currentIndex": 1, "durationMs": 6000},
        },
    )
    assert paused.status_code == 200, paused.text
    body = paused.json()["session"]
    assert body["status"] == "paused"
    assert body["revision"] == active_session["revision"] + 1
    # 整卷草稿只保留白名单字段：correct/correctAnswer/score 等注入值被剥离。
    assert body["answers"][first_id] == {"selectedAnswer": "A", "selectionIndex": 1}
    assert body["answers"][second_id] == {"selectedAnswer": "B", "selectionIndex": 2}
    assert body["stats"] == {
        "total": 10,
        "answered": 2,
        "correct": 1,
        "wrong": 1,
        "unanswered": 8,
        "experience": 10,
        "durationMs": 6000,
    }
    assert body["runtimeState"]["experience"] == 10

    restored = client.get(
        f"/api/v1/learning/practice/sessions/{session_id}"
    ).json()["session"]
    assert restored["answers"][first_id] == {"selectedAnswer": "A", "selectionIndex": 1}
    assert "correct" not in restored["answers"][first_id]

    # pause 保存的整卷草稿即锁定答案：显式提交不能改写。
    locked = client.post(
        f"/api/v1/learning/practice/sessions/{session_id}/answers",
        json={
            "revision": body["revision"],
            "questionId": first_id,
            "selectedAnswer": "B",
        },
    )
    assert locked.status_code == 409, locked.text
    assert locked.json()["detail"]["code"] == "PRACTICE_ANSWER_LOCKED"


# ---------------------------------------------------------------------------
# 显式保存：pause 在一次事务中原子保存整卷未判题草稿 + runtime state + stats
# ---------------------------------------------------------------------------


def _mistake_count(session_id: str) -> int:
    async def count() -> int:
        async with AsyncSessionLocal() as db:
            session = await db.get(PracticeSession, session_id)
            assert session is not None
            return int(
                (
                    await db.execute(
                        select(func.count(PracticeMistake.id)).where(
                            PracticeMistake.owner_id == session.owner_id,
                            PracticeMistake.release_id == session.release_id,
                        )
                    )
                ).scalar_one()
            )

    return asyncio.run(count())


def _side_effect_counts(owner: str, session_id: str) -> tuple[int, int]:
    async def counts() -> tuple[int, int]:
        async with AsyncSessionLocal() as db:
            events = int(
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
            progress = int(
                (
                    await db.execute(
                        select(func.count(TrainingProgress.id)).where(
                            TrainingProgress.owner_id == owner
                        )
                    )
                ).scalar_one()
            )
            return events, progress

    return asyncio.run(counts())


def test_pause_saves_whole_ungraded_draft_once_without_mistakes(client, active_session):
    first_id = active_session["questions"][0]["questionId"]
    response = client.post(
        f"/api/v1/learning/practice/sessions/{active_session['id']}/pause",
        json={
            "revision": active_session["revision"],
            "answers": {first_id: {"selectedAnswer": "B", "selectionIndex": 1}},
            "runtimeState": {"currentIndex": 0, "health": 2, "durationMs": 1200},
        },
    )
    assert response.status_code == 200
    saved = response.json()["session"]
    assert saved["status"] == "paused"
    assert saved["answers"][first_id] == {"selectedAnswer": "B", "selectionIndex": 1}
    assert saved["stats"]["answered"] == 1
    assert _mistake_count(active_session["id"]) == 0

    # pause 只保存运行状态：不写完成事件、不推进长期训练进度。
    owner = active_session["id"]
    assert owner
    events, _progress = _side_effect_counts(
        _session_owner(active_session["id"]), active_session["id"]
    )
    assert events == 0
    persisted = client.get(
        f"/api/v1/learning/practice/sessions/{active_session['id']}"
    ).json()["session"]
    assert persisted["status"] == "paused"
    assert persisted["revision"] == active_session["revision"] + 1
    assert persisted["answers"][first_id] == {"selectedAnswer": "B", "selectionIndex": 1}
    assert persisted["stats"]["answered"] == 1
    assert persisted["runtimeState"]["health"] == 2
    assert persisted["runtimeState"]["durationMs"] == 1200


def _session_owner(session_id: str) -> str:
    async def fetch() -> str:
        async with AsyncSessionLocal() as db:
            session = await db.get(PracticeSession, session_id)
            assert session is not None
            return str(session.owner_id)

    return asyncio.run(fetch())


def test_pause_save_failure_rolls_back_the_whole_draft(client, active_session):
    session_id = active_session["id"]
    first_id = active_session["questions"][0]["questionId"]
    second_id = active_session["questions"][1]["questionId"]
    failed = client.post(
        f"/api/v1/learning/practice/sessions/{session_id}/pause",
        json={
            "revision": active_session["revision"],
            "answers": {
                first_id: {"selectedAnswer": "A", "selectionIndex": 1},
                # C 不在冻结选项白名单内：整卷草稿校验失败必须整笔回滚。
                second_id: {"selectedAnswer": "C", "selectionIndex": 2},
            },
            "runtimeState": {"currentIndex": 1, "durationMs": 900},
        },
    )
    assert failed.status_code == 422
    assert failed.json()["detail"]["code"] == "PRACTICE_DRAFT_ANSWER_INVALID"

    unchanged = client.get(
        f"/api/v1/learning/practice/sessions/{session_id}"
    ).json()["session"]
    assert unchanged["status"] == "active"
    assert unchanged["revision"] == active_session["revision"]
    assert unchanged["answers"] == {}
    assert unchanged["runtimeState"] == {"currentIndex": 0, "order": "paper"}
    assert _mistake_count(session_id) == 0


def test_pause_conflict_rejects_stale_revision_and_locked_answer_rewrites(
    client, active_session
):
    session_id = active_session["id"]
    first_id = active_session["questions"][0]["questionId"]
    second_id = active_session["questions"][1]["questionId"]
    paused = client.post(
        f"/api/v1/learning/practice/sessions/{session_id}/pause",
        json={
            "revision": active_session["revision"],
            "answers": {first_id: {"selectedAnswer": "B", "selectionIndex": 1}},
            "runtimeState": {"currentIndex": 0, "durationMs": 400},
        },
    )
    assert paused.status_code == 200, paused.text
    locked_revision = paused.json()["session"]["revision"]

    # 恢复 active 后才允许再次显式保存；旧 revision 一律 409。
    resumed = client.patch(
        f"/api/v1/learning/practice/sessions/{session_id}/state",
        json={"revision": locked_revision, "runtimeState": {"currentIndex": 0}},
    )
    assert resumed.status_code == 200, resumed.text
    current_revision = resumed.json()["session"]["revision"]

    stale = client.post(
        f"/api/v1/learning/practice/sessions/{session_id}/pause",
        json={
            "revision": active_session["revision"],
            "answers": {first_id: {"selectedAnswer": "A", "selectionIndex": 1}},
            "runtimeState": {"currentIndex": 0, "durationMs": 400},
        },
    )
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "PRACTICE_SESSION_REVISION_CONFLICT"
    assert stale.json()["detail"]["currentRevision"] == current_revision

    # 不允许改写已保存锁定答案
    rewrite = client.post(
        f"/api/v1/learning/practice/sessions/{session_id}/pause",
        json={
            "revision": current_revision,
            "answers": {first_id: {"selectedAnswer": "A", "selectionIndex": 1}},
            "runtimeState": {"currentIndex": 0, "durationMs": 400},
        },
    )
    assert rewrite.status_code == 409
    assert rewrite.json()["detail"]["code"] == "PRACTICE_ANSWER_LOCKED"

    # 不允许减少已保存锁定答案（整卷草稿必须覆盖全部已保存选择）
    reduced = client.post(
        f"/api/v1/learning/practice/sessions/{session_id}/pause",
        json={
            "revision": current_revision,
            "answers": {second_id: {"selectedAnswer": "A", "selectionIndex": 1}},
            "runtimeState": {"currentIndex": 1, "durationMs": 400},
        },
    )
    assert reduced.status_code == 409
    assert reduced.json()["detail"]["code"] == "PRACTICE_ANSWER_LOCKED"

    intact = client.get(
        f"/api/v1/learning/practice/sessions/{session_id}"
    ).json()["session"]
    assert intact["status"] == "active"
    assert intact["revision"] == current_revision
    assert intact["answers"] == {first_id: {"selectedAnswer": "B", "selectionIndex": 1}}


def test_pause_idempotent_for_same_request_retry_but_conflicts_on_changed_payload(
    client, active_session
):
    session_id = active_session["id"]
    first_id = active_session["questions"][0]["questionId"]
    payload = {
        "revision": active_session["revision"],
        "answers": {first_id: {"selectedAnswer": "B", "selectionIndex": 1}},
        "runtimeState": {"currentIndex": 0, "health": 2, "durationMs": 1200},
    }
    first = client.post(
        f"/api/v1/learning/practice/sessions/{session_id}/pause", json=payload
    )
    assert first.status_code == 200, first.text
    saved = first.json()["session"]
    assert saved["status"] == "paused"

    # 相同请求重试幂等：revision 回退窗口内重复 pause 不产生第二次写入。
    retry = client.post(
        f"/api/v1/learning/practice/sessions/{session_id}/pause", json=payload
    )
    assert retry.status_code == 200
    retried = retry.json()["session"]
    assert retried["revision"] == saved["revision"]
    assert retried["pausedAt"] == saved["pausedAt"]
    assert retried["answers"] == saved["answers"]

    latest = client.post(
        f"/api/v1/learning/practice/sessions/{session_id}/pause",
        json={**payload, "revision": saved["revision"]},
    )
    assert latest.status_code == 200
    assert latest.json()["session"]["revision"] == saved["revision"]

    # 不同载荷不是重试：不允许借幂等窗口改写已保存草稿。
    changed = client.post(
        f"/api/v1/learning/practice/sessions/{session_id}/pause",
        json={
            **payload,
            "answers": {first_id: {"selectedAnswer": "A", "selectionIndex": 1}},
        },
    )
    assert changed.status_code == 409
    assert changed.json()["detail"]["code"] == "PRACTICE_SESSION_REVISION_CONFLICT"

    persisted = client.get(
        f"/api/v1/learning/practice/sessions/{session_id}"
    ).json()["session"]
    assert persisted["revision"] == saved["revision"]
    assert persisted["answers"] == {first_id: {"selectedAnswer": "B", "selectionIndex": 1}}


def test_pause_saved_session_is_invisible_to_other_owners(
    client, active_session, practice_ids
):
    session_id = active_session["id"]
    first_id = active_session["questions"][0]["questionId"]
    paused = client.post(
        f"/api/v1/learning/practice/sessions/{session_id}/pause",
        json={
            "revision": active_session["revision"],
            "answers": {first_id: {"selectedAnswer": "B", "selectionIndex": 1}},
            "runtimeState": {"currentIndex": 0, "durationMs": 300},
        },
    )
    assert paused.status_code == 200, paused.text

    assert client.post("/api/v1/auth/logout").status_code == 200
    assert client.post(
        "/api/v1/auth/login",
        json={"username": practice_ids["other_student"], "password": PASSWORD},
    ).status_code == 200
    hidden = client.post(
        f"/api/v1/learning/practice/sessions/{session_id}/pause",
        json={"revision": paused.json()["session"]["revision"]},
    )
    assert hidden.status_code == 404
    assert hidden.json()["detail"]["code"] == "PRACTICE_SESSION_NOT_FOUND"


def test_scholar_pause_with_draft_restores_remaining_ms_without_offline_deduction(
    client, practice_ids
):
    started = client.post(
        "/api/v1/learning/practice/sessions/start",
        json={
            "paperId": practice_ids["paper"],
            "releaseId": practice_ids["release"],
            "mode": "scholar",
            "count": 10,
            "order": "paper",
        },
    )
    assert started.status_code == 200, started.text
    session = started.json()["session"]
    first_id = session["questions"][0]["questionId"]
    paused = client.post(
        f"/api/v1/learning/practice/sessions/{session['id']}/pause",
        json={
            "revision": session["revision"],
            "answers": {
                first_id: {"selectedAnswer": "A", "selectionIndex": 1, "timedOut": True}
            },
            "runtimeState": {
                "currentIndex": 0,
                "remainingMs": 43210,
                "durationMs": 6789,
            },
        },
    )
    assert paused.status_code == 200, paused.text
    saved = paused.json()["session"]
    assert saved["status"] == "paused"
    assert saved["runtimeState"]["remainingMs"] == 43210
    assert saved["answers"][first_id] == {
        "selectedAnswer": "A",
        "selectionIndex": 1,
        "timedOut": True,
    }

    # 恢复会话不扣离线时间：remainingMs 原样恢复。
    restored = client.get(
        f"/api/v1/learning/practice/sessions/{session['id']}"
    ).json()["session"]
    assert restored["status"] == "paused"
    assert restored["runtimeState"]["remainingMs"] == 43210
    assert restored["runtimeState"]["durationMs"] == 6789


def test_pause_continues_legacy_graded_answers_without_recounting_mistakes(
    client, active_session
):
    session_id = active_session["id"]
    first_id = active_session["questions"][0]["questionId"]
    second_id = active_session["questions"][1]["questionId"]

    # 旧版链路：先经 /answers 服务端判题并记录一次错题。
    answered = client.post(
        f"/api/v1/learning/practice/sessions/{session_id}/answers",
        json={"revision": 1, "questionId": first_id, "selectedAnswer": "B"},
    )
    assert answered.status_code == 200, answered.text
    assert answered.json()["answer"]["correct"] is False
    assert _mistake_count(session_id) == 1

    # 升级后整卷草稿继续：旧已判题答案只比较 selectedAnswer 等字段即可原样带入。
    paused = client.post(
        f"/api/v1/learning/practice/sessions/{session_id}/pause",
        json={
            "revision": answered.json()["session"]["revision"],
            "answers": {
                first_id: {"selectedAnswer": "B", "selectionIndex": 1},
                second_id: {"selectedAnswer": "A", "selectionIndex": 2},
            },
            "runtimeState": {"currentIndex": 1, "durationMs": 1000},
        },
    )
    assert paused.status_code == 200, paused.text
    saved = paused.json()["session"]
    assert saved["answers"][first_id] == {"selectedAnswer": "B", "selectionIndex": 1}
    assert saved["stats"]["answered"] == 2
    assert saved["stats"]["correct"] == 1
    assert saved["stats"]["wrong"] == 1

    # pause 不写错题：不重复累计长期错题。
    assert _mistake_count(session_id) == 1
