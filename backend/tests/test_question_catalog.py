import asyncio
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.content_prep import QuestionAuditLog, QuestionBankCollaborator
from app.models.question import ExamPaper, PaperQuestion, Question, QuestionBank
from app.models.training import LearningEvent, RecallProgress, TrainingProgress
from app.models.user import User
from app.services.question_catalog_service import question_to_payload


PASSWORD = "catalog-pass"


def _login(client: TestClient, username: str, password: str = PASSWORD) -> None:
    response = client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": password},
    )
    assert response.status_code == 200


def test_bank_scoped_test_record_cleanup_only_removes_selected_bank_records() -> None:
    suffix = uuid4().hex[:10]
    teacher_name = f"catalog-clear-teacher-{suffix}"
    learner_name = f"catalog-clear-learner-{suffix}"
    bank_a_id = f"catalog-clear-bank-a-{suffix}"
    bank_b_id = f"catalog-clear-bank-b-{suffix}"
    question_a_id = f"catalog-clear-question-a-{suffix}"
    question_b_id = f"catalog-clear-question-b-{suffix}"
    paper_id = f"catalog-clear-paper-{suffix}"

    async def seed() -> None:
        async with AsyncSessionLocal() as db:
            password_hash = hash_password(PASSWORD)
            db.add_all(
                [
                    User(
                        username=teacher_name,
                        password_hash=password_hash,
                        role="teacher",
                        status="active",
                    ),
                    User(
                        username=learner_name,
                        password_hash=password_hash,
                        role="student",
                        status="active",
                    ),
                ]
            )
            await db.flush()
            db.add_all(
                [
                    QuestionBank(
                        id=bank_a_id,
                        owner_id=teacher_name,
                        name="待清理测试题库",
                        subject="PMP",
                    ),
                    QuestionBank(
                        id=bank_b_id,
                        owner_id=teacher_name,
                        name="保留题库",
                        subject="PMP",
                    ),
                ]
            )
            await db.flush()
            db.add_all(
                [
                    Question(
                        id=question_a_id,
                        bank_id=bank_a_id,
                        title="测试题 A",
                        scope="internal",
                    ),
                    Question(
                        id=question_b_id,
                        bank_id=bank_b_id,
                        title="测试题 B",
                        scope="internal",
                    ),
                ]
            )
            await db.flush()
            db.add(
                ExamPaper(
                    id=paper_id,
                    owner_id=teacher_name,
                    name="已发布测试试卷",
                    subject="PMP",
                    status="published",
                    total_count=1,
                )
            )
            await db.flush()
            db.add(PaperQuestion(paper_id=paper_id, question_id=question_a_id))
            db.add_all(
                [
                    TrainingProgress(
                        id=f"tp-clear-a-{suffix}",
                        owner_id=learner_name,
                        question_id=question_a_id,
                        bank_id=bank_a_id,
                    ),
                    TrainingProgress(
                        id=f"tp-clear-b-{suffix}",
                        owner_id=learner_name,
                        question_id=question_b_id,
                        bank_id=bank_b_id,
                    ),
                    RecallProgress(
                        owner_id=learner_name,
                        question_id=question_a_id,
                    ),
                    RecallProgress(
                        owner_id=teacher_name,
                        question_id=question_b_id,
                    ),
                    LearningEvent(
                        id=f"le-clear-a-{suffix}",
                        owner_id=learner_name,
                        question_id=question_a_id,
                        event_type="answer_submitted",
                    ),
                    LearningEvent(
                        id=f"le-clear-b-{suffix}",
                        owner_id=learner_name,
                        question_id=question_b_id,
                        event_type="answer_submitted",
                    ),
                ]
            )
            await db.commit()

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            question_ids = [question_a_id, question_b_id]
            await db.execute(delete(PaperQuestion).where(PaperQuestion.paper_id == paper_id))
            await db.execute(delete(ExamPaper).where(ExamPaper.id == paper_id))
            await db.execute(
                delete(TrainingProgress).where(
                    TrainingProgress.question_id.in_(question_ids)
                )
            )
            await db.execute(
                delete(RecallProgress).where(
                    RecallProgress.question_id.in_(question_ids)
                )
            )
            await db.execute(
                delete(LearningEvent).where(
                    LearningEvent.question_id.in_(question_ids)
                )
            )
            await db.execute(delete(Question).where(Question.id.in_(question_ids)))
            await db.execute(
                delete(QuestionBank).where(QuestionBank.id.in_([bank_a_id, bank_b_id]))
            )
            await db.execute(
                delete(User).where(User.username.in_([teacher_name, learner_name]))
            )
            await db.commit()

    async def remaining_question_ids(
        model: type[TrainingProgress | RecallProgress | LearningEvent],
    ) -> set[str]:
        async with AsyncSessionLocal() as db:
            rows = await db.execute(
                select(model.question_id).where(
                    model.question_id.in_([question_a_id, question_b_id])
                )
            )
            return {str(question_id) for question_id in rows.scalars().all()}

    asyncio.run(seed())
    try:
        with TestClient(app) as client:
            _login(client, teacher_name)
            response = client.post(
                f"/api/v1/banks/{bank_a_id}/test-learning-records/clear"
            )

            deleted = client.delete(f"/api/v1/banks/{bank_a_id}")

        assert response.status_code == 200
        assert response.json() == {
            "questionCount": 1,
            "cleared": {
                "trainingProgress": 1,
                "recallProgress": 1,
                "learningEvents": 1,
            },
        }
        assert deleted.status_code == 200
        for model in (TrainingProgress, RecallProgress, LearningEvent):
            assert asyncio.run(remaining_question_ids(model)) == {question_b_id}

        async def paper_has_no_deleted_bank_questions() -> bool:
            async with AsyncSessionLocal() as db:
                links = await db.execute(
                    select(PaperQuestion).where(PaperQuestion.paper_id == paper_id)
                )
                paper = await db.get(ExamPaper, paper_id)
                return (
                    not links.scalars().all()
                    and paper is not None
                    and paper.total_count == 0
                )

        assert asyncio.run(paper_has_no_deleted_bank_questions())
    finally:
        asyncio.run(cleanup())


