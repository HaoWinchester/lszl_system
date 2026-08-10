"""add immutable question cleanup audits

Revision ID: 5c84e1d3a720
Revises: b7d3e5f9012a
Create Date: 2026-08-10 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "5c84e1d3a720"
down_revision: Union[str, None] = "b7d3e5f9012a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_APPEND_ONLY_FUNCTION = "prevent_question_cleanup_audit_mutation"
_APPEND_ONLY_TRIGGER = "trg_question_cleanup_audits_append_only"


def upgrade() -> None:
    op.create_table(
        "question_cleanup_audits",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("manifest_hash", sa.String(length=64), nullable=False),
        sa.Column("snapshot_hash", sa.String(length=64), nullable=False),
        sa.Column("actor_username", sa.String(length=64), nullable=False),
        sa.Column("backup_path", sa.Text(), nullable=False),
        sa.Column("backup_sha256", sa.String(length=64), nullable=False),
        sa.Column("total_count", sa.Integer(), nullable=False),
        sa.Column("retained_count", sa.Integer(), nullable=False),
        sa.Column("deleted_count", sa.Integer(), nullable=False),
        sa.Column("repaired_reference_count", sa.Integer(), nullable=False),
        sa.Column("preserved_reference_count", sa.Integer(), nullable=False),
        sa.Column(
            "deleted_question_ids",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column(
            "repair_summary",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column("teaching_revision", sa.Integer(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_question_cleanup_audits_manifest_hash",
        "question_cleanup_audits",
        ["manifest_hash"],
        unique=True,
    )
    op.create_index(
        "ix_question_cleanup_audits_completed_at",
        "question_cleanup_audits",
        ["completed_at"],
        unique=False,
    )
    op.create_index(
        "ix_question_cleanup_audits_actor_username",
        "question_cleanup_audits",
        ["actor_username"],
        unique=False,
    )
    op.execute(
        f"""
        CREATE FUNCTION {_APPEND_ONLY_FUNCTION}()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            RAISE EXCEPTION 'question_cleanup_audits is append-only'
                USING ERRCODE = '55000';
        END;
        $$
        """
    )
    op.execute(
        f"""
        CREATE TRIGGER {_APPEND_ONLY_TRIGGER}
        BEFORE UPDATE OR DELETE ON question_cleanup_audits
        FOR EACH ROW
        EXECUTE FUNCTION {_APPEND_ONLY_FUNCTION}()
        """
    )


def downgrade() -> None:
    op.execute(
        f"DROP TRIGGER IF EXISTS {_APPEND_ONLY_TRIGGER} "
        "ON question_cleanup_audits"
    )
    op.execute(f"DROP FUNCTION IF EXISTS {_APPEND_ONLY_FUNCTION}()")
    op.drop_index(
        "ix_question_cleanup_audits_actor_username",
        table_name="question_cleanup_audits",
    )
    op.drop_index(
        "ix_question_cleanup_audits_completed_at",
        table_name="question_cleanup_audits",
    )
    op.drop_index(
        "ix_question_cleanup_audits_manifest_hash",
        table_name="question_cleanup_audits",
    )
    op.drop_table("question_cleanup_audits")
