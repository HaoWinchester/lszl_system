from __future__ import annotations

import asyncio
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import delete, text
from sqlalchemy.exc import IntegrityError

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.course_management import LearningTask
from app.models.user import User
from app.services import course_management_service


PASSWORD = "course-management-pass"


async def _seed_users(*users: tuple[str, str]) -> None:
    async with AsyncSessionLocal() as db:
        password_hash = hash_password(PASSWORD)
        db.add_all(
            User(
                username=username,
                password_hash=password_hash,
                role=role,
                status="active",
            )
            for username, role in users
        )
        await db.commit()


async def _cleanup_users(*usernames: str) -> None:
    async with AsyncSessionLocal() as db:
        if await db.scalar(text("SELECT to_regclass('public.learning_tasks')")):
            await db.execute(
                text("DELETE FROM learning_tasks WHERE owner_id = ANY(:owners)"),
                {"owners": list(usernames)},
            )
            await db.execute(
                text("DELETE FROM course_releases WHERE owner_id = ANY(:owners)"),
                {"owners": list(usernames)},
            )
            await db.execute(
                text("DELETE FROM course_drafts WHERE owner_id = ANY(:owners)"),
                {"owners": list(usernames)},
            )
        await db.execute(delete(User).where(User.username.in_(usernames)))
        await db.commit()


def _login(client: TestClient, username: str) -> None:
    response = client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": PASSWORD},
    )
    assert response.status_code == 200, response.text


