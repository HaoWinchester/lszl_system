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


def test_question_bank_file_import_confirms_and_cleans_content_duplicates() -> None:
    suffix = uuid4().hex[:10]
    usernames = {"manager": f"question-import-dedupe-{suffix}", "viewer": f"question-import-dedupe-viewer-{suffix}"}
    asyncio.run(_seed_users(usernames))
    try:
        with TestClient(app) as client:
            _login(client, usernames["manager"])
            bank = _source_bank("dedupe-bank", "dedupe-question-a")
            duplicate = dict(bank["questions"][0])
            duplicate["id"] = "dedupe-question-b"
            duplicate["title"] = "同内容不同 ID"
            bank["questions"].append(duplicate)
            preview = client.post("/api/v1/banks/import", json={"banks": [bank]})
            assert preview.status_code == 409, preview.text
            detail = preview.json()["detail"]
            assert detail["code"] == "QUESTION_DUPLICATES_CONFIRMATION_REQUIRED"
            assert detail["importPlan"]["duplicateBatchCount"] == 1
            imported = client.post(
                "/api/v1/banks/import",
                json={"banks": [bank], "confirmDuplicateCleanup": True},
            )
            assert imported.status_code == 200, imported.text
            questions = imported.json()["banks"][0]["questions"]
            assert len(questions) == 1
            assert questions[0]["teacherNumber"].startswith("PMP-")
            source_map = imported.json()["sourceQuestionIdMap"]
            assert source_map["dedupe-bank::dedupe-question-a"] == questions[0]["id"]
            assert source_map["dedupe-bank::dedupe-question-b"] == questions[0]["id"]
    finally:
        asyncio.run(_cleanup_users(usernames))


def test_question_bank_replacement_detects_existing_source_updated_into_duplicate() -> None:
    suffix = uuid4().hex[:10]
    usernames = {"manager": f"question-import-update-dedupe-{suffix}", "viewer": f"question-import-update-viewer-{suffix}"}
    asyncio.run(_seed_users(usernames))
    try:
        with TestClient(app) as client:
            _login(client, usernames["manager"])
            original = _source_bank("update-dedupe-bank", "update-dedupe-a")
            second = dict(original["questions"][0])
            second["id"] = "update-dedupe-b"
            second["stemParts"] = [{"text": "原本不同的题干"}]
            original["questions"].append(second)
            first = client.post("/api/v1/banks/import", json={"banks": [original]})
            assert first.status_code == 200, first.text
            retained_id = first.json()["sourceQuestionIdMap"]["update-dedupe-bank::update-dedupe-a"]

            replacement = _source_bank("update-dedupe-bank", "update-dedupe-a")
            duplicate_update = dict(replacement["questions"][0])
            duplicate_update["id"] = "update-dedupe-b"
            duplicate_update["title"] = "更新后变成重复"
            replacement["questions"].append(duplicate_update)
            preview = client.post(
                "/api/v1/banks/import",
                json={"banks": [replacement], "confirmReplace": True},
            )
            assert preview.status_code == 409, preview.text
            detail = preview.json()["detail"]
            assert detail["code"] == "QUESTION_DUPLICATES_CONFIRMATION_REQUIRED"
            assert detail["importPlan"]["duplicateExistingCount"] == 1

            imported = client.post(
                "/api/v1/banks/import",
                json={
                    "banks": [replacement],
                    "confirmReplace": True,
                    "confirmDuplicateCleanup": True,
                },
            )
            assert imported.status_code == 200, imported.text
            payload = imported.json()
            assert len(payload["banks"][0]["questions"]) == 1
            assert payload["sourceQuestionIdMap"]["update-dedupe-bank::update-dedupe-a"] == retained_id
            assert payload["sourceQuestionIdMap"]["update-dedupe-bank::update-dedupe-b"] == retained_id
    finally:
        asyncio.run(_cleanup_users(usernames))


