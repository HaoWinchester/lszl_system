from sqlalchemy import Index, UniqueConstraint

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


def _index_names(model: type) -> set[str | None]:
    return {index.name for index in model.__table__.indexes if isinstance(index, Index)}


def test_recall_snapshots_have_stable_content_identities() -> None:
    assert {column.name for column in RecallQuestionSnapshot.__table__.primary_key} == {"id"}
    assert {column.name for column in RecallLibrarySnapshot.__table__.primary_key} == {"id"}
    assert "uq_recall_question_snapshot_revision_release" in _index_names(RecallQuestionSnapshot)
    assert "uq_recall_library_snapshot_hash" in _unique_constraint_names(RecallLibrarySnapshot)


def test_recall_progress_isolated_by_owner_question_and_release() -> None:
    assert {column.name for column in RecallProgress.__table__.primary_key} == {"id"}
    assert "uq_recall_progress_owner_question_release" in _index_names(RecallProgress)


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
