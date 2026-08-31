from __future__ import annotations

import asyncio
import json
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.paper import PaperImportOperation
from app.models.question import ExamPaper, PaperQuestion, Question, QuestionBank
from app.models.user import User
from app.services import paper_import_service


PASSWORD = "paper-import-pass"
FIXTURE = Path(__file__).parent / "fixtures/papers/paper-package-v1.json"


async def seed_import_catalog(
    teacher: str,
    bank_ids: dict[str, str],
    question_ids: dict[str, str],
) -> None:
    async with AsyncSessionLocal() as db:
        db.add(
            User(
                username=teacher,
                password_hash=hash_password(PASSWORD),
                role="teacher",
                status="active",
            )
        )
        await db.flush()
        for source_id, bank_id in bank_ids.items():
            db.add(
                QuestionBank(
                    id=bank_id,
                    source_id=source_id,
                    owner_id=teacher,
                    name=source_id,
                    subject="PMP",
                    created_by=teacher,
                    updated_by=teacher,
                )
            )
        await db.flush()
        for source_id, question_id in question_ids.items():
            bank_source = (
                "fixture-bank-source-b"
                if source_id.endswith("-2")
                else "fixture-bank-source-a"
            )
            db.add(
                Question(
                    id=question_id,
                    source_id=source_id,
                    bank_id=bank_ids[bank_source],
                    title=source_id,
                    subject="PMP",
                    scope="internal",
                    lifecycle={"status": "active"},
                    created_by=teacher,
                    updated_by=teacher,
                )
            )
        await db.commit()


async def cleanup_import_catalog(
    teacher: str,
    bank_ids: dict[str, str],
    question_ids: dict[str, str],
) -> None:
    async with AsyncSessionLocal() as db:
        owned_papers = select(ExamPaper.id).where(ExamPaper.owner_id == teacher)
        await db.execute(
            delete(PaperImportOperation).where(
                PaperImportOperation.actor_username == teacher
            )
        )
        await db.execute(
            delete(PaperQuestion).where(PaperQuestion.paper_id.in_(owned_papers))
        )
        await db.execute(delete(ExamPaper).where(ExamPaper.owner_id == teacher))
        await db.execute(delete(Question).where(Question.id.in_(question_ids.values())))
        await db.execute(
            delete(QuestionBank).where(QuestionBank.id.in_(bank_ids.values()))
        )
        await db.execute(delete(User).where(User.username == teacher))
        await db.commit()


