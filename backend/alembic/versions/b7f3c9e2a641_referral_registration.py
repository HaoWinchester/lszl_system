"""Add database-backed registration referrals.

Revision ID: b7f3c9e2a641
Revises: 80e5925339a7
"""
from alembic import op
import sqlalchemy as sa

revision = 'b7f3c9e2a641'
down_revision = '80e5925339a7'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('referral_codes',
        sa.Column('username', sa.String(64), sa.ForeignKey('users.username', ondelete='CASCADE'), primary_key=True),
        sa.Column('code', sa.String(16), nullable=False, unique=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))
    op.create_table('referral_bindings',
        sa.Column('invitee_username', sa.String(64), sa.ForeignKey('users.username', ondelete='CASCADE'), primary_key=True),
        sa.Column('inviter_username', sa.String(64), sa.ForeignKey('users.username', ondelete='CASCADE'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint('invitee_username <> inviter_username', name='ck_referral_no_self'))
    op.create_index('ix_referral_bindings_inviter', 'referral_bindings', ['inviter_username'])


def downgrade():
    op.drop_index('ix_referral_bindings_inviter', table_name='referral_bindings')
    op.drop_table('referral_bindings')
    op.drop_table('referral_codes')
