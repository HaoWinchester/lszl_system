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


def _card_payload(title: str = "我的风险原则") -> dict:
    return {
        "title": title,
        "synthesisType": "principle",
        "content": "先判断风险归属，再选择应对。",
        "tags": ["风险", "风险", "  ", "应对"],
        "status": "draft",
        "sourceQuestionRefs": [
            {
                "questionId": "question-stable-1",
                "bankId": "bank-stable-1",
                "paperId": "paper-stable-1",
                "releaseId": "release-stable-1",
                "title": "风险来源题",
                "ignored": "not persisted",
            }
        ],
    }


def test_personal_cards_are_database_backed_searchable_and_owner_isolated() -> None:
    username_a = _name("personal_card_a")
    username_b = _name("personal_card_b")
    _create_student(username_a)
    _create_student(username_b)
    client_a = TestClient(app)
    client_b = TestClient(app)
    _login(client_a, username_a)
    _login(client_b, username_b)

    created_response = client_a.post("/api/v1/learning/personal-cards", json=_card_payload())
    assert created_response.status_code == 200, created_response.text
    card = created_response.json()["card"]
    assert card["id"].startswith("psc_")
    assert card["revision"] == 1
    assert card["tags"] == ["风险", "应对"]
    assert card["sourceQuestionRefs"] == [
        {
            "questionId": "question-stable-1",
            "bankId": "bank-stable-1",
            "paperId": "paper-stable-1",
            "releaseId": "release-stable-1",
            "title": "风险来源题",
        }
    ]
    assert card["archivedAt"] is None

    reloaded = TestClient(app)
    _login(reloaded, username_a)
    listed = reloaded.get("/api/v1/learning/personal-cards")
    assert listed.status_code == 200, listed.text
    assert listed.json()["count"] == 1
    assert listed.json()["cards"][0]["id"] == card["id"]

    searched = reloaded.get("/api/v1/learning/personal-cards", params={"query": "应对"})
    assert searched.status_code == 200
    assert searched.json()["count"] == 1
    assert reloaded.get("/api/v1/learning/personal-cards", params={"query": "不存在"}).json()["cards"] == []

    assert client_b.get(f"/api/v1/learning/personal-cards/{card['id']}").status_code == 404
    assert client_b.put(
        f"/api/v1/learning/personal-cards/{card['id']}",
        json={"title": "越权修改", "revision": 1},
    ).status_code == 404
    assert client_b.post(f"/api/v1/learning/personal-cards/{card['id']}/archive").status_code == 404
    assert client_b.get("/api/v1/learning/personal-cards").json()["cards"] == []


def test_personal_card_update_conflict_archive_and_restore() -> None:
    username = _name("personal_card_lifecycle")
    _create_student(username)
    client = TestClient(app)
    _login(client, username)
    created = client.post("/api/v1/learning/personal-cards", json=_card_payload()).json()["card"]

    updated_response = client.put(
        f"/api/v1/learning/personal-cards/{created['id']}",
        json={
            "title": "更新后的风险原则",
            "content": "识别、分析、规划应对。",
            "synthesisType": "routine",
            "tags": ["风险", "规划"],
            "status": "verified",
            "sourceQuestionRefs": [],
            "revision": 1,
        },
    )
    assert updated_response.status_code == 200, updated_response.text
    updated = updated_response.json()["card"]
    assert updated["revision"] == 2
    assert updated["title"] == "更新后的风险原则"
    assert updated["synthesisType"] == "routine"

    stale = client.put(
        f"/api/v1/learning/personal-cards/{created['id']}",
        json={"title": "旧页面覆盖", "revision": 1},
    )
    assert stale.status_code == 409
    assert stale.json()["detail"]["currentRevision"] == 2

    archived_response = client.post(f"/api/v1/learning/personal-cards/{created['id']}/archive")
    assert archived_response.status_code == 200, archived_response.text
    archived = archived_response.json()["card"]
    assert archived["archivedAt"] is not None
    assert archived["revision"] == 3
    assert client.get("/api/v1/learning/personal-cards").json()["cards"] == []
    archived_list = client.get("/api/v1/learning/personal-cards", params={"archived": "true"})
    assert archived_list.json()["cards"][0]["id"] == created["id"]

    restored_response = client.post(f"/api/v1/learning/personal-cards/{created['id']}/restore")
    assert restored_response.status_code == 200, restored_response.text
    restored = restored_response.json()["card"]
    assert restored["archivedAt"] is None
    assert restored["revision"] == 4
    assert client.get("/api/v1/learning/personal-cards").json()["count"] == 1


def test_personal_card_validation_and_authentication() -> None:
    username = _name("personal_card_validation")
    _create_student(username)
    client = TestClient(app)
    _login(client, username)

    assert client.post("/api/v1/learning/personal-cards", json={**_card_payload(), "title": "  "}).status_code == 422
    assert client.post(
        "/api/v1/learning/personal-cards",
        json={**_card_payload(), "synthesisType": "unknown"},
    ).status_code == 422
    assert client.post(
        "/api/v1/learning/personal-cards",
        json={**_card_payload(), "status": "unknown"},
    ).status_code == 422

    guest = TestClient(app)
    assert guest.get("/api/v1/learning/personal-cards").status_code == 401
    assert guest.post("/api/v1/learning/personal-cards", json=_card_payload()).status_code == 401
