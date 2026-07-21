"""learning sessions events and workspaces

Revision ID: 4b91d6ec2a10
Revises: dac76f2151e2
Create Date: 2026-07-21
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "4b91d6ec2a10"
down_revision: Union[str, None] = "dac76f2151e2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "training_progress",
        sa.Column(
            "session_data",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
    )
    op.create_table(
        "learning_events",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("owner_id", sa.String(length=64), nullable=False),
        sa.Column("question_id", sa.String(length=64), nullable=True),
        sa.Column("event_type", sa.String(length=64), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["users.username"]),
        sa.ForeignKeyConstraint(["question_id"], ["questions.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_learning_events_owner_id", "learning_events", ["owner_id"])
    op.create_index("ix_learning_events_question_id", "learning_events", ["question_id"])
    op.create_index("ix_learning_events_event_type", "learning_events", ["event_type"])
    op.create_index("ix_learning_events_created_at", "learning_events", ["created_at"])
    op.create_table(
        "canvas_workspaces",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("owner_id", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("schema_version", sa.Integer(), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["users.username"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("owner_id", "id", name="uq_canvas_workspace_owner_id"),
    )
    op.create_index("ix_canvas_workspaces_owner_id", "canvas_workspaces", ["owner_id"])
    op.create_index("ix_canvas_workspaces_updated_at", "canvas_workspaces", ["updated_at"])


def downgrade() -> None:
    op.drop_index("ix_canvas_workspaces_updated_at", table_name="canvas_workspaces")
    op.drop_index("ix_canvas_workspaces_owner_id", table_name="canvas_workspaces")
    op.drop_table("canvas_workspaces")
    op.drop_index("ix_learning_events_created_at", table_name="learning_events")
    op.drop_index("ix_learning_events_event_type", table_name="learning_events")
    op.drop_index("ix_learning_events_question_id", table_name="learning_events")
    op.drop_index("ix_learning_events_owner_id", table_name="learning_events")
    op.drop_table("learning_events")
    op.drop_column("training_progress", "session_data")
