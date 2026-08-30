"""Phase-A boundary for retiring teaching-content Runtime projections.

Course drafts/releases and learning tasks stay on the exact compatibility keys
listed below until Task 6 creates their relational owner.  Teaching content has
relational owners already and must not be added back to that exception.
"""

from __future__ import annotations

import inspect

from app.services import (
    content_prep_shared_service,
    question_cleanup_reference_service,
    teaching_content_projection_service,
)


ALLOWED_UNTIL_TASK6 = frozenset(
    {
        "kg_course_config_drafts_v1",
        "kg_course_config_active_release_v1",
        "kg_course_config_releases_v1",
        "kg_learning_tasks_v1",
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


def test_question_cleanup_runtime_compatibility_is_exactly_course_task_until_task6():
    current = question_cleanup_reference_service.CURRENT_RUNTIME_KEY_TYPES
    published = question_cleanup_reference_service.PUBLISHED_RUNTIME_KEY_TYPES

    assert frozenset({*current, *published}) == ALLOWED_UNTIL_TASK6
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
