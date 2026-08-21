import asyncio
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.content_prep import QuestionBankCollaborator
from app.models.paper_release import PaperRelease, PaperReleaseQuestion
from app.models.question import ExamPaper, PaperQuestion, Question, QuestionBank
from app.models.user import User
from app.services import question_service, teaching_content_revision_service


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
            assert question["metadata"] == {
                "knowledge": {"mappingStatus": "unmapped"},
                "stemPrincipleIds": [],
                "optionPrincipleMap": {},
                "principleIds": [],
            }
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
            assert updated_question["metadata"] == {
                "knowledge": {"mappingStatus": "unmapped"},
                "stemPrincipleIds": [],
                "optionPrincipleMap": {},
                "principleIds": [],
            }
            assert updated_question["keyPath"] == {"answerId": "B"}

            client.post("/api/v1/auth/logout")
            _login(client, usernames["reader"])
            assert client.get(f"/api/v1/questions/{created_question_id}").status_code == 200
            reader_updated = client.put(
                f"/api/v1/questions/{created_question_id}",
                json={"title": "所有教师共享更新"},
            )
            assert reader_updated.status_code == 200
            reader_question = reader_updated.json()["question"]
            assert reader_question["revision"] == 3
            assert reader_question["createdBy"] == usernames["owner"]
            assert reader_question["updatedBy"] == usernames["reader"]

            client.post("/api/v1/auth/logout")
            _login(client, "admin", "jbgsnmm~123")
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


