import asyncio
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from threading import Barrier
from urllib.parse import quote
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select, update as sql_update

from app.core.config import settings
from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.runtime_state import RuntimeState
from app.models.shared_runtime_state import SharedRuntimeState
from app.models.subscription import Subscription
from app.models.user import User
from app.services import runtime_state_service as service
from app.services import teaching_content_revision_service as revision_service
from app.web.schemas import RuntimeMutation, RuntimeStateUpdate


def update(*, storage: dict[str, str], mutations: list[RuntimeMutation]) -> RuntimeStateUpdate:
    last = mutations[-1]
    return RuntimeStateUpdate(
        page="question-bank.html",
        namespace="questions",
        operation=last.operation,
        key=last.key,
        value=last.value,
        storage=storage,
        snapshotMode="full",
        mutations=mutations,
        requestId="pytest-shared-policy",
        revision=0,
    )


def test_students_cannot_write_teacher_published_catalogs() -> None:
    assert service.shared_key_writable("kg_exam_papers_published_v1", "teacher")
    assert service.shared_key_writable("kg_exam_papers_published_v1", "admin")
    assert not service.shared_key_writable("kg_exam_papers_published_v1", "student")
    assert not service.shared_key_writable("kg_exam_papers_published_v1", "viewer")


def test_engagement_collections_are_server_owned_runtime_keys() -> None:
    assert service.server_owned_key("kg_announcements_v1")
    assert service.server_owned_key("kg_user_feedback_v1")
    assert not service.server_owned_key("kg_exam_papers_published_v1")


def test_admin_settings_are_admin_only() -> None:
    assert service.shared_key_writable("kg_admin_settings_v1", "admin")
    assert not service.shared_key_writable("kg_admin_settings_v1", "teacher")
    assert service.shared_key_readable("kg_admin_settings_v1", "admin")
    assert not service.shared_key_readable("kg_admin_settings_v1", "teacher")
    assert not service.shared_key_readable("kg_admin_settings_v1", "student")


def test_stale_account_local_shared_values_are_never_returned_as_private_state() -> None:
    filtered = service.private_runtime_storage({
        "kg_admin_settings_v1": '{"secret":"stale"}',
        "kg_exam_papers_published_v1": "[]",
        "kg_announcements_v1": '[{"id":"stale"}]',
        "kg_user_feedback_v1": '[{"id":"stale"}]',
        "pmp_question_font_size_v1": "large",
    })

    assert filtered == {"pmp_question_font_size_v1": "large"}


def test_full_snapshot_only_exposes_explicitly_mutated_shared_keys() -> None:
    stale_papers = json.dumps([{"id": "stale"}])
    payload = update(
        storage={
            "kg_exam_papers_published_v1": stale_papers,
            "pmp_question_font_size_v1": "large",
        },
        mutations=[RuntimeMutation(
            operation="setItem",
            key="pmp_question_font_size_v1",
            value="large",
        )],
    )

    assert service.explicit_shared_mutations(payload) == []


def test_publisher_merge_preserves_other_teachers_and_replaces_current_teacher() -> None:
    existing = json.dumps([
        {"id": "a-old", "publishedBy": "teacher-a"},
        {"id": "b", "publishedBy": "teacher-b"},
    ])
    incoming = json.dumps([
        {"id": "a-new", "publishedBy": "teacher-a"},
        {"id": "b-tampered", "publishedBy": "teacher-b"},
    ])

    merged = json.loads(service.merge_shared_value(
        "kg_question_banks_published_v1",
        existing,
        incoming,
        "teacher-a",
    ))

    assert [row["id"] for row in merged] == ["b", "a-new"]


def test_first_publisher_write_drops_forged_rows_owned_by_other_teachers() -> None:
    incoming = json.dumps([
        {"id": "mine", "publishedBy": "teacher-a"},
        {"id": "forged", "publishedBy": "teacher-b"},
    ])

    initial = json.loads(service.merge_shared_value(
        "kg_question_banks_published_v1",
        "[]",
        incoming,
        "teacher-a",
    ))

    assert [row["id"] for row in initial] == ["mine"]


def test_publisher_remove_preserves_other_teachers() -> None:
    existing = json.dumps([
        {"id": "a", "publishedBy": "teacher-a"},
        {"id": "b", "publishedBy": "teacher-b"},
    ])

    remaining = json.loads(service.remove_publisher_rows(
        "kg_exam_papers_published_v1",
        existing,
        "teacher-a",
    ))

    assert [row["id"] for row in remaining] == ["b"]


def test_activity_collections_are_no_longer_projected_through_runtime() -> None:
    key = "kg_activity_collections_v1"

    assert key in service.RETIRED_CATALOG_RUNTIME_KEYS
    assert key in service.SERVER_OWNED_KEYS
    assert key not in service.SHARED_KEYS
    assert key not in service.TEACHING_SHARED_KEYS


@pytest.mark.parametrize(
    "key",
    [
        "kg_question_banks_published_v1",
        "kg_question_tag_names_v1",
        "kg_question_banks_v1__user__teacher-a",
    ],
)
def test_catalog_cutover_rejects_deprecated_question_writes_before_role_checks(
    monkeypatch: pytest.MonkeyPatch,
    key: str,
) -> None:
    monkeypatch.setattr(settings, "QUESTION_CATALOG_CUTOVER_ENABLED", True)
    payload = update(
        storage={key: "[]"},
        mutations=[RuntimeMutation(operation="setItem", key=key, value="[]")],
    )

    with pytest.raises(
        service.RuntimeStatePermissionError,
        match="正式题库已迁移，请使用题目目录接口",
    ):
        asyncio.run(service.apply_update(None, "teacher-a", "student", payload))


