"""Boundary proving teaching and course management no longer project through Runtime."""

from __future__ import annotations

import asyncio
from copy import deepcopy
import inspect
from uuid import uuid4

import pytest

from app.services import (
    content_prep_shared_service,
    question_cleanup_reference_service,
    teaching_content_projection_service,
    runtime_state_service,
)
from app.db.session import AsyncSessionLocal
from app.models.course_management import CourseDraft, CourseRelease, LearningTask
from app.web.schemas import RuntimeStateUpdate


RETIRED_COURSE_RUNTIME_KEYS = frozenset(
    {
        "kg_course_config_drafts_v1",
        "kg_course_config_active_release_v1",
        "kg_course_config_releases_v1",
        "kg_learning_tasks_v1",
    }
)

RETIRED_CATALOG_RUNTIME_KEYS = frozenset(
    {
        "kg_content_subjects_v1",
        "kg_content_taxonomies_v1",
        "kg_content_activity_overrides_v1",
        "kg_activity_tags_v1",
        "kg_activity_collections_v1",
    }
)


def test_relational_teaching_services_do_not_read_or_write_runtime_rows():
    for module in (
        content_prep_shared_service,
        teaching_content_projection_service,
    ):
        source = inspect.getsource(module)
        assert "SharedRuntimeState" not in source
        assert "shared_runtime_states" not in source


def test_question_cleanup_uses_relational_course_and_task_rows_only():
    assert question_cleanup_reference_service.RECALL_ASSOCIATION_PREFIX is None
    source = inspect.getsource(question_cleanup_reference_service)
    assert "SharedRuntimeState" not in source
    assert "shared_runtime_states" not in source
    for retired_key in RETIRED_COURSE_RUNTIME_KEYS:
        assert retired_key not in source
    for retired_key in (
        "kg_principle_repository_v1",
        "kg_synthesis_preset_repository_v1",
        "kg_recall_association_library_v1",
        "kg_content_taxonomies_v1",
        "kg_content_activity_overrides_v1",
    ):
        assert retired_key not in source


def test_question_cleanup_inventory_classifies_relational_course_snapshots():
    suffix = uuid4().hex[:12]
    question_id = f"cleanup-relational-question-{suffix}"
    bank_id = f"cleanup-relational-bank-{suffix}"
    draft_id = f"cleanup-relational-draft-{suffix}"
    release_id = f"cleanup-relational-release-{suffix}"

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            draft = CourseDraft(
                id=draft_id,
                owner_id="admin",
                name="关系型课程草稿",
                structure={"nodes": [{"questionIds": [question_id]}]},
                revision=3,
                status="draft",
                created_by="admin",
                updated_by="admin",
            )
            release = CourseRelease(
                id=release_id,
                owner_id="admin",
                course_id=draft_id,
                source_draft_id=draft_id,
                source_draft_revision=3,
                version=1,
                status="published",
                course_snapshot={
                    "id": draft_id,
                    "questionRefs": [
                        {"bankId": bank_id, "questionId": question_id}
                    ],
                },
                notes="",
                content_hash="a" * 64,
                revision=1,
                published_by="admin",
            )
            tasks = [
                LearningTask(
                    id=f"cleanup-relational-task-{status}-{suffix}",
                    owner_id="admin",
                    release_id=release_id,
                    title=status,
                    description="",
                    audience={},
                    content={
                        "legacyQuestionRefs": [
                            {"bankId": bank_id, "questionId": question_id}
                        ]
                    },
                    status=status,
                    revision=2,
                    created_by="admin",
                    updated_by="admin",
                )
                for status in ("draft", "published", "archived")
            ]
            db.add_all([draft, release, *tasks])
            await db.flush()

            references, snapshot = (
                await question_cleanup_reference_service.inventory_question_references(db)
            )
            matching = [
                reference
                for reference in references
                if reference.question_id == question_id
            ]

            assert {
                (reference.container_type, reference.container_id, reference.repair_action)
                for reference in matching
            } == {
                ("course_draft", draft_id, "remove_question_and_recalculate"),
                (
                    "published_course_snapshot",
                    release_id,
                    "preserve_historical_snapshot",
                ),
                (
                    "learning_task",
                    f"cleanup-relational-task-draft-{suffix}",
                    "remove_question_and_recalculate",
                ),
                (
                    "learning_task",
                    f"cleanup-relational-task-published-{suffix}",
                    "preserve_historical_snapshot",
                ),
                (
                    "learning_task",
                    f"cleanup-relational-task-archived-{suffix}",
                    "remove_question_and_recalculate",
                ),
            }
            assert all(reference.storage_key is None for reference in matching)
            assert {
                item["kind"]
                for item in snapshot
                if item.get("ownerId") == "admin"
                and item.get("id") in {
                    draft_id,
                    release_id,
                    *(task.id for task in tasks),
                }
            } == {
                "relationalCourseDraft",
                "relationalCourseRelease",
                "relationalLearningTask",
            }
            assert not any(item["kind"] == "sharedRuntime" for item in snapshot)
            await db.rollback()

    asyncio.run(scenario())


