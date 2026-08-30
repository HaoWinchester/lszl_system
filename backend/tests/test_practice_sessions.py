"""Persistent, resumable practice session contracts."""

import asyncio
from pathlib import Path
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


async def _seed_released_pmp_paper(
    ids: dict[str, str], *, domains: list[str] | None = None
) -> None:
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
        if domains is None:
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


async def _seed_global_revenge_mistakes(
    owner: str, first_ids: dict[str, str], second_ids: dict[str, str]
) -> dict[str, str]:
    async with AsyncSessionLocal() as db:
        first_question = (
            await db.execute(
                select(PaperReleaseQuestion)
                .where(PaperReleaseQuestion.release_id == first_ids["release"])
                .order_by(PaperReleaseQuestion.order_index)
                .limit(1)
            )
        ).scalar_one()
        second_question = (
            await db.execute(
                select(PaperReleaseQuestion)
                .where(PaperReleaseQuestion.release_id == second_ids["release"])
                .order_by(PaperReleaseQuestion.order_index)
                .limit(1)
            )
        ).scalar_one()
        now = now_utc()
        rows = [
            PracticeMistake(
                id=f"pm-release-{uuid4().hex[:12]}",
                owner_id=owner,
                question_id=first_question.question_id,
                bank_id=first_question.bank_id,
                paper_id=first_ids["paper"],
                release_id=first_ids["release"],
                paper_version=1,
                paper_name="第一份来源试卷",
                source_mode="challenge",
                language_mode="zh",
                question_snapshot=first_question.snapshot,
                knowledge={},
                selected_answers=["B"],
                status="pending",
                wrong_count=4,
                first_wrong_at=now,
                last_wrong_at=now,
            ),
            PracticeMistake(
                id=f"pm-versionless-{uuid4().hex[:12]}",
                owner_id=owner,
                question_id=first_question.question_id,
                bank_id=first_question.bank_id,
                paper_id=first_ids["paper"],
                release_id=None,
                paper_version=0,
                paper_name="历史无版本错题",
                source_mode="challenge",
                language_mode="zh",
                question_snapshot=first_question.snapshot,
                knowledge={},
                selected_answers=["B"],
                status="needs_remediation",
                wrong_count=2,
                revenge_wrong_count=1,
                first_wrong_at=now,
                last_wrong_at=now,
            ),
            PracticeMistake(
                id=f"pm-second-{uuid4().hex[:12]}",
                owner_id=owner,
                question_id=second_question.question_id,
                bank_id=second_question.bank_id,
                paper_id=second_ids["paper"],
                release_id=second_ids["release"],
                paper_version=1,
                paper_name="第二份来源试卷",
                source_mode="challenge",
                language_mode="zh",
                question_snapshot=second_question.snapshot,
                knowledge={},
                selected_answers=["B"],
                status="pending",
                wrong_count=1,
                first_wrong_at=now,
                last_wrong_at=now,
            ),
        ]
        db.add_all(rows)
        await db.commit()
        return {
            "firstQuestion": first_question.question_id,
            "secondQuestion": second_question.question_id,
            "releaseMistake": rows[0].id,
            "versionlessMistake": rows[1].id,
            "secondMistake": rows[2].id,
        }


async def _set_mistake_correct_answer(mistake_id: str, correct_answer: str) -> None:
    async with AsyncSessionLocal() as db:
        mistake = await db.get(PracticeMistake, mistake_id)
        snapshot = dict(mistake.question_snapshot or {})
        snapshot["correctAnswer"] = correct_answer
        if not correct_answer:
            snapshot["options"] = [
                {**option, "correct": False}
                for option in snapshot.get("options") or []
                if isinstance(option, dict)
            ]
        mistake.question_snapshot = snapshot
        await db.commit()


async def _set_mistake_status(mistake_id: str, status: str) -> None:
    async with AsyncSessionLocal() as db:
        mistake = await db.get(PracticeMistake, mistake_id)
        mistake.status = status
        await db.commit()


async def _corrupt_frozen_session_answer(
    session_id: str, question_id: str
) -> None:
    async with AsyncSessionLocal() as db:
        session = await db.get(PracticeSession, session_id)
        question_order = []
        for raw in session.question_order or []:
            ref = dict(raw)
            if ref.get("questionId") == question_id:
                snapshot = dict(ref.get("questionSnapshot") or {})
                snapshot["correctAnswer"] = ""
                snapshot["options"] = [
                    {**option, "correct": False}
                    for option in snapshot.get("options") or []
                    if isinstance(option, dict)
                ]
                ref["questionSnapshot"] = snapshot
            question_order.append(ref)
        session.question_order = question_order
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


def test_practice_session_model_allows_global_revenge_scope() -> None:
    columns = PracticeSession.__table__.columns

    assert columns["paper_id"].nullable is True
    assert columns["release_id"].nullable is True

    migration = (
        Path(__file__).parents[1]
        / "alembic/versions/c9f2e6a1b430_global_revenge_sessions.py"
    ).read_text(encoding="utf-8")
    assert 'op.alter_column("practice_sessions", "paper_id", nullable=True)' in migration
    assert 'op.alter_column("practice_sessions", "release_id", nullable=True)' in migration


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


@pytest.mark.parametrize("mode", ["challenge", "scholar", "practice"])
def test_start_session_accepts_published_inventory_without_domain_recomposition(mode) -> None:
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
                    "mode": mode,
                    "count": 60,
                    "order": "paper",
                },
            )
        assert response.status_code == 200, response.text
        session = response.json()["session"]
        assert len(session["questions"]) == 60
        assert session["domainTargets"] == {
            "people": 30, "process": 30, "business-environment": 0,
        }
        assert [ref["orderIndex"] for ref in session["questionOrder"]] == list(range(60))
    finally:
        asyncio.run(_cleanup_released_pmp_paper(ids))