def test_catalog_serializer_normalizes_legacy_string_collections() -> None:
    question = Question(
        id="legacy-string-question",
        bank_id="legacy-string-bank",
        title="旧格式题目",
        type="multiple_choice",
        options=[{"id": "A"}, {"id": "B"}, {"id": "C"}],
        stem_parts=["旧格式题干"],
        clues=["旧格式线索"],
        concepts=["可持续步调"],
        reasoning_steps=["先判断原则"],
        correct_answer_ids=["A", "C"],
    )

    payload = question_to_payload(question)

    assert payload["stemParts"] == [{"text": "旧格式题干"}]
    assert payload["clues"] == [{"text": "旧格式线索"}]
    assert payload["concepts"] == [{"title": "可持续步调"}]
    assert payload["reasoningSteps"] == [{"content": "先判断原则"}]
    assert payload["correctOptionIds"] == ["A", "C"]


def test_teacher_can_manage_another_teachers_bank() -> None:
    """Catch a regression that restores owner-only filtering for teaching managers."""

    suffix = uuid4().hex[:10]
    owner_name = f"catalog-shared-owner-{suffix}"
    peer_name = f"catalog-shared-peer-{suffix}"
    student_name = f"catalog-shared-student-{suffix}"
    bank_id = f"catalog-shared-bank-{suffix}"
    question_id = f"catalog-shared-question-{suffix}"

    async def seed() -> None:
        password_hash = hash_password(PASSWORD)
        async with AsyncSessionLocal() as db:
            db.add_all(
                [
                    User(
                        username=owner_name,
                        password_hash=password_hash,
                        role="teacher",
                        status="active",
                    ),
                    User(
                        username=peer_name,
                        password_hash=password_hash,
                        role="teacher",
                        status="active",
                    ),
                    User(
                        username=student_name,
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
                    owner_id=owner_name,
                    name="跨教师共享题库",
                    subject="PMP",
                    visibility="private",
                )
            )
            await db.flush()
            db.add(
                Question(
                    id=question_id,
                    bank_id=bank_id,
                    title="共享池原题",
                    subject="PMP",
                    scope="internal",
                )
            )
            await db.commit()

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(Question).where(Question.bank_id == bank_id))
            await db.execute(delete(QuestionBank).where(QuestionBank.id == bank_id))
            await db.execute(
                delete(User).where(
                    User.username.in_([owner_name, peer_name, student_name])
                )
            )
            await db.commit()

    asyncio.run(seed())
    try:
        with TestClient(app) as client:
            _login(client, peer_name)
            managed = client.get("/api/v1/question-catalog/banks?mode=managed")
            writable = client.get("/api/v1/question-catalog/banks?mode=writable")

            assert managed.status_code == 200
            assert writable.status_code == 200
            managed_bank = next(
                bank for bank in managed.json()["banks"] if bank["id"] == bank_id
            )
            writable_bank = next(
                bank for bank in writable.json()["banks"] if bank["id"] == bank_id
            )
            assert managed_bank["accessMode"] == "teacher"
            assert writable_bank["accessMode"] == "teacher"

            page = client.get(
                f"/api/v1/question-catalog/banks/{bank_id}/questions",
                params={"page": 1, "page_size": 20},
            )
            assert page.status_code == 200
            assert [row["id"] for row in page.json()["questions"]] == [question_id]

            created = client.post(
                f"/api/v1/banks/{bank_id}/questions",
                json={"title": "由另一位教师创建"},
            )
            assert created.status_code == 200
            assert created.json()["question"]["createdBy"] == peer_name

            client.post("/api/v1/auth/logout")
            _login(client, student_name)
            assert (
                client.get("/api/v1/question-catalog/banks?mode=managed").status_code
                == 403
            )
    finally:
        asyncio.run(cleanup())


