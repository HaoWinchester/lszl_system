"""P4.6 第 2 轮：教师按载荷发布/按试卷撤回的 paper-releases 端点。"""

import pytest
from fastapi.testclient import TestClient

from app.main import app
def login(client, username="admin", password="jbgsnmm~123"):
    response = client.post("/api/v1/auth/login", json={
        "username": username, "password": password, "acceptedTermsVersion": "2026-08-13-v1",
    })
    assert response.status_code == 200, response.text


def _payload(paper_id="paper-t1", version=1):
    question = {
        "id": "q_test_1", "title": "测试题", "stemParts": [{"text": "题干"}],
        "options": [{"text": "A"}], "correctAnswer": "A", "bankId": "b_test",
    }
    return {
        "id": f"{paper_id}-v{version}-test", "releaseId": f"{paper_id}-v{version}-test",
        "paperId": paper_id, "version": version, "name": "载荷发布测试卷", "subject": "PMP",
        "status": "published", "accessPolicy": {"accessLevel": "free"},
        "enabledModes": ["practice_mode", "deep_recall"],
        "publishedAt": 1786000000000, "publishedBy": {"id": "admin", "role": "admin"},
        "questions": [{"bankId": "b_test", "questionId": "q_test_1", "order": 1}],
        "questionSnapshots": [{"bankId": "b_test", "questionId": "q_test_1", "question": question}],
    }


def test_publish_payload_creates_release_and_withdraw_all(client=None) -> None:
    with TestClient(app) as client:
        login(client, "admin")
        payload = _payload()
        response = client.post("/api/v1/paper-releases/publish-payload", json=payload)
        assert response.status_code == 200, response.text
        release = response.json()["release"]
        assert release["paperId"] == "paper-t1"
        assert release["status"] == "published"
        assert release["questionCount"] == 1
        # 学员视角目录可见
        questions = client.get(f"/api/v1/paper-releases/{release['releaseId']}/questions?limit=10")
        assert questions.status_code == 200
        assert questions.json()["total"] == 1
        # 重复发布同一 releaseId → 409
        again = client.post("/api/v1/paper-releases/publish-payload", json=payload)
        assert again.status_code == 409
        # 按试卷撤回
        withdrawn = client.post("/api/v1/paper-releases/papers/paper-t1/withdraw-all")
        assert withdrawn.status_code == 200
        assert withdrawn.json()["withdrawn"] == 1
        # 撤回后学员视角不可见（detail 仅暴露 published/superseded）
        detail = client.get(f"/api/v1/paper-releases/{release['releaseId']}")
        assert detail.status_code == 404


def test_publish_payload_rejects_missing_snapshots() -> None:
    with TestClient(app) as client:
        login(client, "admin")
        payload = _payload()
        payload["questionSnapshots"] = []
        response = client.post("/api/v1/paper-releases/publish-payload", json=payload)
        assert response.status_code == 422


def test_new_version_supersedes_previous_active_release() -> None:
    with TestClient(app) as client:
        login(client, "admin")
        first = client.post("/api/v1/paper-releases/publish-payload", json=_payload(paper_id="paper-t3", version=1)).json()["release"]
        second = client.post("/api/v1/paper-releases/publish-payload", json=_payload(paper_id="paper-t3", version=2)).json()["release"]
        statuses = client.get("/api/v1/paper-releases/catalog").json()
        active_ids = [row["releaseId"] for row in statuses["releases"] if row["paperId"] == "paper-t3"]
        assert active_ids == [second["releaseId"]]
        superseded = client.get(f"/api/v1/paper-releases/{first['releaseId']}").json()["release"]
        assert superseded["status"] == "superseded"
        client.post("/api/v1/paper-releases/papers/paper-t3/withdraw-all")