@pytest.mark.parametrize(
    "key",
    [
        "kg_question_current_v1__user__teacher-a",
        "kg_question_training_route_v1",
        "kg_question_library_workspace_layout_v1",
        "pmp_question_font_size_v2",
    ],
)
def test_catalog_cutover_keeps_learning_progress_and_preferences_writable(key: str) -> None:
    assert service.key_allowed(key)
    assert not service.deprecated_question_key(key)


TEACHER_WORKSPACE_SHARED_KEYS = (
    "kg_taxonomy_release_records_v1",
    "kg_taxonomy_deletion_records_v1",
    "kg_taxonomy_import_records_v1",
    "kg_principle_repository_v1",
    "kg_synthesis_preset_repository_v1",
    "kg_exam_papers_published_v1",
    "kg_exam_paper_release_history_v1",
    "kg_question_tag_names_v1",
)

RETIRED_COURSE_RUNTIME_KEYS = (
    "kg_course_config_drafts_v1",
    "kg_course_config_releases_v1",
    "kg_course_config_active_release_v1",
    "kg_learning_tasks_v1",
)

PERSONAL_RUNTIME_KEYS = (
    "kg_graph_user_preferences_v1",
    "kg_guided_learning_progress_v2__teacher__course",
    "kg_practice_attempts_v1__teacher__paper",
    "kg_question_library_workspace_layout_v1",
    "pmp_question_font_size_v1",
)


@pytest.mark.parametrize("key", TEACHER_WORKSPACE_SHARED_KEYS)
def test_existing_teacher_workspace_keys_have_the_same_manager_boundary(key: str) -> None:
    """Catches a shared teaching key accidentally reverting to owner-only policy."""
    assert service.shared_key_writable(key, "admin")
    assert service.shared_key_writable(key, "teacher")
    assert service.shared_key_readable(key, "admin")
    assert service.shared_key_readable(key, "teacher")
    assert not service.shared_key_writable(key, "student")
    assert not service.shared_key_writable(key, "viewer")


@pytest.mark.parametrize("key", RETIRED_COURSE_RUNTIME_KEYS)
def test_course_and_task_keys_are_server_owned_and_absent_from_runtime(key: str) -> None:
    assert service.server_owned_key(key)
    assert key not in service.SHARED_KEYS
    assert key not in service.TEACHING_SHARED_KEYS
    assert key in service.RUNTIME_SNAPSHOT_EXCLUDED_KEYS
    assert not service.shared_key_writable(key, "admin")
    assert not service.shared_key_writable(key, "teacher")


@pytest.mark.parametrize("key", sorted(service.RETIRED_CATALOG_RUNTIME_KEYS))
def test_retired_teaching_catalog_keys_are_not_runtime_readable_or_writable(key: str) -> None:
    assert key in service.SERVER_OWNED_KEYS
    assert key not in service.SHARED_KEYS
    assert key not in service.TEACHING_SHARED_KEYS
    assert not service.shared_key_writable(key, "admin")
    assert not service.shared_key_writable(key, "teacher")


@pytest.mark.parametrize("key", PERSONAL_RUNTIME_KEYS)
def test_personal_graph_progress_attempt_layout_and_preferences_are_not_teacher_shared(
    key: str,
) -> None:
    """Catches broad prefix matching that leaks personal runtime data to managers."""
    assert service.canonical_teacher_shared_key(key, "admin") is None
    assert service.canonical_teacher_shared_key(key, "teacher") is None


def test_teacher_draft_canonical_keys_and_account_aliases_are_role_aware() -> None:
    """Catches storing one teacher's scoped paper key as another private account key."""
    owner = "老师 A/@"
    encoded = quote(owner, safe="")

    assert service.canonical_teacher_shared_key(
        f"kg_exam_papers_v1__user__{encoded}", "teacher", owner
    ) == "kg_exam_papers_v1__teacher_shared"
    assert service.canonical_teacher_shared_key(
        f"kg_exam_paper_categories_v1__user__{encoded}", "admin", owner
    ) == "kg_exam_paper_categories_v1__teacher_shared"
    assert service.canonical_teacher_shared_key(
        "kg_recall_association_library_v1__subject__PMP", "teacher"
    ) == "kg_recall_association_library_v1__subject__PMP"
    assert service.canonical_teacher_shared_key(
        "kg_exam_paper_release_history_v1", "student"
    ) is None
    assert service.canonical_teacher_shared_key(
        "kg_assessment_papers_v1", "viewer"
    ) is None
    assert service.canonical_teacher_shared_key(
        "kg_exam_papers_v1__user__other", "teacher", owner
    ) is None
    assert service.canonical_teacher_shared_key(
        "kg_exam_papers_v1__malformed", "teacher", owner
    ) is None
    assert service.canonical_teacher_shared_key(
        f"kg_recall_association_library_v1__user__{encoded}__PMP",
        "teacher",
        owner,
    ) == "kg_recall_association_library_v1__subject__PMP"
    assert service.canonical_teacher_shared_key(
        "kg_recall_association_library_v1__user__other__PMP",
        "teacher",
        owner,
    ) is None
    assert service.teacher_shared_aliases(owner, "teacher") == {
        "kg_exam_papers_v1__teacher_shared": f"kg_exam_papers_v1__user__{encoded}",
        "kg_exam_paper_categories_v1__teacher_shared": (
            f"kg_exam_paper_categories_v1__user__{encoded}"
        ),
    }
    assert service.teacher_shared_aliases(owner, "student") == {}
    assert service.teacher_shared_aliases(owner, "viewer") == {}