def test_admin_and_teacher_share_paper_crud_compose_publish_and_audit() -> None:
    """Catches restoring owner filters or losing creator/updater/revision audit data."""

    suffix = uuid4().hex[:10]
    teacher_a = f"paper-a-{suffix}"
    teacher_b = f"paper-b-{suffix}"
    usernames = [teacher_a, teacher_b]
    bank_id = ""
    question_id = ""
    paper_ids: list[str] = []

    async def seed_users() -> None:
        password_hash = hash_password(PASSWORD)
        async with AsyncSessionLocal() as db:
            db.add_all(
                [
                    User(
                        username=username,
                        password_hash=password_hash,
                        role="teacher",
                        status="active",
                    )
                    for username in usernames
                ]
            )
            await db.commit()

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            if paper_ids:
                release_ids = select(PaperRelease.id).where(
                    PaperRelease.paper_id.in_(paper_ids)
                )
                await db.execute(
                    delete(PaperReleaseQuestion).where(
                        PaperReleaseQuestion.release_id.in_(release_ids)
                    )
                )
                await db.execute(
                    delete(PaperRelease).where(PaperRelease.paper_id.in_(paper_ids))
                )
                await db.execute(
                    delete(PaperQuestion).where(PaperQuestion.paper_id.in_(paper_ids))
                )
                await db.execute(delete(ExamPaper).where(ExamPaper.id.in_(paper_ids)))
            if question_id:
                await db.execute(delete(Question).where(Question.id == question_id))
            if bank_id:
                await db.execute(delete(QuestionBank).where(QuestionBank.id == bank_id))
            await db.execute(delete(User).where(User.username.in_(usernames)))
            await db.commit()

    async def deleted_snapshot(paper_id: str) -> tuple[dict, int]:
        async with AsyncSessionLocal() as db:
            paper = await db.get(ExamPaper, paper_id)
            assert paper is not None
            reference_count = int(
                (
                    await db.execute(
                        select(func.count())
                        .select_from(PaperQuestion)
                        .where(PaperQuestion.paper_id == paper_id)
                    )
                ).scalar_one()
            )
            return {
                "ownerId": paper.owner_id,
                "createdBy": paper.created_by,
                "updatedBy": paper.updated_by,
                "revision": paper.revision,
                "status": paper.status,
                "deletedBy": paper.deleted_by,
                "deletedAt": paper.deleted_at,
                "deletionReason": paper.deletion_reason,
            }, reference_count

    def switch_login(client: TestClient, username: str, password: str = PASSWORD) -> None:
        client.post("/api/v1/auth/logout")
        _login(client, username, password)

    def assert_shared_lifecycle(
        client: TestClient,
        *,
        actor: str,
        actor_password: str,
        paper_id: str,
        original_name: str,
    ) -> None:
        switch_login(client, actor, actor_password)

        listed = client.get("/api/v1/papers?status=draft")
        assert listed.status_code == 200
        assert paper_id in {paper["id"] for paper in listed.json()["papers"]}

        detail = client.get(f"/api/v1/papers/{paper_id}")
        assert detail.status_code == 200
        created = detail.json()["paper"]
        assert created["name"] == original_name
        assert created["ownerId"] == teacher_a
        assert created["createdBy"] == teacher_a
        assert created["updatedBy"] == teacher_a
        assert created["revision"] == 1

        blind_update = client.put(
            f"/api/v1/papers/{paper_id}",
            json={"name": "未带修订号不得覆盖"},
        )
        assert blind_update.status_code == 409
        assert blind_update.json()["detail"]["code"] == "REVISION_REQUIRED"

        updated = client.put(
            f"/api/v1/papers/{paper_id}",
            json={
                "name": f"{original_name}-共同维护",
                "revision": 1,
                "ownerId": "admin",
                "createdBy": "admin",
                "updatedBy": "forged-actor",
            },
        )
        assert updated.status_code == 200
        updated_paper = updated.json()["paper"]
        assert updated_paper["ownerId"] == teacher_a
        assert updated_paper["createdBy"] == teacher_a
        assert updated_paper["updatedBy"] == actor
        assert updated_paper["revision"] == 2

        stale_update = client.put(
            f"/api/v1/papers/{paper_id}",
            json={"name": "过期写入不得覆盖", "revision": 1},
        )
        assert stale_update.status_code == 409
        after_conflict = client.get(f"/api/v1/papers/{paper_id}").json()["paper"]
        assert after_conflict["name"] == f"{original_name}-共同维护"
        assert after_conflict["revision"] == 2

        missing_compose_revision = client.post(
            f"/api/v1/papers/{paper_id}/compose",
            json={"bankIds": [bank_id], "quotas": {"跨账号领域": 1}},
        )
        assert missing_compose_revision.status_code == 409
        assert missing_compose_revision.json()["detail"]["code"] == "REVISION_REQUIRED"
        invalid_compose_revision = client.post(
            f"/api/v1/papers/{paper_id}/compose",
            json={
                "bankIds": [bank_id],
                "quotas": {"跨账号领域": 1},
                "revision": "invalid",
            },
        )
        assert invalid_compose_revision.status_code == 409
        assert invalid_compose_revision.json()["detail"]["code"] == "REVISION_REQUIRED"
        stale_compose = client.post(
            f"/api/v1/papers/{paper_id}/compose",
            json={
                "bankIds": [bank_id],
                "quotas": {"跨账号领域": 1},
                "revision": 1,
            },
        )
        assert stale_compose.status_code == 409
        assert stale_compose.json()["detail"]["code"] == "REVISION_CONFLICT"

        composed = client.post(
            f"/api/v1/papers/{paper_id}/compose",
            json={
                "bankIds": [bank_id],
                "quotas": {"跨账号领域": 1},
                "revision": 2,
            },
        )
        assert composed.status_code == 200
        assert composed.json() == {"picked": 1}
        after_compose = client.get(f"/api/v1/papers/{paper_id}").json()["paper"]
        assert [question["id"] for question in after_compose["questions"]] == [question_id]
        assert after_compose["ownerId"] == teacher_a
        assert after_compose["createdBy"] == teacher_a
        assert after_compose["updatedBy"] == actor
        assert after_compose["revision"] == 3

        for revision in (None, "invalid"):
            suffix = "" if revision is None else f"?revision={revision}"
            rejected = client.post(f"/api/v1/papers/{paper_id}/publish{suffix}")
            assert rejected.status_code == 409
            assert rejected.json()["detail"]["code"] == "REVISION_REQUIRED"
        stale_publish = client.post(f"/api/v1/papers/{paper_id}/publish?revision=2")
        assert stale_publish.status_code == 409
        assert stale_publish.json()["detail"]["code"] == "REVISION_CONFLICT"

        published = client.post(f"/api/v1/papers/{paper_id}/publish?revision=3")
        assert published.status_code == 200
        published_paper = published.json()["paper"]
        assert published_paper["status"] == "published"
        assert published_paper["ownerId"] == teacher_a
        assert published_paper["createdBy"] == teacher_a
        assert published_paper["updatedBy"] == actor
        assert published_paper["revision"] == 4

        for revision in (None, "invalid"):
            suffix = "" if revision is None else f"?revision={revision}"
            rejected = client.post(f"/api/v1/papers/{paper_id}/unpublish{suffix}")
            assert rejected.status_code == 409
            assert rejected.json()["detail"]["code"] == "REVISION_REQUIRED"
        stale_unpublish = client.post(
            f"/api/v1/papers/{paper_id}/unpublish?revision=3"
        )
        assert stale_unpublish.status_code == 409
        assert stale_unpublish.json()["detail"]["code"] == "REVISION_CONFLICT"

        unpublished = client.post(f"/api/v1/papers/{paper_id}/unpublish?revision=4")
        assert unpublished.status_code == 200
        unpublished_paper = unpublished.json()["paper"]
        assert unpublished_paper["status"] == "draft"
        assert unpublished_paper["publishedAt"] is None
        assert unpublished_paper["ownerId"] == teacher_a
        assert unpublished_paper["createdBy"] == teacher_a
        assert unpublished_paper["updatedBy"] == actor
        assert unpublished_paper["revision"] == 5

        for revision in (None, "invalid"):
            suffix = "" if revision is None else f"?revision={revision}"
            rejected = client.delete(f"/api/v1/papers/{paper_id}{suffix}")
            assert rejected.status_code == 409
            assert rejected.json()["detail"]["code"] == "REVISION_REQUIRED"
        stale_delete = client.delete(f"/api/v1/papers/{paper_id}?revision=4")
        assert stale_delete.status_code == 409
        assert stale_delete.json()["detail"]["code"] == "REVISION_CONFLICT"

        deleted = client.delete(
            f"/api/v1/papers/{paper_id}?revision=5&reason=共同维护完成"
        )
        assert deleted.status_code == 200
        deletion = deleted.json()
        assert deletion["ok"] is True
        assert deletion["deletion"]["paperId"] == paper_id
        assert deletion["deletion"]["revision"] == 6
        assert deletion["deletion"]["deletedBy"] == actor
        assert deletion["deletion"]["reason"] == "共同维护完成"
        assert deletion["deletion"]["references"] == {"paperQuestions": 1}
        assert client.get(f"/api/v1/papers/{paper_id}").status_code == 404
        assert paper_id not in {
            paper["id"] for paper in client.get("/api/v1/papers").json()["papers"]
        }

        tombstone, reference_count = asyncio.run(deleted_snapshot(paper_id))
        assert tombstone["ownerId"] == teacher_a
        assert tombstone["createdBy"] == teacher_a
        assert tombstone["updatedBy"] == actor
        assert tombstone["revision"] == 6
        assert tombstone["status"] == "deleted"
        assert tombstone["deletedBy"] == actor
        assert tombstone["deletedAt"] is not None
        assert tombstone["deletionReason"] == "共同维护完成"
        assert reference_count == 1

    asyncio.run(seed_users())
    try:
        with TestClient(app) as client:
            _login(client, teacher_b)
            bank = client.post(
                "/api/v1/banks",
                json={"name": "跨账号组卷题库", "subject": "PMP"},
            ).json()["bank"]
            bank_id = bank["id"]
            question = client.post(
                f"/api/v1/banks/{bank_id}/questions",
                json={
                    "title": "跨账号组卷题",
                    "domain": "跨账号领域",
                    "options": [{"id": "A", "text": "正确", "correct": True}],
                    "correctAnswer": "A",
                },
            ).json()["question"]
            question_id = question["id"]

            switch_login(client, teacher_a)
            for name in ("教师共同试卷", "管理员共同试卷"):
                response = client.post(
                    "/api/v1/papers",
                    json={"name": name, "subject": "PMP"},
                )
                assert response.status_code == 200
                paper_ids.append(response.json()["paper"]["id"])

            assert_shared_lifecycle(
                client,
                actor=teacher_b,
                actor_password=PASSWORD,
                paper_id=paper_ids[0],
                original_name="教师共同试卷",
            )
            assert_shared_lifecycle(
                client,
                actor="admin",
                actor_password="jbgsnmm~123",
                paper_id=paper_ids[1],
                original_name="管理员共同试卷",
            )
    finally:
        asyncio.run(cleanup())


