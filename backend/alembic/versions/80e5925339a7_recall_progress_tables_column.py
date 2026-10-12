"""recall_progress_tables_column

Revision ID: 80e5925339a7
Revises: d7d641a9f2a9
Create Date: 2026-10-12 23:23:36.663310

深度回忆进度新增 tables JSONB 列（TableV1 列表）。旧记录默认空数组，不回填。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '80e5925339a7'
down_revision: Union[str, None] = 'd7d641a9f2a9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'recall_progress',
        sa.Column('tables', postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
    )


def downgrade() -> None:
    op.drop_column('recall_progress', 'tables')
