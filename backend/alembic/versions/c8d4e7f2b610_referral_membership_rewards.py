"""Record atomic two-sided seven-day referral rewards.

Revision ID: c8d4e7f2b610
Revises: b7f3c9e2a641

Existing bindings stay NULL: this rollout does not retroactively issue gifts.
"""
from alembic import op
import sqlalchemy as sa

revision = 'c8d4e7f2b610'
down_revision = 'b7f3c9e2a641'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('referral_bindings', sa.Column('rewards_granted_at', sa.DateTime(timezone=True), nullable=True))


def downgrade():
    op.drop_column('referral_bindings', 'rewards_granted_at')
