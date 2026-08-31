from __future__ import annotations

import asyncio
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.paper import PaperGenerationBatch
from app.models.question import ExamPaper, PaperQuestion, Question, QuestionBank
from app.models.user import User
from app.services import paper_composition_service


PASSWORD = "paper-composition-pass"
HARD_WEIGHTS = {"people": 42, "process": 50, "business-environment": 8}
SOFT_WEIGHTS = {
    "governance": 1,
    "scope": 1,
    "schedule": 1,
    "finance": 1,
    "stakeholder": 1,
    "resource": 1,
    "risk": 1,
}


def test_composition_preflight_builds_unequal_non_overlapping_variants() -> None:
    """Catches DB preflight ignoring facets, request order, or cross-paper reuse."""

    suffix = uuid4().hex[:10]
    teacher = f"paper-compose-{suffix}"
    bank_id = f"paper-compose-bank-{suffix}"
    question_ids: list[str] = []

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
            db.add(
                QuestionBank(
                    id=bank_id,
                    source_id=f"source-{bank_id}",
                    owner_id=teacher,
                    name="平行组卷题库",
                    subject="PMP",
                    created_by=teacher,
                    updated_by=teacher,
                )
            )
            await db.flush()
            index = 0
            for hard_value, count in (
                ("people", 90),
                ("process", 100),
                ("business-environment", 30),
            ):
                for _ in range(count):
                    question_id = f"compose-q-{suffix}-{index:03d}"
                    question_ids.append(question_id)
                    soft_value = tuple(SOFT_WEIGHTS)[index % len(SOFT_WEIGHTS)]
                    db.add(
                        Question(
                            id=question_id,
                            source_id=f"source-{question_id}",
                            bank_id=bank_id,
                            title=f"组卷候选题 {index + 1}",
                            subject="PMP",
                            scope="internal",
                            lifecycle={"status": "active"},
                            content_metadata={
                                "subjectFacets": [
                                    {
                                        "dimensionId": "exam-domain",
                                        "valueId": hard_value,
                                    },
                                    {
                                        "dimensionId": "performance-domain",
                                        "valueId": soft_value,
                                    },
                                ]
                            },
                            created_by=teacher,
                            updated_by=teacher,
                        )
                    )
                    index += 1
            await db.commit()

    async def write_counts() -> tuple[int, int, int]:
        async with AsyncSessionLocal() as db:
            owned_papers = select(ExamPaper.id).where(ExamPaper.owner_id == teacher)
            return (
                int(
                    await db.scalar(
                        select(func.count())
                        .select_from(PaperGenerationBatch)
                        .where(PaperGenerationBatch.actor_username == teacher)
                    )
                    or 0
                ),
                int(
                    await db.scalar(
                        select(func.count())
                        .select_from(ExamPaper)
                        .where(ExamPaper.owner_id == teacher)
                    )
                    or 0
                ),
                int(
                    await db.scalar(
                        select(func.count())
                        .select_from(PaperQuestion)
                        .where(PaperQuestion.paper_id.in_(owned_papers))
                    )
                    or 0
                ),
            )

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            owned_papers = select(ExamPaper.id).where(ExamPaper.owner_id == teacher)
            await db.execute(
                delete(PaperQuestion).where(PaperQuestion.paper_id.in_(owned_papers))
            )
            await db.execute(delete(ExamPaper).where(ExamPaper.owner_id == teacher))
            await db.execute(
                delete(PaperGenerationBatch).where(
                    PaperGenerationBatch.actor_username == teacher
                )
            )
            await db.execute(delete(Question).where(Question.id.in_(question_ids)))
            await db.execute(delete(QuestionBank).where(QuestionBank.id == bank_id))
            await db.execute(delete(User).where(User.username == teacher))
            await db.commit()

    request = {
        "subject": "PMP",
        "bankIds": [bank_id],
        "filters": {},
        "variants": [
            {"code": "A", "name": "PMP 模拟卷 A", "totalCount": 60},
            {"code": "B", "name": "PMP 模拟卷 B", "totalCount": 50},
            {"code": "C", "name": "PMP 模拟卷 C", "totalCount": 40},
        ],
        "hardQuota": {
            "dimensionId": "exam-domain",
            "weights": HARD_WEIGHTS,
        },
        "softQuota": {
            "dimensionId": "performance-domain",
            "weights": SOFT_WEIGHTS,
        },
        "randomSeed": "api-parallel-seed",
    }

    asyncio.run(seed())
    before = asyncio.run(write_counts())
    try:
        with TestClient(app) as client:
            login = client.post(
                "/api/v1/auth/login",
                json={"username": teacher, "password": PASSWORD},
            )
            assert login.status_code == 200
            response = client.post(
                "/api/v1/papers/composition/preflight",
                json=request,
            )
            assert response.status_code == 200, response.text
            result = response.json()["preflight"]
            assert result["candidateCount"] == 220
            assert result["unclassifiedCount"] == 0
            assert result["inventory"]["hard"] == {
                "people": 90,
                "process": 100,
                "business-environment": 30,
            }
            assert result["feasible"] is True
            assert result["feasibleVariantCodes"] == ["A", "B", "C"]
            assert len(result["planHash"]) == 64
            variants = result["variants"]
            assert [item["totalCount"] for item in variants] == [60, 50, 40]
            assert [item["hardTargets"] for item in variants] == [
                {"people": 25, "process": 30, "business-environment": 5},
                {"people": 21, "process": 25, "business-environment": 4},
                {"people": 17, "process": 20, "business-environment": 3},
            ]
            assert all(item["hardActual"] == item["hardTargets"] for item in variants)
            selected = [
                question_id
                for variant in variants
                for question_id in variant["questionIds"]
            ]
            assert len(selected) == 150
            assert len(selected) == len(set(selected))
        assert asyncio.run(write_counts()) == before
    finally:
        asyncio.run(cleanup())


