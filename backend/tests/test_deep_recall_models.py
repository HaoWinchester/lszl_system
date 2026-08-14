from sqlalchemy import UniqueConstraint

from app.models.training import (
    RecallLibrarySnapshot,
    RecallProgress,
    RecallQuestionSnapshot,
)


def _unique_constraint_names(model: type) -> set[str | None]:
    return {
        constraint.name
        for constraint in model.__table__.constraints
        if isinstance(constraint, UniqueConstraint)
    }


def test_recall_snapshots_have_stable_content_identities() -> None:
    assert {column.name for column in RecallQuestionSnapshot.__table__.primary_key} == {"id"}
    assert {column.name for column in RecallLibrarySnapshot.__table__.primary_key} == {"id"}
    assert "uq_recall_question_snapshot_revision" in _unique_constraint_names(RecallQuestionSnapshot)
    assert "uq_recall_library_snapshot_hash" in _unique_constraint_names(RecallLibrarySnapshot)


def test_recall_progress_remains_isolated_by_owner_and_question() -> None:
    assert {column.name for column in RecallProgress.__table__.primary_key} == {
        "owner_id",
        "question_id",
    }


def test_recall_progress_contains_versioned_graph_columns() -> None:
    columns = RecallProgress.__table__.columns

    assert {
        "bank_id",
        "source_question_revision",
        "source_content_hash",
        "recall_library_hash",
        "graph_schema_version",
        "choice_offsets",
        "transform",
        "metrics",
        "revision",
    } <= set(columns.keys())
    assert columns["source_question_revision"].default.arg == 1
    assert columns["graph_schema_version"].default.arg == 3
    assert columns["revision"].default.arg == 1
