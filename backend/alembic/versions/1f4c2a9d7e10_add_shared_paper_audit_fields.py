"""add shared paper audit fields

Revision ID: 1f4c2a9d7e10
Revises: a91c4d7e2f60
Create Date: 2026-08-10 00:00:00

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "1f4c2a9d7e10"
down_revision: Union[str, None] = "a91c4d7e2f60"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "exam_papers",
        sa.Column("revision", sa.Integer(), server_default=sa.text("1"), nullable=False),
    )
    op.add_column(
        "exam_papers",
        sa.Column("created_by", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "exam_papers",
        sa.Column("updated_by", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "exam_papers",
        sa.Column("deleted_by", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "exam_papers",
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "exam_papers",
        sa.Column("deletion_reason", sa.Text(), nullable=True),
    )
    op.execute(
        sa.text(
            "UPDATE exam_papers "
            "SET created_by = owner_id, updated_by = owner_id "
            "WHERE created_by IS NULL OR updated_by IS NULL"
        )
    )
    op.create_foreign_key(
        "fk_exam_papers_created_by_users",
        "exam_papers",
        "users",
        ["created_by"],
        ["username"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_exam_papers_updated_by_users",
        "exam_papers",
        "users",
        ["updated_by"],
        ["username"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_exam_papers_deleted_by_users",
        "exam_papers",
        "users",
        ["deleted_by"],
        ["username"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_exam_papers_created_by",
        "exam_papers",
        ["created_by"],
        unique=False,
    )
    op.create_index(
        "ix_exam_papers_updated_by",
        "exam_papers",
        ["updated_by"],
        unique=False,
    )
    op.create_index(
        "ix_exam_papers_deleted_by",
        "exam_papers",
        ["deleted_by"],
        unique=False,
    )
    op.create_index(
        "ix_exam_papers_deleted_at",
        "exam_papers",
        ["deleted_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_exam_papers_deleted_at", table_name="exam_papers")
    op.drop_index("ix_exam_papers_deleted_by", table_name="exam_papers")
    op.drop_index("ix_exam_papers_updated_by", table_name="exam_papers")
    op.drop_index("ix_exam_papers_created_by", table_name="exam_papers")
    op.drop_constraint(
        "fk_exam_papers_deleted_by_users",
        "exam_papers",
        type_="foreignkey",
    )
    op.drop_constraint(
        "fk_exam_papers_updated_by_users",
        "exam_papers",
        type_="foreignkey",
    )
    op.drop_constraint(
        "fk_exam_papers_created_by_users",
        "exam_papers",
        type_="foreignkey",
    )
    op.drop_column("exam_papers", "deletion_reason")
    op.drop_column("exam_papers", "deleted_at")
    op.drop_column("exam_papers", "deleted_by")
    op.drop_column("exam_papers", "updated_by")
    op.drop_column("exam_papers", "created_by")
    op.drop_column("exam_papers", "revision")
