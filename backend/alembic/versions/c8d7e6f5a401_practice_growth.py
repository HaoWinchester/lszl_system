"""add transactional practice growth

Revision ID: c8d7e6f5a401
Revises: ab4c8e86b840
"""
from alembic import op
import sqlalchemy as sa

revision = "c8d7e6f5a401"
down_revision = "ab4c8e86b840"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("practice_growth_settings",
        sa.Column("owner_id", sa.String(64), nullable=False),
        sa.Column("configured_goal", sa.Integer(), nullable=False),
        sa.Column("goal_effective_date", sa.Date(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["users.username"], ondelete="CASCADE"), sa.PrimaryKeyConstraint("owner_id"))
    op.create_table("practice_growth_days",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("owner_id", sa.String(64), nullable=False), sa.Column("local_date", sa.Date(), nullable=False),
        sa.Column("goal", sa.Integer(), nullable=False), sa.Column("answered", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["users.username"], ondelete="CASCADE"), sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("owner_id", "local_date", name="uq_practice_growth_day_owner_date"))
    op.create_index("ix_practice_growth_days_owner_id", "practice_growth_days", ["owner_id"])
    op.create_index("ix_practice_growth_days_local_date", "practice_growth_days", ["local_date"])
    op.create_table("practice_growth_answers",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("owner_id", sa.String(64), nullable=False), sa.Column("local_date", sa.Date(), nullable=False),
        sa.Column("question_id", sa.String(128), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["users.username"], ondelete="CASCADE"), sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("owner_id", "local_date", "question_id", name="uq_practice_growth_answer_owner_day_question"))
    op.create_index("ix_practice_growth_answers_owner_id", "practice_growth_answers", ["owner_id"])
    op.create_index("ix_practice_growth_answers_local_date", "practice_growth_answers", ["local_date"])


def downgrade() -> None:
    op.drop_table("practice_growth_answers")
    op.drop_table("practice_growth_days")
    op.drop_table("practice_growth_settings")
