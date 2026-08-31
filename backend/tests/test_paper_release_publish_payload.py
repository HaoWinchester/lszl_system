"""P4.6 第 2 轮：教师按载荷发布/按试卷撤回的 paper-releases 端点。"""

from uuid import uuid4

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
        "options": [{"id": "A", "text": "方案一"}, {"id": "B", "text": "方案二"}],
        "correctAnswer": "A", "bankId": "b_test",
        "metadata": {
            "subjectFacets": [
                {"dimensionId": "exam-domain", "valueId": "process"}
            ]
        },
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
        assert release["metadata"]["domainWeights"] == {
            "people": 42,
            "process": 50,
            "business-environment": 8,
        }
        assert release["metadata"]["simulationScoring"]["passPercent"] == 60
        assert release["metadata"]["simulationScoring"]["official"] is False
        # 学员视角目录可见
        questions = client.get(f"/api/v1/paper-releases/{release['releaseId']}/questions?limit=10")
        assert questions.status_code == 200
        assert questions.json()["total"] == 1
        managed = client.get("/api/v1/paper-releases/management-catalog")
        assert managed.status_code == 200
        managed_paper = next(
            row for row in managed.json()["papers"] if row["paperId"] == "paper-t1"
        )
        assert managed_paper["publishedReleaseId"] == release["releaseId"]
        assert managed_paper["questions"] == [
            {"bankId": "b_test", "questionId": "q_test_1", "order": 1, "score": 1}
        ]
        assert "questionSnapshots" not in managed_paper
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


def test_publish_payload_preserves_multiple_choice_paper_type() -> None:
    with TestClient(app) as client:
        login(client, "admin")
        paper = client.post(
            "/api/v1/papers",
            json={"name": "待发布空草稿", "subject": "PMP"},
        ).json()["paper"]
        paper_id = paper["id"]
        payload = _payload(paper_id=paper_id)
        payload["paperType"] = "multiple_choice"
        question = payload["questionSnapshots"][0]["question"]
        question.update({
            "type": "multiple_choice",
            "options": [
                {"id": "A", "text": "A"},
                {"id": "B", "text": "B"},
                {"id": "C", "text": "C"},
            ],
            "correctAnswer": None,
            "correctOptionIds": ["A", "C"],
            "analysis": "多选解析",
        })
        response = client.post(
            "/api/v1/paper-releases/publish-payload",
            json=payload,
        )
        assert response.status_code == 200, response.text
        release = response.json()["release"]
        assert release["paperType"] == "multiple_choice"
        questions = client.get(
            f"/api/v1/paper-releases/{release['releaseId']}/questions?limit=10"
        ).json()["questions"]
        assert questions[0]["question"]["correctOptionIds"] == ["A", "C"]
        managed = client.get(f"/api/v1/papers/{paper_id}").json()["paper"]
        assert managed["paperType"] == "multiple_choice"
        client.post(f"/api/v1/paper-releases/papers/{paper_id}/withdraw-all")


def test_publish_payload_allows_unclassified_multiple_choice_questions() -> None:
    with TestClient(app) as client:
        login(client, "admin")
        paper_id = f"paper-multi-no-domain-{uuid4().hex[:8]}"
        payload = _payload(paper_id=paper_id)
        payload["paperType"] = "multiple_choice"
        question = payload["questionSnapshots"][0]["question"]
        question.pop("metadata")
        question.update({
            "type": "multiple_choice",
            "options": [
                {"id": "A", "text": "A"},
                {"id": "B", "text": "B"},
                {"id": "C", "text": "C"},
            ],
            "correctAnswer": None,
            "correctOptionIds": ["A", "C"],
            "analysis": "多选解析",
        })

        response = client.post(
            "/api/v1/paper-releases/publish-payload",
            json=payload,
        )

        assert response.status_code == 200, response.text
        assert response.json()["release"]["paperType"] == "multiple_choice"
        client.post(f"/api/v1/paper-releases/papers/{paper_id}/withdraw-all")


