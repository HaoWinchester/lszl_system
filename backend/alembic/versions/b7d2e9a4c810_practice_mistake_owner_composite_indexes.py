"""practice mistake owner composite indexes for overview pagination and aggregation

Revision ID: b7d2e9a4c810
Revises: 38ca40f1c9d3
Create Date: 2026-11-26
"""

from alembic import op

revision = "b7d2e9a4c810"
down_revision = "38ca40f1c9d3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_practice_mistakes_owner_status",
        "practice_mistakes",
        ["owner_id", "status"],
    )
    op.create_index(
        "ix_practice_mistakes_owner_updated_at",
        "practice_mistakes",
        ["owner_id", "updated_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_practice_mistakes_owner_updated_at", table_name="practice_mistakes")
    op.drop_index("ix_practice_mistakes_owner_status", table_name="practice_mistakes")