def _login(client: TestClient, username: str, password: str) -> None:
    response = client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": password},
    )
    assert response.status_code == 200, response.text


def _runtime_storage(client: TestClient) -> dict[str, str]:
    response = client.get("/api/v1/runtime/state")
    assert response.status_code == 200, response.text
    return response.json()["storage"]


async def _content_revision() -> int:
    async with AsyncSessionLocal() as db:
        return int((await revision_service.current(db))["revision"])


def _write_runtime(client: TestClient, key: str, value: str, request_id: str):
    state = client.get("/api/v1/runtime/state")
    assert state.status_code == 200, state.text
    return client.put(
        "/api/v1/runtime/state",
        json={
            "page": "question-bank.html",
            "namespace": "questions",
            "operation": "setItem",
            "key": key,
            "value": value,
            "storage": {key: value},
            "snapshotMode": "merge",
            "mutations": [{"operation": "setItem", "key": key, "value": value}],
            "requestId": request_id,
            "revision": state.json()["revision"],
            "contentRevision": state.json()["contentRevision"],
        },
    )


def _direct_runtime_mutation(
    client: TestClient,
    *,
    operation: str,
    key: str,
    revision: int,
    request_id: str,
    value: str | None = None,
):
    content_revision = client.get("/api/v1/question-catalog/revision")
    assert content_revision.status_code == 200, content_revision.text
    mutation = {"operation": operation, "key": key}
    if value is not None:
        mutation["value"] = value
    return client.put(
        "/api/v1/runtime/state",
        json={
            "page": "question-bank.html",
            "namespace": "questions",
            "operation": operation,
            "key": key,
            "value": value,
            "storage": {key: value} if value is not None else {},
            "snapshotMode": "merge",
            "mutations": [mutation],
            "requestId": request_id,
            "revision": revision,
            "contentRevision": content_revision.json()["revision"],
        },
    )


def _promotion_row_key(key: str) -> bool:
    return (
        key in {
            "kg_teacher_shared_runtime_promotion_v1",
            "kg_exam_paper_release_history_v1",
            "kg_assessment_papers_v1",
            "kg_exam_papers_v1__teacher_shared",
            "kg_exam_paper_categories_v1__teacher_shared",
        }
        or key.startswith("kg_recall_association_library_v1__subject__")
    )


async def _snapshot_teacher_promotion_rows() -> dict[str, tuple[str, int, str | None]]:
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(SharedRuntimeState))).scalars().all()
        return {
            row.key: (row.value, row.schema_version, row.updated_by)
            for row in rows
            if _promotion_row_key(row.key)
        }


async def _restore_teacher_promotion_rows(
    snapshot: dict[str, tuple[str, int, str | None]],
) -> None:
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(SharedRuntimeState))).scalars().all()
        current_keys = {row.key for row in rows if _promotion_row_key(row.key)}
        if current_keys:
            await db.execute(
                delete(SharedRuntimeState).where(SharedRuntimeState.key.in_(current_keys))
            )
        for key, (value, schema_version, updated_by) in snapshot.items():
            db.add(SharedRuntimeState(
                key=key,
                value=value,
                schema_version=schema_version,
                updated_by=updated_by,
            ))
        await db.commit()


async def _delete_shared_rows(keys: set[str]) -> None:
    async with AsyncSessionLocal() as db:
        await db.execute(delete(SharedRuntimeState).where(SharedRuntimeState.key.in_(keys)))
        await db.commit()


async def _read_shared_values(keys: set[str]) -> dict[str, str]:
    async with AsyncSessionLocal() as db:
        rows = (
            await db.execute(
                select(SharedRuntimeState.key, SharedRuntimeState.value).where(
                    SharedRuntimeState.key.in_(keys)
                )
            )
        ).all()
        return {str(key): str(value) for key, value in rows}


async def _seed_legacy_runtime_states(
    rows: dict[str, tuple[dict[str, str], datetime]],
) -> None:
    async with AsyncSessionLocal() as db:
        owners = list(rows)
        await db.execute(delete(RuntimeState).where(RuntimeState.owner_id.in_(owners)))
        for owner, (storage, _) in rows.items():
            db.add(RuntimeState(owner_id=owner, storage=storage, revision=7))
        await db.flush()
        for owner, (_, updated_at) in rows.items():
            await db.execute(
                sql_update(RuntimeState)
                .where(RuntimeState.owner_id == owner)
                .values(updated_at=updated_at)
            )
        await db.commit()


async def _clear_test_account_state(usernames: list[str]) -> None:
    async with AsyncSessionLocal() as db:
        await db.execute(delete(Subscription).where(Subscription.username.in_(usernames)))
        await db.execute(delete(RuntimeState).where(RuntimeState.owner_id.in_(usernames)))
        await db.commit()


async def _runtime_storage_for(owner: str) -> dict[str, str]:
    async with AsyncSessionLocal() as db:
        row = await db.get(RuntimeState, owner)
        return dict(row.storage or {}) if row else {}


