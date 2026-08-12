"""Preserve the deployed Content Prep draft revision in the migration chain.

Revision ID: f1c9d4e7a261
Revises: 6f0f9e1b2d3c
Create Date: 2026-08-12 12:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "f1c9d4e7a261"
down_revision: Union[str, None] = "6f0f9e1b2d3c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "content_prep_drafts",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_by", sa.String(length=64), nullable=True),
        sa.Column("updated_by", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("revision >= 1", name="ck_content_prep_drafts_revision"),
        sa.ForeignKeyConstraint(["created_by"], ["users.username"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by"], ["users.username"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_content_prep_drafts_created_by", "content_prep_drafts", ["created_by"], unique=False)
    op.create_index("ix_content_prep_drafts_updated_by", "content_prep_drafts", ["updated_by"], unique=False)
    op.create_index("ix_content_prep_drafts_updated_at", "content_prep_drafts", ["updated_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_content_prep_drafts_updated_at", table_name="content_prep_drafts")
    op.drop_index("ix_content_prep_drafts_updated_by", table_name="content_prep_drafts")
    op.drop_index("ix_content_prep_drafts_created_by", table_name="content_prep_drafts")
    op.drop_table("content_prep_drafts")