@pytest.mark.parametrize("domains, expected_targets", [
    (["people"] * 83 + ["process"] * 92 + ["business-environment"] * 10,
     {"people": 83, "process": 92, "business-environment": 5}),
    (["process"] * 101 + ["people"] * 84,
     {"people": 79, "process": 101, "business-environment": 0}),
], ids=["production-paper-03-distribution", "production-paper-04-distribution"])
def test_180_question_published_papers_start_save_and_restore_in_all_modes(domains, expected_targets):
    ids = _practice_fixture_ids()
    asyncio.run(_seed_released_pmp_paper(ids, domains=domains))
    try:
        with TestClient(app) as client:
            assert client.post("/api/v1/auth/login", json={
                "username": ids["student"], "password": PASSWORD,
            }).status_code == 200
            for mode in ("challenge", "scholar", "practice"):
                response = client.post("/api/v1/learning/practice/sessions/start", json={
                    "paperId": ids["paper"], "releaseId": ids["release"],
                    "mode": mode, "count": 180, "order": "paper",
                })
                assert response.status_code == 200, response.text
                session = response.json()["session"]
                assert len(session["questions"]) == 180
                assert session["domainTargets"] == expected_targets
                assert [ref["orderIndex"] for ref in session["questionOrder"]] == list(range(180))
                first_id = session["questions"][0]["questionId"]
                assert session["questions"][0]["question"]["correctAnswer"] == "A"
                saved = client.post(f"/api/v1/learning/practice/sessions/{session['id']}/pause", json={
                    "revision": session["revision"],
                    "answers": {first_id: {"selectedAnswer": "A", "selectionIndex": 1}},
                    "runtimeState": {"currentIndex": 1},
                })
                assert saved.status_code == 200, saved.text
                restored = client.get(f"/api/v1/learning/practice/sessions/{session['id']}")
                assert restored.status_code == 200
                assert restored.json()["session"]["questionOrder"] == session["questionOrder"]
                assert restored.json()["session"]["stats"]["correct"] == 1
                assert restored.json()["session"]["answers"][first_id]["selectedAnswer"] == "A"
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
    # 练习现在保留发布顺序；报告夹具显式安排前 10 题的 4/5/1 分布，
    # 不再依赖开始会话时重新按配比抽题来构造报告测试数据。
    asyncio.run(_seed_released_pmp_paper(ids, domains=(
        ["people"] * 4 + ["process"] * 5 + ["business-environment"]
        + ["people"] * 21 + ["process"] * 25 + ["business-environment"] * 4
    )))
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


def test_global_revenge_session_crosses_papers_and_deduplicates_versionless_history() -> None:
    first_ids = _practice_fixture_ids()
    second_ids = _practice_fixture_ids()
    asyncio.run(_seed_released_pmp_paper(first_ids, domains=["people", "process"]))
    asyncio.run(_seed_released_pmp_paper(second_ids, domains=["business-environment"]))
    mistake_ids = asyncio.run(
        _seed_global_revenge_mistakes(first_ids["student"], first_ids, second_ids)
    )
    try:
        with TestClient(app) as client:
            assert client.post(
                "/api/v1/auth/login",
                json={"username": first_ids["student"], "password": PASSWORD},
            ).status_code == 200

            response = client.post(
                "/api/v1/learning/practice/sessions/start",
                json={"mode": "revenge", "count": 10, "order": "paper"},
            )

            assert response.status_code == 200, response.text
            session = response.json()["session"]
            assert session["paperId"] is None
            assert session["releaseId"] is None
            assert session["stats"]["total"] == 2
            assert len(session["questions"]) == 2
            assert {row["questionId"] for row in session["questionOrder"]} == {
                mistake_ids["firstQuestion"],
                mistake_ids["secondQuestion"],
            }
            duplicate = next(
                row
                for row in session["questionOrder"]
                if row["questionId"] == mistake_ids["firstQuestion"]
            )
            assert duplicate["mistakeId"] == mistake_ids["versionlessMistake"]
            assert duplicate["mistakeIds"] == [
                mistake_ids["versionlessMistake"],
                mistake_ids["releaseMistake"],
            ]
            assert duplicate["sourceReleaseId"] == ""
            assert {
                row["sourcePaperId"] for row in session["questionOrder"]
            } == {first_ids["paper"], second_ids["paper"]}

            # 会话开始后即使长期错题快照发生变化，判题与状态推进仍以冻结快照为准。
            asyncio.run(
                _set_mistake_correct_answer(
                    mistake_ids["versionlessMistake"], "B"
                )
            )

            answers = {
                mistake_ids["firstQuestion"]: {
                    "selectedAnswer": "B",
                    "selectionIndex": 1,
                },
                mistake_ids["secondQuestion"]: {
                    "selectedAnswer": "A",
                    "selectionIndex": 2,
                },
            }
            paused_response = client.post(
                f"/api/v1/learning/practice/sessions/{session['id']}/pause",
                json={
                    "revision": session["revision"],
                    "answers": answers,
                    "runtimeState": {"currentIndex": 1},
                },
            )
            assert paused_response.status_code == 200, paused_response.text
            paused = paused_response.json()["session"]
            assert paused["status"] == "paused"
            assert paused["stats"]["answered"] == 2

            restored = client.get(
                f"/api/v1/learning/practice/sessions/{session['id']}"
            ).json()["session"]
            assert restored["status"] == "paused"
            assert len(restored["questions"]) == 2
            assert all(
                item["question"]["correctAnswer"] == "A"
                for item in restored["questions"]
            )

            completed_response = client.post(
                f"/api/v1/learning/practice/sessions/{session['id']}/complete",
                json={
                    "revision": paused["revision"],
                    "answers": answers,
                    "runtimeState": {"currentIndex": 1},
                },
            )
            assert completed_response.status_code == 200, completed_response.text
            completed = completed_response.json()
            assert completed["session"]["status"] == "completed"
            assert completed["report"]["paperName"] == "全局复仇错题"

            async def load_mistakes() -> dict[str, PracticeMistake]:
                async with AsyncSessionLocal() as db:
                    rows = (
                        await db.execute(
                            select(PracticeMistake).where(
                                PracticeMistake.id.in_(
                                    [
                                        mistake_ids["releaseMistake"],
                                        mistake_ids["versionlessMistake"],
                                        mistake_ids["secondMistake"],
                                    ]
                                )
                            )
                        )
                    ).scalars().all()
                    return {row.id: row for row in rows}

            persisted = asyncio.run(load_mistakes())
            assert persisted[mistake_ids["versionlessMistake"]].revenge_wrong_count == 2
            assert persisted[mistake_ids["releaseMistake"]].revenge_attempt_count == 0
            assert persisted[mistake_ids["releaseMistake"]].wrong_count == 4
            assert persisted[mistake_ids["secondMistake"]].status == "verification_due"
            assert persisted[mistake_ids["secondMistake"]].revenge_correct_count == 1
    finally:
        asyncio.run(_cleanup_released_pmp_paper(second_ids))
        asyncio.run(_cleanup_released_pmp_paper(first_ids))


