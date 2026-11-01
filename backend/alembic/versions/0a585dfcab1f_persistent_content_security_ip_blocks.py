"""persistent content security IP blocks

Revision ID: 0a585dfcab1f
Revises: d9e5f8a3c721
Create Date: 2026-11-01 12:47:34.454823

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '0a585dfcab1f'
down_revision: Union[str, None] = 'd9e5f8a3c721'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('security_ip_blocks',
    sa.Column('ip', sa.String(length=45), nullable=False),
    sa.Column('reason', sa.String(length=64), nullable=False),
    sa.Column('path', sa.String(length=255), nullable=False),
    sa.Column('username', sa.String(length=64), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('ip')
    )


def downgrade() -> None:
    op.drop_table('security_ip_blocks')