def test_student_and_viewer_cannot_manage_shared_papers() -> None:
    """Catches weakening paper route dependencies to authentication-only access."""

    suffix = uuid4().hex[:10]
    teacher = f"paper-owner-{suffix}"
    restricted_users = {
        "student": f"paper-student-{suffix}",
        "viewer": f"paper-viewer-{suffix}",
    }
    usernames = [teacher, *restricted_users.values()]
    paper_id = ""

    async def seed_users() -> None:
        password_hash = hash_password(PASSWORD)
        async with AsyncSessionLocal() as db:
            db.add_all(
                [
                    User(
                        username=username,
                        password_hash=password_hash,
                        role=role,
                        status="active",
                    )
                    for role, username in {
                        "teacher": teacher,
                        **restricted_users,
                    }.items()
                ]
            )
            await db.commit()

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            test_papers = select(ExamPaper.id).where(ExamPaper.owner_id.in_(usernames))
            await db.execute(
                delete(PaperQuestion).where(PaperQuestion.paper_id.in_(test_papers))
            )
            await db.execute(delete(ExamPaper).where(ExamPaper.owner_id.in_(usernames)))
            await db.execute(delete(User).where(User.username.in_(usernames)))
            await db.commit()

    asyncio.run(seed_users())
    try:
        with TestClient(app) as client:
            _login(client, teacher)
            paper_response = client.post(
                "/api/v1/papers",
                json={"name": "受限角色不可维护", "subject": "PMP"},
            )
            assert paper_response.status_code == 200
            paper_id = paper_response.json()["paper"]["id"]

            for username in restricted_users.values():
                client.post("/api/v1/auth/logout")
                _login(client, username)
                requests = [
                    client.get("/api/v1/papers"),
                    client.post("/api/v1/papers", json={"name": "越权创建"}),
                    client.get(f"/api/v1/papers/{paper_id}"),
                    client.put(
                        f"/api/v1/papers/{paper_id}",
                        json={"name": "越权更新", "revision": 1},
                    ),
                    client.delete(f"/api/v1/papers/{paper_id}"),
                    client.post(
                        f"/api/v1/papers/{paper_id}/compose",
                        json={"bankIds": [], "quotas": {}},
                    ),
                    client.post(f"/api/v1/papers/{paper_id}/publish"),
                    client.post(f"/api/v1/papers/{paper_id}/unpublish"),
                ]
                assert [response.status_code for response in requests] == [403] * 8
    finally:
        asyncio.run(cleanup())


