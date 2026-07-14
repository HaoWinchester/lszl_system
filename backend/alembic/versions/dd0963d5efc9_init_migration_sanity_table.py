"""init migration sanity table

Revision ID: dd0963d5efc9
Revises: 
Create Date: 2026-07-12 14:25:13.989335

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'dd0963d5efc9'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 阶段 1 仅用于验证 Alembic async 迁移流程能跑通；业务表从阶段 2 起建。
    op.create_table(
        "_migration_sanity",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("note", sa.String(64), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("_migration_sanity")