def test_import_preflight_resolves_external_references_without_writes() -> None:
    """Catches preflight writing rows or treating source IDs as database IDs."""

    suffix = uuid4().hex[:10]
    teacher = f"paper-import-{suffix}"
    bank_ids = {
        "fixture-bank-source-a": f"internal-bank-a-{suffix}",
        "fixture-bank-source-b": f"internal-bank-b-{suffix}",
    }
    question_ids = {
        "fixture-question-source-1": f"internal-question-1-{suffix}",
        "fixture-question-source-2": f"internal-question-2-{suffix}",
        "fixture-question-source-3": f"internal-question-3-{suffix}",
    }
    package = json.loads(FIXTURE.read_text(encoding="utf-8"))

    async def seed() -> None:
        async with AsyncSessionLocal() as db:
            db.add(
                User(
                    username=teacher,
                    password_hash=hash_password(PASSWORD),
                    role="teacher",
                    status="active",
                )
            )
            await db.flush()
            for source_id, bank_id in bank_ids.items():
                db.add(
                    QuestionBank(
                        id=bank_id,
                        source_id=source_id,
                        owner_id=teacher,
                        name=source_id,
                        subject="PMP",
                        created_by=teacher,
                        updated_by=teacher,
                    )
                )
            await db.flush()
            for source_id, question_id in question_ids.items():
                bank_source = (
                    "fixture-bank-source-b"
                    if source_id.endswith("-2")
                    else "fixture-bank-source-a"
                )
                db.add(
                    Question(
                        id=question_id,
                        source_id=source_id,
                        bank_id=bank_ids[bank_source],
                        title=source_id,
                        subject="PMP",
                        scope="internal",
                        lifecycle={"status": "active"},
                        created_by=teacher,
                        updated_by=teacher,
                    )
                )
            await db.commit()

    async def paper_write_counts() -> tuple[int, int, int]:
        async with AsyncSessionLocal() as db:
            return (
                int(await db.scalar(select(func.count()).select_from(ExamPaper)) or 0),
                int(await db.scalar(select(func.count()).select_from(PaperQuestion)) or 0),
                int(
                    await db.scalar(
                        select(func.count()).select_from(PaperImportOperation)
                    )
                    or 0
                ),
            )

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(
                delete(Question).where(Question.id.in_(question_ids.values()))
            )
            await db.execute(
                delete(QuestionBank).where(QuestionBank.id.in_(bank_ids.values()))
            )
            await db.execute(delete(User).where(User.username == teacher))
            await db.commit()

    asyncio.run(seed())
    before = asyncio.run(paper_write_counts())
    try:
        with TestClient(app) as client:
            login = client.post(
                "/api/v1/auth/login",
                json={"username": teacher, "password": PASSWORD},
            )
            assert login.status_code == 200
            response = client.post(
                "/api/v1/papers/import/preflight",
                json={
                    "fileName": "PMP 模拟卷 05_PAPER_V9.0-P4.5.29.json",
                    "package": package,
                },
            )
            assert response.status_code == 200, response.text
            result = response.json()["preflight"]
            assert result["valid"] is True
            assert result["summary"] == {
                "paperId": "fixture-paper-external-04",
                "name": "PMP 模拟卷 04",
                "subject": "PMP",
                "totalCount": 3,
                "questionCount": 3,
                "sourceBankCount": 2,
            }
            assert [item["bankId"] for item in result["references"]] == [
                bank_ids["fixture-bank-source-a"],
                bank_ids["fixture-bank-source-b"],
                bank_ids["fixture-bank-source-a"],
            ]
            assert [item["questionId"] for item in result["references"]] == [
                question_ids["fixture-question-source-1"],
                question_ids["fixture-question-source-2"],
                question_ids["fixture-question-source-3"],
            ]
            assert [item["order"] for item in result["references"]] == [1, 2, 3]
            assert result["errors"] == []
            assert {
                warning["code"] for warning in result["warnings"]
            } >= {"FILE_NAME_MISMATCH", "CATEGORY_NOT_FOUND"}
            assert result["allowedActions"] == {
                "create": True,
                "copy": True,
                "replaceDraft": False,
            }
            assert len(result["payloadHash"]) == 64
        assert asyncio.run(paper_write_counts()) == before
    finally:
        asyncio.run(cleanup())


