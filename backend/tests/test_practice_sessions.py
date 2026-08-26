"""Persistent, resumable practice session contracts."""

from app.models.training import PracticeSession


def test_practice_session_model_has_resumable_and_frozen_report_fields() -> None:
    columns = PracticeSession.__table__.columns

    assert {
        "id",
        "owner_id",
        "paper_id",
        "release_id",
        "mode",
        "status",
        "question_order",
        "answers",
        "runtime_state",
        "stats",
        "scoring_snapshot",
        "report_snapshot",
        "revision",
        "started_at",
        "last_saved_at",
        "paused_at",
        "completed_at",
        "abandoned_at",
    }.issubset(columns.keys())

    constraint_names = {
        constraint.name for constraint in PracticeSession.__table__.constraints
    }
    index_names = {index.name for index in PracticeSession.__table__.indexes}
    assert "ck_practice_sessions_mode" in constraint_names
    assert "ck_practice_sessions_status" in constraint_names
    assert "ck_practice_sessions_revision" in constraint_names
    assert "uq_practice_sessions_one_resumable" in index_names
