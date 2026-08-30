import asyncio
from datetime import timedelta
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.core.security import now_utc
from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.training import PracticeMistake
from app.models.training import TrainingProgress
from app.services import learning_service


def _name(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:10]}"


def _login(client: TestClient, username: str, password: str = "test1234") -> None:
    response = client.post("/api/v1/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200, response.text


def _create_student(username: str) -> None:
    admin = TestClient(app)
    _login(admin, "admin", "jbgsnmm~123")
    response = admin.post(
        "/api/v1/users",
        json={"username": username, "password": "test1234", "role": "student", "subject": "PMP"},
    )
    assert response.status_code == 200, response.text


def _create_public_question(*, title: str, taxonomy_id: str, node_id: str) -> dict:
    admin = TestClient(app)
    _login(admin, "admin", "jbgsnmm~123")
    bank_response = admin.post(
        "/api/v1/banks",
        json={"name": _name("复仇验证题库"), "subject": "PMP", "visibility": "published"},
    )
    assert bank_response.status_code == 200, bank_response.text
    bank_id = bank_response.json()["bank"]["id"]
    question_response = admin.post(
        f"/api/v1/banks/{bank_id}/questions",
        json={
            "title": title,
            "stemParts": [{"text": title}],
            "options": [
                {"id": "A", "text": "正确项", "correct": True},
                {"id": "B", "text": "错误项", "correct": False},
            ],
            "correctAnswer": "A",
            "metadata": {
                "knowledge": {
                    "taxonomyId": taxonomy_id,
                    "primaryNodeId": node_id,
                    "pathSnapshot": ["范围管理", "范围基准"],
                }
            },
        },
    )
    assert question_response.status_code == 200, question_response.text
    question = question_response.json()["question"]
    published = admin.put(f"/api/v1/questions/{question['id']}", json={"scope": "public"})
    assert published.status_code == 200, published.text
    return {"bankId": bank_id, "question": published.json()["question"]}


def _mistake_row(
    *,
    mistake_id: str,
    owner: str,
    question_id: str,
    status: str,
    wrong_count: int = 1,
    revenge_wrong_count: int = 0,
    release_id: str | None = None,
    next_review_at=None,
    updated_at=None,
    usable_snapshot: bool = True,
) -> PracticeMistake:
    snapshot = {
        "id": question_id,
        "title": f"题目 {question_id}",
        "stem": f"题干 {question_id}",
        "options": [
            {"id": "A", "text": "正确项", "correct": True},
            {"id": "B", "text": "错误项", "correct": False},
        ],
        "correctAnswer": "A",
    }
    if not usable_snapshot:
        snapshot = {"id": question_id, "title": "损坏快照", "options": []}
    now = now_utc()
    return PracticeMistake(
        id=mistake_id,
        owner_id=owner,
        question_id=question_id,
        bank_id=None,
        paper_id=None,
        release_id=release_id,
        paper_version=0,
        paper_name="测试错题来源",
        source_mode="challenge",
        language_mode="zh",
        question_snapshot=snapshot,
        knowledge={},
        selected_answers=["B"],
        status=status,
        wrong_count=wrong_count,
        revenge_wrong_count=revenge_wrong_count,
        next_review_at=next_review_at,
        first_wrong_at=now,
        last_wrong_at=now,
        updated_at=updated_at or now,
    )


def test_global_revenge_pool_deduplicates_questions_and_uses_urgent_representative() -> None:
    now = now_utc()
    rows = [
        _mistake_row(
            mistake_id="pm_pending_old_release",
            owner="owner-a",
            question_id="q-duplicate",
            status="pending",
            wrong_count=5,
            release_id="release-old",
            updated_at=now - timedelta(days=2),
        ),
        _mistake_row(
            mistake_id="pm_remediation_new_release",
            owner="owner-a",
            question_id="q-duplicate",
            status="needs_remediation",
            wrong_count=2,
            revenge_wrong_count=1,
            release_id="release-new",
            updated_at=now - timedelta(days=1),
        ),
        _mistake_row(
            mistake_id="pm_legacy_versionless",
            owner="owner-a",
            question_id="q-versionless",
            status="pending",
            release_id=None,
        ),
        _mistake_row(
            mistake_id="pm_waiting",
            owner="owner-a",
            question_id="q-waiting",
            status="verification_due",
            next_review_at=now + timedelta(hours=2),
        ),
        _mistake_row(
            mistake_id="pm_mastered",
            owner="owner-a",
            question_id="q-mastered",
            status="mastered",
        ),
        _mistake_row(
            mistake_id="pm_broken",
            owner="owner-a",
            question_id="q-broken",
            status="pending",
            usable_snapshot=False,
        ),
    ]

    pool = learning_service.build_global_revenge_pool(rows, now=now)

    assert pool["stats"] == {
        "active": 2,
        "pending": 1,
        "needsRemediation": 1,
        "verificationDue": 0,
        "verificationWaiting": 1,
        "mastered": 1,
    }
    assert pool["unavailableCount"] == 1
    assert [row["questionId"] for row in pool["candidates"]] == [
        "q-duplicate",
        "q-versionless",
    ]
    duplicate = pool["candidates"][0]
    assert duplicate["mistakeId"] == "pm_remediation_new_release"
    assert duplicate["mistakeIds"] == [
        "pm_remediation_new_release",
        "pm_pending_old_release",
    ]
    assert duplicate["releaseId"] == "release-new"


def test_global_revenge_pool_skips_an_unusable_urgent_copy_when_a_usable_copy_exists() -> None:
    now = now_utc()
    pool = learning_service.build_global_revenge_pool(
        [
            _mistake_row(
                mistake_id="pm_broken_remediation",
                owner="owner-a",
                question_id="q-shared",
                status="needs_remediation",
                usable_snapshot=False,
            ),
            _mistake_row(
                mistake_id="pm_usable_pending",
                owner="owner-a",
                question_id="q-shared",
                status="pending",
            ),
        ],
        now=now,
    )

    assert pool["unavailableCount"] == 0
    assert [row["mistakeId"] for row in pool["candidates"]] == [
        "pm_usable_pending"
    ]
    assert pool["candidates"][0]["mistakeIds"] == [
        "pm_usable_pending",
        "pm_broken_remediation",
    ]


def test_practice_mistake_remediation_and_verification_are_database_backed() -> None:
    username = _name("practice_owner")
    other_username = _name("practice_other")
    _create_student(username)
    _create_student(other_username)
    source = _create_public_question(title="源错题", taxonomy_id="taxonomy-pmp", node_id="scope-baseline")
    verification = _create_public_question(title="同知识点验证题", taxonomy_id="taxonomy-pmp", node_id="scope-baseline")
    unrelated = _create_public_question(title="无关知识点题", taxonomy_id="taxonomy-pmp", node_id="schedule-network")

    client = TestClient(app)
    _login(client, username)
    create = client.post(
        "/api/v1/learning/practice/mistakes",
        json={
            "questionId": source["question"]["id"],
            "bankId": source["bankId"],
            "paperId": "paper-release-source",
            "releaseId": "",
            "paperVersion": 1,
            "paperName": "范围练习",
            "sourceMode": "challenge",
            "languageMode": "zh",
            "selectedAnswer": "B",
        },
    )
    assert create.status_code == 200, create.text
    mistake = create.json()["mistake"]
    assert mistake["status"] == "pending"
    assert mistake["wrongCount"] == 1
    assert mistake["questionSnapshot"]["id"] == source["question"]["id"]

    persisted = TestClient(app)
    _login(persisted, username)
    overview = persisted.get("/api/v1/learning/practice/overview")
    assert overview.status_code == 200, overview.text
    assert overview.json()["stats"]["pending"] == 1
    assert overview.json()["revengeStats"]["active"] == 1
    assert overview.json()["revengeStats"]["pending"] == 1
    assert [row["mistakeId"] for row in overview.json()["revengeCandidates"]] == [
        mistake["id"]
    ]
    assert "correctAnswer" not in overview.json()["revengeCandidates"][0]["questionSnapshot"]
    assert overview.json()["plan"]["idealAction"]["id"] == "revenge"
    overview_question = overview.json()["mistakes"][0]["questionSnapshot"]
    assert "correctAnswer" not in overview_question
    assert all("correct" not in option for option in overview_question["options"])

    isolated = TestClient(app)
    _login(isolated, other_username)
    assert isolated.get("/api/v1/learning/practice/overview").json()["mistakes"] == []
    assert isolated.post(
        f"/api/v1/learning/practice/mistakes/{mistake['id']}/revenge-answer",
        json={"correct": False, "selectedAnswer": "B"},
    ).status_code == 404

    revenge_wrong = client.post(
        f"/api/v1/learning/practice/mistakes/{mistake['id']}/revenge-answer",
        json={"correct": False, "selectedAnswer": "B"},
    )
    assert revenge_wrong.status_code == 200, revenge_wrong.text
    assert revenge_wrong.json()["mistake"]["status"] == "needs_remediation"

    direct_wrong_cannot_reset_remediation = client.post(
        "/api/v1/learning/practice/mistakes",
        json={
            "questionId": source["question"]["id"],
            "bankId": source["bankId"],
            "releaseId": "",
            "selectedAnswer": "B",
        },
    )
    assert direct_wrong_cannot_reset_remediation.status_code == 200
    assert direct_wrong_cannot_reset_remediation.json()["mistake"]["status"] == "needs_remediation"

    ordinary_wrong_cannot_reset_remediation = client.post(
        "/api/v1/learning/practice/answers",
        json={
            "questionId": source["question"]["id"],
            "bankId": source["bankId"],
            "releaseId": "",
            "selectedAnswer": "B",
        },
    )
    assert ordinary_wrong_cannot_reset_remediation.status_code == 200
    assert ordinary_wrong_cannot_reset_remediation.json()["mistake"]["status"] == "needs_remediation"

    cannot_bypass = client.post(
        "/api/v1/learning/practice/answers",
        json={
            "questionId": source["question"]["id"],
            "bankId": source["bankId"],
            "releaseId": "",
            "selectedAnswer": "A",
        },
    )
    assert cannot_bypass.status_code == 200, cannot_bypass.text
    assert cannot_bypass.json()["mistake"]["status"] == "needs_remediation"

    spoofed_revenge = client.post(
        f"/api/v1/learning/practice/mistakes/{mistake['id']}/revenge-answer",
        json={"correct": True, "selectedAnswer": "B"},
    )
    assert spoofed_revenge.status_code == 200, spoofed_revenge.text
    assert spoofed_revenge.json()["mistake"]["status"] == "needs_remediation"

    invalid_revenge = client.post(
        f"/api/v1/learning/practice/mistakes/{mistake['id']}/revenge-answer",
        json={"selectedAnswer": "Z"},
    )
    assert invalid_revenge.status_code == 422

    before_review = client.get(f"/api/v1/learning/practice/mistakes/{mistake['id']}/verification-candidate")
    assert before_review.status_code == 422

    reviewed = client.post(f"/api/v1/learning/practice/mistakes/{mistake['id']}/remediation-reviewed")
    assert reviewed.status_code == 200, reviewed.text

    candidate = client.get(f"/api/v1/learning/practice/mistakes/{mistake['id']}/verification-candidate")
    assert candidate.status_code == 200, candidate.text
    assert candidate.json()["candidate"]["question"]["id"] == verification["question"]["id"]
    assert candidate.json()["candidate"]["question"]["id"] != source["question"]["id"]
    assert "correctAnswer" not in candidate.json()["candidate"]["question"]
    assert all(
        "correct" not in option
        for option in candidate.json()["candidate"]["question"]["options"]
    )

    bad_candidate = client.post(
        f"/api/v1/learning/practice/mistakes/{mistake['id']}/verification",
        json={"questionId": unrelated["question"]["id"], "selectedAnswer": "A"},
    )
    assert bad_candidate.status_code == 422

    verified = client.post(
        f"/api/v1/learning/practice/mistakes/{mistake['id']}/verification",
        json={"questionId": verification["question"]["id"], "selectedAnswer": "A"},
    )
    assert verified.status_code == 200, verified.text
    assert verified.json()["mistake"]["status"] == "verification_due"
    assert verified.json()["verification"]["correct"] is True

    reloaded = persisted.get("/api/v1/learning/practice/overview")
    assert reloaded.status_code == 200
    row = reloaded.json()["mistakes"][0]
    assert row["verificationPassCount"] == 1
    assert row["remediationReviewedAt"] is not None
    assert row["questionSnapshot"]["id"] == source["question"]["id"]


def test_practice_mistake_routes_require_authentication() -> None:
    client = TestClient(app)
    assert client.get("/api/v1/learning/practice/overview").status_code == 401
    assert client.post("/api/v1/learning/practice/mistakes", json={}).status_code == 401
    assert client.post("/api/v1/learning/practice/answers", json={}).status_code == 401


def test_published_learning_mode_uses_supported_surface_and_falls_back_safely() -> None:
    assert learning_service._published_learning_mode(
        {"sourceMode": "multi_question_canvas"}
    ) == "multi_question_canvas"
    assert learning_service._published_learning_mode(
        {"sourceMode": "single_deep_study"}
    ) == "single_deep_study"
    assert learning_service._published_learning_mode(
        {"sourceMode": "workspace"}
    ) == "practice_mode"


def test_practice_answer_uses_server_truth_delays_mastery_and_reactivates_mistakes() -> None:
    username = _name("practice_answer_owner")
    _create_student(username)
    source = _create_public_question(title="自动错题来源", taxonomy_id="taxonomy-pmp", node_id="scope-baseline")
    client = TestClient(app)
    _login(client, username)
    base = {
        "questionId": source["question"]["id"],
        "bankId": source["bankId"],
        "paperId": "paper-answer-source",
        "releaseId": "",
        "paperVersion": 3,
        "paperName": "自动收集练习",
        "sourceMode": "workspace",
        "languageMode": "zh",
    }

    wrong = client.post(
        "/api/v1/learning/practice/answers",
        json={**base, "selectedAnswer": "B", "correct": True},
    )
    assert wrong.status_code == 200, wrong.text
    assert wrong.json()["correct"] is False
    assert wrong.json()["mistake"]["status"] == "pending"
    assert wrong.json()["mistake"]["wrongCount"] == 1
    assert wrong.json()["completion"]["status"] == "completed"
    assert wrong.json()["completion"]["selectedAnswer"] == "B"

    right = client.post(
        "/api/v1/learning/practice/answers",
        json={**base, "selectedAnswer": "A", "correct": False},
    )
    assert right.status_code == 200, right.text
    assert right.json()["correct"] is True
    assert right.json()["mistake"]["status"] == "verification_due"
    assert right.json()["mistake"]["wrongCount"] == 1
    assert right.json()["mistake"]["masteredAt"] is None
    assert right.json()["mistake"]["nextReviewAt"] is not None
    assert right.json()["completion"]["status"] == "completed"

    overview = client.get("/api/v1/learning/practice/overview")
    assert overview.status_code == 200, overview.text
    assert overview.json()["stats"]["active"] == 0
    assert overview.json()["stats"]["verificationWaiting"] == 1
    assert overview.json()["stats"]["mastered"] == 0

    # Re-answering before the 24-hour review point cannot master the mistake.
    too_early = client.post(
        "/api/v1/learning/practice/answers",
        json={**base, "selectedAnswer": "A"},
    )
    assert too_early.status_code == 200, too_early.text
    assert too_early.json()["mistake"]["status"] == "verification_due"

    async def make_review_due() -> None:
        async with AsyncSessionLocal() as db:
            mistake = (
                await db.execute(
                    select(PracticeMistake).where(
                        PracticeMistake.owner_id == username,
                        PracticeMistake.question_id == source["question"]["id"],
                        PracticeMistake.release_id.is_(None),
                    )
                )
            ).scalar_one()
            mistake.next_review_at = now_utc() - timedelta(seconds=1)
            await db.commit()

    asyncio.run(make_review_due())
    mastered = client.post(
        "/api/v1/learning/practice/answers",
        json={**base, "selectedAnswer": "A"},
    )
    assert mastered.status_code == 200, mastered.text
    assert mastered.json()["mistake"]["status"] == "mastered"
    assert mastered.json()["mistake"]["masteredAt"] is not None

    reactivated = client.post(
        "/api/v1/learning/practice/answers",
        json={**base, "selectedAnswer": "B"},
    )
    assert reactivated.status_code == 200, reactivated.text
    assert reactivated.json()["correct"] is False
    assert reactivated.json()["mistake"]["status"] == "pending"
    assert reactivated.json()["mistake"]["wrongCount"] == 2
    assert reactivated.json()["mistake"]["masteredAt"] is None


def test_practice_answer_validates_options_visibility_and_release_identity() -> None:
    username = _name("practice_answer_validation")
    _create_student(username)
    source = _create_public_question(title="多发布错题", taxonomy_id="taxonomy-pmp", node_id="scope-baseline")
    client = TestClient(app)
    _login(client, username)
    base = {"questionId": source["question"]["id"], "bankId": source["bankId"]}

    denied_unknown_release = client.post(
        "/api/v1/learning/practice/answers",
        json={**base, "releaseId": "release-does-not-exist", "selectedAnswer": "A"},
    )
    assert denied_unknown_release.status_code == 404

    correct_first = client.post(
        "/api/v1/learning/practice/answers",
        json={**base, "selectedAnswer": "A"},
    )
    assert correct_first.status_code == 200, correct_first.text
    assert correct_first.json()["correct"] is True
    assert correct_first.json()["mistake"] is None
    assert correct_first.json()["completion"]["status"] == "completed"

    wrong = client.post(
        "/api/v1/learning/practice/answers",
        json={**base, "selectedAnswer": "B"},
    )
    assert wrong.status_code == 200, wrong.text
    assert wrong.json()["mistake"]["releaseId"] == ""

    overview = client.get("/api/v1/learning/practice/overview").json()
    assert overview["stats"]["active"] == 1
    assert {row["releaseId"] for row in overview["mistakes"]} == {""}

    invalid = client.post(
        "/api/v1/learning/practice/answers",
        json={**base, "selectedAnswer": "Z"},
    )
    assert invalid.status_code == 422

    hidden = _create_public_question(title="稍后隐藏的题", taxonomy_id="taxonomy-pmp", node_id="scope-baseline")
    admin = TestClient(app)
    _login(admin, "admin", "jbgsnmm~123")
    hidden_response = admin.put(f"/api/v1/questions/{hidden['question']['id']}", json={"scope": "internal"})
    assert hidden_response.status_code == 200, hidden_response.text
    not_visible = client.post(
        "/api/v1/learning/practice/answers",
        json={
            "questionId": hidden["question"]["id"],
            "bankId": hidden["bankId"],
            "releaseId": "release-hidden",
            "selectedAnswer": "A",
        },
    )
    assert not_visible.status_code == 404


def test_concurrent_first_answers_are_serialized_without_duplicate_rows() -> None:
    username = _name("practice_answer_concurrent")
    _create_student(username)
    source = _create_public_question(title="并发首次作答", taxonomy_id="taxonomy-pmp", node_id="scope-baseline")
    base = {
        "questionId": source["question"]["id"],
        "bankId": source["bankId"],
        "releaseId": "",
        "sourceMode": "workspace",
    }

    async def submit_pair() -> list[dict]:
        async def submit(selected_answer: str) -> dict:
            async with AsyncSessionLocal() as db:
                return await learning_service.record_practice_answer(
                    db,
                    username,
                    {**base, "selectedAnswer": selected_answer},
                )

        return await asyncio.gather(submit("B"), submit("B"))

    results = asyncio.run(submit_pair())
    assert all(result["correct"] is False for result in results)

    async def load_counts() -> tuple[int, int, int]:
        async with AsyncSessionLocal() as db:
            mistakes = int(
                (
                    await db.execute(
                        select(func.count())
                        .select_from(PracticeMistake)
                        .where(
                            PracticeMistake.owner_id == username,
                            PracticeMistake.question_id == source["question"]["id"],
                            PracticeMistake.release_id.is_(None),
                        )
                    )
                ).scalar_one()
            )
            wrong_count = int(
                (
                    await db.execute(
                        select(PracticeMistake.wrong_count).where(
                            PracticeMistake.owner_id == username,
                            PracticeMistake.question_id == source["question"]["id"],
                            PracticeMistake.release_id.is_(None),
                        )
                    )
                ).scalar_one()
            )
            progress = int(
                (
                    await db.execute(
                        select(func.count())
                        .select_from(TrainingProgress)
                        .where(
                            TrainingProgress.owner_id == username,
                            TrainingProgress.question_id == source["question"]["id"],
                        )
                    )
                ).scalar_one()
            )
            return mistakes, wrong_count, progress

    assert asyncio.run(load_counts()) == (1, 2, 1)


def test_practice_session_history_is_database_backed_and_owner_scoped() -> None:
    username = _name("practice_session_owner")
    other_username = _name("practice_session_other")
    _create_student(username)
    _create_student(other_username)

    client = TestClient(app)
    _login(client, username)
    created = client.post(
        "/api/v1/learning/practice/sessions",
        json={
            "mode": "challenge",
            "paperId": "paper-one",
            "paperName": "范围练习",
            "answered": 10,
            "correct": 8,
            "experience": 96,
            "durationMs": 120000,
            "status": "completed",
        },
    )
    assert created.status_code == 200, created.text
    assert created.json()["session"]["mode"] == "challenge"

    persisted = TestClient(app)
    _login(persisted, username)
    history = persisted.get("/api/v1/learning/practice/sessions")
    assert history.status_code == 200, history.text
    assert history.json()["sessions"][0]["paperName"] == "范围练习"
    assert history.json()["sessions"][0]["eventId"]

    isolated = TestClient(app)
    _login(isolated, other_username)
    assert isolated.get("/api/v1/learning/practice/sessions").json()["sessions"] == []

    deleted = client.delete("/api/v1/learning/practice/sessions")
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["deleted"] == 1
    assert persisted.get("/api/v1/learning/practice/sessions").json()["sessions"] == []