@pytest.mark.parametrize(
    "key",
    [
        "kg_exam_paper_release_history_v1",
        "kg_assessment_papers_v1",
        "kg_exam_papers_v1__teacher_shared",
        "kg_exam_paper_categories_v1__teacher_shared",
    ],
)
def test_teacher_promotion_array_merger_preserves_ids_and_prefers_existing_shared(
    key: str,
) -> None:
    """Catches promotion replacing a whole array or letting legacy beat shared data."""
    earlier = datetime(2026, 1, 1, tzinfo=timezone.utc)
    later = datetime(2026, 1, 2, tzinfo=timezone.utc)

    value, conflicts = service.merge_teacher_shared_payload(
        key,
        [
            (
                "teacher-a",
                earlier,
                json.dumps([{"id": "a"}, {"id": "same", "winner": "old"}]),
            ),
            (
                "teacher-b",
                later,
                json.dumps([{"id": "b"}, {"id": "same", "winner": "new"}]),
            ),
        ],
        existing_shared=json.dumps([
            {"id": "shared-only"},
            {"id": "same", "winner": "shared"},
        ]),
    )

    rows = {row["id"]: row for row in json.loads(value)}
    assert set(rows) == {"a", "b", "same", "shared-only"}
    assert rows["same"]["winner"] == "shared"
    assert conflicts[-1] == {
        "key": key,
        "entityId": "same",
        "loserOwner": "teacher-b",
        "winnerOwner": "shared",
    }


def test_teacher_promotion_association_merger_uses_ids_and_shared_priority() -> None:
    """Catches legacy mapping nodes being lost when mixed with structured Shared data."""
    key = "kg_recall_association_library_v1__subject__PMP"
    value, conflicts = service.merge_teacher_shared_payload(
        key,
        [
            (
                "teacher-a",
                datetime(2026, 1, 1, tzinfo=timezone.utc),
                json.dumps({"需求管理": ["范围管理"]}),
            ),
            (
                "teacher-b",
                datetime(2026, 1, 2, tzinfo=timezone.utc),
                json.dumps({
                    "schemaVersion": 1,
                    "nodes": [{"id": "node-b"}, {"id": "node-same", "v": "new"}],
                    "edges": [{"id": "edge-b"}, {"id": "edge-same", "v": "new"}],
                }),
            ),
        ],
        existing_shared=json.dumps({
            "schemaVersion": 1,
            "nodes": [{"id": "node-shared"}, {"id": "node-same", "v": "shared"}],
            "edges": [{"id": "edge-shared"}, {"id": "edge-same", "v": "shared"}],
        }),
    )

    association = json.loads(value)
    nodes = {row["id"]: row for row in association["nodes"]}
    edges = {row["id"]: row for row in association["edges"]}
    by_title = {row.get("title"): row for row in nodes.values()}
    assert {"需求管理", "范围管理"} <= set(by_title)
    assert by_title["需求管理"]["id"] == "recall-n-1j5pkkc"
    assert by_title["范围管理"]["id"] == "recall-n-vghhod"
    assert {"node-b", "node-shared", "node-same"} <= set(nodes)
    assert {"edge-b", "edge-shared", "edge-same"} <= set(edges)
    assert any(
        row.get("id") == "edge-12hyh15"
        and row.get("from") == by_title["需求管理"]["id"]
        and row.get("to") == by_title["范围管理"]["id"]
        for row in edges.values()
    )
    assert nodes["node-same"]["v"] == "shared"
    assert edges["edge-same"]["v"] == "shared"
    assert {row["entityId"] for row in conflicts} >= {"node-same", "edge-same"}