def test_bank_question_search_filters_before_pagination() -> None:
    """Catch client-side filtering that paginates the unfiltered question set."""

    suffix = uuid4().hex[:10]
    teacher_name = f"catalog-search-teacher-{suffix}"
    bank_id = f"catalog-search-bank-{suffix}"
    question_ids = [f"catalog-search-question-{suffix}-{index}" for index in range(3)]

    async def seed() -> None:
        async with AsyncSessionLocal() as db:
            db.add(
                User(
                    username=teacher_name,
                    password_hash=hash_password(PASSWORD),
                    role="teacher",
                    status="active",
                )
            )
            await db.flush()
            db.add(
                QuestionBank(
                    id=bank_id,
                    owner_id=teacher_name,
                    name="分页搜索题库",
                    subject="PMP",
                )
            )
            await db.flush()
            db.add_all(
                [
                    Question(
                        id=question_ids[0],
                        bank_id=bank_id,
                        title="风险应对一",
                        domain="过程",
                        topic="风险",
                        tags=["规划"],
                        scope="internal",
                    ),
                    Question(
                        id=question_ids[1],
                        bank_id=bank_id,
                        title="风险应对二",
                        domain="过程",
                        topic="执行",
                        tags=["风险"],
                        scope="internal",
                    ),
                    Question(
                        id=question_ids[2],
                        bank_id=bank_id,
                        title="团队建设",
                        domain="人员",
                        topic="团队",
                        tags=["沟通"],
                        scope="internal",
                    ),
                ]
            )
            await db.commit()

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(Question).where(Question.bank_id == bank_id))
            await db.execute(delete(QuestionBank).where(QuestionBank.id == bank_id))
            await db.execute(delete(User).where(User.username == teacher_name))
            await db.commit()

    asyncio.run(seed())
    try:
        with TestClient(app) as client:
            _login(client, teacher_name)
            response = client.get(
                f"/api/v1/question-catalog/banks/{bank_id}/questions",
                params={"search": "风险", "page": 2, "page_size": 1},
            )

        assert response.status_code == 200
        assert response.json()["total"] == 2
        assert [row["title"] for row in response.json()["questions"]] == [
            "风险应对二"
        ]
    finally:
        asyncio.run(cleanup())