@pytest.mark.parametrize(
    "invalid_revision",
    ["²", "①", "9" * 5000],
    ids=["superscript-digit", "circled-digit", "overlong-ascii-digits"],
)
def test_all_paper_mutations_reject_non_bounded_ascii_revision(
    invalid_revision: str,
) -> None:
    """Catches Unicode/overlong numeric strings escaping revision validation."""

    paper_id = ""

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            if paper_id:
                await db.execute(
                    delete(PaperQuestion).where(PaperQuestion.paper_id == paper_id)
                )
                await db.execute(delete(ExamPaper).where(ExamPaper.id == paper_id))
            await db.commit()

    try:
        with TestClient(app, raise_server_exceptions=False) as client:
            _login(client, "admin", "jbgsnmm~123")
            paper = client.post(
                "/api/v1/papers",
                json={"name": "非法修订号验证", "subject": "PMP"},
            ).json()["paper"]
            paper_id = paper["id"]

            responses = [
                client.put(
                    f"/api/v1/papers/{paper_id}",
                    json={"name": "不得更新", "revision": invalid_revision},
                ),
                client.post(
                    f"/api/v1/papers/{paper_id}/compose",
                    json={
                        "bankIds": [],
                        "quotas": {},
                        "revision": invalid_revision,
                    },
                ),
                client.post(
                    f"/api/v1/papers/{paper_id}/publish",
                    params={"revision": invalid_revision},
                ),
                client.post(
                    f"/api/v1/papers/{paper_id}/unpublish",
                    params={"revision": invalid_revision},
                ),
                client.delete(
                    f"/api/v1/papers/{paper_id}",
                    params={"revision": invalid_revision},
                ),
            ]
            assert [response.status_code for response in responses] == [409] * 5
            assert [response.json()["detail"]["code"] for response in responses] == [
                "REVISION_REQUIRED"
            ] * 5

            current = client.get(f"/api/v1/papers/{paper_id}").json()["paper"]
            assert current["revision"] == 1
            assert current["name"] == "非法修订号验证"
    finally:
        asyncio.run(cleanup())


