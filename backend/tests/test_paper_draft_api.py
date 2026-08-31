from __future__ import annotations

import asyncio
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.paper import PaperCategory
from app.models.question import ExamPaper, PaperQuestion, Question, QuestionBank
from app.models.user import User


PASSWORD = "paper-draft-pass"


def login(client: TestClient, username: str) -> None:
    response = client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": PASSWORD},
    )
    assert response.status_code == 200


def test_paper_type_rejects_mixed_questions_and_locks_after_selection() -> None:
    suffix = uuid4().hex[:10]
    teacher = f"paper-type-teacher-{suffix}"
    bank_id = f"paper-type-bank-{suffix}"
    single_id = f"paper-type-single-{suffix}"
    multi_id = f"paper-type-multi-{suffix}"
    paper_id = ""

    async def seed() -> None:
        async with AsyncSessionLocal() as db:
            db.add(User(
                username=teacher,
                password_hash=hash_password(PASSWORD),
                role="teacher",
                status="active",
            ))
            await db.flush()
            db.add(QuestionBank(
                id=bank_id,
                owner_id=teacher,
                name="题型试卷题库",
                subject="PMP",
            ))
            await db.flush()
            db.add_all([
                Question(
                    id=single_id,
                    bank_id=bank_id,
                    title="单选题",
                    type="single_choice",
                    lifecycle={"status": "active"},
                ),
                Question(
                    id=multi_id,
                    bank_id=bank_id,
                    title="多选题",
                    type="multiple_choice",
                    options=[{"id": value} for value in "ABC"],
                    correct_answer_ids=["A", "C"],
                    analysis="解析",
                    lifecycle={"status": "active"},
                ),
            ])
            await db.commit()

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            paper_ids = list((await db.scalars(
                select(ExamPaper.id).where(ExamPaper.owner_id == teacher)
            )).all())
            if paper_ids:
                await db.execute(delete(PaperQuestion).where(PaperQuestion.paper_id.in_(paper_ids)))
                await db.execute(delete(ExamPaper).where(ExamPaper.id.in_(paper_ids)))
            await db.execute(delete(Question).where(Question.bank_id == bank_id))
            await db.execute(delete(QuestionBank).where(QuestionBank.id == bank_id))
            await db.execute(delete(User).where(User.username == teacher))
            await db.commit()

    def reference(question_id: str) -> dict:
        return {
            "bankId": bank_id,
            "questionId": question_id,
            "order": 1,
            "score": 1,
        }

    asyncio.run(seed())
    try:
        with TestClient(app) as client:
            login(client, teacher)
            wrong_standard = client.post(
                "/api/v1/papers",
                json={"name": "标准卷", "questions": [reference(multi_id)]},
            )
            assert wrong_standard.status_code == 422
            assert wrong_standard.json()["detail"]["code"] == "PAPER_TYPE_QUESTION_MISMATCH"

            wrong_multi = client.post(
                "/api/v1/papers",
                json={
                    "name": "多选卷",
                    "paperType": "multiple_choice",
                    "questions": [reference(single_id)],
                },
            )
            assert wrong_multi.status_code == 422
            assert wrong_multi.json()["detail"]["code"] == "PAPER_TYPE_QUESTION_MISMATCH"

            created = client.post(
                "/api/v1/papers",
                json={
                    "name": "多选卷",
                    "paperType": "multiple_choice",
                    "questions": [reference(multi_id)],
                },
            )
            assert created.status_code == 200, created.text
            paper = created.json()["paper"]
            paper_id = paper["id"]
            assert paper["paperType"] == "multiple_choice"

            locked = client.put(
                f"/api/v1/papers/{paper_id}",
                json={"revision": 1, "paperType": "standard"},
            )
            assert locked.status_code == 409
            assert locked.json()["detail"]["code"] == "PAPER_TYPE_LOCKED"
    finally:
        asyncio.run(cleanup())


