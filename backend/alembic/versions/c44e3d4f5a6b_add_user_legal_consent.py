"""Persist accepted privacy-policy and terms versions for authenticated users.

Revision ID: c44e3d4f5a6b
Revises: cc7a8e9d1f24
Create Date: 2026-08-13
"""

from alembic import op
import sqlalchemy as sa


revision = "c44e3d4f5a6b"
down_revision = "cc7a8e9d1f24"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("legal_consent_version", sa.String(length=32), nullable=True))
    op.add_column("users", sa.Column("legal_consent_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "legal_consent_at")
    op.drop_column("users", "legal_consent_version")