def test_pre_upgrade_teacher_drafts_are_promoted_without_losing_either_owner() -> None:
    """Catches the first manager read hiding or deleting pre-upgrade private drafts."""
    token = uuid4().hex[:10]
    password = "test1234"
    usernames = {
        "admin_a": f"migration_admin_a_{token}",
        "teacher_b": f"migration_teacher_b_{token}",
        "teacher_c": f"migration_teacher_c_{token}",
    }
    marker_key = "kg_teacher_shared_runtime_promotion_v1"
    association_key = "kg_recall_association_library_v1__subject__PMP"
    canonical_keys = {
        marker_key,
        "kg_assessment_papers_v1",
        "kg_exam_papers_v1__teacher_shared",
        "kg_exam_paper_categories_v1__teacher_shared",
        association_key,
    }
    snapshot = asyncio.run(_snapshot_teacher_promotion_rows())
    asyncio.run(_delete_shared_rows(set(snapshot) | canonical_keys))
    provisioner = TestClient(app)
    clients: dict[str, TestClient] = {}
    _login(provisioner, "admin", "jbgsnmm~123")
    cleanup_errors: list[BaseException] = []
    try:
        for account, role in (
            ("admin_a", "admin"),
            ("teacher_b", "teacher"),
            ("teacher_c", "teacher"),
        ):
            created = provisioner.post(
                "/api/v1/users",
                json={
                    "username": usernames[account],
                    "password": password,
                    "role": role,
                    "subject": "PMP",
                },
            )
            assert created.status_code == 200, created.text
            clients[account] = TestClient(app)
            _login(clients[account], usernames[account], password)

        paper_keys = {
            account: f"kg_exam_papers_v1__user__{quote(username, safe='')}"
            for account, username in usernames.items()
        }
        category_keys = {
            account: f"kg_exam_paper_categories_v1__user__{quote(username, safe='')}"
            for account, username in usernames.items()
        }
        legacy_association_keys = {
            account: (
                "kg_recall_association_library_v1__user__"
                f"{quote(username, safe='')}__PMP"
            )
            for account, username in usernames.items()
        }
        earlier = datetime(2026, 1, 1, 8, 0, tzinfo=timezone.utc)
        later = datetime(2026, 1, 2, 8, 0, tzinfo=timezone.utc)
        storages = {
            usernames["admin_a"]: (
                {
                    "kg_exam_paper_release_history_v1": json.dumps([
                        {"id": "course-a", "owner": "admin-a"},
                        {"id": "course-later", "winner": "older"},
                    ]),
                    "kg_assessment_papers_v1": json.dumps([
                        {"id": "assessment-a"}
                    ]),
                    paper_keys["admin_a"]: json.dumps([
                        {"id": "paper-a"}
                    ]),
                    category_keys["admin_a"]: json.dumps([
                        {"id": "category-a"}
                    ]),
                    legacy_association_keys["admin_a"]: json.dumps({
                        "需求管理": ["范围管理"]
                    }),
                },
                earlier,
            ),
            usernames["teacher_b"]: (
                {
                    "kg_exam_paper_release_history_v1": json.dumps([
                        {"id": "course-b"},
                        {"id": "course-later", "winner": "newer"},
                        {"id": "course-tie", "winner": "teacher-b"},
                    ]),
                    "kg_assessment_papers_v1": json.dumps([
                        {"id": "assessment-b"}
                    ]),
                    paper_keys["teacher_b"]: json.dumps([{"id": "paper-b"}]),
                    category_keys["teacher_b"]: json.dumps([{"id": "category-b"}]),
                    association_key: json.dumps({
                        "schemaVersion": 1,
                        "nodes": [
                            {"id": "node-b"},
                            {"id": "node-later", "winner": "newer"},
                            {"id": "node-tie", "winner": "teacher-b"},
                        ],
                        "edges": [
                            {"id": "edge-b"},
                            {"id": "edge-later", "winner": "newer"},
                            {"id": "edge-tie", "winner": "teacher-b"},
                        ],
                    }),
                },
                later,
            ),
            usernames["teacher_c"]: (
                {
                    "kg_exam_paper_release_history_v1": json.dumps([
                        {"id": "course-c"},
                        {"id": "course-tie", "winner": "teacher-c"},
                    ]),
                    "kg_assessment_papers_v1": json.dumps([
                        {"id": "assessment-c"}
                    ]),
                    paper_keys["teacher_c"]: json.dumps([{"id": "paper-c"}]),
                    category_keys["teacher_c"]: json.dumps([{"id": "category-c"}]),
                    legacy_association_keys["teacher_c"]: json.dumps({
                        "schemaVersion": 1,
                        "nodes": [
                            {"id": "node-c"},
                            {"id": "node-tie", "winner": "teacher-c"},
                        ],
                        "edges": [
                            {"id": "edge-c"},
                            {"id": "edge-tie", "winner": "teacher-c"},
                        ],
                    }),
                },
                later,
            ),
        }
        asyncio.run(_seed_legacy_runtime_states(storages))

        before_promotion_revision = asyncio.run(_content_revision())
        arrival = Barrier(2)

        def first_read(account: str):
            arrival.wait(timeout=10)
            return clients[account].get("/api/v1/runtime/state")

        with ThreadPoolExecutor(max_workers=2) as pool:
            first_responses = list(
                pool.map(first_read, ("teacher_b", "admin_a"))
            )
        assert all(response.status_code == 200 for response in first_responses)
        assert {
            response.json()["contentRevision"] for response in first_responses
        } == {before_promotion_revision + 1}
        first_response = first_responses[0]
        first = first_response.json()["storage"]
        assert first_response.json()["contentRevision"] == before_promotion_revision + 1
        assert asyncio.run(_content_revision()) == before_promotion_revision + 1
        for account in ("admin_a", "teacher_b", "teacher_c"):
            storage = first if account == "teacher_b" else _runtime_storage(clients[account])
            assert "kg_exam_paper_release_history_v1" not in storage
            assert {row["id"] for row in json.loads(
                storage["kg_assessment_papers_v1"]
            )} >= {"assessment-a", "assessment-b", "assessment-c"}
            assert {row["id"] for row in json.loads(storage[paper_keys[account]])} >= {
                "paper-a", "paper-b", "paper-c"
            }
            assert {row["id"] for row in json.loads(storage[category_keys[account]])} >= {
                "category-a", "category-b", "category-c"
            }
            association = json.loads(storage[association_key])
            nodes = {row["id"]: row for row in association["nodes"]}
            edges = {row["id"]: row for row in association["edges"]}
            assert set(nodes) >= {"node-b", "node-c", "node-later", "node-tie"}
            assert set(edges) >= {
                "edge-b", "edge-c", "edge-later", "edge-tie"
            }
            by_title = {row.get("title"): row for row in nodes.values()}
            assert {"需求管理", "范围管理"} <= set(by_title)
            assert any(
                row.get("from") == by_title["需求管理"]["id"]
                and row.get("to") == by_title["范围管理"]["id"]
                for row in edges.values()
            )
            assert nodes["node-later"]["winner"] == "newer"
            assert nodes["node-tie"]["winner"] == "teacher-c"
            assert edges["edge-later"]["winner"] == "newer"
            assert edges["edge-tie"]["winner"] == "teacher-c"

        promoted = asyncio.run(_read_shared_values(canonical_keys))
        marker = json.loads(promoted[marker_key])
        assert marker["status"] == "complete"
        assert set(marker["sourceOwners"]) >= set(usernames.values())
        conflicts = {(row["key"], row["entityId"]): row for row in marker["conflicts"]}
        assert conflicts[(association_key, "node-tie")]["winnerOwner"] == usernames[
            "teacher_c"
        ]

        before_repeat = dict(promoted)
        assert _runtime_storage(clients["admin_a"])
        assert asyncio.run(_read_shared_values(canonical_keys)) == before_repeat
        assert asyncio.run(_content_revision()) == before_promotion_revision + 1

        unrelated = _write_runtime(
            clients["admin_a"],
            "pmp_question_font_size_v1",
            "large",
            f"pytest-promotion-unrelated-{token}",
        )
        assert unrelated.status_code == 200, unrelated.text
        assert "kg_exam_paper_release_history_v1" not in _runtime_storage(
            clients["teacher_b"]
        )
        legacy_after_put = asyncio.run(_runtime_storage_for(usernames["admin_a"]))
        for key in storages[usernames["admin_a"]][0]:
            if key == "kg_exam_paper_release_history_v1":
                assert key not in legacy_after_put
            else:
                assert legacy_after_put[key] == storages[usernames["admin_a"]][0][key]
    finally:
        for client in clients.values():
            client.close()
        try:
            asyncio.run(_restore_teacher_promotion_rows(snapshot))
        except BaseException as exc:  # cleanup stages must not block later recovery
            cleanup_errors.append(exc)
        try:
            asyncio.run(_clear_test_account_state(list(usernames.values())))
        except BaseException as exc:
            cleanup_errors.append(exc)
        try:
            cleanup = provisioner.request(
                "DELETE",
                "/api/v1/users/batch",
                json={"usernames": list(usernames.values())},
            )
            if cleanup.status_code != 200:
                cleanup_errors.append(AssertionError(cleanup.text))
        finally:
            provisioner.close()
        if cleanup_errors:
            raise cleanup_errors[0]


