from sqlalchemy import Numeric, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB

from app.db.base import Base
from app.models.paper import (
    PaperCategory,
    PaperGenerationBatch,
    PaperImportOperation,
)
from app.models.paper_release import PaperRelease
from app.models.question import ExamPaper, PaperQuestion, Question
from app.models.training import PracticeVerification
from app.schemas.question_catalog import QuestionPayload


def unique_columns(table) -> set[tuple[str, ...]]:
    return {
        tuple(column.name for column in constraint.columns)
        for constraint in table.constraints
        if isinstance(constraint, UniqueConstraint)
    }


def test_paper_models_expose_relational_draft_and_batch_fields() -> None:
    assert {
        "category_id",
        "access_policy",
        "enabled_modes",
        "mode_config_version",
        "purpose",
        "archived_at",
        "restored_at",
        "withdrawn_at",
        "published_release_id",
        "published_version",
        "generation_batch_id",
        "variant_code",
        "generation_config",
        "import_metadata",
    } <= set(ExamPaper.__table__.columns.keys())
    assert "score" in PaperQuestion.__table__.columns
    assert PaperCategory.__tablename__ == "paper_categories"
    assert PaperGenerationBatch.__tablename__ == "paper_generation_batches"
    assert PaperImportOperation.__tablename__ == "paper_import_operations"
    assert {
        "paper_categories",
        "paper_generation_batches",
        "paper_import_operations",
    } <= set(Base.metadata.tables)


def test_paper_questions_have_stable_order_and_numeric_score_constraints() -> None:
    table = PaperQuestion.__table__
    score = table.columns["score"]

    assert ("paper_id", "order_index") in unique_columns(table)
    assert isinstance(score.type, Numeric)
    assert score.type.precision == 8
    assert score.type.scale == 2
    assert score.nullable is False


def test_paper_operation_idempotency_is_scoped_to_actor() -> None:
    assert ("actor_username", "idempotency_key") in unique_columns(
        PaperGenerationBatch.__table__
    )
    assert ("actor_username", "idempotency_key") in unique_columns(
        PaperImportOperation.__table__
    )


def test_paper_category_and_batch_links_are_recoverable() -> None:
    table = ExamPaper.__table__
    category_fk = next(
        item
        for item in table.foreign_keys
        if item.parent.name == "category_id"
    )
    batch_fk = next(
        item
        for item in table.foreign_keys
        if item.parent.name == "generation_batch_id"
    )

    assert category_fk.target_fullname == "paper_categories.id"
    assert category_fk.ondelete == "SET NULL"
    assert batch_fk.target_fullname == "paper_generation_batches.id"
    assert batch_fk.ondelete == "SET NULL"


def test_multiple_choice_models_store_canonical_arrays_and_paper_type() -> None:
    assert isinstance(Question.__table__.columns["correct_answer_ids"].type, JSONB)
    assert "paper_type" in ExamPaper.__table__.columns
    assert "paper_type" in PaperRelease.__table__.columns
    assert isinstance(
        PracticeVerification.__table__.columns["selected_answer_ids"].type,
        JSONB,
    )


def test_question_payload_exposes_correct_option_ids_alias() -> None:
    payload = QuestionPayload.model_validate({
        "id": "question-1",
        "title": "多选题",
        "correctOptionIds": ["A", "C"],
    })

    assert payload.correct_option_ids == ["A", "C"]
    assert payload.model_dump(by_alias=True)["correctOptionIds"] == ["A", "C"]
