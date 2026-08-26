"""add persistent practice sessions

Revision ID: f7a2c4e6b810
Revises: d4f8a1b2c3e4
Create Date: 2026-08-26 19:40:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "f7a2c4e6b810"
down_revision: Union[str, None] = "d4f8a1b2c3e4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "practice_sessions",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("owner_id", sa.String(length=64), nullable=False),
        sa.Column("paper_id", sa.String(length=64), nullable=False),
        sa.Column("release_id", sa.String(length=64), nullable=False),
        sa.Column("mode", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column(
            "question_order",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "answers",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "runtime_state",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "stats",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "scoring_snapshot",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("report_snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("revision", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("last_saved_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("paused_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("abandoned_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "mode IN ('challenge', 'scholar', 'revenge')",
            name="ck_practice_sessions_mode",
        ),
        sa.CheckConstraint(
            "status IN ('active', 'paused', 'completed', 'abandoned')",
            name="ck_practice_sessions_status",
        ),
        sa.CheckConstraint("revision >= 1", name="ck_practice_sessions_revision"),
        sa.ForeignKeyConstraint(
            ["owner_id"], ["users.username"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["release_id"], ["paper_releases.id"], ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_practice_sessions_owner_id", "practice_sessions", ["owner_id"]
    )
    op.create_index(
        "ix_practice_sessions_paper_id", "practice_sessions", ["paper_id"]
    )
    op.create_index(
        "ix_practice_sessions_release_id", "practice_sessions", ["release_id"]
    )
    op.create_index(
        "ix_practice_sessions_status", "practice_sessions", ["status"]
    )
    op.create_index(
        "ix_practice_sessions_last_saved_at", "practice_sessions", ["last_saved_at"]
    )
    op.create_index(
        "ix_practice_sessions_owner_saved",
        "practice_sessions",
        ["owner_id", "last_saved_at"],
    )
    op.create_index(
        "uq_practice_sessions_one_resumable",
        "practice_sessions",
        ["owner_id", "paper_id", "release_id", "mode"],
        unique=True,
        postgresql_where=sa.text("status IN ('active', 'paused')"),
    )


def downgrade() -> None:
    op.drop_index("uq_practice_sessions_one_resumable", table_name="practice_sessions")
    op.drop_index("ix_practice_sessions_owner_saved", table_name="practice_sessions")
    op.drop_index("ix_practice_sessions_last_saved_at", table_name="practice_sessions")
    op.drop_index("ix_practice_sessions_status", table_name="practice_sessions")
    op.drop_index("ix_practice_sessions_release_id", table_name="practice_sessions")
    op.drop_index("ix_practice_sessions_paper_id", table_name="practice_sessions")
    op.drop_index("ix_practice_sessions_owner_id", table_name="practice_sessions")
    op.drop_table("practice_sessions")
