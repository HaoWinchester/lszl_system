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
    _login(admin, "admin", "admin123")
    response = admin.post(
        "/api/v1/users",
        json={"username": username, "password": "test1234", "role": "student", "subject": "PMP"},
    )
    assert response.status_code == 200, response.text


def _create_published_question() -> str:
    admin = TestClient(app)
    _login(admin, "admin", "admin123")
    bank = admin.post(
        "/api/v1/banks",
        json={"name": _name("学习题库"), "subject": "PMP", "visibility": "published"},
    )
    assert bank.status_code == 200, bank.text
    bank_id = bank.json()["bank"]["id"]
    question = admin.post(
        f"/api/v1/banks/{bank_id}/questions",
        json={
            "title": "学习会话测试题",
            "options": [{"id": "A", "text": "正确项", "correct": True}],
            "correctAnswer": "A",
        },
    )
    assert question.status_code == 200, question.text
    question_id = question.json()["question"]["id"]
    published = admin.put(f"/api/v1/questions/{question_id}", json={"scope": "public"})
    assert published.status_code == 200, published.text
    return question_id


def test_training_session_and_events_round_trip() -> None:
    username = _name("learner")
    _create_student(username)
    client = TestClient(app)
    _login(client, username)
    question_id = _create_published_question()
    session = {
        "schemaVersion": 2,
        "currentStep": 3,
        "completedSteps": [1, 2],
        "answer": {"selectedAnswer": "A", "submitted": True},
        "viewport": {"x": 120, "y": 80, "scale": 1.2},
    }

    saved = client.put(f"/api/v1/training/session/{question_id}", json=session)
    assert saved.status_code == 200, saved.text
    assert saved.json()["session"] == session
    loaded = client.get(f"/api/v1/training/session/{question_id}")
    assert loaded.status_code == 200
    assert loaded.json()["session"] == session

    event = client.post(
        "/api/v1/learning/events",
        json={"questionId": question_id, "eventType": "step_completed", "payload": {"step": 2}},
    )
    assert event.status_code == 200, event.text
    events = client.get("/api/v1/learning/events", params={"question_id": question_id})
    assert events.status_code == 200
    assert events.json()["events"][0]["eventType"] == "step_completed"

    invalid = client.put(f"/api/v1/training/session/{question_id}", json={"schemaVersion": 99})
    assert invalid.status_code == 400


def test_workspace_crud_is_owner_isolated() -> None:
    user_a = _name("workspace_a")
    user_b = _name("workspace_b")
    _create_student(user_a)
    _create_student(user_b)
    client_a = TestClient(app)
    client_b = TestClient(app)
    _login(client_a, user_a)
    _login(client_b, user_b)

    created_response = client_a.post(
        "/api/v1/workspaces",
        json={"title": "我的归纳画布", "schemaVersion": 6, "payload": {"nodes": {}, "edges": [], "groups": []}},
    )
    assert created_response.status_code == 200, created_response.text
    created = created_response.json()["workspace"]

    assert client_b.get(f"/api/v1/workspaces/{created['id']}").status_code == 404
    assert client_b.put(f"/api/v1/workspaces/{created['id']}", json={"title": "越权"}).status_code == 404

    listed = client_a.get("/api/v1/workspaces")
    assert listed.status_code == 200
    assert any(item["id"] == created["id"] for item in listed.json()["workspaces"])

    updated_response = client_a.put(
        f"/api/v1/workspaces/{created['id']}",
        json={"title": "更新后的画布", "schemaVersion": 6, "payload": {"nodes": {"n1": {"id": "n1"}}}},
    )
    assert updated_response.status_code == 200, updated_response.text
    assert updated_response.json()["workspace"]["title"] == "更新后的画布"
    assert client_a.delete(f"/api/v1/workspaces/{created['id']}").status_code == 200
    assert client_a.get(f"/api/v1/workspaces/{created['id']}").status_code == 404


def test_workspace_preserves_the_new_legacy_stable_id() -> None:
    username = _name("workspace_stable")
    _create_student(username)
    client = TestClient(app)
    _login(client, username)
    workspace_id = f"workspace-{uuid4().hex[:12]}"

    response = client.post(
        "/api/v1/workspaces",
        json={
            "id": workspace_id,
            "title": "稳定 ID 画布",
            "schemaVersion": 6,
            "payload": {"id": workspace_id, "nodes": {}, "edges": [], "groups": []},
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()["workspace"]["id"] == workspace_id


def test_learning_persistence_requires_authentication() -> None:
    client = TestClient(app)
    assert client.get("/api/v1/workspaces").status_code == 401
    assert client.get("/api/v1/learning/events").status_code == 401
    assert client.get("/api/v1/training/session/missing").status_code == 401