def test_import_create_is_draft_ordered_and_idempotent() -> None:
    """Catches import copying question bodies, trusting package status, or retrying writes."""

    suffix = uuid4().hex[:10]
    teacher = f"paper-import-create-{suffix}"
    bank_ids = {
        "fixture-bank-source-a": f"create-bank-a-{suffix}",
        "fixture-bank-source-b": f"create-bank-b-{suffix}",
    }
    question_ids = {
        "fixture-question-source-1": f"create-question-1-{suffix}",
        "fixture-question-source-2": f"create-question-2-{suffix}",
        "fixture-question-source-3": f"create-question-3-{suffix}",
    }
    package = json.loads(FIXTURE.read_text(encoding="utf-8"))
    file_name = "PMP 模拟卷 05_PAPER_V9.0-P4.5.29.json"
    idempotency_key = f"paper-import-create-{suffix}"

    async def operation_count() -> int:
        async with AsyncSessionLocal() as db:
            return int(
                await db.scalar(
                    select(func.count())
                    .select_from(PaperImportOperation)
                    .where(PaperImportOperation.actor_username == teacher)
                )
                or 0
            )

    asyncio.run(seed_import_catalog(teacher, bank_ids, question_ids))
    try:
        with TestClient(app) as client:
            login = client.post(
                "/api/v1/auth/login",
                json={"username": teacher, "password": PASSWORD},
            )
            assert login.status_code == 200
            preflight = client.post(
                "/api/v1/papers/import/preflight",
                json={"fileName": file_name, "package": package},
            )
            assert preflight.status_code == 200, preflight.text
            preflight_hash = preflight.json()["preflight"]["payloadHash"]
            request = {
                "fileName": file_name,
                "package": package,
                "preflightHash": preflight_hash,
                "conflictAction": "create",
                "idempotencyKey": idempotency_key,
            }

            invalid_replace = client.post(
                "/api/v1/papers/import",
                json={
                    **request,
                    "conflictAction": "replace_draft",
                    "expectedRevision": 1,
                    "idempotencyKey": f"invalid-replace-{suffix}",
                },
            )
            assert invalid_replace.status_code == 409
            assert invalid_replace.json()["detail"]["code"] == (
                "PAPER_IMPORT_ACTION_NOT_ALLOWED"
            )

            stale = client.post(
                "/api/v1/papers/import",
                json={
                    **request,
                    "preflightHash": "0" * 64,
                    "idempotencyKey": f"stale-{suffix}",
                },
            )
            assert stale.status_code == 409
            assert stale.json()["detail"]["code"] == "PREFLIGHT_STALE"

            created = client.post("/api/v1/papers/import", json=request)
            assert created.status_code == 200, created.text
            result = created.json()["result"]
            assert result["replayed"] is False
            paper = result["paper"]
            assert paper["id"] == "fixture-paper-external-04"
            assert paper["name"] == "PMP 模拟卷 04"
            assert paper["status"] == "draft"
            assert paper["categoryId"] is None
            assert [item["questionId"] for item in paper["questions"]] == [
                question_ids["fixture-question-source-1"],
                question_ids["fixture-question-source-2"],
                question_ids["fixture-question-source-3"],
            ]
            assert [item["order"] for item in paper["questions"]] == [1, 2, 3]
            assert paper["importMetadata"]["sourcePaperId"] == (
                "fixture-paper-external-04"
            )
            assert paper["importMetadata"]["sourceStatus"] == "published"
            assert paper["importMetadata"]["sourceCategoryId"] == (
                "missing-category-source"
            )

            replayed = client.post("/api/v1/papers/import", json=request)
            assert replayed.status_code == 200, replayed.text
            replay = replayed.json()["result"]
            assert replay["replayed"] is True
            assert replay["paper"]["id"] == paper["id"]
            assert asyncio.run(operation_count()) == 1

            conflicted_key = client.post(
                "/api/v1/papers/import",
                json={**request, "conflictAction": "copy"},
            )
            assert conflicted_key.status_code == 409
            assert conflicted_key.json()["detail"]["code"] == (
                "IDEMPOTENCY_PAYLOAD_CONFLICT"
            )
    finally:
        asyncio.run(cleanup_import_catalog(teacher, bank_ids, question_ids))


