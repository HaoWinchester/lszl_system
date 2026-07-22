"""feature usage events

Revision ID: f0a7e4b1c2d3
Revises: c10d8cf33790
Create Date: 2026-07-22
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f0a7e4b1c2d3"
down_revision: Union[str, None] = "c10d8cf33790"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "feature_usage_events",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("owner_id", sa.String(length=64), nullable=False),
        sa.Column("feature_key", sa.String(length=32), nullable=False),
        sa.Column("event_type", sa.String(length=32), nullable=False),
        sa.Column("action_key", sa.String(length=32), nullable=True),
        sa.Column("duration_seconds", sa.Integer(), nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["users.username"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_feature_usage_events_owner_id", "feature_usage_events", ["owner_id"])
    op.create_index("ix_feature_usage_events_feature_key", "feature_usage_events", ["feature_key"])
    op.create_index("ix_feature_usage_events_event_type", "feature_usage_events", ["event_type"])
    op.create_index("ix_feature_usage_events_occurred_at", "feature_usage_events", ["occurred_at"])


def downgrade() -> None:
    op.drop_index("ix_feature_usage_events_occurred_at", table_name="feature_usage_events")
    op.drop_index("ix_feature_usage_events_event_type", table_name="feature_usage_events")
    op.drop_index("ix_feature_usage_events_feature_key", table_name="feature_usage_events")
    op.drop_index("ix_feature_usage_events_owner_id", table_name="feature_usage_events")
    op.drop_table("feature_usage_events")
