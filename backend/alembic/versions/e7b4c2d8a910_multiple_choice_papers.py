"""add canonical multiple-choice paper fields

Revision ID: e7b4c2d8a910
Revises: d3f7a9c2e510
Create Date: 2026-08-31 13:30:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "e7b4c2d8a910"
down_revision: Union[str, None] = "d3f7a9c2e510"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "questions",
        sa.Column(
            "correct_answer_ids",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
    )
    op.add_column(
        "exam_papers",
        sa.Column(
            "paper_type",
            sa.String(length=32),
            server_default=sa.text("'standard'"),
            nullable=False,
        ),
    )
    op.create_check_constraint(
        "ck_exam_papers_paper_type",
        "exam_papers",
        "paper_type IN ('standard', 'multiple_choice')",
    )
    op.add_column(
        "paper_releases",
        sa.Column(
            "paper_type",
            sa.String(length=32),
            server_default=sa.text("'standard'"),
            nullable=False,
        ),
    )
    op.create_check_constraint(
        "ck_paper_releases_paper_type",
        "paper_releases",
        "paper_type IN ('standard', 'multiple_choice')",
    )
    op.add_column(
        "practice_verifications",
        sa.Column(
            "selected_answer_ids",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("practice_verifications", "selected_answer_ids")
    op.drop_constraint(
        "ck_paper_releases_paper_type",
        "paper_releases",
        type_="check",
    )
    op.drop_column("paper_releases", "paper_type")
    op.drop_constraint(
        "ck_exam_papers_paper_type",
        "exam_papers",
        type_="check",
    )
    op.drop_column("exam_papers", "paper_type")
    op.drop_column("questions", "correct_answer_ids")
