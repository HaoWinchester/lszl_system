from __future__ import annotations

import asyncio
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest
from pydantic import ValidationError
from sqlalchemy import delete, text
from sqlalchemy.exc import IntegrityError

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.course_management import LearningTask
from app.models.user import User
from app.schemas.course_management import (
    MAX_JSON_BYTES,
    CourseDraftCreate,
)
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


def test_public_create_rejects_client_ids_without_leaking_global_occupancy() -> None:
    suffix = uuid4().hex[:10]
    teacher = f"course-server-id-{suffix}"
    bad_id = f"bad/id-{suffix}"
    asyncio.run(_seed_users((teacher, "teacher")))
    try:
        with TestClient(app) as client:
            _login(client, teacher)

            revision_before_draft = client.get(
                "/api/v1/question-catalog/revision"
            ).json()["revision"]
            rejected_draft = client.post(
                "/api/v1/course-management/drafts",
                json={"id": bad_id, "name": "不允许指定 ID", "structure": {}},
            )
            assert rejected_draft.status_code == 422, rejected_draft.text
            assert rejected_draft.json()["detail"] == [
                {
                    "type": "extra_forbidden",
                    "loc": ["body", "id"],
                    "msg": "Extra inputs are not permitted",
                    "input": bad_id,
                }
            ]
            assert client.get(
                "/api/v1/question-catalog/revision"
            ).json()["revision"] == revision_before_draft

            draft = _create_draft(client)
            release = client.post(
                f"/api/v1/course-management/drafts/{draft['id']}/publish",
                json={"revision": draft["revision"]},
            ).json()["release"]
            revision_before_task = client.get(
                "/api/v1/question-catalog/revision"
            ).json()["revision"]
            rejected_task = client.post(
                "/api/v1/course-management/tasks",
                json={
                    "id": bad_id,
                    "title": "不允许指定 ID",
                    "releaseId": release["id"],
                    "audience": {},
                },
            )
            assert rejected_task.status_code == 422, rejected_task.text
            assert client.get(
                "/api/v1/question-catalog/revision"
            ).json()["revision"] == revision_before_task

        async def assert_bad_id_absent() -> None:
            async with AsyncSessionLocal() as db:
                assert await db.scalar(
                    text("SELECT count(*) FROM course_drafts WHERE id = :id"),
                    {"id": bad_id},
                ) == 0
                assert await db.scalar(
                    text("SELECT count(*) FROM learning_tasks WHERE id = :id"),
                    {"id": bad_id},
                ) == 0

        asyncio.run(assert_bad_id_absent())
    finally:
        asyncio.run(_cleanup_users(teacher))


def test_non_finite_course_json_returns_safe_422_without_mutation() -> None:
    suffix = uuid4().hex[:10]
    teacher = f"course-finite-{suffix}"
    asyncio.run(_seed_users((teacher, "teacher")))
    try:
        with TestClient(app, raise_server_exceptions=False) as client:
            _login(client, teacher)

            initial_revision = client.get(
                "/api/v1/question-catalog/revision"
            ).json()["revision"]
            rejected_create = client.post(
                "/api/v1/course-management/drafts",
                content='{"name":"NaN draft","structure":{"score":NaN}}',
                headers={"content-type": "application/json"},
            )
            assert rejected_create.status_code == 422, rejected_create.text
            assert "INSERT INTO" not in rejected_create.text
            assert "parameters" not in rejected_create.text
            finite_error = rejected_create.json()["detail"][0]
            assert finite_error["loc"] == ["body", "structure"]
            assert finite_error["type"] == "value_error"
            assert finite_error["input"]["score"] == "non-finite number"
            assert client.get(
                "/api/v1/question-catalog/revision"
            ).json()["revision"] == initial_revision
            assert client.get(
                "/api/v1/course-management/drafts"
            ).json()["drafts"] == []

            draft = _create_draft(client)
            release = client.post(
                f"/api/v1/course-management/drafts/{draft['id']}/publish",
                json={"revision": draft["revision"]},
            ).json()["release"]
            revision_before_task_create = client.get(
                "/api/v1/question-catalog/revision"
            ).json()["revision"]
            rejected_task_create = client.post(
                "/api/v1/course-management/tasks",
                content=(
                    '{"title":"Infinity task","releaseId":"'
                    + release["id"]
                    + '","audience":{"score":Infinity},"content":{}}'
                ),
                headers={"content-type": "application/json"},
            )
            assert rejected_task_create.status_code == 422, rejected_task_create.text
            assert "INSERT INTO" not in rejected_task_create.text
            assert "parameters" not in rejected_task_create.text
            assert client.get(
                "/api/v1/question-catalog/revision"
            ).json()["revision"] == revision_before_task_create
            assert client.get(
                "/api/v1/course-management/tasks"
            ).json()["tasks"] == []

            task = client.post(
                "/api/v1/course-management/tasks",
                json={
                    "title": "finite task",
                    "releaseId": release["id"],
                    "audience": {},
                    "content": {},
                },
            ).json()["task"]
            revision_before_updates = client.get(
                "/api/v1/question-catalog/revision"
            ).json()["revision"]
            rejected_draft_update = client.put(
                f"/api/v1/course-management/drafts/{draft['id']}",
                content=(
                    '{"revision":'
                    + str(draft["revision"] + 1)
                    + ',"structure":{"score":-Infinity}}'
                ),
                headers={"content-type": "application/json"},
            )
            rejected_task_update = client.put(
                f"/api/v1/course-management/tasks/{task['id']}",
                content=(
                    '{"revision":'
                    + str(task["revision"])
                    + ',"content":{"score":NaN}}'
                ),
                headers={"content-type": "application/json"},
            )
            assert rejected_draft_update.status_code == 422, rejected_draft_update.text
            assert rejected_task_update.status_code == 422, rejected_task_update.text
            for rejected_update in (rejected_draft_update, rejected_task_update):
                assert "UPDATE " not in rejected_update.text
                assert "parameters" not in rejected_update.text
            assert client.get(
                "/api/v1/question-catalog/revision"
            ).json()["revision"] == revision_before_updates
            assert client.get(
                f"/api/v1/course-management/drafts/{draft['id']}"
            ).json()["draft"]["structure"] == draft["structure"]
            assert client.get(
                f"/api/v1/course-management/tasks/{task['id']}"
            ).json()["task"]["content"] == {}
    finally:
        asyncio.run(_cleanup_users(teacher))


