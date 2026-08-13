"""Add learner-owned personal synthesis cards.

Revision ID: d5e8f1a2b3c4
Revises: c44e3d4f5a6b
Create Date: 2026-08-13
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "d5e8f1a2b3c4"
down_revision = "c44e3d4f5a6b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "personal_synthesis_cards",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("owner_id", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("synthesis_type", sa.String(length=32), nullable=False),
        sa.Column("content", sa.Text(), nullable=False, server_default=""),
        sa.Column("tags", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="[]"),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="draft"),
        sa.Column(
            "source_question_refs",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="[]",
        ),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("revision >= 1", name="ck_personal_cards_revision"),
        sa.CheckConstraint(
            "status IN ('draft', 'verified', 'mastered')",
            name="ck_personal_cards_status",
        ),
        sa.CheckConstraint(
            "synthesis_type IN ('principle', 'routine', 'trap', 'note')",
            name="ck_personal_cards_type",
        ),
        sa.ForeignKeyConstraint(["owner_id"], ["users.username"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_personal_synthesis_cards_owner_id", "personal_synthesis_cards", ["owner_id"])
    op.create_index("ix_personal_synthesis_cards_archived_at", "personal_synthesis_cards", ["archived_at"])
    op.create_index("ix_personal_synthesis_cards_updated_at", "personal_synthesis_cards", ["updated_at"])
    op.create_index(
        "ix_personal_cards_owner_archived_updated",
        "personal_synthesis_cards",
        ["owner_id", "archived_at", "updated_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_personal_cards_owner_archived_updated", table_name="personal_synthesis_cards")
    op.drop_index("ix_personal_synthesis_cards_updated_at", table_name="personal_synthesis_cards")
    op.drop_index("ix_personal_synthesis_cards_archived_at", table_name="personal_synthesis_cards")
    op.drop_index("ix_personal_synthesis_cards_owner_id", table_name="personal_synthesis_cards")
    op.drop_table("personal_synthesis_cards")