def test_shortage_requires_repreflight_of_the_feasible_subset() -> None:
    """Catches reusing allocations from an infeasible full batch after variants change."""

    suffix = uuid4().hex[:10]
    teacher = f"paper-shortage-{suffix}"
    bank_id = f"paper-shortage-bank-{suffix}"
    question_ids = [f"shortage-q-{suffix}-{index:03d}" for index in range(60)]

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
            db.add(
                QuestionBank(
                    id=bank_id,
                    owner_id=teacher,
                    source_id=f"source-{bank_id}",
                    name="库存不足题库",
                    subject="PMP",
                    created_by=teacher,
                    updated_by=teacher,
                )
            )
            await db.flush()
            for index, question_id in enumerate(question_ids):
                hard_value = "people" if index < 30 else "process"
                db.add(
                    Question(
                        id=question_id,
                        source_id=f"source-{question_id}",
                        bank_id=bank_id,
                        title=question_id,
                        subject="PMP",
                        scope="internal",
                        lifecycle={"status": "active"},
                        content_metadata={
                            "subjectFacets": [
                                {
                                    "dimensionId": "exam-domain",
                                    "valueId": hard_value,
                                }
                            ]
                        },
                        created_by=teacher,
                        updated_by=teacher,
                    )
                )
            await db.commit()

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(Question).where(Question.id.in_(question_ids)))
            await db.execute(delete(QuestionBank).where(QuestionBank.id == bank_id))
            await db.execute(delete(User).where(User.username == teacher))
            await db.commit()

    base = {
        "subject": "PMP",
        "bankIds": [bank_id],
        "filters": {},
        "hardQuota": {
            "dimensionId": "exam-domain",
            "weights": {"people": 1, "process": 1},
        },
        "randomSeed": "shortage-api-seed",
    }
    asyncio.run(seed())
    try:
        with TestClient(app) as client:
            assert (
                client.post(
                    "/api/v1/auth/login",
                    json={"username": teacher, "password": PASSWORD},
                ).status_code
                == 200
            )
            full = client.post(
                "/api/v1/papers/composition/preflight",
                json={
                    **base,
                    "variants": [
                        {"code": "A", "name": "A 卷", "totalCount": 40},
                        {"code": "B", "name": "B 卷", "totalCount": 40},
                    ],
                },
            )
            assert full.status_code == 200, full.text
            full_plan = full.json()["preflight"]
            assert full_plan["feasible"] is False
            assert full_plan["feasibleVariantCodes"] == ["A"]
            assert full_plan["variants"][1]["hardShortages"] == {
                "people": 10,
                "process": 10,
            }

            reduced = client.post(
                "/api/v1/papers/composition/preflight",
                json={
                    **base,
                    "variants": [
                        {"code": "A", "name": "A 卷", "totalCount": 40}
                    ],
                },
            )
            assert reduced.status_code == 200, reduced.text
            reduced_plan = reduced.json()["preflight"]
            assert reduced_plan["feasible"] is True
            assert reduced_plan["feasibleVariantCodes"] == ["A"]
            assert len(reduced_plan["variants"][0]["questionIds"]) == 40
            assert reduced_plan["planHash"] != full_plan["planHash"]
    finally:
        asyncio.run(cleanup())


