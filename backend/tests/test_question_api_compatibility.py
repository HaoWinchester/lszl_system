import asyncio
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.content_prep import QuestionBankCollaborator
from app.models.question import Question, QuestionBank
from app.models.user import User


PASSWORD = "legacy-question-pass"


def _login(client: TestClient, username: str, password: str = PASSWORD) -> None:
    response = client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": password},
    )
    assert response.status_code == 200


def test_legacy_question_endpoints_delegate_access_and_preserve_new_fields() -> None:
    suffix = uuid4().hex[:10]
    usernames = {
        role: f"legacy-question-{role}-{suffix}"
        for role in ("owner", "editor", "reader", "student", "viewer")
    }
    created_bank_id = ""
    created_question_id = ""

    async def seed_users() -> None:
        password_hash = hash_password(PASSWORD)
        async with AsyncSessionLocal() as db:
            db.add_all(
                [
                    User(
                        username=username,
                        password_hash=password_hash,
                        role=(
                            "student"
                            if role == "student"
                            else "viewer"
                            if role == "viewer"
                            else "teacher"
                        ),
                        status="active",
                    )
                    for role, username in usernames.items()
                ]
            )
            await db.commit()

    async def add_collaborators(bank_id: str) -> None:
        async with AsyncSessionLocal() as db:
            db.add_all(
                [
                    QuestionBankCollaborator(
                        id=f"legacy-editor-{suffix}",
                        bank_id=bank_id,
                        username=usernames["editor"],
                        permission="edit",
                        granted_by=usernames["owner"],
                    ),
                    QuestionBankCollaborator(
                        id=f"legacy-reader-{suffix}",
                        bank_id=bank_id,
                        username=usernames["reader"],
                        permission="view",
                        granted_by=usernames["owner"],
                    ),
                ]
            )
            await db.commit()

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            if created_question_id:
                await db.execute(delete(Question).where(Question.id == created_question_id))
            if created_bank_id:
                await db.execute(
                    delete(QuestionBankCollaborator).where(
                        QuestionBankCollaborator.bank_id == created_bank_id
                    )
                )
                await db.execute(delete(QuestionBank).where(QuestionBank.id == created_bank_id))
            await db.execute(delete(User).where(User.username.in_(usernames.values())))
            await db.commit()

    asyncio.run(seed_users())
    try:
        with TestClient(app) as client:
            assert client.get("/api/v1/banks").status_code == 401
            _login(client, usernames["student"])
            assert client.get("/api/v1/banks").status_code == 403
            client.post("/api/v1/auth/logout")
            _login(client, usernames["viewer"])
            assert client.get("/api/v1/banks").status_code == 403
            client.post("/api/v1/auth/logout")

            _login(client, usernames["owner"])
            bank_response = client.post(
                "/api/v1/banks",
                json={"name": "旧接口兼容题库", "subject": "PMP"},
            )
            assert bank_response.status_code == 200
            bank = bank_response.json()["bank"]
            created_bank_id = bank["id"]
            assert bank["revision"] == 1
            assert bank["createdBy"] == usernames["owner"]
            assert bank["updatedBy"] == usernames["owner"]
            assert bank["visibility"] == "private"

            question_response = client.post(
                f"/api/v1/banks/{created_bank_id}/questions",
                json={
                    "title": "旧端点创建题",
                    "subject": "PMP",
                    "tags": ["可公开"],
                    "stemParts": [{"text": "题干"}],
                    "options": [
                        {"id": "A", "text": "错误", "correct": False},
                        {"id": "B", "text": "正确", "correct": True},
                    ],
                    "correctAnswer": "B",
                    "analysis": "原解析",
                    "translations": {"en": {"analysis": "Original"}},
                    "metadata": {"knowledge": {"mappingStatus": "unmapped"}},
                    "keyPath": {"answerId": "B"},
                    "lifecycle": {"status": "active"},
                    "teacherNumber": "LEGACY-001",
                    "contentHash": "forged",
                    "actorUsername": "admin",
                },
            )
            assert question_response.status_code == 200
            question = question_response.json()["question"]
            created_question_id = question["id"]
            assert created_question_id.startswith("q_")
            assert question["scope"] == "internal"
            assert question["revision"] == 1
            assert len(question["contentHash"]) == 64
            assert question["contentHash"] != "forged"
            assert question["createdBy"] == usernames["owner"]
            assert question["translations"] == {"en": {"analysis": "Original"}}
            assert question["metadata"] == {"knowledge": {"mappingStatus": "unmapped"}}
            assert question["keyPath"] == {"answerId": "B"}
            original_hash = question["contentHash"]

        asyncio.run(add_collaborators(created_bank_id))

        with TestClient(app) as client:
            _login(client, usernames["editor"])
            listed_bank_ids = {bank["id"] for bank in client.get("/api/v1/banks").json()["banks"]}
            assert created_bank_id in listed_bank_ids
            detail = client.get(f"/api/v1/questions/{created_question_id}")
            assert detail.status_code == 200
            updated = client.put(
                f"/api/v1/questions/{created_question_id}",
                json={"title": "协作者更新标题", "analysis": "新解析"},
            )
            assert updated.status_code == 200
            updated_question = updated.json()["question"]
            assert updated_question["revision"] == 2
            assert updated_question["contentHash"] != original_hash
            assert updated_question["updatedBy"] == usernames["editor"]
            assert updated_question["translations"] == {"en": {"analysis": "Original"}}
            assert updated_question["metadata"] == {"knowledge": {"mappingStatus": "unmapped"}}
            assert updated_question["keyPath"] == {"answerId": "B"}

            client.post("/api/v1/auth/logout")
            _login(client, usernames["reader"])
            assert client.get(f"/api/v1/questions/{created_question_id}").status_code == 200
            assert client.put(
                f"/api/v1/questions/{created_question_id}",
                json={"title": "只读协作者不能更新"},
            ).status_code == 404

            client.post("/api/v1/auth/logout")
            _login(client, "admin", "admin123")
            assert client.get(f"/api/v1/questions/{created_question_id}").status_code == 200

            legacy_page = client.get(
                f"/api/v1/banks/{created_bank_id}/questions?page=1&page_size=20"
            )
            assert legacy_page.status_code == 200
            assert set(legacy_page.json()) == {
                "questions",
                "total",
                "page",
                "page_size",
            }
    finally:
        asyncio.run(cleanup())
