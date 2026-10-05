"""add question favorites

Revision ID: b3882ab31623
Revises: ed50f24a8633
Create Date: 2026-10-05 11:14:46.797549

只建 question_favorites 表；autogenerate 同时检测到的其他历史漂移
（question_materials、wechat_account_tickets、practice_verifications.selected_pairs 等）
属于先前已另行处理的差异，不随本次迁移执行。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'b3882ab31623'
down_revision: Union[str, None] = 'ed50f24a8633'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('question_favorites',
    sa.Column('question_id', sa.String(length=64), nullable=False),
    sa.Column('owner_id', sa.String(length=64), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['owner_id'], ['users.username'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['question_id'], ['questions.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('question_id', 'owner_id')
    )
    op.create_index('ix_question_favorites_owner_created', 'question_favorites', ['owner_id', 'created_at'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_question_favorites_owner_created', table_name='question_favorites')
    op.drop_table('question_favorites')