def test_question_bank_import_keeps_source_identity_and_requires_confirmed_replacement() -> None:
    suffix = uuid4().hex[:10]
    usernames = {"manager": f"question-import-policy-{suffix}", "viewer": f"question-import-policy-viewer-{suffix}"}
    asyncio.run(_seed_users(usernames))
    try:
        with TestClient(app) as client:
            _login(client, usernames["manager"])
            original = _source_bank("stable-bank", "stable-question", name="稳定来源题库")
            first = client.post("/api/v1/banks/import", json={"banks": [original]})
            assert first.status_code == 200, first.text
            first_payload = first.json()
            bank_id = first_payload["banks"][0]["id"]
            question_id = first_payload["banks"][0]["questions"][0]["id"]

            duplicate = client.post("/api/v1/banks/import", json={"banks": [original]})
            assert duplicate.status_code == 200, duplicate.text
            assert duplicate.json()["banks"] == []
            assert duplicate.json()["importPlan"]["skip"] == 1

            template_visibility = _source_bank("template-bank", "template-question")
            template_visibility["visibility"] = "template"
            template_first = client.post("/api/v1/banks/import", json={"banks": [template_visibility]})
            assert template_first.status_code == 200, template_first.text
            template_duplicate = client.post("/api/v1/banks/import", json={"banks": [template_visibility]})
            assert template_duplicate.status_code == 200, template_duplicate.text
            assert template_duplicate.json()["importPlan"]["skip"] == 1

            changed = _source_bank("stable-bank", "stable-question", name="稳定来源题库")
            changed["questions"][0]["stemParts"] = [{"text": "更新后的题干"}]
            needs_confirmation = client.post("/api/v1/banks/import", json={"banks": [changed]})
            assert needs_confirmation.status_code == 409, needs_confirmation.text
            detail = needs_confirmation.json()["detail"]
            assert detail["code"] == "IMPORT_REPLACEMENT_CONFIRMATION_REQUIRED"
            assert detail["importPlan"]["replace"] == 1
            assert detail["importPlan"]["summaries"][0]["modifiedQuestions"] == 1
            assert detail["importPlan"]["summaries"][0]["groups"] == {
                "content": 1,
                "analysis": 0,
                "keywords": 0,
                "tags": 0,
                "principles": 0,
                "knowledge": 0,
                "reasoning": 0,
                "family": 0,
            }

            replaced = client.post(
                "/api/v1/banks/import",
                json={"banks": [changed], "confirmReplace": True},
            )
            assert replaced.status_code == 200, replaced.text
            assert replaced.json()["banks"][0]["id"] == bank_id
            assert replaced.json()["banks"][0]["questions"][0]["id"] == question_id
            assert replaced.json()["banks"][0]["questions"][0]["stemParts"] == [{"text": "更新后的题干"}]

            conflict = _source_bank("other-bank", "stable-question", name="冲突题库")
            overlap = client.post("/api/v1/banks/import", json={"banks": [conflict]})
            assert overlap.status_code == 409, overlap.text
            assert overlap.json()["detail"]["code"] == "IMPORT_QUESTION_ID_CONFLICT"

            duplicate_source_question = client.post(
                "/api/v1/banks/import",
                json={
                    "banks": [
                        _source_bank("batch-bank-a", "batch-question"),
                        _source_bank("batch-bank-b", "batch-question"),
                    ]
                },
            )
            assert duplicate_source_question.status_code == 422, duplicate_source_question.text
            assert duplicate_source_question.json()["detail"]["code"] == "IMPORT_VALIDATION_FAILED"
    finally:
        asyncio.run(_cleanup_users(usernames))


def test_exported_catalog_bank_reimports_by_source_identity() -> None:
    """A downloaded server-backed bank must be safe to import again unchanged."""
    suffix = uuid4().hex[:10]
    usernames = {
        "manager": f"question-import-roundtrip-{suffix}",
        "viewer": f"question-import-roundtrip-viewer-{suffix}",
    }
    asyncio.run(_seed_users(usernames))
    try:
        with TestClient(app) as client:
            _login(client, usernames["manager"])
            created = client.post(
                "/api/v1/banks/import",
                json={"banks": [_source_bank("roundtrip-bank", "roundtrip-question")]},
            )
            assert created.status_code == 200, created.text

            catalog = client.get(
                "/api/v1/question-catalog/bootstrap?mode=managed&include_questions=true"
            )
            assert catalog.status_code == 200, catalog.text
            snapshot = catalog.json()
            exported_bank = next(
                bank for bank in snapshot["banks"] if bank["id"] == created.json()["banks"][0]["id"]
            )
            exported = {
                **exported_bank,
                "questions": [
                    question
                    for question in snapshot["questions"]
                    if question["bankId"] == exported_bank["id"]
                ],
            }

            round_trip = client.post("/api/v1/banks/import", json={"banks": [exported]})
            assert round_trip.status_code == 200, round_trip.text
            assert round_trip.json()["banks"] == []
            assert round_trip.json()["importPlan"]["skip"] == 1
    finally:
        asyncio.run(_cleanup_users(usernames))


def test_exported_directly_created_bank_reimports_without_duplicate() -> None:
    """Exports of normal in-app banks have no import source ID to begin with."""
    suffix = uuid4().hex[:10]
    usernames = {
        "manager": f"question-import-direct-roundtrip-{suffix}",
        "viewer": f"question-import-direct-roundtrip-viewer-{suffix}",
    }
    asyncio.run(_seed_users(usernames))
    try:
        with TestClient(app) as client:
            _login(client, usernames["manager"])
            created_bank = client.post(
                "/api/v1/banks",
                json={"name": "直接创建并导出的题库", "subject": "PMP"},
            )
            assert created_bank.status_code == 200, created_bank.text
            bank_id = created_bank.json()["bank"]["id"]
            created_question = client.post(
                f"/api/v1/banks/{bank_id}/questions",
                json=_source_bank("unused-bank", "direct-question")["questions"][0],
            )
            assert created_question.status_code == 200, created_question.text

            snapshot = client.get(
                "/api/v1/question-catalog/bootstrap?mode=managed&include_questions=true"
            ).json()
            exported_bank = next(bank for bank in snapshot["banks"] if bank["id"] == bank_id)
            exported = {
                **exported_bank,
                "questions": [
                    question for question in snapshot["questions"] if question["bankId"] == bank_id
                ],
            }
            round_trip = client.post("/api/v1/banks/import", json={"banks": [exported]})
            assert round_trip.status_code == 200, round_trip.text
            assert round_trip.json()["banks"] == []
            assert round_trip.json()["importPlan"]["skip"] == 1
    finally:
        asyncio.run(_cleanup_users(usernames))
