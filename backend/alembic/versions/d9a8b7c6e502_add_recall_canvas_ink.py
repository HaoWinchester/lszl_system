"""Persist world-coordinate ink on deep recall canvases.

Revision ID: d9a8b7c6e502
Revises: c8d7e6f5a401
Create Date: 2026-09-25
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "d9a8b7c6e502"
down_revision = "c8d7e6f5a401"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "recall_progress",
        sa.Column("strokes", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
    )


def downgrade() -> None:
    op.drop_column("recall_progress", "strokes")