@pytest.mark.parametrize(
    "invalid_revision",
    [2_147_483_647, 2_147_483_648],
    ids=["postgres-integer-max", "above-postgres-integer-max"],
)
def test_all_paper_mutations_reject_revision_that_cannot_be_incremented(
    invalid_revision: int,
) -> None:
    """Catches CAS overflow when the stored revision cannot be incremented."""

    paper_id = ""

    async def set_max_revision() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(
                update(ExamPaper)
                .where(ExamPaper.id == paper_id)
                .values(revision=2_147_483_647)
            )
            await db.commit()

    async def snapshot() -> dict:
        async with AsyncSessionLocal() as db:
            paper = await db.get(ExamPaper, paper_id)
            assert paper is not None
            reference_count = int(
                (
                    await db.execute(
                        select(func.count())
                        .select_from(PaperQuestion)
                        .where(PaperQuestion.paper_id == paper_id)
                    )
                ).scalar_one()
            )
            return {
                "revision": paper.revision,
                "name": paper.name,
                "status": paper.status,
                "deletedAt": paper.deleted_at,
                "referenceCount": reference_count,
            }

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            if paper_id:
                await db.execute(
                    delete(PaperQuestion).where(PaperQuestion.paper_id == paper_id)
                )
                await db.execute(delete(ExamPaper).where(ExamPaper.id == paper_id))
            await db.commit()

    try:
        with TestClient(app, raise_server_exceptions=False) as client:
            _login(client, "admin", "jbgsnmm~123")
            paper = client.post(
                "/api/v1/papers",
                json={"name": "修订号上限验证", "subject": "PMP"},
            ).json()["paper"]
            paper_id = paper["id"]
            asyncio.run(set_max_revision())

            responses = [
                client.put(
                    f"/api/v1/papers/{paper_id}",
                    json={"name": "不得更新", "revision": invalid_revision},
                ),
                client.post(
                    f"/api/v1/papers/{paper_id}/compose",
                    json={
                        "bankIds": [],
                        "quotas": {},
                        "revision": invalid_revision,
                    },
                ),
                client.post(
                    f"/api/v1/papers/{paper_id}/publish",
                    params={"revision": invalid_revision},
                ),
                client.post(
                    f"/api/v1/papers/{paper_id}/unpublish",
                    params={"revision": invalid_revision},
                ),
                client.delete(
                    f"/api/v1/papers/{paper_id}",
                    params={"revision": invalid_revision},
                ),
            ]
            assert [response.status_code for response in responses] == [409] * 5
            assert [response.json()["detail"]["code"] for response in responses] == [
                "REVISION_REQUIRED"
            ] * 5

        assert asyncio.run(snapshot()) == {
            "revision": 2_147_483_647,
            "name": "修订号上限验证",
            "status": "draft",
            "deletedAt": None,
            "referenceCount": 0,
        }
    finally:
        asyncio.run(cleanup())