def test_global_revenge_reports_damaged_history_separately_from_an_empty_pool() -> None:
    first_ids = _practice_fixture_ids()
    second_ids = _practice_fixture_ids()
    asyncio.run(_seed_released_pmp_paper(first_ids, domains=["people"]))
    asyncio.run(_seed_released_pmp_paper(second_ids, domains=["process"]))
    mistake_ids = asyncio.run(
        _seed_global_revenge_mistakes(first_ids["student"], first_ids, second_ids)
    )
    try:
        # 同题的可用 mastered 历史不能掩盖损坏的 active 记录。
        asyncio.run(
            _set_mistake_status(mistake_ids["versionlessMistake"], "mastered")
        )
        for mistake_id in (
            mistake_ids["releaseMistake"],
            mistake_ids["secondMistake"],
        ):
            asyncio.run(_set_mistake_correct_answer(mistake_id, ""))

        with TestClient(app) as client:
            assert client.post(
                "/api/v1/auth/login",
                json={"username": first_ids["student"], "password": PASSWORD},
            ).status_code == 200
            response = client.post(
                "/api/v1/learning/practice/sessions/start",
                json={"mode": "revenge", "count": 10, "order": "paper"},
            )

            assert response.status_code == 422, response.text
            assert response.json()["detail"]["code"] == "REVENGE_SNAPSHOT_UNAVAILABLE"
            assert response.json()["detail"]["unavailableCount"] == 2
    finally:
        asyncio.run(_cleanup_released_pmp_paper(second_ids))
        asyncio.run(_cleanup_released_pmp_paper(first_ids))


