import asyncio
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.content_prep import QuestionBankCollaborator
from app.models.question import ExamPaper, PaperQuestion, Question, QuestionBank
from app.models.user import User
from app.services.question_catalog_service import question_to_payload


PASSWORD = "catalog-pass"


def _login(client: TestClient, username: str, password: str = PASSWORD) -> None:
    response = client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": password},
    )
    assert response.status_code == 200


def test_catalog_serializer_normalizes_legacy_string_collections() -> None:
    question = Question(
        id="legacy-string-question",
        bank_id="legacy-string-bank",
        title="旧格式题目",
        stem_parts=["旧格式题干"],
        clues=["旧格式线索"],
        concepts=["可持续步调"],
        reasoning_steps=["先判断原则"],
    )

    payload = question_to_payload(question)

    assert payload["stemParts"] == [{"text": "旧格式题干"}]
    assert payload["clues"] == [{"text": "旧格式线索"}]
    assert payload["concepts"] == [{"title": "可持续步调"}]
    assert payload["reasoningSteps"] == [{"content": "先判断原则"}]


def test_catalog_access_pagination_round_trip_and_learning_visibility() -> None:
    suffix = uuid4().hex[:10]
    usernames = {
        role: f"catalog-{role}-{suffix}"
        for role in ("owner", "editor", "collaborator", "student", "viewer")
    }
    bank_ids = {
        "private": f"catalog-private-{suffix}",
        "published": f"catalog-published-{suffix}",
    }
    question_ids = {
        name: f"catalog-{name}-{suffix}"
        for name in (
            "complete",
            "private-second",
            "published-active",
            "published-legacy",
            "published-internal",
            "published-deleted",
        )
    }
    paper_ids = {
        "published": f"catalog-paper-published-{suffix}",
        "draft": f"catalog-paper-draft-{suffix}",
    }

    async def seed() -> None:
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
            await db.flush()
            db.add_all(
                [
                    QuestionBank(
                        id=bank_ids["private"],
                        owner_id=usernames["owner"],
                        name="私有制作题库",
                        subject="PMP",
                        visibility="private",
                        revision=3,
                    ),
                    QuestionBank(
                        id=bank_ids["published"],
                        owner_id=usernames["owner"],
                        name="已发布题库",
                        subject="PMP",
                        visibility="published",
                        revision=4,
                    ),
                ]
            )
            await db.flush()
            db.add_all(
                [
                    QuestionBankCollaborator(
                        id=f"catalog-edit-{suffix}",
                        bank_id=bank_ids["private"],
                        username=usernames["editor"],
                        permission="edit",
                        granted_by=usernames["owner"],
                    ),
                    QuestionBankCollaborator(
                        id=f"catalog-view-{suffix}",
                        bank_id=bank_ids["private"],
                        username=usernames["collaborator"],
                        permission="view",
                        granted_by=usernames["owner"],
                    ),
                ]
            )
            db.add_all(
                [
                    Question(
                        id=question_ids["complete"],
                        bank_id=bank_ids["private"],
                        title="完整字段题",
                        subject="PMP",
                        scope="internal",
                        teacher_number="PMP-001",
                        content_hash="a" * 64,
                        creator_id="creator_001",
                        creator_name="管理员",
                        revision=7,
                        tags=["内部使用"],
                        stem_parts=[{"text": "题干"}],
                        options=[{"id": "A", "text": "答案", "correct": True}],
                        correct_answer="A",
                        analysis="解析",
                        translations={"en": {"analysis": "Explanation"}},
                        content_metadata={"knowledge": {"primaryNodeId": "kp-1"}},
                        key_path={"answerId": "A"},
                        clues=[{"id": "clue-1"}],
                        concepts=[{"id": "kp-1"}],
                        reasoning_steps=[{"id": "step-1"}],
                        status={"contentReady": True},
                        lifecycle={"status": "active"},
                    ),
                    Question(
                        id=question_ids["private-second"],
                        bank_id=bank_ids["private"],
                        title="分页题",
                        subject="PMP",
                        scope="internal",
                    ),
                    Question(
                        id=question_ids["published-active"],
                        bank_id=bank_ids["published"],
                        title="公开有效题",
                        subject="PMP",
                        scope="public",
                        lifecycle={"status": "active"},
                    ),
                    Question(
                        id=question_ids["published-legacy"],
                        bank_id=bank_ids["published"],
                        title="公开历史题",
                        subject="PMP",
                        scope="public",
                        lifecycle={},
                    ),
                    Question(
                        id=question_ids["published-internal"],
                        bank_id=bank_ids["published"],
                        title="已发布题库内部题",
                        subject="PMP",
                        scope="internal",
                        lifecycle={"status": "active"},
                    ),
                    Question(
                        id=question_ids["published-deleted"],
                        bank_id=bank_ids["published"],
                        title="已删除题",
                        subject="PMP",
                        scope="public",
                        lifecycle={"status": "deleted"},
                    ),
                ]
            )
            db.add_all(
                [
                    ExamPaper(
                        id=paper_ids["published"],
                        owner_id=usernames["owner"],
                        name="公开试卷",
                        subject="PMP",
                        status="published",
                    ),
                    ExamPaper(
                        id=paper_ids["draft"],
                        owner_id=usernames["owner"],
                        name="草稿试卷",
                        subject="PMP",
                        status="draft",
                    ),
                ]
            )
            await db.flush()
            db.add_all(
                [
                    PaperQuestion(
                        paper_id=paper_ids["published"],
                        question_id=question_ids["published-active"],
                        order_index=0,
                    ),
                    PaperQuestion(
                        paper_id=paper_ids["draft"],
                        question_id=question_ids["published-legacy"],
                        order_index=0,
                    ),
                ]
            )
            await db.commit()

    async def assert_complete_serializer() -> None:
        async with AsyncSessionLocal() as db:
            question = await db.get(Question, question_ids["complete"])
            assert question is not None
            payload = question_to_payload(question)
            assert payload["teacherNumber"] == "PMP-001"
            assert payload["revision"] == 7
            assert payload["translations"] == {"en": {"analysis": "Explanation"}}
            assert payload["metadata"] == {"knowledge": {"primaryNodeId": "kp-1"}}
            assert payload["keyPath"] == {"answerId": "A"}
            assert payload["lifecycle"] == {"status": "active"}

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(PaperQuestion).where(PaperQuestion.paper_id.in_(paper_ids.values())))
            await db.execute(delete(ExamPaper).where(ExamPaper.id.in_(paper_ids.values())))
            await db.execute(delete(Question).where(Question.id.in_(question_ids.values())))
            await db.execute(
                delete(QuestionBankCollaborator).where(
                    QuestionBankCollaborator.bank_id.in_(bank_ids.values())
                )
            )
            await db.execute(delete(QuestionBank).where(QuestionBank.id.in_(bank_ids.values())))
            await db.execute(delete(User).where(User.username.in_(usernames.values())))
            await db.commit()

    asyncio.run(seed())
    try:
        asyncio.run(assert_complete_serializer())
        with TestClient(app) as client:
            assert client.get("/api/v1/question-catalog/banks?mode=managed").status_code == 401

            _login(client, usernames["owner"])
            owner_banks = client.get("/api/v1/question-catalog/banks?mode=writable").json()["banks"]
            owner_ids = [bank["id"] for bank in owner_banks]
            assert bank_ids["private"] in owner_ids
            assert bank_ids["published"] in owner_ids
            assert owner_ids.index(bank_ids["private"]) < owner_ids.index(bank_ids["published"])
            page = client.get(
                f"/api/v1/question-catalog/banks/{bank_ids['private']}/questions?page=1&page_size=1"
            ).json()
            assert page["total"] == 2
            assert len(page["questions"]) == 1
            detail = client.get(
                f"/api/v1/question-catalog/questions/{question_ids['complete']}"
            ).json()["question"]
            assert detail["translations"]["en"]["analysis"] == "Explanation"
            assert detail["contentHash"] == "a" * 64

            client.post("/api/v1/auth/logout")
            _login(client, usernames["editor"])
            editor_ids = {
                bank["id"]
                for bank in client.get(
                    "/api/v1/question-catalog/banks?mode=writable"
                ).json()["banks"]
            }
            assert bank_ids["private"] in editor_ids

            client.post("/api/v1/auth/logout")
            _login(client, usernames["collaborator"])
            managed_ids = {
                bank["id"]
                for bank in client.get(
                    "/api/v1/question-catalog/banks?mode=managed"
                ).json()["banks"]
            }
            writable_ids = {
                bank["id"]
                for bank in client.get(
                    "/api/v1/question-catalog/banks?mode=writable"
                ).json()["banks"]
            }
            assert bank_ids["private"] in managed_ids
            assert bank_ids["private"] not in writable_ids
            assert client.get(
                f"/api/v1/question-catalog/questions/{question_ids['complete']}"
            ).status_code == 200

            client.post("/api/v1/auth/logout")
            _login(client, usernames["student"])
            assert client.get("/api/v1/question-catalog/banks?mode=managed").status_code == 403
            client.post("/api/v1/auth/logout")
            _login(client, usernames["viewer"])
            assert client.get("/api/v1/question-catalog/banks?mode=managed").status_code == 403
            client.post("/api/v1/auth/logout")

            _login(client, "admin", "admin123")
            admin_ids = {
                bank["id"]
                for bank in client.get(
                    "/api/v1/question-catalog/banks?mode=writable"
                ).json()["banks"]
            }
            assert set(bank_ids.values()) <= admin_ids
            client.post("/api/v1/auth/logout")

            learning = client.get(
                "/api/v1/question-catalog/learning/questions",
                params={"subject": "PMP", "bank_id": bank_ids["published"]},
            )
            assert learning.status_code == 200
            assert {row["id"] for row in learning.json()["questions"]} == {
                question_ids["published-active"],
                question_ids["published-legacy"],
            }
            published_paper = client.get(
                "/api/v1/question-catalog/learning/questions",
                params={"paper_id": paper_ids["published"]},
            )
            assert [row["id"] for row in published_paper.json()["questions"]] == [
                question_ids["published-active"]
            ]
            draft_paper = client.get(
                "/api/v1/question-catalog/learning/questions",
                params={"paper_id": paper_ids["draft"]},
            )
            assert draft_paper.json()["questions"] == []
            bootstrap = client.get(
                "/api/v1/question-catalog/bootstrap",
                params={"mode": "learning", "subject": "PMP"},
            )
            assert bootstrap.status_code == 200
            assert len(bootstrap.json()["catalogRevision"]) == 64

            paths = client.get("/openapi.json").json()["paths"]
            assert paths["/api/v1/question-catalog/banks"]["get"]["responses"]["200"][
                "content"
            ]["application/json"]["schema"]["$ref"].endswith("CatalogBankListResponse")
            assert paths["/api/v1/question-catalog/learning/questions"]["get"][
                "responses"
            ]["200"]["content"]["application/json"]["schema"]["$ref"].endswith(
                "CatalogQuestionListResponse"
            )
            assert paths["/api/v1/question-catalog/bootstrap"]["get"]["responses"][
                "200"
            ]["content"]["application/json"]["schema"]["$ref"].endswith(
                "CatalogBootstrapResponse"
            )
    finally:
        asyncio.run(cleanup())