def test_import_replace_draft_uses_revision_and_replaces_references() -> None:
    """Catches replace_draft creating a second paper or leaving old references behind."""

    suffix = uuid4().hex[:10]
    teacher = f"paper-import-replace-{suffix}"
    bank_ids = {
        "fixture-bank-source-a": f"replace-bank-a-{suffix}",
        "fixture-bank-source-b": f"replace-bank-b-{suffix}",
    }
    question_ids = {
        "fixture-question-source-1": f"replace-question-1-{suffix}",
        "fixture-question-source-2": f"replace-question-2-{suffix}",
        "fixture-question-source-3": f"replace-question-3-{suffix}",
    }
    package = json.loads(FIXTURE.read_text(encoding="utf-8"))
    paper_id = package["paper"]["id"]
    file_name = "PMP 模拟卷 05_PAPER_V9.0-P4.5.29.json"

    async def seed_existing_draft() -> None:
        async with AsyncSessionLocal() as db:
            db.add(
                ExamPaper(
                    id=paper_id,
                    owner_id=teacher,
                    name="待覆盖草稿",
                    subject="PMP",
                    total_count=1,
                    status="draft",
                    revision=1,
                    created_by=teacher,
                    updated_by=teacher,
                )
            )
            await db.flush()
            db.add(
                PaperQuestion(
                    paper_id=paper_id,
                    question_id=question_ids["fixture-question-source-1"],
                    order_index=0,
                    score=9,
                )
            )
            await db.commit()

    asyncio.run(seed_import_catalog(teacher, bank_ids, question_ids))
    asyncio.run(seed_existing_draft())
    try:
        with TestClient(app) as client:
            assert (
                client.post(
                    "/api/v1/auth/login",
                    json={"username": teacher, "password": PASSWORD},
                ).status_code
                == 200
            )
            preflight = client.post(
                "/api/v1/papers/import/preflight",
                json={"fileName": file_name, "package": package},
            )
            assert preflight.status_code == 200, preflight.text
            checked = preflight.json()["preflight"]
            assert checked["allowedActions"] == {
                "create": False,
                "copy": True,
                "replaceDraft": True,
            }

            replaced = client.post(
                "/api/v1/papers/import",
                json={
                    "fileName": file_name,
                    "package": package,
                    "preflightHash": checked["payloadHash"],
                    "conflictAction": "replace_draft",
                    "expectedRevision": 1,
                    "idempotencyKey": f"replace-{suffix}",
                },
            )
            assert replaced.status_code == 200, replaced.text
            paper = replaced.json()["result"]["paper"]
            assert paper["id"] == paper_id
            assert paper["name"] == "PMP 模拟卷 04"
            assert paper["status"] == "draft"
            assert paper["revision"] == 2
            assert [item["questionId"] for item in paper["questions"]] == [
                question_ids["fixture-question-source-1"],
                question_ids["fixture-question-source-2"],
                question_ids["fixture-question-source-3"],
            ]
            assert [item["score"] for item in paper["questions"]] == [1.0, 2.5, 1.0]
    finally:
        asyncio.run(cleanup_import_catalog(teacher, bank_ids, question_ids))


def test_published_id_conflict_denies_replace_but_allows_copy() -> None:
    """Catches copy overwriting a published paper or replace bypassing its lifecycle."""

    suffix = uuid4().hex[:10]
    teacher = f"paper-import-copy-{suffix}"
    bank_ids = {
        "fixture-bank-source-a": f"copy-bank-a-{suffix}",
        "fixture-bank-source-b": f"copy-bank-b-{suffix}",
    }
    question_ids = {
        "fixture-question-source-1": f"copy-question-1-{suffix}",
        "fixture-question-source-2": f"copy-question-2-{suffix}",
        "fixture-question-source-3": f"copy-question-3-{suffix}",
    }
    package = json.loads(FIXTURE.read_text(encoding="utf-8"))
    source_paper_id = package["paper"]["id"]
    file_name = "PMP 模拟卷 05_PAPER_V9.0-P4.5.29.json"

    async def seed_published() -> None:
        async with AsyncSessionLocal() as db:
            db.add(
                ExamPaper(
                    id=source_paper_id,
                    owner_id=teacher,
                    name="已发布原卷",
                    subject="PMP",
                    total_count=0,
                    status="published",
                    revision=7,
                    created_by=teacher,
                    updated_by=teacher,
                )
            )
            await db.commit()

    asyncio.run(seed_import_catalog(teacher, bank_ids, question_ids))
    asyncio.run(seed_published())
    try:
        with TestClient(app, raise_server_exceptions=False) as client:
            assert (
                client.post(
                    "/api/v1/auth/login",
                    json={"username": teacher, "password": PASSWORD},
                ).status_code
                == 200
            )
            checked = client.post(
                "/api/v1/papers/import/preflight",
                json={"fileName": file_name, "package": package},
            ).json()["preflight"]
            assert checked["allowedActions"] == {
                "create": False,
                "copy": True,
                "replaceDraft": False,
            }

            denied = client.post(
                "/api/v1/papers/import",
                json={
                    "fileName": file_name,
                    "package": package,
                    "preflightHash": checked["payloadHash"],
                    "conflictAction": "replace_draft",
                    "expectedRevision": 7,
                    "idempotencyKey": f"published-replace-{suffix}",
                },
            )
            assert denied.status_code == 409
            assert denied.json()["detail"]["code"] == (
                "PUBLISHED_PAPER_REPLACE_FORBIDDEN"
            )

            copied = client.post(
                "/api/v1/papers/import",
                json={
                    "fileName": file_name,
                    "package": package,
                    "preflightHash": checked["payloadHash"],
                    "conflictAction": "copy",
                    "idempotencyKey": f"published-copy-{suffix}",
                },
            )
            assert copied.status_code == 200, copied.text
            copied_paper = copied.json()["result"]["paper"]
            assert copied_paper["id"] != source_paper_id
            assert copied_paper["status"] == "draft"
            assert copied_paper["importMetadata"]["sourcePaperId"] == source_paper_id

            original = client.get(f"/api/v1/papers/{source_paper_id}")
            assert original.status_code == 200
            assert original.json()["paper"]["name"] == "已发布原卷"
            assert original.json()["paper"]["status"] == "published"
            assert original.json()["paper"]["revision"] == 7
    finally:
        asyncio.run(cleanup_import_catalog(teacher, bank_ids, question_ids))