def test_create_paper_persists_ordered_references_and_denies_students() -> None:
    suffix = uuid4().hex[:10]
    teacher = f"paper-draft-teacher-{suffix}"
    student = f"paper-draft-student-{suffix}"
    bank_id = f"paper-draft-bank-{suffix}"
    question_ids = [f"paper-draft-q-{suffix}-{index}" for index in range(2)]
    paper_id = ""

    async def seed() -> None:
        async with AsyncSessionLocal() as db:
            password_hash = hash_password(PASSWORD)
            db.add_all(
                [
                    User(
                        username=teacher,
                        password_hash=password_hash,
                        role="teacher",
                        status="active",
                    ),
                    User(
                        username=student,
                        password_hash=password_hash,
                        role="student",
                        status="active",
                    ),
                ]
            )
            await db.flush()
            db.add(
                QuestionBank(
                    id=bank_id,
                    source_id=f"source-{bank_id}",
                    owner_id=teacher,
                    name="试卷草稿题库",
                    subject="PMP",
                    created_by=teacher,
                    updated_by=teacher,
                )
            )
            await db.flush()
            db.add_all(
                [
                    Question(
                        id=question_id,
                        source_id=f"source-{question_id}",
                        bank_id=bank_id,
                        title=f"草稿题目 {index + 1}",
                        subject="PMP",
                        domain="人员",
                        topic="团队",
                        difficulty="medium",
                        tags=["敏捷"],
                        scope="internal",
                        lifecycle={"status": "active"},
                        created_by=teacher,
                        updated_by=teacher,
                    )
                    for index, question_id in enumerate(question_ids)
                ]
            )
            await db.commit()

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            if paper_id:
                await db.execute(
                    delete(PaperQuestion).where(PaperQuestion.paper_id == paper_id)
                )
                await db.execute(delete(ExamPaper).where(ExamPaper.id == paper_id))
            await db.execute(delete(PaperCategory).where(PaperCategory.owner_id == teacher))
            await db.execute(delete(Question).where(Question.bank_id == bank_id))
            await db.execute(delete(QuestionBank).where(QuestionBank.id == bank_id))
            await db.execute(delete(User).where(User.username.in_([teacher, student])))
            await db.commit()

    asyncio.run(seed())
    try:
        with TestClient(app) as client:
            login(client, teacher)
            response = client.post(
                "/api/v1/papers",
                json={
                    "name": "API 草稿",
                    "subject": "PMP",
                    "description": "由草稿接口创建",
                    "accessPolicy": {"accessLevel": "member"},
                    "enabledModes": ["practice_mode", "deep_recall"],
                    "questions": [
                        {
                            "bankId": bank_id,
                            "questionId": question_ids[0],
                            "order": 1,
                            "score": 1,
                        },
                        {
                            "bankId": bank_id,
                            "questionId": question_ids[1],
                            "order": 2,
                            "score": 2.5,
                        },
                    ],
                },
            )
            assert response.status_code == 200, response.text
            paper = response.json()["paper"]
            paper_id = paper["id"]
            assert paper["totalCount"] == 2
            assert paper["accessPolicy"] == {"accessLevel": "member"}
            assert paper["enabledModes"] == ["practice_mode", "deep_recall"]
            assert paper["questions"] == [
                {
                    "bankId": bank_id,
                    "questionId": question_ids[0],
                    "order": 1,
                    "score": 1.0,
                    "summary": {
                        "title": "草稿题目 1",
                        "domain": "人员",
                        "topic": "团队",
                        "difficulty": "medium",
                        "tags": ["敏捷"],
                    },
                },
                {
                    "bankId": bank_id,
                    "questionId": question_ids[1],
                    "order": 2,
                    "score": 2.5,
                    "summary": {
                        "title": "草稿题目 2",
                        "domain": "人员",
                        "topic": "团队",
                        "difficulty": "medium",
                        "tags": ["敏捷"],
                    },
                },
            ]

            detail = client.get(f"/api/v1/papers/{paper_id}")
            assert detail.status_code == 200
            assert detail.json()["paper"]["questions"] == paper["questions"]

            listed = client.get("/api/v1/papers")
            assert listed.status_code == 200
            listed_paper = next(
                item for item in listed.json()["papers"] if item["id"] == paper_id
            )
            assert "questions" not in listed_paper

            client.post("/api/v1/auth/logout")
            login(client, student)
            assert client.get("/api/v1/papers").status_code == 403
    finally:
        asyncio.run(cleanup())