def test_publish_payload_rejects_unclassified_pmp_practice_questions() -> None:
    with TestClient(app) as client:
        login(client, "admin")
        payload = _payload(paper_id="paper-domain-preflight")
        payload["questionSnapshots"][0]["question"].pop("metadata")
        response = client.post("/api/v1/paper-releases/publish-payload", json=payload)
        assert response.status_code == 422
        detail = response.json()["detail"]
        assert detail["code"] == "PRACTICE_DOMAIN_PREFLIGHT_FAILED"
        assert detail["invalidQuestionNumbers"] == [1]
        assert detail["shortages"] == {"process": 1}


def test_publish_payload_preserves_an_explicit_zero_question_score() -> None:
    with TestClient(app) as client:
        login(client, "admin")
        payload = _payload(paper_id="paper-zero-score")
        payload["questions"][0]["score"] = 0
        response = client.post("/api/v1/paper-releases/publish-payload", json=payload)
        assert response.status_code == 200, response.text
        release_id = response.json()["release"]["releaseId"]
        questions = client.get(
            f"/api/v1/paper-releases/{release_id}/questions?limit=10"
        ).json()["questions"]
        assert questions[0]["question"]["releaseScore"] == 0


def test_publish_payload_rejects_missing_snapshots() -> None:
    with TestClient(app) as client:
        login(client, "admin")
        payload = _payload()
        payload["questionSnapshots"] = []
        response = client.post("/api/v1/paper-releases/publish-payload", json=payload)
        assert response.status_code == 422


def test_publish_payload_repairs_summary_only_stubs_from_bank() -> None:
    """摘要桩快照（__paperSummaryOnly）在服务端用题库权威内容重建后放行。"""
    with TestClient(app) as client:
        login(client, "admin")
        bank = client.post(
            "/api/v1/banks",
            json={"name": f"桩重建题库-{uuid4().hex[:8]}", "subject": "PMP"},
        ).json()["bank"]
        question = client.post(
            f"/api/v1/banks/{bank['id']}/questions",
            json={
                "title": "权威题目",
                "stemParts": [{"text": "题库里的完整题干"}],
                "options": [{"id": "A", "text": "方案一"}, {"id": "B", "text": "方案二"}],
                "correctAnswer": "A",
                "metadata": {
                    "subjectFacets": [
                        {"dimensionId": "exam-domain", "valueId": "process"}
                    ]
                },
            },
        ).json()["question"]

        payload = _payload(paper_id=f"paper-stub-{uuid4().hex[:6]}", version=1)
        stub = {"id": question["id"], "bankId": bank["id"],
                "title": question["title"], "__paperSummaryOnly": True}
        payload["questions"] = [{"bankId": bank["id"], "questionId": question["id"], "order": 1}]
        payload["questionSnapshots"] = [{"bankId": bank["id"], "questionId": question["id"], "question": stub}]

        response = client.post("/api/v1/paper-releases/publish-payload", json=payload)
        assert response.status_code == 200, response.text
        release = response.json()["release"]
        served = client.get(
            f"/api/v1/paper-releases/{release['releaseId']}/questions?limit=10"
        ).json()["questions"]
        assert len(served) == 1
        snapshot = served[0]["question"]
        assert snapshot.get("__paperSummaryOnly") is not True
        assert "题库里的完整题干" in "".join(
            part.get("text", "") for part in snapshot.get("stemParts", [])
        )
        assert len(snapshot.get("options", [])) >= 2
        assert snapshot.get("correctAnswer")