def test_import_rolls_back_paper_and_operation_on_mid_reference_failure(
    monkeypatch,
) -> None:
    """Catches a transaction committing a paper before all references are inserted."""

    suffix = uuid4().hex[:10]
    teacher = f"paper-import-rollback-{suffix}"
    bank_ids = {
        "fixture-bank-source-a": f"rollback-bank-a-{suffix}",
        "fixture-bank-source-b": f"rollback-bank-b-{suffix}",
    }
    question_ids = {
        "fixture-question-source-1": f"rollback-question-1-{suffix}",
        "fixture-question-source-2": f"rollback-question-2-{suffix}",
        "fixture-question-source-3": f"rollback-question-3-{suffix}",
    }
    package = json.loads(FIXTURE.read_text(encoding="utf-8"))
    paper_id = package["paper"]["id"]
    file_name = "PMP 模拟卷 05_PAPER_V9.0-P4.5.29.json"
    idempotency_key = f"rollback-{suffix}"

    async def residual_counts() -> tuple[int, int, int]:
        async with AsyncSessionLocal() as db:
            return (
                int(
                    await db.scalar(
                        select(func.count())
                        .select_from(ExamPaper)
                        .where(ExamPaper.id == paper_id)
                    )
                    or 0
                ),
                int(
                    await db.scalar(
                        select(func.count())
                        .select_from(PaperQuestion)
                        .where(PaperQuestion.paper_id == paper_id)
                    )
                    or 0
                ),
                int(
                    await db.scalar(
                        select(func.count())
                        .select_from(PaperImportOperation)
                        .where(
                            PaperImportOperation.actor_username == teacher,
                            PaperImportOperation.idempotency_key == idempotency_key,
                        )
                    )
                    or 0
                ),
            )

    asyncio.run(seed_import_catalog(teacher, bank_ids, question_ids))
    try:
        with TestClient(app, raise_server_exceptions=False) as client:
            assert (
                client.post(
                    "/api/v1/auth/login",
                    json={"username": teacher, "password": PASSWORD},
                ).status_code
                == 200
            )
            checked = client.post(
                "/api/v1/papers/import/preflight",
                json={"fileName": file_name, "package": package},
            ).json()["preflight"]

            real_link = paper_import_service.PaperQuestion
            constructed = 0

            def fail_on_second_reference(*args, **kwargs):
                nonlocal constructed
                constructed += 1
                if constructed == 2:
                    raise RuntimeError("forced mid-reference failure")
                return real_link(*args, **kwargs)

            monkeypatch.setattr(
                paper_import_service,
                "PaperQuestion",
                fail_on_second_reference,
            )
            failed = client.post(
                "/api/v1/papers/import",
                json={
                    "fileName": file_name,
                    "package": package,
                    "preflightHash": checked["payloadHash"],
                    "conflictAction": "create",
                    "idempotencyKey": idempotency_key,
                },
            )
            assert failed.status_code == 500
            assert asyncio.run(residual_counts()) == (0, 0, 0)
    finally:
        asyncio.run(cleanup_import_catalog(teacher, bank_ids, question_ids))