@pytest.mark.parametrize(
    ("operation", "key", "replacement"),
    [
        (
            "setItem",
            "kg_assessment_papers_v1",
            json.dumps([{"id": "replacement-only"}]),
        ),
        ("removeItem", "kg_assessment_papers_v1", None),
    ],
)
def test_first_direct_manager_mutation_promotes_before_set_or_remove(
    operation: str,
    key: str,
    replacement: str | None,
) -> None:
    """Catches a first direct write being merged with or resurrected by later promotion."""
    token = uuid4().hex[:10]
    username = f"direct_promotion_teacher_{token}"
    password = "test1234"
    marker_key = "kg_teacher_shared_runtime_promotion_v1"
    snapshot = asyncio.run(_snapshot_teacher_promotion_rows())
    asyncio.run(_delete_shared_rows(set(snapshot) | {marker_key, key}))
    provisioner = TestClient(app)
    client = TestClient(app)
    cleanup_errors: list[BaseException] = []
    _login(provisioner, "admin", "jbgsnmm~123")
    try:
        created = provisioner.post(
            "/api/v1/users",
            json={
                "username": username,
                "password": password,
                "role": "teacher",
                "subject": "PMP",
            },
        )
        assert created.status_code == 200, created.text
        _login(client, username, password)
        legacy_value = json.dumps([{"id": f"legacy-{token}"}])
        asyncio.run(_seed_legacy_runtime_states({
            username: (
                {key: legacy_value},
                datetime(2026, 1, 1, tzinfo=timezone.utc),
            )
        }))

        before_promotion_revision = asyncio.run(_content_revision())
        response = _direct_runtime_mutation(
            client,
            operation=operation,
            key=key,
            value=replacement,
            revision=7,
            request_id=f"pytest-direct-promotion-{operation}-{token}",
        )
        assert response.status_code == 200, response.text
        assert response.json()["contentRevision"] == before_promotion_revision + 2
        assert asyncio.run(_content_revision()) == before_promotion_revision + 2
        storage = _runtime_storage(client)
        if replacement is None:
            assert key not in storage
        else:
            assert json.loads(storage[key]) == [{"id": "replacement-only"}]
        assert marker_key in asyncio.run(_read_shared_values({marker_key}))
        assert asyncio.run(_runtime_storage_for(username))[key] == legacy_value
    finally:
        client.close()
        try:
            asyncio.run(_restore_teacher_promotion_rows(snapshot))
        except BaseException as exc:
            cleanup_errors.append(exc)
        try:
            asyncio.run(_clear_test_account_state([username]))
        except BaseException as exc:
            cleanup_errors.append(exc)
        try:
            cleanup = provisioner.request(
                "DELETE",
                "/api/v1/users/batch",
                json={"usernames": [username]},
            )
            if cleanup.status_code != 200:
                cleanup_errors.append(AssertionError(cleanup.text))
        finally:
            provisioner.close()
        if cleanup_errors:
            raise cleanup_errors[0]