def test_question_cleanup_repairs_only_mutable_relational_course_rows():
    suffix = uuid4().hex[:12]
    question_id = f"cleanup-repair-question-{suffix}"
    bank_id = f"cleanup-repair-bank-{suffix}"
    draft_id = f"cleanup-repair-draft-{suffix}"
    release_id = f"cleanup-repair-release-{suffix}"

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            draft = CourseDraft(
                id=draft_id,
                owner_id="admin",
                name="关系型课程草稿",
                structure={"questionIds": [question_id, "keep-question"]},
                revision=3,
                status="draft",
                created_by="admin",
                updated_by="admin",
            )
            release_snapshot = {
                "questionRefs": [
                    {"bankId": bank_id, "questionId": question_id}
                ]
            }
            release = CourseRelease(
                id=release_id,
                owner_id="admin",
                course_id=draft_id,
                source_draft_id=draft_id,
                source_draft_revision=3,
                version=1,
                status="published",
                course_snapshot=deepcopy(release_snapshot),
                notes="",
                content_hash="b" * 64,
                revision=4,
                published_by="admin",
            )
            task_payload = {
                "legacyQuestionRefs": [
                    {"bankId": bank_id, "questionId": question_id},
                    {"bankId": bank_id, "questionId": "keep-question"},
                ]
            }
            tasks = {
                status: LearningTask(
                    id=f"cleanup-repair-task-{status}-{suffix}",
                    owner_id="admin",
                    release_id=release_id,
                    title=status,
                    description="",
                    audience={},
                    content=deepcopy(task_payload),
                    status=status,
                    revision=2,
                    created_by="admin",
                    updated_by="admin",
                )
                for status in ("draft", "published", "archived")
            }
            db.add_all([draft, release, *tasks.values()])
            await db.flush()

            summary = await question_cleanup_reference_service.repair_current_question_references(
                db,
                {question_id},
                actor_username="admin",
                question_domains={question_id: "domain-a", "keep-question": "domain-b"},
            )

            assert draft.structure == {"questionIds": ["keep-question"]}
            assert draft.revision == 4
            assert draft.updated_by == "admin"
            for status in ("draft", "archived"):
                assert tasks[status].content == {
                    "legacyQuestionRefs": [
                        {"bankId": bank_id, "questionId": "keep-question"}
                    ]
                }
                assert tasks[status].revision == 3
                assert tasks[status].updated_by == "admin"
            assert tasks["published"].content == task_payload
            assert tasks["published"].revision == 2
            assert release.course_snapshot == release_snapshot
            assert release.content_hash == "b" * 64
            assert release.revision == 4
            assert summary == {
                "relationalPaperIds": [],
                "relationalRecallLibraryIds": [],
                "removedRelationalRecallReferences": 0,
                "relationalCourseDraftIds": [draft_id],
                "relationalLearningTaskIds": sorted(
                    [tasks["archived"].id, tasks["draft"].id]
                ),
                "removedRelationalCourseReferences": 3,
                "runtimeKeys": [],
                "removedRuntimeReferences": 0,
                "publishedBankIds": [bank_id],
            }
            await db.rollback()

    asyncio.run(scenario())


def test_projection_service_has_no_runtime_projection_synchronizers():
    assert not hasattr(teaching_content_projection_service, "_write_row")
    assert not hasattr(teaching_content_projection_service, "projection_rows_present")
    assert not hasattr(teaching_content_projection_service, "write_principle_projection")
    assert not hasattr(teaching_content_projection_service, "apply_principle_projection")


def test_all_retired_catalog_runtime_keys_are_server_owned():
    assert RETIRED_CATALOG_RUNTIME_KEYS <= runtime_state_service.SERVER_OWNED_KEYS
    assert RETIRED_CATALOG_RUNTIME_KEYS.isdisjoint(runtime_state_service.SHARED_KEYS)
    assert all(runtime_state_service.server_owned_key(key) for key in RETIRED_CATALOG_RUNTIME_KEYS)


def test_all_retired_course_runtime_keys_are_hidden_server_owned_migration_inputs():
    assert RETIRED_COURSE_RUNTIME_KEYS <= runtime_state_service.SERVER_OWNED_KEYS
    assert RETIRED_COURSE_RUNTIME_KEYS.isdisjoint(runtime_state_service.EXACT_KEYS)
    assert RETIRED_COURSE_RUNTIME_KEYS.isdisjoint(runtime_state_service.SHARED_KEYS)
    assert RETIRED_COURSE_RUNTIME_KEYS.isdisjoint(runtime_state_service.TEACHER_SHARED_EXACT_KEYS)
    assert RETIRED_COURSE_RUNTIME_KEYS.isdisjoint(runtime_state_service.BOOTSTRAP_MANAGEMENT_EXACT_KEYS)
    assert RETIRED_COURSE_RUNTIME_KEYS.isdisjoint(runtime_state_service.PUBLISHER_COLLECTION_KEYS)
    assert all(runtime_state_service.server_owned_key(key) for key in RETIRED_COURSE_RUNTIME_KEYS)


@pytest.mark.parametrize("retired_key", sorted(RETIRED_COURSE_RUNTIME_KEYS))
def test_retired_course_runtime_keys_are_filtered_from_get_and_rejected_on_put(retired_key):
    assert runtime_state_service.private_runtime_storage(
        {retired_key: '[{"id":"legacy"}]', "kg_default_entry_mode_v1": "graph"}
    ) == {"kg_default_entry_mode_v1": "graph"}

    update = RuntimeStateUpdate(
        page="course-admin.html",
        namespace="courses",
        operation="setItem",
        key=retired_key,
        value="[]",
        requestId=f"retired-{retired_key}",
    )
    with pytest.raises(runtime_state_service.RuntimeStatePermissionError):
        asyncio.run(
            runtime_state_service.apply_update(
                None,  # rejected before any database access
                "admin",
                "admin",
                update,
            )
        )
