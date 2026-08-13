from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app


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
            "releaseId": "release-source",
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
    assert overview.json()["plan"]["idealAction"]["id"] == "revenge"

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

    before_review = client.get(f"/api/v1/learning/practice/mistakes/{mistake['id']}/verification-candidate")
    assert before_review.status_code == 422

    reviewed = client.post(f"/api/v1/learning/practice/mistakes/{mistake['id']}/remediation-reviewed")
    assert reviewed.status_code == 200, reviewed.text

    candidate = client.get(f"/api/v1/learning/practice/mistakes/{mistake['id']}/verification-candidate")
    assert candidate.status_code == 200, candidate.text
    assert candidate.json()["candidate"]["question"]["id"] == verification["question"]["id"]
    assert candidate.json()["candidate"]["question"]["id"] != source["question"]["id"]

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


def test_practice_answer_uses_server_truth_and_reactivates_mastered_mistakes() -> None:
    username = _name("practice_answer_owner")
    _create_student(username)
    source = _create_public_question(title="自动错题来源", taxonomy_id="taxonomy-pmp", node_id="scope-baseline")
    client = TestClient(app)
    _login(client, username)
    base = {
        "questionId": source["question"]["id"],
        "bankId": source["bankId"],
        "paperId": "paper-answer-source",
        "releaseId": "release-answer-source",
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

    right = client.post(
        "/api/v1/learning/practice/answers",
        json={**base, "selectedAnswer": "A", "correct": False},
    )
    assert right.status_code == 200, right.text
    assert right.json()["correct"] is True
    assert right.json()["mistake"]["status"] == "mastered"
    assert right.json()["mistake"]["wrongCount"] == 1
    assert right.json()["mistake"]["masteredAt"] is not None

    overview = client.get("/api/v1/learning/practice/overview")
    assert overview.status_code == 200, overview.text
    assert overview.json()["stats"]["active"] == 0
    assert overview.json()["stats"]["mastered"] == 1

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

    correct_first = client.post(
        "/api/v1/learning/practice/answers",
        json={**base, "releaseId": "release-clean", "selectedAnswer": "A"},
    )
    assert correct_first.status_code == 200, correct_first.text
    assert correct_first.json() == {"correct": True, "mistake": None}

    for release_id in ("release-one", "release-two"):
        response = client.post(
            "/api/v1/learning/practice/answers",
            json={**base, "releaseId": release_id, "selectedAnswer": "B"},
        )
        assert response.status_code == 200, response.text
        assert response.json()["mistake"]["releaseId"] == release_id

    overview = client.get("/api/v1/learning/practice/overview").json()
    assert overview["stats"]["active"] == 2
    assert {row["releaseId"] for row in overview["mistakes"]} == {"release-one", "release-two"}

    invalid = client.post(
        "/api/v1/learning/practice/answers",
        json={**base, "releaseId": "release-invalid", "selectedAnswer": "Z"},
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
