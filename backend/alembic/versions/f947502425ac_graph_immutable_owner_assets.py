"""graph immutable owner assets

Revision ID: f947502425ac
Revises: b3882ab31623
Create Date: 2026-10-12 18:44:10.064441

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f947502425ac'
down_revision: Union[str, None] = 'b3882ab31623'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('graph_assets',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('owner_id', sa.String(64), sa.ForeignKey('users.username'), nullable=False),
        sa.Column('filename', sa.String(200), nullable=False),
        sa.Column('mime_type', sa.String(32), nullable=False),
        sa.Column('alt', sa.String(1000), nullable=False),
        sa.Column('data', sa.LargeBinary(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))
    op.create_index('ix_graph_assets_owner_id', 'graph_assets', ['owner_id'])


def downgrade() -> None:
    op.drop_table('graph_assets')
