"""add relational paper releases

Revision ID: a7c3e9f1b205
Revises: 6f4b8a2d1c30
Create Date: 2026-08-17 14:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "a7c3e9f1b205"
down_revision: Union[str, None] = "6f4b8a2d1c30"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("uq_training_owner_question", "training_progress", type_="unique")
    op.drop_constraint("training_progress_question_id_fkey", "training_progress", type_="foreignkey")
    op.add_column(
        "training_progress",
        sa.Column("release_id", sa.String(length=64), server_default="", nullable=False),
    )
    op.create_unique_constraint(
        "uq_training_owner_question_release",
        "training_progress",
        ["owner_id", "question_id", "release_id"],
    )
    op.drop_constraint(
        "uq_recall_question_snapshot_revision", "recall_question_snapshots", type_="unique"
    )
    op.add_column(
        "recall_question_snapshots",
        sa.Column("release_id", sa.String(length=64), server_default="", nullable=False),
    )
    op.create_unique_constraint(
        "uq_recall_question_snapshot_revision_release",
        "recall_question_snapshots",
        ["question_id", "question_revision", "release_id"],
    )
    op.drop_constraint("recall_progress_question_id_fkey", "recall_progress", type_="foreignkey")
    op.add_column(
        "recall_progress",
        sa.Column("release_id", sa.String(length=64), server_default="", nullable=False),
    )
    op.drop_constraint("recall_progress_pkey", "recall_progress", type_="primary")
    op.create_primary_key(
        "recall_progress_pkey",
        "recall_progress",
        ["owner_id", "question_id", "release_id"],
    )
    op.create_table(
        "paper_releases",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("paper_id", sa.String(length=64), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("subject", sa.String(length=32), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("publisher_id", sa.String(length=64), nullable=False),
        sa.Column("access_level", sa.String(length=16), nullable=False),
        sa.Column("enabled_modes", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("allowed_roles", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("source_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("question_count", sa.Integer(), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("withdrawn_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("withdrawn_by", sa.String(length=64), nullable=True),
        sa.ForeignKeyConstraint(["paper_id"], ["exam_papers.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["publisher_id"], ["users.username"]),
        sa.ForeignKeyConstraint(["withdrawn_by"], ["users.username"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("paper_id", "version", name="uq_paper_releases_paper_version"),
    )
    op.create_index("ix_paper_releases_paper_id", "paper_releases", ["paper_id"])
    op.create_index(
        "uq_paper_releases_one_active",
        "paper_releases",
        ["paper_id"],
        unique=True,
        postgresql_where=sa.text("status = 'published'"),
    )
    op.create_index("ix_paper_releases_catalog", "paper_releases", ["status", "published_at"])
    op.create_table(
        "paper_release_questions",
        sa.Column("release_id", sa.String(length=64), nullable=False),
        sa.Column("order_index", sa.Integer(), nullable=False),
        sa.Column("bank_id", sa.String(length=64), nullable=False),
        sa.Column("question_id", sa.String(length=64), nullable=False),
        sa.Column("snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.ForeignKeyConstraint(["release_id"], ["paper_releases.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("release_id", "order_index"),
    )
    op.create_index("ix_paper_release_questions_question", "paper_release_questions", ["question_id"])


def downgrade() -> None:
    op.drop_index("ix_paper_release_questions_question", table_name="paper_release_questions")
    op.drop_table("paper_release_questions")
    op.drop_index("ix_paper_releases_catalog", table_name="paper_releases")
    op.drop_index("uq_paper_releases_one_active", table_name="paper_releases")
    op.drop_index("ix_paper_releases_paper_id", table_name="paper_releases")
    op.drop_table("paper_releases")
    op.drop_constraint(
        "uq_recall_question_snapshot_revision_release",
        "recall_question_snapshots",
        type_="unique",
    )
    op.drop_column("recall_question_snapshots", "release_id")
    op.create_unique_constraint(
        "uq_recall_question_snapshot_revision",
        "recall_question_snapshots",
        ["question_id", "question_revision"],
    )
    op.drop_constraint(
        "uq_training_owner_question_release", "training_progress", type_="unique"
    )
    op.drop_column("training_progress", "release_id")
    op.create_unique_constraint(
        "uq_training_owner_question",
        "training_progress",
        ["owner_id", "question_id"],
    )
    op.create_foreign_key(
        "training_progress_question_id_fkey",
        "training_progress",
        "questions",
        ["question_id"],
        ["id"],
    )
    op.drop_constraint("recall_progress_pkey", "recall_progress", type_="primary")
    op.create_primary_key(
        "recall_progress_pkey", "recall_progress", ["owner_id", "question_id"]
    )
    op.drop_column("recall_progress", "release_id")
    op.create_foreign_key(
        "recall_progress_question_id_fkey",
        "recall_progress",
        "questions",
        ["question_id"],
        ["id"],
    )
