"""make release learning foreign keys restrictive

Revision ID: f6a1b2c3d4e5
Revises: e5b9c3d7a120
"""
from typing import Sequence, Union

from alembic import op

revision: str = "f6a1b2c3d4e5"
down_revision: Union[str, None] = "e5b9c3d7a120"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLES = (
    ("paper_release_questions", "paper_release_questions_release_id_fkey"),
    ("practice_mistakes", "practice_mistakes_release_id_fkey"),
    ("recall_progress", "recall_progress_release_id_fkey"),
    ("recall_question_snapshots", "recall_question_snapshots_release_id_fkey"),
    ("training_progress", "training_progress_release_id_fkey"),
)


def upgrade() -> None:
    for table, constraint in _TABLES:
        op.drop_constraint(constraint, table, type_="foreignkey")
        op.create_foreign_key(
            constraint,
            table,
            "paper_releases",
            ["release_id"],
            ["id"],
            ondelete="RESTRICT",
        )


def downgrade() -> None:
    for table, constraint in _TABLES:
        op.drop_constraint(constraint, table, type_="foreignkey")
        op.create_foreign_key(
            constraint,
            table,
            "paper_releases",
            ["release_id"],
            ["id"],
            ondelete="CASCADE",
        )
