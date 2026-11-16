"""finance_records

Revision ID: fc95227a8df6
Revises: 456f42ad29df
Create Date: 2026-11-13 09:59:04.630579

只创建 finance_records 一张表。autogenerate 检测到的其余差异
（wechat_account_tickets/question_materials 等在部分本地库缺失）
属于历史环境偏差，与本迁移无关，已手工裁剪以免在生产/UAT 库
重复建表导致迁移失败。

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'fc95227a8df6'
down_revision: Union[str, None] = '456f42ad29df'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('finance_records',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('amount', sa.Numeric(precision=12, scale=2), nullable=False),
    sa.Column('purpose', sa.String(length=200), nullable=False),
    sa.Column('spent_on', sa.Date(), nullable=False),
    sa.Column('note', sa.Text(), nullable=True),
    sa.Column('invoice_path', sa.String(length=255), nullable=True),
    sa.Column('invoice_name', sa.String(length=255), nullable=True),
    sa.Column('invoice_mime', sa.String(length=80), nullable=True),
    sa.Column('invoice_size', sa.Integer(), nullable=True),
    sa.Column('invoice_digest', sa.String(length=64), nullable=True),
    sa.Column('created_by', sa.String(length=64), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('amount > 0', name='ck_finance_records_amount_positive'),
    sa.ForeignKeyConstraint(['created_by'], ['users.username'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_finance_records_spent_on'), 'finance_records', ['spent_on'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_finance_records_spent_on'), table_name='finance_records')
    op.drop_table('finance_records')