def test_shared_paper_update_reference_replacement_and_category_cas() -> None:
    suffix = uuid4().hex[:10]
    teacher_a = f"paper-shared-a-{suffix}"
    teacher_b = f"paper-shared-b-{suffix}"
    bank_id = f"paper-shared-bank-{suffix}"
    question_ids = [f"paper-shared-q-{suffix}-{index}" for index in range(3)]
    paper_id = ""
    category_id = ""

    async def seed() -> None:
        async with AsyncSessionLocal() as db:
            password_hash = hash_password(PASSWORD)
            db.add_all(
                [
                    User(
                        username=username,
                        password_hash=password_hash,
                        role="teacher",
                        status="active",
                    )
                    for username in (teacher_a, teacher_b)
                ]
            )
            await db.flush()
            db.add(
                QuestionBank(
                    id=bank_id,
                    source_id=f"source-{bank_id}",
                    owner_id=teacher_a,
                    name="共享试卷题库",
                    subject="PMP",
                    created_by=teacher_a,
                    updated_by=teacher_a,
                )
            )
            await db.flush()
            db.add_all(
                [
                    Question(
                        id=question_id,
                        source_id=f"source-{question_id}",
                        bank_id=bank_id,
                        title=f"共享题目 {index + 1}",
                        subject="PMP",
                        scope="internal",
                        lifecycle={"status": "active"},
                        created_by=teacher_a,
                        updated_by=teacher_a,
                    )
                    for index, question_id in enumerate(question_ids)
                ]
            )
            await db.commit()

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            if paper_id:
                await db.execute(
                    delete(PaperQuestion).where(PaperQuestion.paper_id == paper_id)
                )
                await db.execute(delete(ExamPaper).where(ExamPaper.id == paper_id))
            if category_id:
                await db.execute(
                    delete(PaperCategory).where(PaperCategory.id == category_id)
                )
            await db.execute(delete(Question).where(Question.bank_id == bank_id))
            await db.execute(delete(QuestionBank).where(QuestionBank.id == bank_id))
            await db.execute(delete(User).where(User.username.in_([teacher_a, teacher_b])))
            await db.commit()

    asyncio.run(seed())
    try:
        with TestClient(app) as client:
            login(client, teacher_a)
            category_response = client.post(
                "/api/v1/paper-categories",
                json={"name": "模拟卷", "description": "共享分类"},
            )
            assert category_response.status_code == 200, category_response.text
            category = category_response.json()["category"]
            category_id = category["id"]
            assert category["revision"] == 1
            assert category["createdBy"] == teacher_a

            paper_response = client.post(
                "/api/v1/papers",
                json={
                    "name": "共享草稿",
                    "categoryId": category_id,
                    "questions": [
                        {
                            "bankId": bank_id,
                            "questionId": question_ids[0],
                            "order": 1,
                            "score": 1,
                        }
                    ],
                },
            )
            assert paper_response.status_code == 200, paper_response.text
            paper_id = paper_response.json()["paper"]["id"]

            renamed = client.put(
                f"/api/v1/paper-categories/{category_id}",
                json={"revision": 1, "name": "正式模拟卷"},
            )
            assert renamed.status_code == 200, renamed.text
            assert renamed.json()["category"]["revision"] == 2

            client.post("/api/v1/auth/logout")
            login(client, teacher_b)
            listed = client.get("/api/v1/papers").json()["papers"]
            assert any(item["id"] == paper_id for item in listed)
            categories = client.get("/api/v1/paper-categories").json()["categories"]
            assert any(item["id"] == category_id for item in categories)

            updated = client.put(
                f"/api/v1/papers/{paper_id}",
                json={"revision": 1, "name": "教师 B 更新的草稿"},
            )
            assert updated.status_code == 200, updated.text
            assert updated.json()["paper"]["revision"] == 2
            assert updated.json()["paper"]["updatedBy"] == teacher_b

            replaced = client.put(
                f"/api/v1/papers/{paper_id}/questions",
                json={
                    "revision": 2,
                    "questions": [
                        {
                            "bankId": bank_id,
                            "questionId": question_ids[2],
                            "order": 1,
                            "score": 2,
                        },
                        {
                            "bankId": bank_id,
                            "questionId": question_ids[1],
                            "order": 2,
                            "score": 1.5,
                        },
                    ],
                },
            )
            assert replaced.status_code == 200, replaced.text
            replaced_paper = replaced.json()["paper"]
            assert replaced_paper["revision"] == 3
            assert replaced_paper["totalCount"] == 2
            assert [item["questionId"] for item in replaced_paper["questions"]] == [
                question_ids[2],
                question_ids[1],
            ]

            stale = client.put(
                f"/api/v1/papers/{paper_id}/questions",
                json={"revision": 2, "questions": []},
            )
            assert stale.status_code == 409
            assert stale.json()["detail"]["currentRevision"] == 3

            mismatch = client.put(
                f"/api/v1/papers/{paper_id}/questions",
                json={
                    "revision": 3,
                    "questions": [
                        {
                            "bankId": "wrong-bank",
                            "questionId": question_ids[0],
                            "order": 1,
                            "score": 1,
                        }
                    ],
                },
            )
            assert mismatch.status_code == 422
            assert mismatch.json()["detail"]["issues"][0]["code"] == "QUESTION_BANK_MISMATCH"

            referenced_delete = client.delete(
                f"/api/v1/paper-categories/{category_id}?revision=2"
            )
            assert referenced_delete.status_code == 409

            uncategorized = client.put(
                f"/api/v1/papers/{paper_id}",
                json={"revision": 3, "categoryId": None},
            )
            assert uncategorized.status_code == 200, uncategorized.text
            assert uncategorized.json()["paper"]["categoryId"] is None
            assert uncategorized.json()["paper"]["revision"] == 4

            deleted_category = client.delete(
                f"/api/v1/paper-categories/{category_id}?revision=2"
            )
            assert deleted_category.status_code == 200
    finally:
        asyncio.run(cleanup())


