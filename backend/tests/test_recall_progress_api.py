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


def _create_published_question() -> tuple[str, str]:
    admin = TestClient(app)
    _login(admin, "admin", "jbgsnmm~123")
    bank_response = admin.post(
        "/api/v1/banks",
        json={"name": _name("回忆进度题库"), "subject": "PMP", "visibility": "published"},
    )
    assert bank_response.status_code == 200, bank_response.text
    bank_id = bank_response.json()["bank"]["id"]
    question_response = admin.post(
        f"/api/v1/banks/{bank_id}/questions",
        json={
            "title": "数据库回忆画布题",
            "stemParts": [{"text": "范围基准需要回忆哪些内容？"}],
            "options": [{"id": "A", "text": "范围说明书", "correct": True}],
            "correctAnswer": "A",
        },
    )
    assert question_response.status_code == 200, question_response.text
    question_id = question_response.json()["question"]["id"]
    published = admin.put(f"/api/v1/questions/{question_id}", json={"scope": "public"})
    assert published.status_code == 200, published.text
    return bank_id, question_id


def test_recall_progress_persists_the_full_canvas_in_database_and_is_owner_scoped() -> None:
    owner = _name("recall_owner")
    other = _name("recall_other")
    _create_student(owner)
    _create_student(other)
    bank_id, question_id = _create_published_question()
    payload = {
        "nodes": [{"instanceId": "node-1", "dataId": "scope-baseline", "x": 128, "y": -64}],
        "edges": [{"id": "edge-1", "from": "root", "to": "node-1"}],
        "customNodes": {"custom-1": {"title": "我的回忆"}},
        "activeKeywords": ["scope"],
        "choiceOffsets": {"scope-baseline": 4},
        "metrics": {"keywordClicks": 3, "choiceClicks": 2, "nodeOpens": 5},
        "transform": {"x": 320, "y": -120, "scale": 1.25},
    }

    client = TestClient(app)
    _login(client, owner)
    saved = client.put(f"/api/v1/recall/progress/{question_id}", json=payload)
    assert saved.status_code == 200, saved.text
    assert saved.json()["progress"] == payload

    reloaded = TestClient(app)
    _login(reloaded, owner)
    loaded = reloaded.get(f"/api/v1/recall/progress/{question_id}")
    assert loaded.status_code == 200, loaded.text
    assert loaded.json()["progress"] == payload
    explored = reloaded.get("/api/v1/recall/progress", params=[("question_ids", question_id)])
    assert explored.status_code == 200, explored.text
    assert explored.json()["questionIds"] == [question_id]

    isolated = TestClient(app)
    _login(isolated, other)
    assert isolated.get(f"/api/v1/recall/progress/{question_id}").json()["progress"] is None
    assert isolated.get("/api/v1/recall/progress", params=[("question_ids", question_id)]).json()["questionIds"] == []


def test_recall_progress_rejects_a_missing_question_without_a_database_error() -> None:
    owner = _name("recall_missing")
    _create_student(owner)
    client = TestClient(app, raise_server_exceptions=False)
    _login(client, owner)

    response = client.put("/api/v1/recall/progress/unavailable", json={"nodes": [], "edges": []})

    assert response.status_code == 404, response.text
    assert response.json()["detail"] == "题目不存在或无权访问"