def test_composition_batch_creates_all_variants_once_in_one_batch(monkeypatch) -> None:
    """Catches batch creation omitting a variant, reusing questions, or duplicating retries."""

    suffix = uuid4().hex[:10]
    teacher = f"paper-batch-{suffix}"
    bank_id = f"paper-batch-bank-{suffix}"
    question_ids = [f"batch-q-{suffix}-{index:02d}" for index in range(18)]

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
            db.add(
                QuestionBank(
                    id=bank_id,
                    source_id=f"source-{bank_id}",
                    owner_id=teacher,
                    name="批次组卷题库",
                    subject="PMP",
                    created_by=teacher,
                    updated_by=teacher,
                )
            )
            await db.flush()
            hard_values = (
                ["people"] * 6
                + ["process"] * 6
                + ["business-environment"] * 6
            )
            for question_id, hard_value in zip(question_ids, hard_values, strict=True):
                db.add(
                    Question(
                        id=question_id,
                        source_id=f"source-{question_id}",
                        bank_id=bank_id,
                        title=question_id,
                        subject="PMP",
                        scope="internal",
                        lifecycle={"status": "active"},
                        content_metadata={
                            "subjectFacets": [
                                {
                                    "dimensionId": "exam-domain",
                                    "valueId": hard_value,
                                }
                            ]
                        },
                        created_by=teacher,
                        updated_by=teacher,
                    )
                )
            await db.commit()

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            owned_papers = select(ExamPaper.id).where(ExamPaper.owner_id == teacher)
            await db.execute(
                delete(PaperQuestion).where(PaperQuestion.paper_id.in_(owned_papers))
            )
            await db.execute(delete(ExamPaper).where(ExamPaper.owner_id == teacher))
            await db.execute(
                delete(PaperGenerationBatch).where(
                    PaperGenerationBatch.actor_username == teacher
                )
            )
            await db.execute(delete(Question).where(Question.id.in_(question_ids)))
            await db.execute(delete(QuestionBank).where(QuestionBank.id == bank_id))
            await db.execute(delete(User).where(User.username == teacher))
            await db.commit()

    async def set_question_lifecycle(question_id: str, status: str) -> None:
        async with AsyncSessionLocal() as db:
            question = await db.get(Question, question_id)
            assert question is not None
            question.lifecycle = {"status": status}
            await db.commit()

    async def batch_count() -> int:
        async with AsyncSessionLocal() as db:
            return int(
                await db.scalar(
                    select(func.count())
                    .select_from(PaperGenerationBatch)
                    .where(PaperGenerationBatch.actor_username == teacher)
                )
                or 0
            )

    async def composition_write_counts() -> tuple[int, int, int]:
        async with AsyncSessionLocal() as db:
            owned_papers = select(ExamPaper.id).where(ExamPaper.owner_id == teacher)
            return (
                int(
                    await db.scalar(
                        select(func.count())
                        .select_from(PaperGenerationBatch)
                        .where(PaperGenerationBatch.actor_username == teacher)
                    )
                    or 0
                ),
                int(
                    await db.scalar(
                        select(func.count())
                        .select_from(ExamPaper)
                        .where(ExamPaper.owner_id == teacher)
                    )
                    or 0
                ),
                int(
                    await db.scalar(
                        select(func.count())
                        .select_from(PaperQuestion)
                        .where(PaperQuestion.paper_id.in_(owned_papers))
                    )
                    or 0
                ),
            )

    request = {
        "subject": "PMP",
        "bankIds": [bank_id],
        "filters": {},
        "variants": [
            {"code": "A", "name": "批次 A 卷", "totalCount": 6},
            {"code": "B", "name": "批次 B 卷", "totalCount": 5},
            {"code": "C", "name": "批次 C 卷", "totalCount": 4},
        ],
        "hardQuota": {
            "dimensionId": "exam-domain",
            "weights": {
                "people": 1,
                "process": 1,
                "business-environment": 1,
            },
        },
        "randomSeed": "batch-create-seed",
    }
    idempotency_key = f"batch-create-{suffix}"

    asyncio.run(seed())
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
                "/api/v1/papers/composition/preflight",
                json=request,
            ).json()["preflight"]
            assert checked["feasible"] is True
            batch_request = {
                **checked["normalizedRequest"],
                "planHash": checked["planHash"],
                "idempotencyKey": idempotency_key,
            }

            changed_question_id = checked["variants"][0]["questionIds"][0]
            asyncio.run(set_question_lifecycle(changed_question_id, "deleted"))
            changed = client.post(
                "/api/v1/papers/composition/batches",
                json=batch_request,
            )
            assert changed.status_code == 409
            assert changed.json()["detail"]["code"] == "COMPOSITION_PLAN_CHANGED"
            assert asyncio.run(batch_count()) == 0
            asyncio.run(set_question_lifecycle(changed_question_id, "active"))

            created = client.post(
                "/api/v1/papers/composition/batches",
                json=batch_request,
            )
            assert created.status_code == 200, created.text
            result = created.json()["result"]
            assert result["replayed"] is False
            assert result["status"] == "created"
            assert result["planHash"] == checked["planHash"]
            assert [paper["variantCode"] for paper in result["papers"]] == [
                "A",
                "B",
                "C",
            ]
            assert [paper["questionCount"] for paper in result["papers"]] == [6, 5, 4]
            assert all(
                paper["generationBatchId"] == result["batchId"]
                for paper in result["papers"]
            )
            selected = [
                reference["questionId"]
                for paper in result["papers"]
                for reference in paper["questions"]
            ]
            assert len(selected) == 15
            assert len(selected) == len(set(selected))

            replayed = client.post(
                "/api/v1/papers/composition/batches",
                json=batch_request,
            )
            assert replayed.status_code == 200, replayed.text
            replay = replayed.json()["result"]
            assert replay["replayed"] is True
            assert replay["batchId"] == result["batchId"]
            assert [paper["id"] for paper in replay["papers"]] == [
                paper["id"] for paper in result["papers"]
            ]

            conflicted = client.post(
                "/api/v1/papers/composition/batches",
                json={**batch_request, "randomSeed": "different-seed"},
            )
            assert conflicted.status_code == 409
            assert conflicted.json()["detail"]["code"] == (
                "IDEMPOTENCY_PAYLOAD_CONFLICT"
            )

            before_failure = asyncio.run(composition_write_counts())
            assert before_failure == (1, 3, 15)
            real_link = paper_composition_service.PaperQuestion
            constructed = 0

            def fail_on_second_reference(*args, **kwargs):
                nonlocal constructed
                constructed += 1
                if constructed == 2:
                    raise RuntimeError("forced composition reference failure")
                return real_link(*args, **kwargs)

            monkeypatch.setattr(
                paper_composition_service,
                "PaperQuestion",
                fail_on_second_reference,
            )
            failed = client.post(
                "/api/v1/papers/composition/batches",
                json={
                    **batch_request,
                    "idempotencyKey": f"batch-rollback-{suffix}",
                },
            )
            assert failed.status_code == 500
            assert asyncio.run(composition_write_counts()) == before_failure
    finally:
        asyncio.run(cleanup())
