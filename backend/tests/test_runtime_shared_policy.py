import json

from app.services import runtime_state_service as service
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


def test_private_activity_collections_are_only_visible_to_their_owner() -> None:
    source = json.dumps([
        {
            "id": "admin-private",
            "visibility": "private",
            "authorship": {"createdByUserId": "admin-a"},
        },
        {
            "id": "teacher-shared",
            "visibility": "shared",
            "authorship": {"createdByUserId": "teacher-a"},
        },
    ])

    student_rows = json.loads(service.visible_shared_value(
        "kg_activity_collections_v1", source, "student-a"
    ))
    owner_rows = json.loads(service.visible_shared_value(
        "kg_activity_collections_v1", source, "admin-a"
    ))

    assert [row["id"] for row in student_rows] == ["teacher-shared"]
    assert [row["id"] for row in owner_rows] == ["admin-private", "teacher-shared"]