def test_concurrent_compose_and_publish_share_one_atomic_revision(monkeypatch) -> None:
    """Catches lost revision increments across two different paper mutations."""

    suffix = uuid4().hex[:10]
    teacher_a = f"paper-race-a-{suffix}"
    teacher_b = f"paper-race-b-{suffix}"
    bank_id = ""
    question_id = ""
    paper_id = ""

    async def seed_users() -> None:
        password_hash = hash_password(PASSWORD)
        async with AsyncSessionLocal() as db:
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
            await db.commit()

    async def run_race() -> dict:
        original_acquire_lock = teaching_content_revision_service.acquire_lock
        arrival_lock = asyncio.Lock()
        both_arrived = asyncio.Event()
        arrivals = 0

        async def gated_acquire_lock(db: AsyncSession) -> None:
            nonlocal arrivals
            if arrivals < 2:
                async with arrival_lock:
                    arrivals += 1
                    if arrivals == 2:
                        both_arrived.set()
                await asyncio.wait_for(both_arrived.wait(), timeout=5)
            await original_acquire_lock(db)

        monkeypatch.setattr(
            teaching_content_revision_service,
            "acquire_lock",
            gated_acquire_lock,
        )

        async with AsyncSessionLocal() as compose_db, AsyncSessionLocal() as publish_db:
            compose_actor = await compose_db.get(User, teacher_b)
            publish_actor = await publish_db.get(User, "admin")
            assert compose_actor is not None
            assert publish_actor is not None

            async def compose() -> tuple[str, int]:
                try:
                    picked = await question_service.compose_paper(
                        compose_db,
                        compose_actor,
                        paper_id,
                        [bank_id],
                        {"并发领域": 1},
                        2,
                    )
                    return "compose", picked
                except HTTPException as exc:
                    return "compose-conflict", exc.status_code

            async def publish() -> tuple[str, int]:
                try:
                    await question_service.set_published(
                        publish_db,
                        publish_actor,
                        paper_id,
                        True,
                        2,
                    )
                    return "publish", 1
                except HTTPException as exc:
                    return "publish-conflict", exc.status_code

            tasks = [
                asyncio.create_task(compose(), name="compose-paper"),
                asyncio.create_task(publish(), name="publish-paper"),
            ]
            done, pending = await asyncio.wait(tasks, timeout=3)
            if pending:
                for task in tasks:
                    task.print_stack()
                for task in pending:
                    task.cancel()
                await asyncio.gather(*pending, return_exceptions=True)
                pytest.fail("concurrent paper mutations did not finish within 3 seconds")
            results = [task.result() for task in tasks]

        async with AsyncSessionLocal() as db:
            paper = await db.get(ExamPaper, paper_id)
            assert paper is not None
            reference_count = int(
                (
                    await db.execute(
                        select(func.count())
                        .select_from(PaperQuestion)
                        .where(PaperQuestion.paper_id == paper_id)
                    )
                ).scalar_one()
            )
            return {
                "results": results,
                "revision": paper.revision,
                "status": paper.status,
                "updatedBy": paper.updated_by,
                "referenceCount": reference_count,
            }

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            if paper_id:
                await db.execute(
                    delete(PaperQuestion).where(PaperQuestion.paper_id == paper_id)
                )
                await db.execute(delete(ExamPaper).where(ExamPaper.id == paper_id))
            if question_id:
                await db.execute(delete(Question).where(Question.id == question_id))
            if bank_id:
                await db.execute(delete(QuestionBank).where(QuestionBank.id == bank_id))
            await db.execute(
                delete(User).where(User.username.in_([teacher_a, teacher_b]))
            )
            await db.commit()

    asyncio.run(seed_users())
    try:
        with TestClient(app) as client:
            _login(client, teacher_b)
            bank = client.post(
                "/api/v1/banks",
                json={"name": "并发组卷题库", "subject": "PMP"},
            ).json()["bank"]
            bank_id = bank["id"]
            question = client.post(
                f"/api/v1/banks/{bank_id}/questions",
                json={
                    "title": "并发组卷题",
                    "domain": "并发领域",
                    "options": [{"id": "A", "text": "正确", "correct": True}],
                    "correctAnswer": "A",
                },
            ).json()["question"]
            question_id = question["id"]

            client.post("/api/v1/auth/logout")
            _login(client, teacher_a)
            paper = client.post(
                "/api/v1/papers",
                json={"name": "并发互斥试卷", "subject": "PMP"},
            ).json()["paper"]
            paper_id = paper["id"]
            seeded = client.post(
                f"/api/v1/papers/{paper_id}/compose",
                json={
                    "bankIds": [bank_id],
                    "quotas": {"并发领域": 1},
                    "revision": 1,
                },
            )
            assert seeded.status_code == 200
            assert seeded.json()["picked"] == 1

        result = asyncio.run(run_race())
        assert sorted(item[0] for item in result["results"]) in (
            ["compose", "publish-conflict"],
            ["compose-conflict", "publish"],
        )
        assert [item[1] for item in result["results"] if "conflict" in item[0]] == [409]
        assert result["revision"] == 3
        if result["results"][0][0] == "compose":
            assert result["status"] == "draft"
            assert result["updatedBy"] == teacher_b
            assert result["referenceCount"] == 1
        else:
            assert result["status"] == "published"
            assert result["updatedBy"] == "admin"
            assert result["referenceCount"] == 1
    finally:
        asyncio.run(cleanup())
