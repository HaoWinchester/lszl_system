"""guided courses activities and progress

Revision ID: 90fd7f6bf301
Revises: 4b91d6ec2a10
Create Date: 2026-07-21
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "90fd7f6bf301"
down_revision: Union[str, None] = "4b91d6ec2a10"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "guided_courses",
        sa.Column("id", sa.String(length=96), nullable=False),
        sa.Column("version", sa.String(length=32), nullable=False),
        sa.Column("schema_version", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("structure", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("content_hash", sa.String(length=80), nullable=False),
        sa.Column("published", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_guided_courses_published", "guided_courses", ["published"])
    op.create_table(
        "guided_activities",
        sa.Column("id", sa.String(length=128), nullable=False),
        sa.Column("version", sa.String(length=32), nullable=False),
        sa.Column("schema_version", sa.Integer(), nullable=False),
        sa.Column("activity_type", sa.String(length=64), nullable=False),
        sa.Column("record", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_guided_activities_activity_type", "guided_activities", ["activity_type"])
    op.create_table(
        "guided_course_activities",
        sa.Column("course_id", sa.String(length=96), nullable=False),
        sa.Column("activity_id", sa.String(length=128), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["activity_id"], ["guided_activities.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["course_id"], ["guided_courses.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("course_id", "activity_id"),
        sa.UniqueConstraint("course_id", "position", name="uq_guided_course_activity_position"),
    )
    op.create_table(
        "guided_learning_progress",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("owner_id", sa.String(length=64), nullable=False),
        sa.Column("course_id", sa.String(length=96), nullable=False),
        sa.Column("schema_version", sa.Integer(), nullable=False),
        sa.Column("progress", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["course_id"], ["guided_courses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["owner_id"], ["users.username"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("owner_id", "course_id", name="uq_guided_progress_owner_course"),
    )
    op.create_index("ix_guided_learning_progress_owner_id", "guided_learning_progress", ["owner_id"])
    op.create_index("ix_guided_learning_progress_course_id", "guided_learning_progress", ["course_id"])


def downgrade() -> None:
    op.drop_index("ix_guided_learning_progress_course_id", table_name="guided_learning_progress")
    op.drop_index("ix_guided_learning_progress_owner_id", table_name="guided_learning_progress")
    op.drop_table("guided_learning_progress")
    op.drop_table("guided_course_activities")
    op.drop_index("ix_guided_activities_activity_type", table_name="guided_activities")
    op.drop_table("guided_activities")
    op.drop_index("ix_guided_courses_published", table_name="guided_courses")
    op.drop_table("guided_courses")
