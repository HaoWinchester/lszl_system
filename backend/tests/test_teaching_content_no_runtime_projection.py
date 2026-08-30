"""Phase-A boundary for retiring teaching-content Runtime projections.

Course drafts/releases and learning tasks stay on the exact compatibility keys
listed below until Task 7 removes their browser compatibility facade. Teaching content has
relational owners already and must not be added back to that exception.
"""

from __future__ import annotations

import inspect

from app.services import (
    content_prep_shared_service,
    question_cleanup_reference_service,
    teaching_content_projection_service,
    runtime_state_service,
)


ALLOWED_UNTIL_TASK7 = frozenset(
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


def test_question_cleanup_runtime_compatibility_is_exactly_course_task_until_task7():
    current = question_cleanup_reference_service.CURRENT_RUNTIME_KEY_TYPES
    published = question_cleanup_reference_service.PUBLISHED_RUNTIME_KEY_TYPES

    assert frozenset({*current, *published}) == ALLOWED_UNTIL_TASK7
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
