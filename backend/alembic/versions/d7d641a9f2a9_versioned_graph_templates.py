"""versioned graph templates

Revision ID: d7d641a9f2a9
Revises: adb222e8e3a0
Create Date: 2026-10-12 20:42:20.944264

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'd7d641a9f2a9'
down_revision: Union[str, None] = 'adb222e8e3a0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('graph_templates',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('owner_id', sa.String(64), sa.ForeignKey('users.username'), nullable=False),
        sa.Column('name', sa.String(200), nullable=False), sa.Column('description', sa.Text(), nullable=False),
        sa.Column('member_only', sa.Boolean(), nullable=False), sa.Column('listed', sa.Boolean(), nullable=False),
        sa.Column('current_version', sa.Integer(), nullable=False))
    op.create_index('ix_graph_templates_owner_id', 'graph_templates', ['owner_id'])
    op.create_table('graph_template_versions',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('template_id', sa.String(64), sa.ForeignKey('graph_templates.id'), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False), sa.Column('source_file_id', sa.String(64), nullable=False),
        sa.Column('source_revision', sa.Integer(), nullable=False),
        sa.Column('asset_owner', sa.String(64), sa.ForeignKey('users.username'), nullable=False),
        sa.Column('graph_data', postgresql.JSONB(), nullable=False), sa.Column('bindings', postgresql.JSONB(), nullable=False),
        sa.UniqueConstraint('template_id', 'version'))
    op.create_index('ix_graph_template_versions_template_id', 'graph_template_versions', ['template_id'])
    op.create_table('graph_template_loads',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('owner_id', sa.String(64), sa.ForeignKey('users.username'), nullable=False),
        sa.Column('request_id', sa.String(128), nullable=False),
        sa.Column('template_id', sa.String(64), sa.ForeignKey('graph_templates.id'), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False), sa.Column('file_id', sa.String(64), nullable=False),
        sa.Column('id_map', postgresql.JSONB(), nullable=False), sa.UniqueConstraint('owner_id', 'request_id'))
    op.create_index('ix_graph_template_loads_owner_id', 'graph_template_loads', ['owner_id'])


def downgrade() -> None:
    op.drop_table('graph_template_loads')
    op.drop_table('graph_template_versions')
    op.drop_table('graph_templates')
