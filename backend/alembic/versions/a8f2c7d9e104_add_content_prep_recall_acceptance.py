"""add content prep recall acceptance persistence

Revision ID: a8f2c7d9e104
Revises: e2c6f8a1b304
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "a8f2c7d9e104"
down_revision = "e2c6f8a1b304"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "content_prep_recall_acceptance",
        sa.Column("owner_id", sa.String(length=64), nullable=False),
        sa.Column(
            "records",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column("revision", sa.Integer(), server_default="0", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "revision >= 0",
            name="ck_content_prep_recall_acceptance_revision",
        ),
        sa.ForeignKeyConstraint(
            ["owner_id"],
            ["users.username"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("owner_id"),
    )


def downgrade() -> None:
    op.drop_table("content_prep_recall_acceptance")