def test_archive_and_restore_paper_preserve_cas_lifecycle() -> None:
    """Catches archive/restore skipping status, timestamps, or revision CAS."""

    suffix = uuid4().hex[:10]
    teacher = f"paper-archive-teacher-{suffix}"
    paper_id = ""

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
            await db.commit()

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            if paper_id:
                await db.execute(
                    delete(PaperQuestion).where(PaperQuestion.paper_id == paper_id)
                )
                await db.execute(delete(ExamPaper).where(ExamPaper.id == paper_id))
            await db.execute(delete(User).where(User.username == teacher))
            await db.commit()

    asyncio.run(seed())
    try:
        with TestClient(app) as client:
            login(client, teacher)
            created = client.post(
                "/api/v1/papers",
                json={"name": "归档生命周期", "subject": "PMP"},
            )
            assert created.status_code == 200, created.text
            paper_id = created.json()["paper"]["id"]

            archived = client.post(
                f"/api/v1/papers/{paper_id}/archive",
                params={"revision": 1},
            )
            assert archived.status_code == 200, archived.text
            archived_paper = archived.json()["paper"]
            assert archived_paper["status"] == "archived"
            assert archived_paper["revision"] == 2
            assert archived_paper["archivedAt"] is not None
            assert archived_paper["restoredAt"] is None

            stale_restore = client.post(
                f"/api/v1/papers/{paper_id}/restore",
                params={"revision": 1},
            )
            assert stale_restore.status_code == 409
            assert stale_restore.json()["detail"]["code"] == "REVISION_CONFLICT"

            restored = client.post(
                f"/api/v1/papers/{paper_id}/restore",
                params={"revision": 2},
            )
            assert restored.status_code == 200, restored.text
            restored_paper = restored.json()["paper"]
            assert restored_paper["status"] == "draft"
            assert restored_paper["revision"] == 3
            assert restored_paper["archivedAt"] is None
            assert restored_paper["restoredAt"] is not None
    finally:
        asyncio.run(cleanup())
