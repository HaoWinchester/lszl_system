"""keep Question Family import identities stable

Revision ID: cc7a8e9d1f24
Revises: eb9c6f0a7d12
Create Date: 2026-08-12 22:58:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "cc7a8e9d1f24"
down_revision: Union[str, None] = "eb9c6f0a7d12"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("question_banks", sa.Column("source_id", sa.String(length=128), nullable=True))
    op.create_unique_constraint(
        "uq_question_banks_owner_source_id",
        "question_banks",
        ["owner_id", "source_id"],
    )
    op.add_column("questions", sa.Column("source_id", sa.String(length=128), nullable=True))
    op.create_index("ix_questions_source_id", "questions", ["source_id"], unique=False)
    op.create_unique_constraint(
        "uq_questions_bank_source_id",
        "questions",
        ["bank_id", "source_id"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_questions_bank_source_id", "questions", type_="unique")
    op.drop_index("ix_questions_source_id", table_name="questions")
    op.drop_column("questions", "source_id")
    op.drop_constraint("uq_question_banks_owner_source_id", "question_banks", type_="unique")
    op.drop_column("question_banks", "source_id")