def test_teacher_can_update_and_delete_another_teachers_bank_content() -> None:
    """Catch regressions where shared listing works but cross-teacher writes do not."""

    suffix = uuid4().hex[:10]
    owner_name = f"catalog-write-owner-{suffix}"
    peer_name = f"catalog-write-peer-{suffix}"
    student_name = f"catalog-write-student-{suffix}"
    viewer_name = f"catalog-write-viewer-{suffix}"
    created_bank_ids: set[str] = set()
    created_question_ids: set[str] = set()

    async def seed_users() -> None:
        password_hash = hash_password(PASSWORD)
        async with AsyncSessionLocal() as db:
            db.add_all(
                [
                    User(
                        username=owner_name,
                        password_hash=password_hash,
                        role="teacher",
                        status="active",
                    ),
                    User(
                        username=peer_name,
                        password_hash=password_hash,
                        role="teacher",
                        status="active",
                    ),
                    User(
                        username=student_name,
                        password_hash=password_hash,
                        role="student",
                        status="active",
                    ),
                    User(
                        username=viewer_name,
                        password_hash=password_hash,
                        role="viewer",
                        status="active",
                    ),
                ]
            )
            await db.commit()

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            test_usernames = [owner_name, peer_name, student_name, viewer_name]
            owned_bank_ids = set(
                (
                    await db.execute(
                        select(QuestionBank.id).where(
                            QuestionBank.owner_id.in_(test_usernames)
                        )
                    )
                ).scalars()
            )
            cleanup_bank_ids = created_bank_ids | owned_bank_ids
            if cleanup_bank_ids:
                await db.execute(
                    delete(QuestionAuditLog).where(
                        QuestionAuditLog.bank_id.in_(cleanup_bank_ids)
                    )
                )
                await db.execute(
                    delete(Question).where(Question.bank_id.in_(cleanup_bank_ids))
                )
                await db.execute(
                    delete(QuestionBank).where(QuestionBank.id.in_(cleanup_bank_ids))
                )
            if created_question_ids:
                await db.execute(
                    delete(QuestionAuditLog).where(
                        QuestionAuditLog.question_id.in_(created_question_ids)
                    )
                )
            await db.execute(
                delete(User).where(
                    User.username.in_(test_usernames)
                )
            )
            await db.commit()

    asyncio.run(seed_users())
    try:
        with TestClient(app) as client:
            _login(client, owner_name)
            mutable_bank = client.post(
                "/api/v1/banks",
                json={"name": "待协作编辑题库", "subject": "PMP"},
            )
            assert mutable_bank.status_code == 200
            mutable_bank_id = mutable_bank.json()["bank"]["id"]
            created_bank_ids.add(mutable_bank_id)

            removable_bank = client.post(
                "/api/v1/banks",
                json={"name": "待协作删除题库", "subject": "PMP"},
            )
            assert removable_bank.status_code == 200
            removable_bank_id = removable_bank.json()["bank"]["id"]
            created_bank_ids.add(removable_bank_id)

            mutable_question = client.post(
                f"/api/v1/banks/{mutable_bank_id}/questions",
                json={"title": "待协作编辑题目"},
            )
            assert mutable_question.status_code == 200
            mutable_question_id = mutable_question.json()["question"]["id"]
            created_question_ids.add(mutable_question_id)

            removable_question = client.post(
                f"/api/v1/banks/{mutable_bank_id}/questions",
                json={"title": "待协作删除题目"},
            )
            assert removable_question.status_code == 200
            removable_question_id = removable_question.json()["question"]["id"]
            created_question_ids.add(removable_question_id)

            client.post("/api/v1/auth/logout")
            _login(client, peer_name)
            updated_bank = client.put(
                f"/api/v1/banks/{mutable_bank_id}",
                json={"name": "由另一位教师更新"},
            )
            assert updated_bank.status_code == 200
            updated_bank_payload = updated_bank.json()["bank"]
            assert {
                "name": updated_bank_payload["name"],
                "ownerId": updated_bank_payload["ownerId"],
                "createdBy": updated_bank_payload["createdBy"],
                "updatedBy": updated_bank_payload["updatedBy"],
            } == {
                "name": "由另一位教师更新",
                "ownerId": owner_name,
                "createdBy": owner_name,
                "updatedBy": peer_name,
            }

            updated_question = client.put(
                f"/api/v1/questions/{mutable_question_id}",
                json={"title": "由另一位教师更新的题目"},
            )
            assert updated_question.status_code == 200
            updated_question_payload = updated_question.json()["question"]
            assert {
                "title": updated_question_payload["title"],
                "createdBy": updated_question_payload["createdBy"],
                "updatedBy": updated_question_payload["updatedBy"],
            } == {
                "title": "由另一位教师更新的题目",
                "createdBy": owner_name,
                "updatedBy": peer_name,
            }

            deleted_question = client.delete(
                f"/api/v1/questions/{removable_question_id}"
            )
            assert deleted_question.status_code == 200
            assert client.get(
                f"/api/v1/questions/{removable_question_id}"
            ).status_code == 404

            deleted_bank = client.delete(f"/api/v1/banks/{removable_bank_id}")
            assert deleted_bank.status_code == 200
            managed_ids = {
                bank["id"]
                for bank in client.get(
                    "/api/v1/question-catalog/banks?mode=managed"
                ).json()["banks"]
            }
            assert removable_bank_id not in managed_ids
            assert mutable_bank_id in managed_ids

            for restricted_username in (student_name, viewer_name):
                client.post("/api/v1/auth/logout")
                _login(client, restricted_username)
                assert client.post(
                    "/api/v1/banks",
                    json={"name": "禁止创建", "subject": "PMP"},
                ).status_code == 403
                assert client.put(
                    f"/api/v1/banks/{mutable_bank_id}",
                    json={"name": "禁止更新"},
                ).status_code == 403
                assert client.delete(
                    f"/api/v1/questions/{mutable_question_id}"
                ).status_code == 403
    finally:
        asyncio.run(cleanup())


