"""冒烟测试：health、认证流程、权限拦截、文件 CRUD。用 TestClient 跑真实 DB。"""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
    assert r.json()["db"] == "ok"


def test_health_returns_503_when_database_is_unavailable(monkeypatch):
    import importlib

    health_module = importlib.import_module("app.api.v1.health")

    class BrokenSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return None

        async def execute(self, *_):
            raise RuntimeError("database unavailable")

    monkeypatch.setattr(health_module, "AsyncSessionLocal", lambda: BrokenSession())
    with TestClient(app) as isolated_client:
        response = isolated_client.get("/api/v1/health")

    assert response.status_code == 503
    assert response.json()["status"] == "degraded"
    assert response.json()["db"].startswith("error:")


def test_auth_flow():
    r = client.post("/api/v1/auth/login", json={"username": "admin", "password": "jbgsnmm~123"})
    assert r.status_code == 200
    assert r.json()["user"]["username"] == "admin"
    assert client.get("/api/v1/auth/me").status_code == 200
    assert client.post("/api/v1/auth/logout").status_code == 200
    assert client.get("/api/v1/auth/me").status_code == 401


def test_wrong_password():
    r = client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin123"})
    assert r.status_code == 401


def test_unauth_blocked():
    assert client.get("/api/v1/users").status_code == 401
    assert client.get("/api/v1/files").status_code == 401


def test_file_crud():
    client.post("/api/v1/auth/login", json={"username": "admin", "password": "jbgsnmm~123"})
    r = client.post("/api/v1/files", json={"name": "pytest文件"})
    assert r.status_code == 200
    fid = r.json()["file"]["id"]

    save = client.put(
        f"/api/v1/files/{fid}",
        json={"graphData": {"meta": {"title": "pytest文件"}, "nodes": [{"id": "n1"}, {"id": "n2"}], "links": [{"id": "l1", "from": "n1", "to": "n2"}]}},
    )
    assert save.status_code == 200
    assert save.json()["file"]["nodeCount"] == 2
    assert save.json()["file"]["linkCount"] == 1

    opened = client.get(f"/api/v1/files/{fid}")
    assert opened.status_code == 200
    assert len(opened.json()["graphData"]["nodes"]) == 2

    lst = client.get("/api/v1/files")
    assert lst.json()["total"] >= 1

    assert client.delete(f"/api/v1/files/{fid}").status_code == 200
    assert client.get(f"/api/v1/files/{fid}").status_code == 200  # 软删，仍可打开


def test_question_bank_and_paper():
    client.post("/api/v1/auth/login", json={"username": "admin", "password": "jbgsnmm~123"})
    b = client.post("/api/v1/banks", json={"name": "pytest题库", "subject": "PMP"}).json()["bank"]["id"]
    question = client.post(
        f"/api/v1/banks/{b}/questions",
        json={"title": "pytest题目", "domain": "范围", "options": [{"id": "A", "text": "x", "correct": True}], "correctAnswer": "A"},
    ).json()["question"]
    q = question["id"]
    assert question["scope"] == "internal"
    assert question["revision"] == 1
    assert len(question["contentHash"]) == 64
    assert len(client.get(f"/api/v1/banks/{b}/questions").json()["questions"]) == 1
    paper = client.post("/api/v1/papers", json={"name": "pytest卷"}).json()["paper"]
    p = paper["id"]
    comp = client.post(
        f"/api/v1/papers/{p}/compose",
        json={
            "bankIds": [b],
            "quotas": {"范围": 1},
            "revision": paper["revision"],
        },
    )
    assert comp.json()["picked"] == 1
    composed_paper = client.get(f"/api/v1/papers/{p}").json()["paper"]
    assert client.post(
        f"/api/v1/papers/{p}/publish?revision={composed_paper['revision']}"
    ).json()["paper"]["status"] == "published"
