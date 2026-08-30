"""add activity tag metadata

Revision ID: d1a4c7e9f205
Revises: ca3f5a7b9d20
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "d1a4c7e9f205"
down_revision = "ca3f5a7b9d20"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "activity_tags",
        sa.Column(
            "content_metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("activity_tags", "content_metadata")
