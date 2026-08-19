"""harden runtime migration ledger drop gates

Revision ID: b8e2d4f6a130
Revises: 7c2d9e4a1b6f
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "b8e2d4f6a130"
down_revision: Union[str, None] = "7c2d9e4a1b6f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("runtime_migration_runs", sa.Column("source_snapshot_hash", sa.String(length=64), nullable=True))
    op.add_column("runtime_migration_runs", sa.Column("source_snapshot_count", sa.Integer(), server_default="0", nullable=False))
    op.add_column("runtime_migration_runs", sa.Column("backup_reference", sa.Text(), nullable=True))
    op.add_column("runtime_migration_runs", sa.Column("snapshot_created_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("runtime_migration_items", sa.Column("disposition", sa.String(length=40), server_default="unknown", nullable=False))
    op.add_column("runtime_migration_items", sa.Column("target_domain", sa.String(length=80), nullable=True))
    op.add_column("runtime_migration_items", sa.Column("discard_reason", sa.Text(), nullable=True))
    op.add_column("runtime_migration_items", sa.Column("verification_metadata", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False))


def downgrade() -> None:
    op.drop_column("runtime_migration_items", "verification_metadata")
    op.drop_column("runtime_migration_items", "discard_reason")
    op.drop_column("runtime_migration_items", "target_domain")
    op.drop_column("runtime_migration_items", "disposition")
    op.drop_column("runtime_migration_runs", "snapshot_created_at")
    op.drop_column("runtime_migration_runs", "backup_reference")
    op.drop_column("runtime_migration_runs", "source_snapshot_count")
    op.drop_column("runtime_migration_runs", "source_snapshot_hash")
