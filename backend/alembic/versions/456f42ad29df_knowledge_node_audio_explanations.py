"""knowledge node audio explanations

Revision ID: 456f42ad29df
Revises: 1b6f9a2d4c80
Create Date: 2026-11-06 14:01:54.287436

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '456f42ad29df'
down_revision: Union[str, None] = '1b6f9a2d4c80'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('knowledge_node_audios',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('taxonomy_id', sa.String(length=128), nullable=False),
    sa.Column('node_id', sa.String(length=128), nullable=False),
    sa.Column('title', sa.String(length=240), nullable=False),
    sa.Column('filename', sa.String(length=200), nullable=False),
    sa.Column('mime_type', sa.String(length=32), nullable=False),
    sa.Column('byte_length', sa.Integer(), nullable=False),
    sa.Column('duration_ms', sa.Integer(), nullable=False),
    sa.Column('sha256', sa.String(length=64), nullable=False),
    sa.Column('data', sa.LargeBinary(), nullable=False),
    sa.Column('created_by', sa.String(length=64), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('byte_length > 0 AND byte_length <= 67108864', name='ck_knowledge_audio_size'),
    sa.CheckConstraint('duration_ms > 0 AND duration_ms <= 43200000', name='ck_knowledge_audio_duration'),
    sa.ForeignKeyConstraint(['created_by'], ['users.username'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['taxonomy_id'], ['content_taxonomies.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('taxonomy_id', 'node_id', 'sha256', name='uq_knowledge_node_audio_content')
    )


def downgrade() -> None:
    op.drop_table('knowledge_node_audios')
