"""add database-backed deep recall sessions

Revision ID: 2d8a6c4e9f10
Revises: d5e8f1a2b3c4
Create Date: 2026-08-14 12:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "2d8a6c4e9f10"
down_revision: Union[str, None] = "d5e8f1a2b3c4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "recall_question_snapshots",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("question_id", sa.String(length=64), nullable=False),
        sa.Column("bank_id", sa.String(length=64), nullable=False),
        sa.Column("question_revision", sa.Integer(), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("subject", sa.String(length=100), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "question_id",
            "question_revision",
            name="uq_recall_question_snapshot_revision",
        ),
    )
    op.create_index(
        "ix_recall_question_snapshots_question_id",
        "recall_question_snapshots",
        ["question_id"],
        unique=False,
    )
    op.create_index(
        "ix_recall_question_snapshots_bank_id",
        "recall_question_snapshots",
        ["bank_id"],
        unique=False,
    )

    op.create_table(
        "recall_library_snapshots",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("subject", sa.String(length=100), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("source_revision", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "subject",
            "content_hash",
            name="uq_recall_library_snapshot_hash",
        ),
    )
    op.create_index(
        "ix_recall_library_snapshots_subject",
        "recall_library_snapshots",
        ["subject"],
        unique=False,
    )

    op.add_column("recall_progress", sa.Column("bank_id", sa.String(length=64), nullable=True))
    op.add_column(
        "recall_progress",
        sa.Column("source_question_revision", sa.Integer(), nullable=False, server_default="1"),
    )
    op.add_column(
        "recall_progress",
        sa.Column("source_content_hash", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "recall_progress",
        sa.Column("recall_library_hash", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "recall_progress",
        sa.Column("graph_schema_version", sa.Integer(), nullable=False, server_default="3"),
    )
    op.add_column(
        "recall_progress",
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
    )


def downgrade() -> None:
    op.drop_column("recall_progress", "revision")
    op.drop_column("recall_progress", "graph_schema_version")
    op.drop_column("recall_progress", "recall_library_hash")
    op.drop_column("recall_progress", "source_content_hash")
    op.drop_column("recall_progress", "source_question_revision")
    op.drop_column("recall_progress", "bank_id")

    op.drop_index("ix_recall_library_snapshots_subject", table_name="recall_library_snapshots")
    op.drop_table("recall_library_snapshots")
    op.drop_index("ix_recall_question_snapshots_bank_id", table_name="recall_question_snapshots")
    op.drop_index("ix_recall_question_snapshots_question_id", table_name="recall_question_snapshots")
    op.drop_table("recall_question_snapshots")
