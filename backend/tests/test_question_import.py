import asyncio
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.question import Question, QuestionBank
from app.models.user import User
from app.services import teaching_content_revision_service


PASSWORD = "question-import-pass"


def _login(client: TestClient, username: str) -> None:
    response = client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": PASSWORD},
    )
    assert response.status_code == 200


def _source_bank(source_id: str, question_id: str, *, name: str = "导入题库") -> dict:
    return {
        "id": source_id,
        "name": name,
        "subject": "PMP",
        "description": "用于验证原子导入",
        "version": "1.0",
        "visibility": "private",
        "questions": [
            {
                "id": question_id,
                "title": "导入的单选题",
                "type": "single_choice",
                "stemParts": [{"text": "导入题干"}],
                "options": [
                    {"id": "A", "text": "正确选项", "correct": True},
                    {"id": "B", "text": "错误选项"},
                ],
                "correctAnswer": "A",
                "analysis": "导入解析",
                "metadata": {"stemPrincipleIds": ["principle-import"]},
            }
        ],
    }


async def _seed_users(usernames: dict[str, str]) -> None:
    password_hash = hash_password(PASSWORD)
    async with AsyncSessionLocal() as db:
        db.add_all(
            [
                User(
                    username=usernames["manager"],
                    password_hash=password_hash,
                    role="teacher",
                    status="active",
                ),
                User(
                    username=usernames["viewer"],
                    password_hash=password_hash,
                    role="viewer",
                    status="active",
                ),
            ]
        )
        await db.commit()


async def _owner_counts_and_revision(username: str) -> tuple[int, int, int]:
    async with AsyncSessionLocal() as db:
        bank_count = int(
            (
                await db.execute(
                    select(func.count())
                    .select_from(QuestionBank)
                    .where(QuestionBank.owner_id == username)
                )
            ).scalar_one()
        )
        question_count = int(
            (
                await db.execute(
                    select(func.count())
                    .select_from(Question)
                    .join(QuestionBank, Question.bank_id == QuestionBank.id)
                    .where(QuestionBank.owner_id == username)
                )
            ).scalar_one()
        )
        revision = int((await teaching_content_revision_service.current(db))["revision"])
        return bank_count, question_count, revision


async def _cleanup_users(usernames: dict[str, str]) -> None:
    async with AsyncSessionLocal() as db:
        bank_ids = list(
            (
                await db.execute(
                    select(QuestionBank.id).where(
                        QuestionBank.owner_id.in_(usernames.values())
                    )
                )
            ).scalars()
        )
        if bank_ids:
            await db.execute(delete(Question).where(Question.bank_id.in_(bank_ids)))
            await db.execute(delete(QuestionBank).where(QuestionBank.id.in_(bank_ids)))
        await db.execute(delete(User).where(User.username.in_(usernames.values())))
        await db.commit()


def test_question_bank_json_import_is_atomic_and_returns_server_id_maps() -> None:
    suffix = uuid4().hex[:10]
    usernames = {
        "manager": f"question-import-manager-{suffix}",
        "viewer": f"question-import-viewer-{suffix}",
    }
    asyncio.run(_seed_users(usernames))
    try:
        with TestClient(app) as client:
            _login(client, usernames["viewer"])
            denied = client.post(
                "/api/v1/banks/import",
                json={"banks": [_source_bank("source-bank-denied", "source-question-denied")]},
            )
            assert denied.status_code == 403
            client.post("/api/v1/auth/logout")

            _login(client, usernames["manager"])
            before_banks, before_questions, before_revision = asyncio.run(
                _owner_counts_and_revision(usernames["manager"])
            )
            first = _source_bank("source-bank-a", "source-question-a")
            second = _source_bank("source-bank-b", "source-question-b", name="第二个导入题库")
            response = client.post("/api/v1/banks/import", json={"banks": [first, second]})
            assert response.status_code == 200, response.text
            payload = response.json()

            assert len(payload["banks"]) == 2
            saved_first, saved_second = payload["banks"]
            assert saved_first["id"].startswith("b_")
            assert saved_second["id"].startswith("b_")
            assert saved_first["id"] != first["id"]
            assert saved_first["questions"][0]["id"].startswith("q_")
            assert saved_first["questions"][0]["id"] != first["questions"][0]["id"]
            assert payload["sourceBankIdMap"] == {
                "source-bank-a": saved_first["id"],
                "source-bank-b": saved_second["id"],
            }
            assert payload["sourceQuestionIdMap"] == {
                "source-bank-a::source-question-a": saved_first["questions"][0]["id"],
                "source-bank-b::source-question-b": saved_second["questions"][0]["id"],
            }

            after_banks, after_questions, after_revision = asyncio.run(
                _owner_counts_and_revision(usernames["manager"])
            )
            assert (after_banks, after_questions) == (
                before_banks + 2,
                before_questions + 2,
            )
            assert after_revision == before_revision + 1

            duplicate = _source_bank("source-bank-duplicate", "source-question-c")
            failed = client.post(
                "/api/v1/banks/import",
                json={
                    "banks": [
                        duplicate,
                        _source_bank("source-bank-duplicate", "source-question-d"),
                    ]
                },
            )
            assert failed.status_code == 422, failed.text
            assert failed.json()["detail"]["code"] == "IMPORT_VALIDATION_FAILED"

            final_banks, final_questions, final_revision = asyncio.run(
                _owner_counts_and_revision(usernames["manager"])
            )
            assert (final_banks, final_questions, final_revision) == (
                after_banks,
                after_questions,
                after_revision,
            )
    finally:
        asyncio.run(_cleanup_users(usernames))