def test_course_json_size_limit_accepts_boundary_and_rejects_one_byte_over() -> None:
    exact_payload = {"blob": "x" * (MAX_JSON_BYTES - 11)}
    assert CourseDraftCreate(name="boundary", structure=exact_payload).structure == exact_payload
    with pytest.raises(ValidationError):
        CourseDraftCreate(
            name="over",
            structure={"blob": "x" * (MAX_JSON_BYTES - 10)},
        )


def test_admin_mutations_succeed_while_viewer_mutations_are_denied() -> None:
    suffix = uuid4().hex[:10]
    admin = f"course-admin-{suffix}"
    viewer = f"course-viewer-{suffix}"
    asyncio.run(_seed_users((admin, "admin"), (viewer, "viewer")))
    try:
        with TestClient(app) as admin_client:
            _login(admin_client, admin)
            draft = _create_draft(admin_client, name="管理员课程")
            updated_draft_response = admin_client.put(
                f"/api/v1/course-management/drafts/{draft['id']}",
                json={"revision": draft["revision"], "name": "管理员课程 v2"},
            )
            assert updated_draft_response.status_code == 200
            draft = updated_draft_response.json()["draft"]
            publish_response = admin_client.post(
                f"/api/v1/course-management/drafts/{draft['id']}/publish",
                json={"revision": draft["revision"]},
            )
            assert publish_response.status_code == 200
            draft = publish_response.json()["draft"]
            release = publish_response.json()["release"]
            task_response = admin_client.post(
                "/api/v1/course-management/tasks",
                json={
                    "title": "管理员任务",
                    "releaseId": release["id"],
                    "audience": {},
                },
            )
            assert task_response.status_code == 200
            task = task_response.json()["task"]
            updated_task_response = admin_client.put(
                f"/api/v1/course-management/tasks/{task['id']}",
                json={"revision": task["revision"], "status": "published"},
            )
            assert updated_task_response.status_code == 200
            task = updated_task_response.json()["task"]

        with TestClient(app) as viewer_client:
            _login(viewer_client, viewer)
            denied_mutations = (
                (
                    "POST",
                    "/api/v1/course-management/drafts",
                    {"name": "越权", "structure": {}},
                ),
                (
                    "PUT",
                    f"/api/v1/course-management/drafts/{draft['id']}",
                    {"revision": draft["revision"], "name": "越权"},
                ),
                (
                    "DELETE",
                    f"/api/v1/course-management/drafts/{draft['id']}",
                    {"revision": draft["revision"]},
                ),
                (
                    "POST",
                    f"/api/v1/course-management/drafts/{draft['id']}/publish",
                    {"revision": draft["revision"]},
                ),
                (
                    "POST",
                    "/api/v1/course-management/tasks",
                    {"title": "越权", "releaseId": release["id"]},
                ),
                (
                    "PUT",
                    f"/api/v1/course-management/tasks/{task['id']}",
                    {"revision": task["revision"], "title": "越权"},
                ),
                (
                    "DELETE",
                    f"/api/v1/course-management/tasks/{task['id']}",
                    {"revision": task["revision"]},
                ),
                (
                    "POST",
                    f"/api/v1/course-management/releases/{release['id']}/withdraw",
                    {"revision": release["revision"]},
                ),
            )
            for method, path, payload in denied_mutations:
                response = viewer_client.request(method, path, json=payload)
                assert response.status_code == 403, (method, path, response.text)

        with TestClient(app) as admin_client:
            _login(admin_client, admin)
            deleted_task = admin_client.request(
                "DELETE",
                f"/api/v1/course-management/tasks/{task['id']}",
                json={"revision": task["revision"]},
            )
            assert deleted_task.status_code == 200
            withdrawn = admin_client.post(
                f"/api/v1/course-management/releases/{release['id']}/withdraw",
                json={"revision": release["revision"]},
            )
            assert withdrawn.status_code == 200
            deleted_draft = admin_client.request(
                "DELETE",
                f"/api/v1/course-management/drafts/{draft['id']}",
                json={"revision": draft["revision"]},
            )
            assert deleted_draft.status_code == 200
    finally:
        asyncio.run(_cleanup_users(admin, viewer))