def test_promotion_cas_exemption_rejects_a_competitor_in_the_commit_window(
    monkeypatch,
) -> None:
    token = uuid4().hex[:10]
    username = f"promotion_window_{token}"
    key = "kg_assessment_papers_v1"
    marker_key = "kg_teacher_shared_runtime_promotion_v1"
    snapshot = asyncio.run(_snapshot_teacher_promotion_rows())
    asyncio.run(_delete_shared_rows(set(snapshot) | {marker_key, key}))

    async def seed() -> None:
        async with AsyncSessionLocal() as db:
            db.add(
                User(
                    username=username,
                    password_hash="unused",
                    role="teacher",
                    status="active",
                )
            )
            await db.flush()
            db.add(
                RuntimeState(
                    owner_id=username,
                    storage={key: json.dumps([{"id": "legacy"}])},
                    revision=7,
                )
            )
            await db.commit()

    async def cleanup() -> None:
        await _restore_teacher_promotion_rows(snapshot)
        async with AsyncSessionLocal() as db:
            await db.execute(delete(RuntimeState).where(RuntimeState.owner_id == username))
            await db.execute(delete(User).where(User.username == username))
            await db.commit()

    async def scenario() -> None:
        base_revision = await _content_revision()
        reached_put_lock = asyncio.Event()
        release_put_lock = asyncio.Event()
        original_acquire = revision_service.acquire_lock
        main_acquire_calls = 0

        async def gated_acquire(db) -> None:
            nonlocal main_acquire_calls
            if db.info.get("promotion_window_main"):
                main_acquire_calls += 1
                if main_acquire_calls == 3:
                    reached_put_lock.set()
                    await asyncio.wait_for(release_put_lock.wait(), timeout=10)
            await original_acquire(db)

        monkeypatch.setattr(revision_service, "acquire_lock", gated_acquire)

        async def competing_write() -> None:
            await asyncio.wait_for(reached_put_lock.wait(), timeout=10)
            async with AsyncSessionLocal() as db:
                async with db.begin():
                    await revision_service.acquire_lock(db)
                    row = await db.get(SharedRuntimeState, key)
                    assert row is not None
                    row.value = json.dumps([{"id": "competitor"}])
                    row.updated_by = "promotion-competitor"
                    await revision_service.bump(
                        db,
                        "promotion-competitor",
                        [
                            {
                                "entityType": "runtimeShared",
                                "entityId": key,
                                "action": "updated",
                            }
                        ],
                    )
            release_put_lock.set()

        async def stale_put() -> service.RuntimeStateConflictError:
            async with AsyncSessionLocal() as db:
                db.info["promotion_window_main"] = True
                request = RuntimeStateUpdate(
                    page="question-bank.html",
                    namespace="questions",
                    operation="setItem",
                    key=key,
                    value=json.dumps([{"id": "stale-request"}]),
                    storage={},
                    snapshotMode="merge",
                    mutations=[
                        RuntimeMutation(
                            operation="setItem",
                            key=key,
                            value=json.dumps([{"id": "stale-request"}]),
                        )
                    ],
                    requestId=f"promotion-window-{token}",
                    revision=7,
                    contentRevision=base_revision,
                )
                with pytest.raises(service.RuntimeStateConflictError) as conflict:
                    await service.apply_update(db, username, "teacher", request)
                return conflict.value

        conflict, _ = await asyncio.gather(stale_put(), competing_write())
        assert conflict.current_content_revision == base_revision + 2
        async with AsyncSessionLocal() as db:
            row = await db.get(SharedRuntimeState, key)
            assert row is not None
            assert json.loads(row.value) == [{"id": "competitor"}]
            assert int((await revision_service.current(db))["revision"]) == base_revision + 2

    asyncio.run(seed())
    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(cleanup())


def test_promotion_with_identical_shared_content_does_not_bump_revision() -> None:
    """Catches marker-only promotion creating a false teaching-content revision."""

    token = uuid4().hex[:10]
    username = f"promotion_noop_{token}"
    key = "kg_assessment_papers_v1"
    marker_key = "kg_teacher_shared_runtime_promotion_v1"
    snapshot = asyncio.run(_snapshot_teacher_promotion_rows())
    value = json.dumps([{"id": f"same-{token}"}])
    other_states: dict[str, dict[str, str]] = {}

    async def seed() -> None:
        async with AsyncSessionLocal() as db:
            rows = (
                await db.execute(
                    select(RuntimeState)
                    .join(User, User.username == RuntimeState.owner_id)
                    .where(User.role.in_(("admin", "teacher")))
                )
            ).scalars().all()
            for row in rows:
                other_states[row.owner_id] = dict(row.storage or {})
                row.storage = {}
            db.add(User(username=username, password_hash="unused", role="teacher", status="active"))
            await db.flush()
            db.add(RuntimeState(owner_id=username, storage={key: value}, revision=1))
            existing = await db.get(SharedRuntimeState, key)
            if existing is None:
                db.add(SharedRuntimeState(key=key, value=value, updated_by=username))
            else:
                existing.value = value
            marker = await db.get(SharedRuntimeState, marker_key)
            if marker is not None:
                await db.delete(marker)
            await db.commit()

    async def scenario() -> None:
        before = await _content_revision()
        async with AsyncSessionLocal() as db:
            storage, _, _ = await service.get_state(db, username, "teacher")
            assert json.loads(storage[key]) == json.loads(value)
        assert await _content_revision() == before

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(RuntimeState).where(RuntimeState.owner_id == username))
            await db.execute(delete(User).where(User.username == username))
            for owner_id, storage in other_states.items():
                row = await db.get(RuntimeState, owner_id)
                if row is not None:
                    row.storage = storage
            await db.commit()
        await _restore_teacher_promotion_rows(snapshot)

    asyncio.run(seed())
    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(cleanup())