def test_global_revenge_invalid_frozen_snapshot_rolls_back_the_whole_completion() -> None:
    first_ids = _practice_fixture_ids()
    second_ids = _practice_fixture_ids()
    asyncio.run(_seed_released_pmp_paper(first_ids, domains=["people"]))
    asyncio.run(_seed_released_pmp_paper(second_ids, domains=["process"]))
    mistake_ids = asyncio.run(
        _seed_global_revenge_mistakes(first_ids["student"], first_ids, second_ids)
    )
    try:
        with TestClient(app) as client:
            assert client.post(
                "/api/v1/auth/login",
                json={"username": first_ids["student"], "password": PASSWORD},
            ).status_code == 200
            started = client.post(
                "/api/v1/learning/practice/sessions/start",
                json={"mode": "revenge", "count": 10, "order": "paper"},
            ).json()["session"]
            asyncio.run(
                _corrupt_frozen_session_answer(
                    started["id"], mistake_ids["secondQuestion"]
                )
            )

            response = client.post(
                f"/api/v1/learning/practice/sessions/{started['id']}/complete",
                json={
                    "revision": started["revision"],
                    "answers": {
                        mistake_ids["firstQuestion"]: {
                            "selectedAnswer": "B",
                            "selectionIndex": 1,
                        },
                        mistake_ids["secondQuestion"]: {
                            "selectedAnswer": "A",
                            "selectionIndex": 2,
                        },
                    },
                    "runtimeState": {"currentIndex": 1},
                },
            )
            assert response.status_code == 409, response.text
            assert response.json()["detail"]["code"] == "PRACTICE_SNAPSHOT_INVALID"

            async def load_state() -> tuple[PracticeSession, list[PracticeMistake]]:
                async with AsyncSessionLocal() as db:
                    session = await db.get(PracticeSession, started["id"])
                    mistakes = list(
                        (
                            await db.execute(
                                select(PracticeMistake).where(
                                    PracticeMistake.id.in_(
                                        [
                                            mistake_ids["versionlessMistake"],
                                            mistake_ids["secondMistake"],
                                        ]
                                    )
                                )
                            )
                        ).scalars().all()
                    )
                    return session, mistakes

            persisted_session, persisted_mistakes = asyncio.run(load_state())
            assert persisted_session.status == "active"
            assert persisted_session.revision == started["revision"]
            assert all(row.revenge_attempt_count == 0 for row in persisted_mistakes)
    finally:
        asyncio.run(_cleanup_released_pmp_paper(second_ids))
        asyncio.run(_cleanup_released_pmp_paper(first_ids))


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
        "creditedExperience": 10,
        "experienceAccountingVersion": 1,
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
    # timedOut 条目存储归一化为超时占位符（与前端 gradeLocal/_judge 同构）。
    assert saved["answers"][first_id] == {
        "selectedAnswer": "__timeout__",
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


# ---------------------------------------------------------------------------
# 整卷交卷：complete 一次锁定、权威重算、一次提交、终态幂等
# ---------------------------------------------------------------------------


def test_complete_regrades_whole_submission_and_ignores_client_truth(client, active_session):
    first_id = active_session["questions"][0]["questionId"]
    response = client.post(
        f"/api/v1/learning/practice/sessions/{active_session['id']}/complete",
        json={
            "revision": active_session["revision"],
            "answers": {
                first_id: {
                    "selectedAnswer": "B",
                    "selectionIndex": 1,
                    "correct": True,
                    "correctAnswer": "B",
                    "score": 999,
                }
            },
            "runtimeState": {"currentIndex": 0, "durationMs": 1800},
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["session"]["answers"][first_id]["correct"] is False
    assert body["report"]["counts"]["wrong"] == 1
    assert body["report"]["passed"] is False


def test_pause_never_records_mistakes_until_complete_does(client, active_session):
    session_id = active_session["id"]
    first_id = active_session["questions"][0]["questionId"]
    second_id = active_session["questions"][1]["questionId"]
    paused = client.post(
        f"/api/v1/learning/practice/sessions/{session_id}/pause",
        json={
            "revision": active_session["revision"],
            "answers": {
                first_id: {"selectedAnswer": "B", "selectionIndex": 1},
                second_id: {"selectedAnswer": "B", "selectionIndex": 2},
            },
            "runtimeState": {"currentIndex": 1, "durationMs": 2000},
        },
    )
    assert paused.status_code == 200, paused.text
    saved = paused.json()["session"]
    assert saved["status"] == "paused"
    # pause 只保存草稿统计：不产生任何长期错题。
    assert saved["stats"]["wrong"] == 2
    assert _mistake_count(session_id) == 0

    completed = client.post(
        f"/api/v1/learning/practice/sessions/{session_id}/complete",
        json={"revision": saved["revision"], "answers": saved["answers"]},
    )
    assert completed.status_code == 200, completed.text
    body = completed.json()
    assert body["session"]["status"] == "completed"
    assert body["report"]["counts"]["wrong"] == 2
    assert set(body["report"]["wrongQuestionIds"]) == {first_id, second_id}
    assert _mistake_count(session_id) == 2


def test_complete_counts_unanswered_as_zero_and_orders_experience_by_selection_index(
    client, active_session
):
    session_id = active_session["id"]
    questions = active_session["questions"]
    ids = [entry["questionId"] for entry in questions[:4]]
    answers = {
        # 顺序由 selectionIndex 决定：第 3 题最先答对，随后第 1 题连击。
        ids[2]: {"selectedAnswer": "A", "selectionIndex": 1},
        ids[0]: {"selectedAnswer": "A", "selectionIndex": 2},
        ids[3]: {"selectedAnswer": "B", "selectionIndex": 3},
        # ids[1] 未答计 0，不计入连胜也不产生错题。
    }
    completed = client.post(
        f"/api/v1/learning/practice/sessions/{session_id}/complete",
        json={
            "revision": active_session["revision"],
            "answers": answers,
            "runtimeState": {"currentIndex": 3, "durationMs": 5000},
        },
    )
    assert completed.status_code == 200, completed.text
    report = completed.json()["report"]
    session = completed.json()["session"]
    assert report["counts"] == {
        "total": 10,
        "answered": 3,
        "correct": 2,
        "wrong": 1,
        "unanswered": 7,
    }
    # 连胜经验按 selectionIndex：第 1 笔 +10；第 2 笔连胜 2 无加成 +10 = 20。
    assert session["stats"]["experience"] == 20
    assert session["runtimeState"]["experience"] == 20


def test_duplicate_complete_returns_same_frozen_report_without_new_side_effects(
    client, active_session
):
    session_id = active_session["id"]
    owner = _session_owner(session_id)
    first_id = active_session["questions"][0]["questionId"]
    answers = {
        first_id: {"selectedAnswer": "B", "selectionIndex": 1},
    }
    first = client.post(
        f"/api/v1/learning/practice/sessions/{session_id}/complete",
        json={
            "revision": active_session["revision"],
            "answers": answers,
            "runtimeState": {"currentIndex": 0, "durationMs": 700},
        },
    )
    assert first.status_code == 200, first.text
    body = first.json()
    report = body["report"]
    assert report["counts"]["answered"] == 1
    experience_before = client.get(
        "/api/v1/learning/practice/experience-summary"
    ).json()["totalExperience"]

    # 终态幂等：重复 complete（即便带不同载荷）返回同一冻结报告，不重放判题副作用。
    retry = client.post(
        f"/api/v1/learning/practice/sessions/{session_id}/complete",
        json={
            "revision": 999999,
            "answers": {},
            "score": 100,
            "passed": True,
        },
    )
    assert retry.status_code == 200, retry.text
    assert retry.json()["report"] == report
    assert retry.json()["session"]["status"] == "completed"
    assert asyncio.run(_completion_event_count(owner, session_id)) == 1
    assert _mistake_count(session_id) == 1
    assert (
        client.get("/api/v1/learning/practice/experience-summary").json()[
            "totalExperience"
        ]
        == experience_before
    )


def test_grade_failure_mid_submission_rolls_back_everything(client, practice_ids):
    """复仇卷第二题的错题在整卷重算中途消失：PRACTICE_GRADE_FAILED 且全量回滚。

    （challenge 卷逐题判题读取冻结发布快照，删除源 Question 不影响判题，
    因此用 revenge 卷制造可稳定复现的中途判题失败。）
    """

    # 先造一道长期错题，才能开复仇卷。
    seed = client.post(
        "/api/v1/learning/practice/sessions/start",
        json={
            "paperId": practice_ids["paper"],
            "releaseId": practice_ids["release"],
            "mode": "challenge",
            "count": 10,
            "order": "paper",
        },
    ).json()["session"]
    challenge_question = seed["questionOrder"][0]["questionId"]
    answered = client.post(
        f"/api/v1/learning/practice/sessions/{seed['id']}/answers",
        json={
            "revision": seed["revision"],
            "questionId": challenge_question,
            "selectedAnswer": "B",
        },
    )
    assert answered.status_code == 200, answered.text
    client.post(
        f"/api/v1/learning/practice/sessions/{seed['id']}/complete",
        json={"revision": answered.json()["session"]["revision"]},
    )

    revenge_response = client.post(
        "/api/v1/learning/practice/sessions/start",
        json={
            "paperId": practice_ids["paper"],
            "releaseId": practice_ids["release"],
            "mode": "revenge",
            "count": 10,
            "order": "paper",
        },
    )
    assert revenge_response.status_code == 200, revenge_response.text
    revenge = revenge_response.json()["session"]

    async def delete_mistake() -> None:
        async with AsyncSessionLocal() as db:
            row = await db.get(
                PracticeMistake, revenge["questionOrder"][0]["mistakeId"]
            )
            assert row is not None
            await db.delete(row)
            await db.commit()

    asyncio.run(delete_mistake())
    # 删除后确认错题确已消失，防止误删导致的假通过。
    assert _mistake_count(revenge["id"]) == 0
    question_ids = [entry["questionId"] for entry in revenge["questionOrder"]]
    owner = _session_owner(revenge["id"])
    revision_before = revenge["revision"]
    response = client.post(
        f"/api/v1/learning/practice/sessions/{revenge['id']}/complete",
        json={
            "revision": revenge["revision"],
            "answers": {
                # 第一题的错题已删：整卷重算在第一笔就失败，事务应整体回滚。
                question_ids[0]: {"selectedAnswer": "A", "selectionIndex": 1},
            },
            "runtimeState": {"currentIndex": 0, "durationMs": 2500},
        },
    )
    assert response.status_code == 404, response.text
    assert (
        response.json()["detail"]["code"] == "PRACTICE_MISTAKE_NOT_FOUND"
    )

    persisted = client.get(
        f"/api/v1/learning/practice/sessions/{revenge['id']}"
    ).json()["session"]
    # 判题失败不落任何终态：会话、草稿与统计全部保持交卷前原样。
    assert persisted["status"] == "active"
    assert persisted["revision"] == revision_before
    assert persisted["answers"] == {}
    assert persisted["stats"]["answered"] == 0
    assert persisted["stats"]["experience"] == 0
    assert asyncio.run(_completion_event_count(owner, revenge["id"])) == 0
    # 判题失败即使发生在任何记账之前，也不得留下半份错题或完成事件。
    assert _mistake_count(revenge["id"]) == 0


def test_complete_whole_paper_advances_revenge_state_once(client, practice_ids):
    # 先造一道长期错题。
    seed = client.post(
        "/api/v1/learning/practice/sessions/start",
        json={
            "paperId": practice_ids["paper"],
            "releaseId": practice_ids["release"],
            "mode": "challenge",
            "count": 10,
            "order": "paper",
        },
    ).json()["session"]
    challenge_question = seed["questionOrder"][0]["questionId"]
    answered = client.post(
        f"/api/v1/learning/practice/sessions/{seed['id']}/answers",
        json={
            "revision": seed["revision"],
            "questionId": challenge_question,
            "selectedAnswer": "B",
        },
    )
    assert answered.status_code == 200, answered.text
    assert client.post(
        f"/api/v1/learning/practice/sessions/{seed['id']}/complete",
        json={"revision": answered.json()["session"]["revision"]},
    ).status_code == 200

    revenge = client.post(
        "/api/v1/learning/practice/sessions/start",
        json={
            "paperId": practice_ids["paper"],
            "releaseId": practice_ids["release"],
            "mode": "revenge",
            "count": 10,
            "order": "paper",
        },
    ).json()["session"]
    mistake_id = revenge["questionOrder"][0]["mistakeId"]

    async def mistake_snapshot() -> dict:
        async with AsyncSessionLocal() as db:
            row = await db.get(PracticeMistake, mistake_id)
            assert row is not None
            return {
                "status": row.status,
                "revenge_attempt_count": row.revenge_attempt_count,
                "revenge_correct_count": row.revenge_correct_count,
                "revenge_wrong_count": row.revenge_wrong_count,
            }

    before = asyncio.run(mistake_snapshot())
    # 复仇整卷答对后先显式保存：只有 complete 才推进长期错题状态。
    paused = client.post(
        f"/api/v1/learning/practice/sessions/{revenge['id']}/pause",
        json={
            "revision": revenge["revision"],
            "answers": {
                challenge_question: {"selectedAnswer": "A", "selectionIndex": 1}
            },
            "runtimeState": {"currentIndex": 0, "durationMs": 500},
        },
    )
    assert paused.status_code == 200, paused.text
    saved = paused.json()["session"]
    during = asyncio.run(mistake_snapshot())
    assert during == before
    assert saved["answers"][challenge_question]["selectedAnswer"] == "A"

    completed = client.post(
        f"/api/v1/learning/practice/sessions/{revenge['id']}/complete",
        json={"revision": saved["revision"], "answers": saved["answers"]},
    )
    assert completed.status_code == 200, completed.text
    assert completed.json()["report"]["counts"]["correct"] == 1
    after = asyncio.run(mistake_snapshot())
    assert after["revenge_attempt_count"] == before["revenge_attempt_count"] + 1
    assert after["revenge_correct_count"] == before["revenge_correct_count"] + 1
    assert after["status"] == "verification_due"


def test_duplicate_selection_index_is_rejected_without_locking_answers(
    client, active_session
):
    session_id = active_session["id"]
    first_id = active_session["questions"][0]["questionId"]
    second_id = active_session["questions"][1]["questionId"]
    response = client.post(
        f"/api/v1/learning/practice/sessions/{session_id}/complete",
        json={
            "revision": active_session["revision"],
            "answers": {
                first_id: {"selectedAnswer": "A", "selectionIndex": 2},
                second_id: {"selectedAnswer": "A", "selectionIndex": 2},
            },
        },
    )
    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "PRACTICE_DRAFT_ANSWER_INVALID"
    persisted = client.get(
        f"/api/v1/learning/practice/sessions/{session_id}"
    ).json()["session"]
    assert persisted["status"] == "active"
    assert persisted["revision"] == active_session["revision"]
    assert persisted["answers"] == {}


def test_legacy_paused_session_completes_without_resubmitting_answers(
    client, active_session
):
    session_id = active_session["id"]
    first_id = active_session["questions"][0]["questionId"]
    second_id = active_session["questions"][1]["questionId"]
    first = client.post(
        f"/api/v1/learning/practice/sessions/{session_id}/answers",
        json={"revision": 1, "questionId": first_id, "selectedAnswer": "B"},
    ).json()["session"]
    second = client.post(
        f"/api/v1/learning/practice/sessions/{session_id}/pause",
        json={
            "revision": first["revision"],
            "answers": {
                first_id: {"selectedAnswer": "B", "selectionIndex": 1},
                second_id: {"selectedAnswer": "B", "selectionIndex": 2},
            },
            "runtimeState": {"currentIndex": 1, "durationMs": 800},
        },
    ).json()["session"]
    assert second["status"] == "paused"
    assert _mistake_count(session_id) == 1

    completed = client.post(
        f"/api/v1/learning/practice/sessions/{session_id}/complete",
        json={
            "revision": second["revision"],
            "answers": {
                first_id: {"selectedAnswer": "B", "selectionIndex": 1},
                second_id: {"selectedAnswer": "B", "selectionIndex": 2},
            },
            "runtimeState": {"durationMs": 800},
        },
    )
    assert completed.status_code == 200, completed.text
    body = completed.json()
    assert body["report"]["counts"]["answered"] == 2
    assert body["report"]["counts"]["correct"] == 0
    # 升级链路只补第二题的错题：旧判题不重算、不错记第二次错误。
    assert _mistake_count(session_id) == 2
    overview = client.get("/api/v1/learning/practice/overview").json()
    second_mistake = next(
        row
        for row in overview["mistakes"]
        if row["questionId"] == second_id
    )
    assert second_mistake["wrongCount"] == 1


def test_whole_paper_grading_helper_is_the_single_mistake_record_path(
    client, active_session, monkeypatch
):
    session_id = active_session["id"]
    owner = _session_owner(session_id)
    first_id = active_session["questions"][0]["questionId"]
    answers = {first_id: {"selectedAnswer": "B", "selectionIndex": 1}}
    response = client.post(
        f"/api/v1/learning/practice/sessions/{session_id}/complete",
        json={
            "revision": active_session["revision"],
            "answers": answers,
            "runtimeState": {"currentIndex": 0, "durationMs": 600},
        },
    )
    assert response.status_code == 200, response.text
    report = response.json()["report"]

    # 单题 helper 是唯一判题入口：直接调用必须与整卷交卷结果一致。
    async def grade_directly() -> dict:
        async with AsyncSessionLocal() as db:
            session = await db.get(PracticeSession, session_id)
            refs = [item for item in session.question_order if isinstance(item, dict)]
            ref = next(item for item in refs if item.get("questionId") == first_id)
            rows = await practice_session_service._release_question_rows(
                db, session.release_id
            )
            row = rows[first_id]
            student = await db.get(User, owner)
            draft = {"selectedAnswer": "B"}
            graded = await practice_session_service._grade_session_selection(
                db, owner, student, session, ref, row, draft, 1
            )
            await db.rollback()
            return graded

    graded = asyncio.run(grade_directly())
    assert graded["questionId"] == first_id
    assert graded["selectedAnswer"] == "B"
    assert graded["correctAnswer"] == "A"
    assert graded["correct"] is False
    assert graded["submissionIndex"] == 1
    assert graded["submittedAt"]
    assert report["wrongQuestionIds"] == [first_id]


def test_complete_with_whole_answers_never_double_counts_legacy_graded_mistakes(
    client, active_session
):
    """升级链路重交已判题答案：旧 wrong 记账不得重复累计。

    （owner/question/release 唯一索引下，同一事务对同一题二次 create
    会直接 IntegrityError → 交卷 500。）
    """

    session_id = active_session["id"]
    owner = _session_owner(session_id)
    first_id = active_session["questions"][0]["questionId"]
    second_id = active_session["questions"][1]["questionId"]

    # 旧版链路：first 已由 /answers 判题并记账一次错题。
    answered = client.post(
        f"/api/v1/learning/practice/sessions/{session_id}/answers",
        json={"revision": 1, "questionId": first_id, "selectedAnswer": "B"},
    )
    assert answered.status_code == 200, answered.text

    # 升级后显式保存再交卷：整卷载荷包含同一条已判题答案（正常前端形态）。
    whole_paper = {
        first_id: {"selectedAnswer": "B", "selectionIndex": 1},
        second_id: {"selectedAnswer": "B", "selectionIndex": 2},
    }
    paused = client.post(
        f"/api/v1/learning/practice/sessions/{session_id}/pause",
        json={
            "revision": answered.json()["session"]["revision"],
            "answers": whole_paper,
            "runtimeState": {"currentIndex": 1, "durationMs": 1500},
        },
    )
    assert paused.status_code == 200, paused.text

    completed = client.post(
        f"/api/v1/learning/practice/sessions/{session_id}/complete",
        json={
            "revision": paused.json()["session"]["revision"],
            "answers": whole_paper,
            "runtimeState": {"durationMs": 1500},
        },
    )
    assert completed.status_code == 200, completed.text
    body = completed.json()
    assert body["report"]["counts"]["answered"] == 2
    assert body["report"]["counts"]["correct"] == 0
    # 交卷后 first 的错题仍只有一条记录，且 wrongCount 不被二次累计。
    overview = client.get("/api/v1/learning/practice/overview").json()
    first_mistake = next(
        row for row in overview["mistakes"] if row["questionId"] == first_id
    )
    assert first_mistake["wrongCount"] == 1
    second_mistake = next(
        row for row in overview["mistakes"] if row["questionId"] == second_id
    )
    assert second_mistake["wrongCount"] == 1
    assert asyncio.run(_completion_event_count(owner, session_id)) == 1


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


# ---------------------------------------------------------------------------
# Bridge O-1：前端 submission() 对超时条目统一发 '__timeout__' + timedOut:true
# ---------------------------------------------------------------------------


def test_scholar_pause_and_complete_accept_timeout_placeholder_from_client_grading(
    client, practice_ids
):
    """O-1 桥接：pause 必须保存占位符草稿，complete 重算按 timedOut 判 false；
    裸 '__timeout__'（不带 timedOut:true）仍被拒绝以伪造超时。"""

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
    second_id = session["questions"][1]["questionId"]

    # 裸 '__timeout__'（不带 timedOut:true）依旧拒绝。
    bare = client.post(
        f"/api/v1/learning/practice/sessions/{session['id']}/pause",
        json={
            "revision": session["revision"],
            "answers": {
                first_id: {"selectedAnswer": "__timeout__", "selectionIndex": 1}
            },
            "runtimeState": {"currentIndex": 0},
        },
    )
    assert bare.status_code == 422
    assert bare.json()["detail"]["code"] == "PRACTICE_DRAFT_ANSWER_INVALID"
    intact = client.get(
        f"/api/v1/learning/practice/sessions/{session['id']}"
    ).json()["session"]
    assert intact["answers"] == {}

    # 前端归一化形态：'__timeout__' + timedOut:true 必须通过白名单并落库。
    whole_paper = {
        first_id: {"selectedAnswer": "__timeout__", "selectionIndex": 1, "timedOut": True},
        second_id: {"selectedAnswer": "A", "selectionIndex": 2},
    }
    paused = client.post(
        f"/api/v1/learning/practice/sessions/{session['id']}/pause",
        json={
            "revision": session["revision"],
            "answers": whole_paper,
            "runtimeState": {"currentIndex": 1, "durationMs": 3000},
        },
    )
    assert paused.status_code == 200, paused.text
    saved = paused.json()["session"]
    assert saved["status"] == "paused"
    assert saved["answers"][first_id] == {
        "selectedAnswer": "__timeout__",
        "selectionIndex": 1,
        "timedOut": True,
    }
    assert saved["stats"]["answered"] == 2

    # 同一载荷重试：pause 幂等窗口不因占位符深比较误判冲突。
    retry = client.post(
        f"/api/v1/learning/practice/sessions/{session['id']}/pause",
        json={
            "revision": saved["revision"] - 1,
            "answers": whole_paper,
            "runtimeState": {"currentIndex": 1, "durationMs": 3000},
        },
    )
    assert retry.status_code == 200, retry.text
    assert retry.json()["session"]["revision"] == saved["revision"]

    # 交卷：timedOut 条目整卷重算判 false，真实选项条目正常判分。
    completed = client.post(
        f"/api/v1/learning/practice/sessions/{session['id']}/complete",
        json={"revision": saved["revision"], "answers": whole_paper,
              "runtimeState": {"durationMs": 3000}},
    )
    assert completed.status_code == 200, completed.text
    body = completed.json()
    assert body["report"]["counts"]["answered"] == 2
    assert body["report"]["counts"]["wrong"] == 1
    assert body["report"]["counts"]["correct"] == 1
    assert body["report"]["wrongQuestionIds"] == [first_id]
    assert body["session"]["answers"][first_id]["correct"] is False


def test_legacy_real_option_with_timed_out_draft_resaves_as_placeholder(
    client, practice_ids
):
    """联动 3a：服务器存有旧格式超时草稿（真实选项值）时，
    新前端重发归一化占位符不得被误判为改写或冲突。"""

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

    # 旧格式：真实值 + timedOut:true 落库。
    first_save = client.post(
        f"/api/v1/learning/practice/sessions/{session['id']}/pause",
        json={
            "revision": session["revision"],
            "answers": {
                first_id: {"selectedAnswer": "A", "selectionIndex": 1, "timedOut": True}
            },
            "runtimeState": {"currentIndex": 0, "durationMs": 1000},
        },
    )
    assert first_save.status_code == 200, first_save.text
    revision = first_save.json()["session"]["revision"]

    # 新前端 resume 后在幂等窗口内重发归一化占位符（同 selectionIndex/timedOut）：
    # 不允许 PRACTICE_ANSWER_LOCKED 或 revision 冲突。
    resave = client.post(
        f"/api/v1/learning/practice/sessions/{session['id']}/pause",
        json={
            "revision": revision - 1,
            "answers": {
                first_id: {
                    "selectedAnswer": "__timeout__",
                    "selectionIndex": 1,
                    "timedOut": True,
                }
            },
            "runtimeState": {"currentIndex": 0, "durationMs": 1000},
        },
    )
    assert resave.status_code == 200, resave.text


# Exit settlement: only server-created delta events can credit account experience.
def test_experience_delta_is_monotonic_and_retry_safe(client, active_session):
    from app.services import practice_experience_service as ledger

    async def verify():
        async with AsyncSessionLocal() as db:
            session = await db.get(PracticeSession, active_session['id'])
            assert await ledger.settle_experience_delta(db, session, 100, now_utc()) == 100
            assert await ledger.settle_experience_delta(db, session, 100, now_utc()) == 0
            assert await ledger.settle_experience_delta(db, session, 140, now_utc()) == 40
            with pytest.raises(ValueError, match='不能倒退'):
                await ledger.settle_experience_delta(db, session, 139, now_utc())
            await db.flush()
            events = (await db.execute(select(LearningEvent).where(
                LearningEvent.owner_id == session.owner_id,
                LearningEvent.event_type == 'PRACTICE_EXPERIENCE_SETTLED',
            ))).scalars().all()
            assert sorted(event.payload['delta'] for event in events) == [40, 100]
            assert session.stats['creditedExperience'] == 140
            assert all(event.id.startswith('pxp_') and len(event.id) <= 64 for event in events)
            await db.rollback()
    asyncio.run(verify())


def test_public_learning_events_cannot_mint_experience(client):
    response = client.post('/api/v1/learning/events', json={
        'eventType': 'PRACTICE_EXPERIENCE_SETTLED',
        'payload': {'delta': 999999, 'trusted': True},
    })
    assert response.status_code == 400, response.text
    assert client.get('/api/v1/learning/practice/experience-summary').json()['totalExperience'] == 0
    assert client.post('/api/v1/learning/events', json={
        'eventType': 'PRACTICE_REVIEW_OPENED', 'payload': {},
    }).status_code == 200


def test_experience_baseline_preserves_date_and_replays_once(client, active_session):
    import importlib.util
    from pathlib import Path
    from datetime import timedelta
    migration_path = Path(__file__).parents[1] / 'alembic/versions/a8c1d4e7f920_practice_mode_experience_ledger.py'
    assert migration_path.exists(), 'experience baseline migration is required'
    spec = importlib.util.spec_from_file_location('experience_baseline_migration', migration_path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    original_time = now_utc() - timedelta(days=2)

    async def verify():
        async with AsyncSessionLocal() as db:
            session = await db.get(PracticeSession, active_session['id'])
            session.status = 'completed'
            session.completed_at = original_time
            session.stats = {'experience': 106}
            await db.flush()
            for _ in range(2):
                await db.run_sync(lambda sync: migration.backfill_experience(sync.connection()))
            await db.refresh(session)
            events = (await db.execute(select(LearningEvent).where(
                LearningEvent.owner_id == session.owner_id,
                LearningEvent.event_type == 'PRACTICE_EXPERIENCE_SETTLED',
            ))).scalars().all()
            assert len(events) == 1
            assert events[0].payload['delta'] == 106
            assert events[0].created_at == original_time
            assert session.stats['creditedExperience'] == 106
            await db.rollback()
    asyncio.run(verify())


def test_pause_credits_once_and_resumed_completion_only_credits_delta(client, active_session):
    sid = active_session['id']
    ids = [ref['questionId'] for ref in active_session['questions']]
    payload = {'revision': active_session['revision'],
               'answers': {ids[0]: {'selectedAnswer': 'A', 'selectionIndex': 1}}}
    for _ in range(2):
        paused = client.post(f'/api/v1/learning/practice/sessions/{sid}/pause', json=payload)
        assert paused.status_code == 200, paused.text
    assert client.get('/api/v1/learning/practice/experience-summary').json()['totalExperience'] == 10
    assert paused.json()['session']['status'] == 'paused'
    payload['revision'] = paused.json()['session']['revision']
    payload['answers'][ids[1]] = {'selectedAnswer': 'A', 'selectionIndex': 2}
    second = client.post(f'/api/v1/learning/practice/sessions/{sid}/pause', json=payload)
    assert second.status_code == 200, second.text
    assert second.json()['session']['stats']['answered'] == 2
    assert client.get('/api/v1/learning/practice/experience-summary').json()['totalExperience'] == 20
    payload['revision'] = second.json()['session']['revision']
    payload['answers'][ids[2]] = {'selectedAnswer': 'A', 'selectionIndex': 3}
    for _ in range(2):
        completed = client.post(f'/api/v1/learning/practice/sessions/{sid}/complete', json=payload)
        assert completed.status_code == 200, completed.text
    assert completed.json()['session']['stats']['creditedExperience'] == 32
    assert client.get('/api/v1/learning/practice/experience-summary').json()['totalExperience'] == 32


def test_abandon_saves_latest_answers_and_credits_without_report(client, active_session):
    sid = active_session['id']
    qid = active_session['questions'][0]['questionId']
    payload = {'revision': active_session['revision'],
               'answers': {qid: {'selectedAnswer': 'A', 'selectionIndex': 1}},
               'runtimeState': {'experience': 999999}}
    for _ in range(2):
        saved = client.post(f'/api/v1/learning/practice/sessions/{sid}/abandon', json=payload)
        assert saved.status_code == 200, saved.text
    session = saved.json()['session']
    assert session['answers'][qid]['selectedAnswer'] == 'A'
    assert session['stats']['experience'] == 10
    assert session['status'] == 'abandoned'
    assert client.get('/api/v1/learning/practice/experience-summary').json()['totalExperience'] == 10
    assert client.get(f'/api/v1/learning/practice/sessions/{sid}/report').status_code == 404
    payload['answers'][qid]['selectedAnswer'] = 'B'
    changed = client.post(f'/api/v1/learning/practice/sessions/{sid}/abandon', json=payload)
    assert changed.status_code == 409


def test_practice_mode_is_distinct_and_clearing_history_preserves_progress_and_xp(client, practice_ids):
    started = client.post('/api/v1/learning/practice/sessions/start', json={
        'paperId': practice_ids['paper'], 'releaseId': practice_ids['release'],
        'mode': 'practice', 'count': 10, 'order': 'paper',
    })
    assert started.status_code == 200, started.text
    session = started.json()['session']
    assert session['mode'] == 'practice'
    sid = session['id']
    qids = [ref['questionId'] for ref in session['questions']]
    payload = {'revision': session['revision'],
               'answers': {qids[0]: {'selectedAnswer': 'A', 'selectionIndex': 1}}}
    paused = client.post(f'/api/v1/learning/practice/sessions/{sid}/pause', json=payload)
    assert paused.status_code == 200, paused.text
    history = client.get('/api/v1/learning/practice/sessions').json()['sessions']
    assert [item['sessionId'] for item in history] == [sid]
    assert history[0]['reportAvailable'] is False
    assert client.delete('/api/v1/learning/practice/sessions').status_code == 200
    assert client.get('/api/v1/learning/practice/sessions').json()['sessions'] == []
    assert client.get('/api/v1/learning/practice/experience-summary').json()['totalExperience'] == 10
    assert client.get(f'/api/v1/learning/practice/sessions/{sid}').status_code == 200
    payload['revision'] = paused.json()['session']['revision']
    payload['answers'][qids[1]] = {'selectedAnswer': 'B', 'selectionIndex': 2}
    assert client.post(f'/api/v1/learning/practice/sessions/{sid}/pause', json=payload).status_code == 200
    assert len(client.get('/api/v1/learning/practice/sessions').json()['sessions']) == 1


def test_experience_summary_ignores_forged_old_events_and_keeps_delta_dates(client, active_session, practice_ids):
    from datetime import timedelta
    sid = active_session['id']
    ids = [ref['questionId'] for ref in active_session['questions']]
    payload = {'revision': active_session['revision'],
               'answers': {ids[0]: {'selectedAnswer': 'A', 'selectionIndex': 1}}}
    paused = client.post(f'/api/v1/learning/practice/sessions/{sid}/pause', json=payload).json()['session']
    yesterday = now_utc() - timedelta(days=1)

    async def move_first_and_forge():
        async with AsyncSessionLocal() as db:
            events = (await db.execute(select(LearningEvent).where(
                LearningEvent.owner_id == practice_ids['student'],
                LearningEvent.event_type == 'PRACTICE_EXPERIENCE_SETTLED',
            ))).scalars().all()
            assert len(events) == 1
            events[0].created_at = yesterday
            db.add(LearningEvent(id='le_' + uuid4().hex, owner_id=practice_ids['student'],
                event_type='PRACTICE_EXPERIENCE_SETTLED', payload={'delta': 99999, 'trusted': True}))
            await db.commit()
    asyncio.run(move_first_and_forge())
    payload['revision'] = paused['revision']
    payload['answers'][ids[1]] = {'selectedAnswer': 'A', 'selectionIndex': 2}
    response = client.post(f'/api/v1/learning/practice/sessions/{sid}/complete', json=payload)
    assert response.status_code == 200, response.text
    summary = client.get('/api/v1/learning/practice/experience-summary').json()
    daily = {item['date']: item['experience'] for item in summary['daily']}
    assert summary['totalExperience'] == 20
    assert daily[yesterday.astimezone().date().isoformat()] == 10
    assert daily[now_utc().astimezone().date().isoformat()] == 10
    assert client.delete('/api/v1/learning/practice/sessions').status_code == 200
    assert client.get('/api/v1/learning/practice/experience-summary').json()['totalExperience'] == 20
