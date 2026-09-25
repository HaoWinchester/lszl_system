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
    canvas = {
        "strokes": [{"id": "ink-1", "tool": "pen", "color": "#123456", "width": 3, "points": [[1, 2], [-3, 4]]}],
        "nodes": [
            {"instanceId": "root", "dataId": "scope-baseline", "x": 0, "y": 0},
            {
                "instanceId": "node-1",
                "dataId": "personal:custom-1",
                "title": "我的回忆",
                "custom": True,
                "x": 128,
                "y": -64,
            },
        ],
        "edges": [{"id": "edge-1", "from": "root", "to": "node-1"}],
        "customNodes": {"personal:custom-1": {"title": "我的回忆"}},
        "activeKeywords": ["scope"],
        "choiceOffsets": {"scope-baseline": 4},
        "metrics": {"keywordClicks": 3, "choiceClicks": 2, "nodeOpens": 5},
        "transform": {"x": 320, "y": -120, "scale": 1.25},
    }

    client = TestClient(app)
    _login(client, owner)
    session = client.get(f"/api/v1/recall/session/{question_id}").json()
    payload = {
        **canvas,
        "expectedRevision": session["progressRevision"],
        "questionRevision": session["currentQuestion"]["revision"],
        "libraryHash": session["library"]["contentHash"],
        "graphSchemaVersion": 3,
    }
    saved = client.put(f"/api/v1/recall/progress/{question_id}", json=payload)
    assert saved.status_code == 200, saved.text
    for key, value in canvas.items():
        assert saved.json()[key] == value

    reloaded = TestClient(app)
    _login(reloaded, owner)
    loaded = reloaded.get(f"/api/v1/recall/progress/{question_id}")
    assert loaded.status_code == 200, loaded.text
    assert loaded.json()["progress"] == canvas
    explored = reloaded.get("/api/v1/recall/progress", params=[("question_ids", question_id)])
    assert explored.status_code == 200, explored.text
    assert explored.json()["questionIds"] == [question_id]

    isolated = TestClient(app)
    _login(isolated, other)
    assert isolated.get(f"/api/v1/recall/progress/{question_id}").json()["progress"] is None
    assert isolated.get(f"/api/v1/recall/session/{question_id}").json()["progress"]["strokes"] == []

    restored = reloaded.get(f"/api/v1/recall/session/{question_id}").json()
    assert restored["progress"]["strokes"] == canvas["strokes"]
    stale = reloaded.put(f"/api/v1/recall/progress/{question_id}", json={**payload, "strokes": []})
    assert stale.status_code == 409
    assert reloaded.get(f"/api/v1/recall/session/{question_id}").json()["progress"]["strokes"] == canvas["strokes"]
    reset = reloaded.post(f"/api/v1/recall/progress/{question_id}/reset", json={
        "expectedRevision": saved.json()["revision"],
        "targetQuestionRevision": session["currentQuestion"]["revision"],
    })
    assert reset.status_code == 200, reset.text
    assert reset.json()["strokes"] == []
    assert reloaded.get(f"/api/v1/recall/progress/{question_id}").json()["progress"]["strokes"] == []
    assert isolated.get("/api/v1/recall/progress", params=[("question_ids", question_id)]).json()["questionIds"] == []


def test_recall_progress_rejects_a_missing_question_without_a_database_error() -> None:
    owner = _name("recall_missing")
    _create_student(owner)
    client = TestClient(app, raise_server_exceptions=False)
    _login(client, owner)

    response = client.put(
        "/api/v1/recall/progress/unavailable",
        json={
            "expectedRevision": 0,
            "questionRevision": 1,
            "libraryHash": "0" * 64,
            "graphSchemaVersion": 3,
            "nodes": [],
            "edges": [],
        },
    )

    assert response.status_code == 404, response.text
    assert response.json()["detail"]["code"] == "recall_question_not_found"


def test_viewer_cannot_delete_saved_recall_through_legacy_api() -> None:
    username, other = _name("recall_readonly"), _name("recall_nonowner")
    _create_student(username)
    _create_student(other)
    _, question_id = _create_published_question()
    client = TestClient(app)
    _login(client, username)
    session = client.get(f"/api/v1/recall/session/{question_id}").json()
    strokes = [{"id": "ink", "tool": "pen", "color": "#123456", "width": 3, "points": [[1, 2]]}]
    saved = client.put(f"/api/v1/recall/progress/{question_id}", json={
        "expectedRevision": 0,
        "questionRevision": session["currentQuestion"]["revision"],
        "libraryHash": session["library"]["contentHash"],
        "graphSchemaVersion": 3, "nodes": [], "edges": [], "strokes": strokes,
    })
    assert saved.status_code == 200, saved.text
    nonowner = TestClient(app)
    _login(nonowner, other)
    assert nonowner.delete(f"/api/v1/recall/progress/{question_id}").json() == {"deleted": False}
    assert client.get(f"/api/v1/recall/progress/{question_id}").json()["progress"]["strokes"] == strokes

    admin = TestClient(app)
    _login(admin, "admin", "jbgsnmm~123")
    changed = admin.put(f"/api/v1/users/{username}", json={"role": "viewer"})
    assert changed.status_code == 200, changed.text
    denied = client.delete(f"/api/v1/recall/progress/{question_id}")
    assert denied.status_code == 403, denied.text
    assert client.get(f"/api/v1/recall/progress/{question_id}").json()["progress"]["strokes"] == strokes

    restored = admin.put(f"/api/v1/users/{username}", json={"role": "student"})
    assert restored.status_code == 200, restored.text
    assert client.delete(f"/api/v1/recall/progress/{question_id}").json() == {"deleted": True}
    assert client.get(f"/api/v1/recall/progress/{question_id}").json()["progress"] is None