@pytest.mark.parametrize(
    ("case", "expected_code"),
    [
        ("missing-bank", "BANK_NOT_FOUND"),
        ("ambiguous-bank", "BANK_SOURCE_AMBIGUOUS"),
        ("wrong-bank", "QUESTION_BANK_MISMATCH"),
        ("deleted-question", "QUESTION_DELETED"),
        ("duplicate-reference", "DUPLICATE_REFERENCE"),
        ("broken-order", "REFERENCE_ORDER_INVALID"),
        ("total-mismatch", "TOTAL_COUNT_MISMATCH"),
    ],
)
def test_preflight_reports_reference_integrity_failures(
    case: str,
    expected_code: str,
) -> None:
    """Catches preflight silently accepting damaged or ambiguous reference packages."""

    suffix = uuid4().hex[:10]
    teacher = f"paper-import-invalid-{suffix}"
    other_teacher = f"paper-import-other-{suffix}"
    bank_ids = {
        "fixture-bank-source-a": f"invalid-bank-a-{suffix}",
        "fixture-bank-source-b": f"invalid-bank-b-{suffix}",
    }
    question_ids = {
        "fixture-question-source-1": f"invalid-question-1-{suffix}",
        "fixture-question-source-2": f"invalid-question-2-{suffix}",
        "fixture-question-source-3": f"invalid-question-3-{suffix}",
    }
    package = json.loads(FIXTURE.read_text(encoding="utf-8"))

    async def damage_catalog() -> None:
        async with AsyncSessionLocal() as db:
            if case == "deleted-question":
                question = await db.get(
                    Question,
                    question_ids["fixture-question-source-1"],
                )
                assert question is not None
                question.lifecycle = {"status": "deleted"}
            elif case == "ambiguous-bank":
                db.add(
                    User(
                        username=other_teacher,
                        password_hash=hash_password(PASSWORD),
                        role="teacher",
                        status="active",
                    )
                )
                await db.flush()
                db.add(
                    QuestionBank(
                        id=f"ambiguous-bank-{suffix}",
                        source_id="fixture-bank-source-a",
                        owner_id=other_teacher,
                        name="歧义来源题库",
                        subject="PMP",
                        created_by=other_teacher,
                        updated_by=other_teacher,
                    )
                )
            await db.commit()

    async def cleanup_extra() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(
                delete(QuestionBank).where(QuestionBank.owner_id == other_teacher)
            )
            await db.execute(delete(User).where(User.username == other_teacher))
            await db.commit()

    if case == "missing-bank":
        package["paper"]["questions"][0]["bankId"] = "missing-bank-source"
    elif case == "wrong-bank":
        package["paper"]["questions"][0]["bankId"] = (
            "fixture-bank-source-b"
        )
    elif case == "duplicate-reference":
        package["paper"]["questions"][1].update(
            {
                "bankId": "fixture-bank-source-a",
                "questionId": "fixture-question-source-1",
            }
        )
    elif case == "broken-order":
        package["paper"]["questions"][1]["order"] = 1
    elif case == "total-mismatch":
        package["paper"]["totalCount"] = 4

    asyncio.run(seed_import_catalog(teacher, bank_ids, question_ids))
    asyncio.run(damage_catalog())
    try:
        with TestClient(app) as client:
            assert (
                client.post(
                    "/api/v1/auth/login",
                    json={"username": teacher, "password": PASSWORD},
                ).status_code
                == 200
            )
            response = client.post(
                "/api/v1/papers/import/preflight",
                json={"fileName": "damaged-package.json", "package": package},
            )
            assert response.status_code == 200, response.text
            result = response.json()["preflight"]
            assert result["valid"] is False
            assert expected_code in {issue["code"] for issue in result["errors"]}
            assert result["allowedActions"] == {
                "create": False,
                "copy": False,
                "replaceDraft": False,
            }
    finally:
        asyncio.run(cleanup_extra())
        asyncio.run(cleanup_import_catalog(teacher, bank_ids, question_ids))
