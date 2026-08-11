"""add versioned subject facet schemas

Revision ID: 6f0f9e1b2d3c
Revises: e1439a1eb412
Create Date: 2026-08-12 00:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "6f0f9e1b2d3c"
down_revision: Union[str, None] = "e1439a1eb412"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "subject_facet_schemas",
        sa.Column("schema_id", sa.String(length=128), nullable=False),
        sa.Column("subject_id", sa.String(length=128), nullable=False),
        sa.Column("schema_version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("name", sa.String(length=300), nullable=False),
        sa.Column(
            "subject_codes",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "dimensions",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column("status", sa.String(length=32), server_default="active", nullable=False),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("created_by", sa.String(length=64), nullable=True),
        sa.Column("updated_by", sa.String(length=64), nullable=True),
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
            "status IN ('active', 'inactive', 'deprecated')",
            name="ck_subject_facet_schemas_status",
        ),
        sa.ForeignKeyConstraint(["created_by"], ["users.username"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by"], ["users.username"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("schema_id"),
        sa.UniqueConstraint("subject_id", name="uq_subject_facet_schemas_subject_id"),
    )
    op.create_index(
        "ix_subject_facet_schemas_subject_id",
        "subject_facet_schemas",
        ["subject_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_subject_facet_schemas_subject_id", table_name="subject_facet_schemas")
    op.drop_table("subject_facet_schemas")
