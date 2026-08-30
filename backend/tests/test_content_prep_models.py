from sqlalchemy import CheckConstraint, UniqueConstraint

from app.db.base import Base
import app.models  # noqa: F401  # Register every production model on Base.metadata.


def test_content_prep_tables_are_registered_for_migrations() -> None:
    expected = {
        "question_bank_collaborators",
        "principles",
        "synthesis_presets",
        "question_tag_configs",
        "question_edit_locks",
        "question_upload_batches",
        "question_audit_logs",
    }

    assert expected <= set(Base.metadata.tables)


def test_activity_tags_preserve_full_catalog_metadata() -> None:
    columns = Base.metadata.tables["activity_tags"].columns

    assert "content_metadata" in columns
    assert columns["content_metadata"].nullable is False


def test_question_bank_tracks_revision_and_server_actors() -> None:
    columns = Base.metadata.tables["question_banks"].columns

    assert {"revision", "created_by", "updated_by"} <= set(columns.keys())
    assert columns["revision"].nullable is False
    assert columns["revision"].default.arg == 1


def test_question_preserves_complete_content_prep_payload() -> None:
    columns = Base.metadata.tables["questions"].columns

    assert {
        "teacher_number",
        "scope",
        "content_hash",
        "creator_id",
        "creator_name",
        "created_by",
        "updated_by",
        "revision",
        "translations",
        "metadata",
        "key_path",
        "lifecycle",
    } <= set(columns.keys())
    assert columns["scope"].nullable is False
    assert columns["scope"].default.arg == "internal"
    assert columns["revision"].nullable is False
    assert columns["revision"].default.arg == 1


def test_question_scope_is_constrained_to_public_or_internal() -> None:
    table = Base.metadata.tables["questions"]
    checks = {
        str(constraint.sqltext)
        for constraint in table.constraints
        if isinstance(constraint, CheckConstraint)
    }

    assert "scope IN ('public', 'internal')" in checks


def test_bank_collaborator_has_one_permission_per_user_and_bank() -> None:
    table = Base.metadata.tables["question_bank_collaborators"]
    unique_columns = {
        tuple(column.name for column in constraint.columns)
        for constraint in table.constraints
        if isinstance(constraint, UniqueConstraint)
    }

    assert ("bank_id", "username") in unique_columns


def test_edit_lock_is_deleted_with_its_question() -> None:
    table = Base.metadata.tables["question_edit_locks"]
    question_fk = next(
        foreign_key
        for foreign_key in table.foreign_keys
        if foreign_key.target_fullname == "questions.id"
    )

    assert question_fk.ondelete == "CASCADE"


def test_upload_idempotency_is_scoped_to_actor() -> None:
    table = Base.metadata.tables["question_upload_batches"]
    unique_columns = {
        tuple(column.name for column in constraint.columns)
        for constraint in table.constraints
        if isinstance(constraint, UniqueConstraint)
    }

    assert ("actor_username", "idempotency_key") in unique_columns


def test_only_one_tag_config_can_be_active() -> None:
    table = Base.metadata.tables["question_tag_configs"]
    active_indexes = [index for index in table.indexes if index.unique]

    assert len(active_indexes) == 1
    assert tuple(column.name for column in active_indexes[0].columns) == ("active",)
    assert str(active_indexes[0].dialect_options["postgresql"]["where"]) == "active IS true"
