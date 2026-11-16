"""finance_records_invoice_by

Revision ID: 38ca40f1c9d3
Revises: fc95227a8df6
Create Date: 2026-11-13 10:49:29.279339

只新增 finance_records.invoice_by 一列（发票上传人）。
autogenerate 检测到的其余差异属历史环境偏差，已手工裁剪。

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '38ca40f1c9d3'
down_revision: Union[str, None] = 'fc95227a8df6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('finance_records', sa.Column('invoice_by', sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column('finance_records', 'invoice_by')
