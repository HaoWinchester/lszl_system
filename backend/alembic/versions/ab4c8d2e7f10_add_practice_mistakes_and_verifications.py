"""Add database-backed practice mistakes and remediation verification evidence.

Revision ID: ab4c8d2e7f10
Revises: 9d2a4b6c8e1f
Create Date: 2026-08-12
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "ab4c8d2e7f10"
down_revision = "9d2a4b6c8e1f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "practice_mistakes",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("owner_id", sa.String(length=64), nullable=False),
        sa.Column("question_id", sa.String(length=64), nullable=True),
        sa.Column("bank_id", sa.String(length=64), nullable=True),
        sa.Column("paper_id", sa.String(length=64), nullable=True),
        sa.Column("release_id", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("paper_version", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("paper_name", sa.String(length=200), nullable=False, server_default="错题来源试卷"),
        sa.Column("source_mode", sa.String(length=32), nullable=False, server_default="challenge"),
        sa.Column("language_mode", sa.String(length=16), nullable=False, server_default="zh"),
        sa.Column("question_snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("knowledge", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("selected_answers", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
        sa.Column("wrong_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("revenge_attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("revenge_wrong_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("revenge_correct_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("verification_attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("verification_pass_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("verification_fail_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("first_wrong_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("last_wrong_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("last_revenge_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("next_review_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("remediation_reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("mastered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("status IN ('pending', 'needs_remediation', 'verification_due', 'mastered')", name="ck_practice_mistakes_status"),
        sa.ForeignKeyConstraint(["bank_id"], ["question_banks.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["owner_id"], ["users.username"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["question_id"], ["questions.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("owner_id", "question_id", "release_id", name="uq_practice_mistake_owner_question_release"),
    )
    op.create_index("ix_practice_mistakes_owner_id", "practice_mistakes", ["owner_id"])
    op.create_index("ix_practice_mistakes_question_id", "practice_mistakes", ["question_id"])
    op.create_index("ix_practice_mistakes_status", "practice_mistakes", ["status"])
    op.create_index("ix_practice_mistakes_last_wrong_at", "practice_mistakes", ["last_wrong_at"])
    op.create_index("ix_practice_mistakes_next_review_at", "practice_mistakes", ["next_review_at"])
    op.create_index("ix_practice_mistakes_updated_at", "practice_mistakes", ["updated_at"])
    op.create_table(
        "practice_verifications",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("mistake_id", sa.String(length=64), nullable=False),
        sa.Column("owner_id", sa.String(length=64), nullable=False),
        sa.Column("question_id", sa.String(length=64), nullable=True),
        sa.Column("bank_id", sa.String(length=64), nullable=True),
        sa.Column("selected_answer", sa.String(length=64), nullable=True),
        sa.Column("correct", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["bank_id"], ["question_banks.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["mistake_id"], ["practice_mistakes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["owner_id"], ["users.username"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["question_id"], ["questions.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_practice_verifications_mistake_id", "practice_verifications", ["mistake_id"])
    op.create_index("ix_practice_verifications_owner_id", "practice_verifications", ["owner_id"])


def downgrade() -> None:
    op.drop_index("ix_practice_verifications_owner_id", table_name="practice_verifications")
    op.drop_index("ix_practice_verifications_mistake_id", table_name="practice_verifications")
    op.drop_table("practice_verifications")
    op.drop_index("ix_practice_mistakes_updated_at", table_name="practice_mistakes")
    op.drop_index("ix_practice_mistakes_next_review_at", table_name="practice_mistakes")
    op.drop_index("ix_practice_mistakes_last_wrong_at", table_name="practice_mistakes")
    op.drop_index("ix_practice_mistakes_status", table_name="practice_mistakes")
    op.drop_index("ix_practice_mistakes_question_id", table_name="practice_mistakes")
    op.drop_index("ix_practice_mistakes_owner_id", table_name="practice_mistakes")
    op.drop_table("practice_mistakes")
