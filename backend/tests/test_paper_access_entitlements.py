"""VIP 试卷权益与服务端目录裁剪回归。"""

import json
from datetime import timedelta
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.core.security import now_utc
from app.main import app
from app.services import runtime_state_service, subscription_service


def subscription(*, plan_id: str, status: str = "active", expires_at=None):
    return SimpleNamespace(
        plan_id=plan_id,
        status=status,
        expires_at=expires_at,
    )


def published_releases() -> str:
    question = {
        "id": "q-vip-1",
        "stemParts": [{"text": "VIP 题干"}],
        "options": [
            {"id": "A", "text": "选项 A", "correct": True},
            {"id": "B", "text": "选项 B", "correct": False},
        ],
    }
    return json.dumps(
        [
            {
                "id": "release-free",
                "paperId": "paper-free",
                "releaseId": "release-free",
                "name": "免费试卷",
                "status": "published",
                "accessPolicy": {"accessLevel": "free"},
                "questions": [{"bankId": "bank-1", "questionId": "q-free-1"}],
                "questionSnapshots": [
                    {"bankId": "bank-1", "questionId": "q-free-1", "question": question}
                ],
            },
            {
                "id": "release-vip",
                "paperId": "paper-vip",
                "releaseId": "release-vip",
                "name": "VIP 试卷",
                "status": "published",
                "accessPolicy": {"accessLevel": "member"},
                "questions": [{"bankId": "bank-1", "questionId": "q-vip-1"}],
                "questionSnapshots": [
                    {"bankId": "bank-1", "questionId": "q-vip-1", "question": question}
                ],
            },
        ],
        ensure_ascii=False,
    )


def test_free_student_receives_vip_catalog_without_question_payload() -> None:
    visible = json.loads(
        runtime_state_service.visible_published_papers(
            published_releases(), can_access_member=False
        )
    )

    free_release, vip_release = visible
    assert free_release["questionSnapshots"][0]["question"]["stemParts"][0]["text"] == "VIP 题干"
    assert vip_release["accessPolicy"] == {"accessLevel": "member"}
    assert vip_release["questions"] == []
    assert vip_release["questionSnapshots"] == []
    assert vip_release["configuredCount"] == 1
    assert vip_release["totalCount"] == 1
    assert vip_release["contentRestricted"] is True


def test_member_catalog_keeps_vip_question_payload() -> None:
    visible = json.loads(
        runtime_state_service.visible_published_papers(
            published_releases(), can_access_member=True
        )
    )

    vip_release = visible[1]
    assert vip_release["questions"] == [
        {"bankId": "bank-1", "questionId": "q-vip-1"}
    ]
    assert vip_release["questionSnapshots"][0]["question"]["stemParts"][0]["text"] == "VIP 题干"
    assert "contentRestricted" not in vip_release


def test_free_student_release_history_also_withholds_vip_question_payload() -> None:
    visible = json.loads(
        runtime_state_service.visible_shared_value(
            "kg_exam_paper_release_history_v1",
            published_releases(),
            "free-student",
            can_access_member=False,
        )
    )

    vip_release = visible[1]
    assert vip_release["configuredCount"] == 1
    assert vip_release["questions"] == []
    assert vip_release["questionSnapshots"] == []
    assert vip_release["contentRestricted"] is True


def test_all_exam_papers_entitlement_respects_role_plan_status_and_expiry() -> None:
    future = now_utc() + timedelta(days=1)
    past = now_utc() - timedelta(days=1)

    assert subscription_service.entitlements_for(
        "teacher", subscription(plan_id="free")
    )["allExamPapers"] is True
    assert subscription_service.entitlements_for(
        "admin", subscription(plan_id="free")
    )["allExamPapers"] is True
    assert subscription_service.entitlements_for(
        "student", subscription(plan_id="monthly", expires_at=future)
    )["allExamPapers"] is True
    assert subscription_service.entitlements_for(
        "student", subscription(plan_id="free")
    )["allExamPapers"] is False
    assert subscription_service.entitlements_for(
        "student", subscription(plan_id="monthly", status="paused", expires_at=future)
    )["allExamPapers"] is False
    assert subscription_service.entitlements_for(
        "student", subscription(plan_id="monthly", expires_at=past)
    )["allExamPapers"] is False
    assert subscription_service.entitlements_for(
        "viewer", subscription(plan_id="lifetime")
    )["allExamPapers"] is False


def test_subscription_endpoint_exposes_server_entitlements() -> None:
    with TestClient(app) as client:
        login = client.post(
            "/api/v1/auth/login",
            json={"username": "佩奇007", "password": "111111"},
        )
        assert login.status_code == 200
        response = client.get("/api/v1/subscriptions/me")

    assert response.status_code == 200
    assert response.json()["entitlements"] == {"allExamPapers": True}
