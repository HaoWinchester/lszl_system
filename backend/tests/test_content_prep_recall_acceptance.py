import asyncio
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.user import User
from app.services import recall_acceptance_service, runtime_state_service


PASSWORD = "recall-acceptance-pass"


def _record(identifier: str) -> dict:
    return {
        "id": identifier,
        "at": "2026-08-30T09:00:00.000Z",
        "type": "input",
        "source": "input",
        "query": identifier,
        "matchMode": "未命中",
        "nodeId": "",
        "nodeTitle": "",
        "autoStatus": "未命中",
        "candidateCount": 0,
        "firstChoices": [],
        "path": [],
        "manualVerdict": "",
        "note": "",
    }


async def _seed_users(*users: tuple[str, str]) -> None:
    async with AsyncSessionLocal() as db:
        db.add_all(
            User(
                username=username,
                password_hash=hash_password(PASSWORD),
                role=role,
                status="active",
                subject="PMP",
            )
            for username, role in users
        )
        await db.commit()


async def _cleanup_users(*usernames: str) -> None:
    async with AsyncSessionLocal() as db:
        await db.execute(delete(User).where(User.username.in_(usernames)))
        await db.commit()


def _login(client: TestClient, username: str) -> None:
    response = client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": PASSWORD},
    )
    assert response.status_code == 200, response.text


def test_recall_acceptance_records_require_prep_editor_and_are_owner_isolated() -> None:
    suffix = uuid4().hex[:10]
    teacher_a = f"recall-accept-a-{suffix}"
    teacher_b = f"recall-accept-b-{suffix}"
    viewer = f"recall-accept-viewer-{suffix}"
    asyncio.run(
        _seed_users(
            (teacher_a, "teacher"),
            (teacher_b, "teacher"),
            (viewer, "viewer"),
        )
    )
    try:
        with TestClient(app) as first, TestClient(app) as second, TestClient(app) as denied:
            assert first.get("/api/v1/content-prep/recall-acceptance-records").status_code == 401

            _login(denied, viewer)
            assert denied.get("/api/v1/content-prep/recall-acceptance-records").status_code == 403
            assert denied.put(
                "/api/v1/content-prep/recall-acceptance-records",
                json={"revision": 0, "records": [_record("viewer-record")]},
            ).status_code == 403

            _login(first, teacher_a)
            initial = first.get("/api/v1/content-prep/recall-acceptance-records")
            assert initial.status_code == 200
            assert initial.json() == {"revision": 0, "records": []}
            saved = first.put(
                "/api/v1/content-prep/recall-acceptance-records",
                json={"revision": 0, "records": [_record("teacher-a-record")]},
            )
            assert saved.status_code == 200, saved.text
            assert saved.json()["revision"] == 1

            _login(second, teacher_b)
            isolated = second.get("/api/v1/content-prep/recall-acceptance-records")
            assert isolated.status_code == 200
            assert isolated.json() == {"revision": 0, "records": []}
            second_saved = second.put(
                "/api/v1/content-prep/recall-acceptance-records",
                json={"revision": 0, "records": [_record("teacher-b-record")]},
            )
            assert second_saved.status_code == 200, second_saved.text

            assert first.get("/api/v1/content-prep/recall-acceptance-records").json()["records"] == [
                _record("teacher-a-record")
            ]
    finally:
        asyncio.run(_cleanup_users(teacher_a, teacher_b, viewer))


def test_recall_acceptance_records_are_revision_safe_bounded_and_cleared_by_api() -> None:
    teacher = f"recall-accept-revision-{uuid4().hex[:10]}"
    asyncio.run(_seed_users((teacher, "teacher")))
    try:
        with TestClient(app) as client:
            _login(client, teacher)
            records = [_record(f"record-{index}") for index in range(2001)]
            created = client.put(
                "/api/v1/content-prep/recall-acceptance-records",
                json={"revision": 0, "records": records},
            )
            assert created.status_code == 200, created.text
            assert created.json()["revision"] == 1
            assert len(created.json()["records"]) == 2000
            assert created.json()["records"][0]["id"] == "record-1"
            assert created.json()["records"][-1]["id"] == "record-2000"

            stale = client.put(
                "/api/v1/content-prep/recall-acceptance-records",
                json={"revision": 0, "records": [_record("stale")]},
            )
            assert stale.status_code == 409
            assert stale.json()["detail"] == {
                "code": "RECALL_ACCEPTANCE_REVISION_CONFLICT",
                "message": "验收记录已在其他会话更新，请刷新后重试",
                "currentRevision": 1,
            }

            invalid = client.put(
                "/api/v1/content-prep/recall-acceptance-records",
                json={
                    "revision": 1,
                    "records": [{**_record("invalid"), "candidateCount": "many"}],
                },
            )
            assert invalid.status_code == 422

            cleared = client.request(
                "DELETE",
                "/api/v1/content-prep/recall-acceptance-records",
                json={"revision": 1},
            )
            assert cleared.status_code == 200, cleared.text
            assert cleared.json()["revision"] == 2
            assert cleared.json()["records"] == []
            assert client.get("/api/v1/content-prep/recall-acceptance-records").json()["revision"] == 2

            stale_clear = client.request(
                "DELETE",
                "/api/v1/content-prep/recall-acceptance-records",
                json={"revision": 1},
            )
            assert stale_clear.status_code == 409
    finally:
        asyncio.run(_cleanup_users(teacher))


def test_recall_acceptance_runtime_key_is_migration_only() -> None:
    key = recall_acceptance_service.RUNTIME_SOURCE_KEY

    assert key in runtime_state_service.EXACT_KEYS
    assert key not in runtime_state_service.ONLINE_RUNTIME_EXACT_KEYS
    assert key in runtime_state_service.RUNTIME_SNAPSHOT_EXCLUDED_KEYS
    assert runtime_state_service.server_owned_key(key)
    for page in (
        "content-prep.html",
        "question-bank.html",
        "question-training.html",
        "question-workspace.html",
        "knowledge-recall.html",
    ):
        exact, _prefixes = runtime_state_service._bootstrap_selector_tokens(
            "teacher",
            "teacher",
            page,
        )
        assert key not in exact, page