def test_publish_payload_rejects_stubs_without_bank_question() -> None:
    """摘要桩在题库中找不到权威题目时拒绝发布。"""
    with TestClient(app) as client:
        login(client, "admin")
        payload = _payload(paper_id=f"paper-miss-{uuid4().hex[:6]}", version=1)
        stub = {"id": "q_missing_1", "bankId": "b_test",
                "title": "不存在的题", "__paperSummaryOnly": True}
        payload["questions"] = [{"bankId": "b_test", "questionId": "q_missing_1", "order": 1}]
        payload["questionSnapshots"] = [{"bankId": "b_test", "questionId": "q_missing_1", "question": stub}]

        response = client.post("/api/v1/paper-releases/publish-payload", json=payload)
        assert response.status_code == 422, response.text
        detail = response.json()["detail"]
        assert detail["code"] == "RELEASE_SNAPSHOT_INCOMPLETE"
        assert "q_missing_1" in detail["message"]


def test_server_allocates_next_version_when_client_version_is_stale() -> None:
    with TestClient(app) as client:
        login(client, "admin")
        first = client.post("/api/v1/paper-releases/publish-payload", json=_payload(paper_id="paper-t3", version=1)).json()["release"]
        stale = _payload(paper_id="paper-t3", version=1)
        stale["id"] = stale["releaseId"] = "paper-t3-stale-version-retry"
        response = client.post("/api/v1/paper-releases/publish-payload", json=stale)
        assert response.status_code == 200, response.text
        second = response.json()["release"]
        assert second["version"] == 2
        assert second["releaseId"] != stale["releaseId"]
        statuses = client.get("/api/v1/paper-releases/catalog").json()
        active_ids = [row["releaseId"] for row in statuses["releases"] if row["paperId"] == "paper-t3"]
        assert active_ids == [second["releaseId"]]
        superseded = client.get(f"/api/v1/paper-releases/{first['releaseId']}").json()["release"]
        assert superseded["status"] == "superseded"
        client.post("/api/v1/paper-releases/papers/paper-t3/withdraw-all")


def test_publish_payload_updates_paper_management_projection() -> None:
    with TestClient(app) as client:
        login(client, "admin")
        created = client.post(
            "/api/v1/papers",
            json={"name": "发布投影测试卷", "subject": "PMP"},
        )
        assert created.status_code == 200, created.text
        paper = created.json()["paper"]

        published = client.post(
            "/api/v1/paper-releases/publish-payload",
            json=_payload(paper_id=paper["id"], version=1),
        )
        assert published.status_code == 200, published.text
        release = published.json()["release"]

        detail = client.get(f"/api/v1/papers/{paper['id']}")
        assert detail.status_code == 200, detail.text
        projection = detail.json()["paper"]
        assert projection["status"] == "published"
        assert projection["publishedVersion"] == 1
        assert projection["publishedReleaseId"] == release["releaseId"]


def test_experience_summary_week_and_daily() -> None:
    """学霸学习周（周日19:00起）与最近7日经验聚合。"""
    from app.services.learning_service import _learning_week_start
    from datetime import datetime, timezone, timedelta

    tz8 = timezone(timedelta(hours=8))
    # 2026-08-19 是周三：本周日为 08-16，学习周起点 08-16 19:00
    assert _learning_week_start(datetime(2026, 8, 19, 12, 0, tzinfo=tz8)) == datetime(2026, 8, 16, 19, 0, tzinfo=tz8)
    # 周日 20:00 已进入新学习周
    assert _learning_week_start(datetime(2026, 8, 16, 20, 0, tzinfo=tz8)) == datetime(2026, 8, 16, 19, 0, tzinfo=tz8)
    # 周日 18:00 仍属上一学习周（08-09 起）
    assert _learning_week_start(datetime(2026, 8, 16, 18, 0, tzinfo=tz8)) == datetime(2026, 8, 9, 19, 0, tzinfo=tz8)

    with TestClient(app) as client:
        login(client)
        response = client.get("/api/v1/learning/practice/experience-summary")
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["totalExperience"] >= 0
        assert data["weekExperience"] >= 0
        assert len(data["daily"]) == 7
        assert all(set(day) == {"date", "experience"} for day in data["daily"])
        assert data["weekStart"] < data["weekEnd"]