def _create_draft(client: TestClient, *, name: str = "PMP 课程") -> dict:
    response = client.post(
        "/api/v1/course-management/drafts",
        json={
            "name": name,
            "structure": {
                "subjectId": "subject-pmp",
                "taxonomyId": "taxonomy-pmp-main",
                "stages": [{"id": "stage-1", "title": "启动", "order": 1}],
                "parts": [{"id": "part-1", "stageId": "stage-1", "title": "基础", "order": 1}],
                "nodes": [
                    {
                        "id": "node-1",
                        "partId": "part-1",
                        "title": "第一节",
                        "activityIds": ["activity-1"],
                        "settings": {"required": True},
                    }
                ],
                "extension": {"futureField": [1, {"nested": True}]},
            },
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["draft"]


def test_course_draft_publish_and_task_lifecycle() -> None:
    suffix = uuid4().hex[:10]
    teacher = f"course-teacher-{suffix}"
    asyncio.run(_seed_users((teacher, "teacher")))
    try:
        with TestClient(app) as client:
            _login(client, teacher)
            draft = _create_draft(client)
            assert draft["ownerId"] == teacher
            assert draft["revision"] == 1

            published = client.post(
                f"/api/v1/course-management/drafts/{draft['id']}/publish",
                json={"revision": draft["revision"], "notes": "UAT 首发"},
            )
            assert published.status_code == 200, published.text
            release = published.json()["release"]
            assert release["courseId"] == draft["id"]
            assert release["sourceDraftRevision"] == 1
            assert release["version"] == 1
            assert release["status"] == "published"
            assert release["notes"] == "UAT 首发"
            assert release["course"]["extension"] == {
                "futureField": [1, {"nested": True}]
            }
            assert release["course"]["nodes"][0]["settings"] == {"required": True}

            created = client.post(
                "/api/v1/course-management/tasks",
                json={
                    "title": "第一阶段",
                    "releaseId": release["id"],
                    "audience": {"roles": ["student"], "cohorts": ["uat"]},
                    "content": {
                        "type": "deep_recall",
                        "sourceActivityIds": ["activity-1"],
                        "config": {"keywordAnnotations": [{"id": "k1"}]},
                    },
                },
            )
            assert created.status_code == 200, created.text
            task = created.json()["task"]
            assert task["releaseId"] == release["id"]
            assert task["audience"] == {"roles": ["student"], "cohorts": ["uat"]}
            assert task["content"]["config"] == {"keywordAnnotations": [{"id": "k1"}]}

            updated = client.put(
                f"/api/v1/course-management/tasks/{task['id']}",
                json={
                    "revision": task["revision"],
                    "title": "第一阶段（已发布）",
                    "status": "published",
                },
            )
            assert updated.status_code == 200, updated.text
            task = updated.json()["task"]
            assert task["title"] == "第一阶段（已发布）"
            assert task["status"] == "published"
            assert task["revision"] == 2

            deleted = client.request(
                "DELETE",
                f"/api/v1/course-management/tasks/{task['id']}",
                json={"revision": task["revision"]},
            )
            assert deleted.status_code == 200, deleted.text
            assert deleted.json() == {"deletedId": task["id"]}
            assert client.get(
                f"/api/v1/course-management/tasks/{task['id']}"
            ).status_code == 404
    finally:
        asyncio.run(_cleanup_users(teacher))


def test_course_draft_rejects_stale_revision() -> None:
    suffix = uuid4().hex[:10]
    teacher = f"course-stale-{suffix}"
    asyncio.run(_seed_users((teacher, "teacher")))
    try:
        with TestClient(app) as client:
            _login(client, teacher)
            draft = _create_draft(client)
            updated = client.put(
                f"/api/v1/course-management/drafts/{draft['id']}",
                json={"revision": draft["revision"], "name": "PMP v2"},
            )
            assert updated.status_code == 200, updated.text

            stale = client.put(
                f"/api/v1/course-management/drafts/{draft['id']}",
                json={"revision": draft["revision"], "name": "stale"},
            )
            assert stale.status_code == 409
            assert stale.json()["detail"]["code"] == "REVISION_CONFLICT"
            assert stale.json()["detail"]["currentRevision"] == 2
    finally:
        asyncio.run(_cleanup_users(teacher))


def test_release_versions_are_monotonic_immutable_and_survive_draft_deletion() -> None:
    suffix = uuid4().hex[:10]
    teacher = f"course-release-{suffix}"
    asyncio.run(_seed_users((teacher, "teacher")))
    try:
        with TestClient(app) as client:
            _login(client, teacher)
            draft = _create_draft(client, name="可删除草稿")
            first_publish = client.post(
                f"/api/v1/course-management/drafts/{draft['id']}/publish",
                json={"revision": draft["revision"], "notes": "v1"},
            )
            assert first_publish.status_code == 200, first_publish.text
            first = first_publish.json()["release"]
            draft_after_first = first_publish.json()["draft"]

            changed_structure = {
                **draft["structure"],
                "nodes": [
                    {
                        **draft["structure"]["nodes"][0],
                        "title": "第二版节点",
                        "settings": {"required": False, "durationMinutes": 15},
                    }
                ],
                "extension": {"futureField": [2, {"nested": False}]},
            }
            updated = client.put(
                f"/api/v1/course-management/drafts/{draft['id']}",
                json={
                    "revision": draft_after_first["revision"],
                    "name": "可删除草稿 v2",
                    "structure": changed_structure,
                },
            )
            assert updated.status_code == 200, updated.text
            updated_draft = updated.json()["draft"]

            second_publish = client.post(
                f"/api/v1/course-management/drafts/{draft['id']}/publish",
                json={"revision": updated_draft["revision"], "notes": "v2"},
            )
            assert second_publish.status_code == 200, second_publish.text
            second = second_publish.json()["release"]
            latest_draft = second_publish.json()["draft"]
            assert (first["version"], second["version"]) == (1, 2)
            assert first["contentHash"] != second["contentHash"]

            frozen_first = client.get(
                f"/api/v1/course-management/releases/{first['id']}"
            )
            assert frozen_first.status_code == 200, frozen_first.text
            frozen_first_release = frozen_first.json()["release"]
            assert frozen_first_release["status"] == "superseded"
            assert frozen_first_release["revision"] == 2
            assert frozen_first_release["course"]["nodes"][0]["title"] == "第一节"
            assert frozen_first_release["course"]["extension"] == {
                "futureField": [1, {"nested": True}]
            }

            deleted = client.request(
                "DELETE",
                f"/api/v1/course-management/drafts/{draft['id']}",
                json={"revision": latest_draft["revision"]},
            )
            assert deleted.status_code == 200, deleted.text
            assert client.get(
                f"/api/v1/course-management/drafts/{draft['id']}"
            ).status_code == 404
            assert client.get(
                f"/api/v1/course-management/releases/{first['id']}"
            ).status_code == 200
            assert client.get(
                f"/api/v1/course-management/releases/{second['id']}"
            ).status_code == 200

            withdrawn = client.post(
                f"/api/v1/course-management/releases/{second['id']}/withdraw",
                json={"revision": second["revision"]},
            )
            assert withdrawn.status_code == 200, withdrawn.text
            assert withdrawn.json()["release"]["status"] == "withdrawn"
            assert withdrawn.json()["release"]["revision"] == 2

            stale_withdraw = client.post(
                f"/api/v1/course-management/releases/{second['id']}/withdraw",
                json={"revision": second["revision"]},
            )
            assert stale_withdraw.status_code == 409
            assert stale_withdraw.json()["detail"]["currentRevision"] == 2
    finally:
        asyncio.run(_cleanup_users(teacher))


def test_course_management_enforces_permissions_owner_and_release_owner() -> None:
    suffix = uuid4().hex[:10]
    first_teacher = f"course-owner-a-{suffix}"
    second_teacher = f"course-owner-b-{suffix}"
    student = f"course-student-{suffix}"
    asyncio.run(
        _seed_users(
            (first_teacher, "teacher"),
            (second_teacher, "teacher"),
            (student, "student"),
        )
    )
    try:
        with TestClient(app) as first:
            _login(first, first_teacher)
            draft = _create_draft(first, name="A 的课程")
            published = first.post(
                f"/api/v1/course-management/drafts/{draft['id']}/publish",
                json={"revision": draft["revision"]},
            )
            assert published.status_code == 200, published.text
            release = published.json()["release"]

        with TestClient(app) as second:
            _login(second, second_teacher)
            assert second.get(
                f"/api/v1/course-management/drafts/{draft['id']}"
            ).status_code == 404
            assert second.get(
                f"/api/v1/course-management/releases/{release['id']}"
            ).status_code == 404
            assert all(
                item["id"] != draft["id"]
                for item in second.get(
                    "/api/v1/course-management/drafts"
                ).json()["drafts"]
            )
            assert all(
                item["id"] != release["id"]
                for item in second.get(
                    "/api/v1/course-management/releases"
                ).json()["releases"]
            )
            cross_owner_task = second.post(
                "/api/v1/course-management/tasks",
                json={
                    "title": "不应引用 A 的 release",
                    "releaseId": release["id"],
                    "audience": {"roles": ["student"]},
                },
            )
            assert cross_owner_task.status_code == 404

        with TestClient(app) as learner:
            _login(learner, student)
            assert learner.get("/api/v1/course-management/drafts").status_code == 403
            assert learner.get("/api/v1/course-management/releases").status_code == 403
            assert learner.get("/api/v1/course-management/tasks").status_code == 403
            assert learner.post(
                "/api/v1/course-management/drafts",
                json={"name": "越权", "structure": {}},
            ).status_code == 403
    finally:
        asyncio.run(_cleanup_users(first_teacher, second_teacher, student))


def test_learning_task_rejects_stale_revision_and_invalid_status() -> None:
    suffix = uuid4().hex[:10]
    teacher = f"course-task-stale-{suffix}"
    asyncio.run(_seed_users((teacher, "teacher")))
    try:
        with TestClient(app) as client:
            _login(client, teacher)
            draft = _create_draft(client)
            release = client.post(
                f"/api/v1/course-management/drafts/{draft['id']}/publish",
                json={"revision": draft["revision"]},
            ).json()["release"]
            created = client.post(
                "/api/v1/course-management/tasks",
                json={
                    "title": "并发任务",
                    "releaseId": release["id"],
                    "audience": {"roles": ["student"]},
                    "content": {"legacySource": {"kind": "canvas-workspace"}},
                },
            )
            assert created.status_code == 200, created.text
            task = created.json()["task"]

            updated = client.put(
                f"/api/v1/course-management/tasks/{task['id']}",
                json={"revision": task["revision"], "description": "新描述"},
            )
            assert updated.status_code == 200, updated.text
            assert updated.json()["task"]["content"] == task["content"]

            stale = client.put(
                f"/api/v1/course-management/tasks/{task['id']}",
                json={"revision": task["revision"], "title": "stale"},
            )
            assert stale.status_code == 409
            assert stale.json()["detail"]["currentRevision"] == 2

            invalid = client.put(
                f"/api/v1/course-management/tasks/{task['id']}",
                json={"revision": 2, "status": "removed"},
            )
            assert invalid.status_code == 422

            stale_delete = client.request(
                "DELETE",
                f"/api/v1/course-management/tasks/{task['id']}",
                json={"revision": task["revision"]},
            )
            assert stale_delete.status_code == 409
    finally:
        asyncio.run(_cleanup_users(teacher))


def test_concurrent_publish_accepts_one_revision_and_creates_one_version() -> None:
    suffix = uuid4().hex[:10]
    teacher = f"course-publish-race-{suffix}"
    asyncio.run(_seed_users((teacher, "teacher")))
    try:
        with TestClient(app) as client:
            _login(client, teacher)
            draft = _create_draft(client)
            revision_before_publish = client.get(
                "/api/v1/question-catalog/revision"
            ).json()["revision"]

        async def publish_pair() -> list[object]:
            async with AsyncSessionLocal() as first_db, AsyncSessionLocal() as second_db:
                first_actor = await first_db.get(User, teacher)
                second_actor = await second_db.get(User, teacher)
                assert first_actor is not None and second_actor is not None

                async def publish_once(db, actor, notes: str) -> object:
                    try:
                        return await course_management_service.publish_draft(
                            db,
                            actor,
                            draft["id"],
                            expected_revision=draft["revision"],
                            notes=notes,
                        )
                    except course_management_service.CourseManagementError as error:
                        return error

                return list(
                    await asyncio.gather(
                        publish_once(first_db, first_actor, "race-a"),
                        publish_once(second_db, second_actor, "race-b"),
                    )
                )

        results = asyncio.run(publish_pair())
        successes = [item for item in results if isinstance(item, tuple)]
        conflicts = [
            item
            for item in results
            if isinstance(item, course_management_service.CourseManagementError)
        ]
        assert len(successes) == 1
        assert len(conflicts) == 1
        assert conflicts[0].status_code == 409
        assert conflicts[0].code == "REVISION_CONFLICT"
        assert conflicts[0].current_revision == 2

        with TestClient(app) as client:
            _login(client, teacher)
            releases = client.get("/api/v1/course-management/releases").json()["releases"]
            owned = [item for item in releases if item["courseId"] == draft["id"]]
            assert len(owned) == 1
            assert owned[0]["version"] == 1
            assert owned[0]["status"] == "published"
            assert client.get(
                "/api/v1/question-catalog/revision"
            ).json()["revision"] == revision_before_publish + 1
    finally:
        asyncio.run(_cleanup_users(teacher))


def test_database_rejects_cross_owner_release_references_and_invalid_task_status() -> None:
    suffix = uuid4().hex[:10]
    first_teacher = f"course-db-owner-a-{suffix}"
    second_teacher = f"course-db-owner-b-{suffix}"
    asyncio.run(_seed_users((first_teacher, "teacher"), (second_teacher, "teacher")))
    try:
        with TestClient(app) as client:
            _login(client, first_teacher)
            draft = _create_draft(client)
            release = client.post(
                f"/api/v1/course-management/drafts/{draft['id']}/publish",
                json={"revision": draft["revision"]},
            ).json()["release"]

        async def attempt_invalid_rows() -> None:
            async with AsyncSessionLocal() as db:
                db.add(
                    LearningTask(
                        id=f"cross-owner-task-{suffix}",
                        owner_id=second_teacher,
                        release_id=release["id"],
                        title="跨 owner 引用",
                        audience={},
                        content={},
                        status="draft",
                        revision=1,
                        created_by=second_teacher,
                        updated_by=second_teacher,
                    )
                )
                with pytest.raises(IntegrityError):
                    await db.commit()
                await db.rollback()

                db.add(
                    LearningTask(
                        id=f"invalid-status-task-{suffix}",
                        owner_id=first_teacher,
                        release_id=release["id"],
                        title="非法状态",
                        audience={},
                        content={},
                        status="removed",
                        revision=1,
                        created_by=first_teacher,
                        updated_by=first_teacher,
                    )
                )
                with pytest.raises(IntegrityError):
                    await db.commit()
                await db.rollback()

        asyncio.run(attempt_invalid_rows())
    finally:
        asyncio.run(_cleanup_users(first_teacher, second_teacher))


def test_mutable_course_json_fields_reject_explicit_null() -> None:
    suffix = uuid4().hex[:10]
    teacher = f"course-null-{suffix}"
    asyncio.run(_seed_users((teacher, "teacher")))
    try:
        with TestClient(app, raise_server_exceptions=False) as client:
            _login(client, teacher)
            draft = _create_draft(client)
            before_null_structure = client.get(
                "/api/v1/question-catalog/revision"
            ).json()["revision"]
            null_structure = client.put(
                f"/api/v1/course-management/drafts/{draft['id']}",
                json={"revision": draft["revision"], "structure": None},
            )
            assert null_structure.status_code == 422, null_structure.text
            assert client.get(
                "/api/v1/question-catalog/revision"
            ).json()["revision"] == before_null_structure

            release = client.post(
                f"/api/v1/course-management/drafts/{draft['id']}/publish",
                json={"revision": draft["revision"]},
            ).json()["release"]
            task = client.post(
                "/api/v1/course-management/tasks",
                json={
                    "title": "null 边界",
                    "releaseId": release["id"],
                    "audience": {},
                    "content": {},
                },
            ).json()["task"]
            before_null_content = client.get(
                "/api/v1/question-catalog/revision"
            ).json()["revision"]
            null_content = client.put(
                f"/api/v1/course-management/tasks/{task['id']}",
                json={"revision": task["revision"], "content": None},
            )
            assert null_content.status_code == 422, null_content.text
            assert client.get(
                "/api/v1/question-catalog/revision"
            ).json()["revision"] == before_null_content
    finally:
        asyncio.run(_cleanup_users(teacher))


def test_successful_course_writes_bump_the_shared_content_revision_once() -> None:
    suffix = uuid4().hex[:10]
    teacher = f"course-content-revision-{suffix}"
    asyncio.run(_seed_users((teacher, "teacher")))
    try:
        with TestClient(app) as client:
            _login(client, teacher)

            def revision() -> int:
                response = client.get("/api/v1/question-catalog/revision")
                assert response.status_code == 200, response.text
                return response.json()["revision"]

            def assert_one_bump(before: int) -> int:
                after = revision()
                assert after == before + 1
                return after

            current = revision()
            draft = _create_draft(client)
            current = assert_one_bump(current)

            updated = client.put(
                f"/api/v1/course-management/drafts/{draft['id']}",
                json={"revision": draft["revision"], "name": "revision v2"},
            )
            assert updated.status_code == 200, updated.text
            draft = updated.json()["draft"]
            current = assert_one_bump(current)

            stale = client.put(
                f"/api/v1/course-management/drafts/{draft['id']}",
                json={"revision": 1, "name": "stale"},
            )
            assert stale.status_code == 409
            assert revision() == current

            published = client.post(
                f"/api/v1/course-management/drafts/{draft['id']}/publish",
                json={"revision": draft["revision"]},
            )
            assert published.status_code == 200, published.text
            release = published.json()["release"]
            draft = published.json()["draft"]
            current = assert_one_bump(current)

            created_task = client.post(
                "/api/v1/course-management/tasks",
                json={
                    "title": "revision task",
                    "releaseId": release["id"],
                    "audience": {"roles": ["student"]},
                },
            )
            assert created_task.status_code == 200, created_task.text
            task = created_task.json()["task"]
            current = assert_one_bump(current)

            updated_task = client.put(
                f"/api/v1/course-management/tasks/{task['id']}",
                json={"revision": task["revision"], "status": "published"},
            )
            assert updated_task.status_code == 200, updated_task.text
            task = updated_task.json()["task"]
            current = assert_one_bump(current)

            deleted_task = client.request(
                "DELETE",
                f"/api/v1/course-management/tasks/{task['id']}",
                json={"revision": task["revision"]},
            )
            assert deleted_task.status_code == 200, deleted_task.text
            current = assert_one_bump(current)

            withdrawn = client.post(
                f"/api/v1/course-management/releases/{release['id']}/withdraw",
                json={"revision": release["revision"]},
            )
            assert withdrawn.status_code == 200, withdrawn.text
            current = assert_one_bump(current)

            deleted_draft = client.request(
                "DELETE",
                f"/api/v1/course-management/drafts/{draft['id']}",
                json={"revision": draft["revision"]},
            )
            assert deleted_draft.status_code == 200, deleted_draft.text
            assert_one_bump(current)
    finally:
        asyncio.run(_cleanup_users(teacher))


def test_failed_course_transaction_rolls_back_the_shared_content_revision() -> None:
    suffix = uuid4().hex[:10]
    teacher = f"course-rollback-{suffix}"
    asyncio.run(_seed_users((teacher, "teacher")))
    try:
        with TestClient(app) as client:
            _login(client, teacher)
            draft = _create_draft(client)
            release = client.post(
                f"/api/v1/course-management/drafts/{draft['id']}/publish",
                json={"revision": draft["revision"]},
            ).json()["release"]
            revision_before = client.get(
                "/api/v1/question-catalog/revision"
            ).json()["revision"]

        invalid_task_id = f"rollback-task-{suffix}"

        async def fail_transaction() -> None:
            async with AsyncSessionLocal() as db:
                actor = await db.get(User, teacher)
                assert actor is not None
                with pytest.raises(IntegrityError):
                    await course_management_service.create_task(
                        db,
                        actor,
                        task_id=invalid_task_id,
                        release_id=release["id"],
                        title="不能提交的任务",
                        description="",
                        audience={},
                        content={},
                        status="removed",
                    )
                await db.rollback()

            async with AsyncSessionLocal() as verify_db:
                revision_after = await verify_db.scalar(
                    text(
                        "SELECT revision FROM teaching_content_revisions WHERE id = 1"
                    )
                )
                task_count = await verify_db.scalar(
                    text("SELECT count(*) FROM learning_tasks WHERE id = :task_id"),
                    {"task_id": invalid_task_id},
                )
                assert revision_after == revision_before
                assert task_count == 0

        asyncio.run(fail_transaction())
    finally:
        asyncio.run(_cleanup_users(teacher))
