"""graph card question bindings and attempts

Revision ID: adb222e8e3a0
Revises: f947502425ac
Create Date: 2026-10-12 19:52:43.074257

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'adb222e8e3a0'
down_revision: Union[str, None] = 'f947502425ac'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('graph_question_bindings',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('owner_id', sa.String(64), nullable=False),
        sa.Column('file_id', sa.String(64), nullable=False),
        sa.Column('node_id', sa.String(128), nullable=False),
        sa.Column('question_id', sa.String(64), nullable=False),
        sa.Column('question_revision', sa.Integer(), nullable=False),
        sa.Column('source_version', sa.String(64), nullable=False),
        sa.Column('order_index', sa.Integer(), nullable=False),
        sa.Column('created_by', sa.String(64), nullable=False),
        sa.Column('status', sa.String(16), nullable=False),
        sa.Column('snapshot', postgresql.JSONB(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint('file_id', 'node_id', 'question_id', name='uq_graph_question_card_source'))
    for column in ('owner_id', 'file_id', 'question_id'):
        op.create_index('ix_graph_question_bindings_' + column, 'graph_question_bindings', [column])
    op.create_table('graph_question_attempts',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('owner_id', sa.String(64), nullable=False),
        sa.Column('binding_id', sa.String(64), nullable=False),
        sa.Column('file_id', sa.String(64), nullable=False),
        sa.Column('node_id', sa.String(128), nullable=False),
        sa.Column('source_version', sa.String(64), nullable=False),
        sa.Column('question_revision', sa.Integer(), nullable=False),
        sa.Column('request_id', sa.String(128), nullable=False),
        sa.Column('selection', postgresql.JSONB(), nullable=False),
        sa.Column('result', postgresql.JSONB(), nullable=False),
        sa.Column('snapshot', postgresql.JSONB(), nullable=False),
        sa.Column('submitted_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint('owner_id', 'request_id', name='uq_graph_question_attempt_request'))
    for column in ('owner_id', 'binding_id'):
        op.create_index('ix_graph_question_attempts_' + column, 'graph_question_attempts', [column])


def downgrade() -> None:
    op.drop_table('graph_question_attempts')
    op.drop_table('graph_question_bindings')
