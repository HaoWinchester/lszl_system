"""wechat login openid index and pay fields on orders

Revision ID: dac76f2151e2
Revises: 8aa6b65aabb8
Create Date: 2026-07-17 16:06:22.969358

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'dac76f2151e2'
down_revision: Union[str, None] = '8aa6b65aabb8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1) 微信登录：users.wechat->>'openid' 部分唯一索引（防同一微信重复建号、加速查找）
    op.execute(
        "CREATE UNIQUE INDEX uix_users_wechat_openid "
        "ON users ((wechat ->> 'openid')) "
        "WHERE wechat IS NOT NULL AND wechat ->> 'openid' <> ''"
    )

    # 2) 微信支付：subscription_orders 增加支付相关字段
    op.add_column('subscription_orders', sa.Column('prepay_id', sa.String(length=64), nullable=True))
    op.add_column('subscription_orders', sa.Column('code_url', sa.Text(), nullable=True))
    op.add_column('subscription_orders', sa.Column('transaction_id', sa.String(length=64), nullable=True))
    op.add_column('subscription_orders', sa.Column('pay_status', sa.String(length=16), nullable=True))
    op.add_column('subscription_orders', sa.Column('amount', sa.Integer(), nullable=True))
    op.add_column('subscription_orders', sa.Column('paid_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('subscription_orders', sa.Column('pay_method', sa.String(length=32), nullable=True))


def downgrade() -> None:
    for col in ('pay_method', 'paid_at', 'amount', 'pay_status', 'transaction_id', 'code_url', 'prepay_id'):
        op.drop_column('subscription_orders', col)
    op.execute("DROP INDEX IF EXISTS uix_users_wechat_openid")
