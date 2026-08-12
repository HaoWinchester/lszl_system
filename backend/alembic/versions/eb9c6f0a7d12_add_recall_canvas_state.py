"""persist complete deep recall canvas state

Revision ID: eb9c6f0a7d12
Revises: ab4c8d2e7f10
Create Date: 2026-08-12 22:30:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "eb9c6f0a7d12"
down_revision: Union[str, None] = "ab4c8d2e7f10"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    empty_json = sa.text("'{}'::jsonb")
    op.add_column("recall_progress", sa.Column("choice_offsets", postgresql.JSONB(), nullable=False, server_default=empty_json))
    op.add_column("recall_progress", sa.Column("metrics", postgresql.JSONB(), nullable=False, server_default=empty_json))
    op.add_column("recall_progress", sa.Column("transform", postgresql.JSONB(), nullable=False, server_default=empty_json))


def downgrade() -> None:
    op.drop_column("recall_progress", "transform")
    op.drop_column("recall_progress", "metrics")
    op.drop_column("recall_progress", "choice_offsets")