def test_teacher_drafts_round_trip_across_managers_but_not_students_or_viewers() -> None:
    """Catches drafts being stored in the writing teacher's private runtime row."""
    token = uuid4().hex[:10]
    password = "test1234"
    usernames = {
        "admin": f"draft_admin_{token}",
        "teacher_a": f"draft_teacher_a_{token}",
        "teacher_b": f"draft_teacher_b_{token}",
        "student": f"draft_student_{token}",
        "viewer": f"draft_viewer_{token}",
    }
    snapshot = asyncio.run(_snapshot_teacher_promotion_rows())
    provisioner = TestClient(app)
    clients: dict[str, TestClient] = {}
    _login(provisioner, "admin", "jbgsnmm~123")
    try:
        for account, role in (
            ("admin", "admin"),
            ("teacher_a", "teacher"),
            ("teacher_b", "teacher"),
            ("student", "student"),
            ("viewer", "viewer"),
        ):
            created = provisioner.post(
                "/api/v1/users",
                json={
                    "username": usernames[account],
                    "password": password,
                    "role": role,
                    "subject": "PMP",
                },
            )
            assert created.status_code == 200, created.text
            clients[account] = TestClient(app)
            _login(clients[account], usernames[account], password)

        teacher_a_paper_key = (
            "kg_exam_papers_v1__user__"
            f"{quote(usernames['teacher_a'], safe='')}"
        )
        teacher_a_category_key = (
            "kg_exam_paper_categories_v1__user__"
            f"{quote(usernames['teacher_a'], safe='')}"
        )
        written = {
            "kg_exam_paper_release_history_v1": json.dumps({"draft": token}),
            "kg_assessment_papers_v1": json.dumps([{"id": f"assessment-{token}"}]),
            teacher_a_paper_key: json.dumps([{"id": f"paper-{token}"}]),
            teacher_a_category_key: json.dumps([{"id": f"category-{token}"}]),
        }
        for index, (key, value) in enumerate(written.items()):
            response = _write_runtime(
                clients["teacher_a"], key, value, f"pytest-draft-write-{token}-{index}"
            )
            assert response.status_code == 200, response.text

        for account in ("admin", "teacher_a", "teacher_b"):
            storage = _runtime_storage(clients[account])
            paper_alias = (
                "kg_exam_papers_v1__user__"
                f"{quote(usernames[account], safe='')}"
            )
            category_alias = (
                "kg_exam_paper_categories_v1__user__"
                f"{quote(usernames[account], safe='')}"
            )
            assert "kg_exam_paper_release_history_v1" not in storage
            assert storage["kg_assessment_papers_v1"] == written[
                "kg_assessment_papers_v1"
            ]
            assert storage[paper_alias] == written[teacher_a_paper_key]
            assert storage[category_alias] == written[teacher_a_category_key]
            assert "kg_exam_papers_v1__teacher_shared" not in storage
            assert "kg_exam_paper_categories_v1__teacher_shared" not in storage

        for account in ("student", "viewer"):
            storage = _runtime_storage(clients[account])
            scoped_paper = (
                "kg_exam_papers_v1__user__"
                f"{quote(usernames[account], safe='')}"
            )
            scoped_category = (
                "kg_exam_paper_categories_v1__user__"
                f"{quote(usernames[account], safe='')}"
            )
            for key in (
                "kg_exam_paper_release_history_v1",
                "kg_assessment_papers_v1",
                scoped_paper,
                scoped_category,
                "kg_exam_papers_v1__teacher_shared",
                "kg_exam_paper_categories_v1__teacher_shared",
            ):
                assert key not in storage

            denied_keys = (
                "kg_exam_paper_release_history_v1",
                "kg_assessment_papers_v1",
                scoped_paper,
                scoped_category,
            )
            for index, key in enumerate(denied_keys):
                denied = _write_runtime(
                    clients[account],
                    key,
                    json.dumps({"forged": token}),
                    f"pytest-draft-denied-{account}-{token}-{index}",
                )
                assert denied.status_code == 403, denied.text

        for index, key in enumerate((
            f"kg_exam_papers_v1__user__{quote(usernames['teacher_b'], safe='')}",
            "kg_exam_papers_v1__malformed",
        )):
            denied = _write_runtime(
                clients["teacher_a"],
                key,
                "[]",
                f"pytest-draft-malformed-{token}-{index}",
            )
            assert denied.status_code == 403, denied.text

    finally:
        for client in clients.values():
            client.close()
        asyncio.run(_restore_teacher_promotion_rows(snapshot))
        cleanup = provisioner.request(
            "DELETE",
            "/api/v1/users/batch",
            json={"usernames": list(usernames.values())},
        )
        assert cleanup.status_code == 200, cleanup.text
        provisioner.close()


def test_personal_runtime_boundary_stays_isolated_between_two_teachers() -> None:
    """Catches draft canonicalization accidentally absorbing personal prefixes."""
    token = uuid4().hex[:10]
    password = "test1234"
    teacher_a = f"personal_teacher_a_{token}"
    teacher_b = f"personal_teacher_b_{token}"
    provisioner = TestClient(app)
    clients = {"a": TestClient(app), "b": TestClient(app)}
    promotion_snapshot = asyncio.run(_snapshot_teacher_promotion_rows())
    _login(provisioner, "admin", "jbgsnmm~123")
    try:
        for username in (teacher_a, teacher_b):
            created = provisioner.post(
                "/api/v1/users",
                json={
                    "username": username,
                    "password": password,
                    "role": "teacher",
                    "subject": "PMP",
                },
            )
            assert created.status_code == 200, created.text
        _login(clients["a"], teacher_a, password)
        _login(clients["b"], teacher_b, password)

        personal_keys = (
            "kg_graph_user_preferences_v1",
            f"kg_guided_learning_progress_v2__{quote(teacher_a, safe='')}__course",
            f"kg_practice_attempts_v1__{quote(teacher_a, safe='')}__paper",
            "kg_question_library_workspace_layout_v1",
            "pmp_question_font_size_v1",
        )
        for account, client in clients.items():
            for index, key in enumerate(personal_keys):
                value = json.dumps({"owner": account, "keyIndex": index})
                response = _write_runtime(
                    client,
                    key,
                    value,
                    f"pytest-personal-{account}-{token}-{index}",
                )
                assert response.status_code == 200, response.text

        state_a = _runtime_storage(clients["a"])
        state_b = _runtime_storage(clients["b"])
        for index, key in enumerate(personal_keys):
            assert json.loads(state_a[key])["owner"] == "a"
            assert json.loads(state_b[key])["owner"] == "b"
            assert json.loads(state_a[key])["keyIndex"] == index
            assert json.loads(state_b[key])["keyIndex"] == index
    finally:
        for client in clients.values():
            client.close()
        asyncio.run(_restore_teacher_promotion_rows(promotion_snapshot))
        cleanup = provisioner.request(
            "DELETE",
            "/api/v1/users/batch",
            json={"usernames": [teacher_a, teacher_b]},
        )
        assert cleanup.status_code == 200, cleanup.text
        provisioner.close()