def test_admin_can_update_and_delete_teacher_owned_bank_content() -> None:
    """Catch regressions that leave admin access read-only across teacher ownership."""

    suffix = uuid4().hex[:10]
    owner_name = f"catalog-admin-owner-{suffix}"
    created_bank_ids: set[str] = set()
    created_question_ids: set[str] = set()

    async def seed_owner() -> None:
        async with AsyncSessionLocal() as db:
            db.add(
                User(
                    username=owner_name,
                    password_hash=hash_password(PASSWORD),
                    role="teacher",
                    status="active",
                )
            )
            await db.commit()

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            owned_bank_ids = set(
                (
                    await db.execute(
                        select(QuestionBank.id).where(
                            QuestionBank.owner_id == owner_name
                        )
                    )
                ).scalars()
            )
            cleanup_bank_ids = created_bank_ids | owned_bank_ids
            if cleanup_bank_ids:
                await db.execute(
                    delete(QuestionAuditLog).where(
                        QuestionAuditLog.bank_id.in_(cleanup_bank_ids)
                    )
                )
                await db.execute(
                    delete(Question).where(Question.bank_id.in_(cleanup_bank_ids))
                )
                await db.execute(
                    delete(QuestionBank).where(QuestionBank.id.in_(cleanup_bank_ids))
                )
            if created_question_ids:
                await db.execute(
                    delete(QuestionAuditLog).where(
                        QuestionAuditLog.question_id.in_(created_question_ids)
                    )
                )
            await db.execute(delete(User).where(User.username == owner_name))
            await db.commit()

    asyncio.run(seed_owner())
    try:
        with TestClient(app) as client:
            _login(client, owner_name)
            mutable_bank = client.post(
                "/api/v1/banks",
                json={"name": "管理员待编辑题库", "subject": "PMP"},
            )
            assert mutable_bank.status_code == 200
            mutable_bank_id = mutable_bank.json()["bank"]["id"]
            created_bank_ids.add(mutable_bank_id)

            removable_bank = client.post(
                "/api/v1/banks",
                json={"name": "管理员待删除题库", "subject": "PMP"},
            )
            assert removable_bank.status_code == 200
            removable_bank_id = removable_bank.json()["bank"]["id"]
            created_bank_ids.add(removable_bank_id)

            mutable_question = client.post(
                f"/api/v1/banks/{mutable_bank_id}/questions",
                json={"title": "管理员待编辑题目"},
            )
            assert mutable_question.status_code == 200
            mutable_question_id = mutable_question.json()["question"]["id"]
            created_question_ids.add(mutable_question_id)

            removable_question = client.post(
                f"/api/v1/banks/{mutable_bank_id}/questions",
                json={"title": "管理员待删除题目"},
            )
            assert removable_question.status_code == 200
            removable_question_id = removable_question.json()["question"]["id"]
            created_question_ids.add(removable_question_id)

            client.post("/api/v1/auth/logout")
            _login(client, "admin", "jbgsnmm~123")
            updated_bank = client.put(
                f"/api/v1/banks/{mutable_bank_id}",
                json={"name": "由管理员更新"},
            )
            assert updated_bank.status_code == 200
            updated_bank_payload = updated_bank.json()["bank"]
            assert {
                "name": updated_bank_payload["name"],
                "ownerId": updated_bank_payload["ownerId"],
                "createdBy": updated_bank_payload["createdBy"],
                "updatedBy": updated_bank_payload["updatedBy"],
            } == {
                "name": "由管理员更新",
                "ownerId": owner_name,
                "createdBy": owner_name,
                "updatedBy": "admin",
            }

            updated_question = client.put(
                f"/api/v1/questions/{mutable_question_id}",
                json={"title": "由管理员更新的题目"},
            )
            assert updated_question.status_code == 200
            updated_question_payload = updated_question.json()["question"]
            assert {
                "title": updated_question_payload["title"],
                "createdBy": updated_question_payload["createdBy"],
                "updatedBy": updated_question_payload["updatedBy"],
            } == {
                "title": "由管理员更新的题目",
                "createdBy": owner_name,
                "updatedBy": "admin",
            }

            assert client.delete(
                f"/api/v1/questions/{removable_question_id}"
            ).status_code == 200
            assert client.get(
                f"/api/v1/questions/{removable_question_id}"
            ).status_code == 404

            assert client.delete(
                f"/api/v1/banks/{removable_bank_id}"
            ).status_code == 200
            writable_ids = {
                bank["id"]
                for bank in client.get(
                    "/api/v1/question-catalog/banks?mode=writable"
                ).json()["banks"]
            }
            assert removable_bank_id not in writable_ids
            assert mutable_bank_id in writable_ids
    finally:
        asyncio.run(cleanup())


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
            assert bank_ids["private"] in writable_ids
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

            _login(client, "admin", "jbgsnmm~123")
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