def test_stale_course_mutations_preserve_rows_and_shared_revision() -> None:
    suffix = uuid4().hex[:10]
    teacher = f"course-stale-effects-{suffix}"
    asyncio.run(_seed_users((teacher, "teacher")))
    try:
        with TestClient(app) as client:
            _login(client, teacher)

            def shared_revision() -> int:
                return client.get("/api/v1/question-catalog/revision").json()["revision"]

            draft = _create_draft(client)
            updated = client.put(
                f"/api/v1/course-management/drafts/{draft['id']}",
                json={"revision": draft["revision"], "name": "当前版本"},
            ).json()["draft"]
            before_stale_draft = shared_revision()
            for method, suffix_path in (("POST", "/publish"), ("DELETE", "")):
                response = client.request(
                    method,
                    f"/api/v1/course-management/drafts/{updated['id']}{suffix_path}",
                    json={"revision": draft["revision"]},
                )
                assert response.status_code == 409, response.text
            assert shared_revision() == before_stale_draft
            assert client.get(
                f"/api/v1/course-management/drafts/{updated['id']}"
            ).json()["draft"] == updated
            assert client.get(
                "/api/v1/course-management/releases"
            ).json()["releases"] == []

            published = client.post(
                f"/api/v1/course-management/drafts/{updated['id']}/publish",
                json={"revision": updated["revision"]},
            ).json()
            release = published["release"]
            task = client.post(
                "/api/v1/course-management/tasks",
                json={"title": "并发删除任务", "releaseId": release["id"]},
            ).json()["task"]
            current_task = client.put(
                f"/api/v1/course-management/tasks/{task['id']}",
                json={"revision": task["revision"], "description": "当前描述"},
            ).json()["task"]
            before_stale_task = shared_revision()
            stale_task_delete = client.request(
                "DELETE",
                f"/api/v1/course-management/tasks/{task['id']}",
                json={"revision": task["revision"]},
            )
            assert stale_task_delete.status_code == 409
            assert shared_revision() == before_stale_task
            assert client.get(
                f"/api/v1/course-management/tasks/{task['id']}"
            ).json()["task"] == current_task

            current_release = client.post(
                f"/api/v1/course-management/releases/{release['id']}/withdraw",
                json={"revision": release["revision"]},
            ).json()["release"]
            before_stale_withdraw = shared_revision()
            stale_withdraw = client.post(
                f"/api/v1/course-management/releases/{release['id']}/withdraw",
                json={"revision": release["revision"]},
            )
            assert stale_withdraw.status_code == 409
            assert shared_revision() == before_stale_withdraw
            assert client.get(
                f"/api/v1/course-management/releases/{release['id']}"
            ).json()["release"] == current_release
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

        async def fail_transaction() -> None:
            async with AsyncSessionLocal() as db:
                actor = await db.get(User, teacher)
                assert actor is not None
                task_count_before = await db.scalar(
                    text("SELECT count(*) FROM learning_tasks WHERE owner_id = :owner_id"),
                    {"owner_id": teacher},
                )
                with pytest.raises(IntegrityError):
                    await course_management_service.create_task(
                        db,
                        actor,
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
                    text("SELECT count(*) FROM learning_tasks WHERE owner_id = :owner_id"),
                    {"owner_id": teacher},
                )
                assert revision_after == revision_before
                assert task_count == task_count_before

        asyncio.run(fail_transaction())
    finally:
        asyncio.run(_cleanup_users(teacher))
