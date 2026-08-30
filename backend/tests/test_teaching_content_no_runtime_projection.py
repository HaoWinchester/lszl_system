"""Boundary proving teaching and course management no longer project through Runtime."""

from __future__ import annotations

import asyncio
import inspect

import pytest

from app.services import (
    content_prep_shared_service,
    question_cleanup_reference_service,
    teaching_content_projection_service,
    runtime_state_service,
)
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


def test_question_cleanup_keeps_course_task_rows_only_as_migration_inputs():
    current = question_cleanup_reference_service.CURRENT_RUNTIME_KEY_TYPES
    published = question_cleanup_reference_service.PUBLISHED_RUNTIME_KEY_TYPES

    assert frozenset({*current, *published}) == RETIRED_COURSE_RUNTIME_KEYS
    assert question_cleanup_reference_service.RECALL_ASSOCIATION_PREFIX is None
    source = inspect.getsource(question_cleanup_reference_service)
    for retired_key in (
        "kg_principle_repository_v1",
        "kg_synthesis_preset_repository_v1",
        "kg_recall_association_library_v1",
        "kg_content_taxonomies_v1",
        "kg_content_activity_overrides_v1",
    ):
        assert retired_key not in source


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
