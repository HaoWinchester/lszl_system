"""Versioned foreground usage intervals; legacy events remain untouched."""
from alembic import op
import sqlalchemy as sa
revision = 'ec49e13f7522'
down_revision = 'eb38d02e6411'
branch_labels = None
depends_on = None

def upgrade():
    op.create_table('feature_usage_intervals',
        sa.Column('id',sa.String(64),primary_key=True),
        sa.Column('owner_id',sa.String(64),sa.ForeignKey('users.username',ondelete='CASCADE'),nullable=False),
        sa.Column('role',sa.String(16),nullable=False),
        sa.Column('client',sa.String(8),nullable=False),
        sa.Column('visit_id',sa.String(36),nullable=False),
        sa.Column('feature_key',sa.String(32),nullable=False),
        sa.Column('started_at',sa.DateTime(timezone=True),nullable=False),
        sa.Column('ended_at',sa.DateTime(timezone=True),nullable=False),
        sa.Column('foreground_seconds',sa.Integer(),nullable=False),
        sa.Column('active_seconds',sa.Integer(),nullable=False),
        sa.Column('received_at',sa.DateTime(timezone=True),server_default=sa.func.now(),nullable=False),
        sa.CheckConstraint('active_seconds >= 0 AND active_seconds <= foreground_seconds AND foreground_seconds <= 60 AND foreground_seconds > 0',name='ck_usage_interval_seconds'),
        sa.CheckConstraint('ended_at > started_at',name='ck_usage_interval_order'))
    op.create_index('ix_feature_usage_intervals_owner_id','feature_usage_intervals',['owner_id'])
    op.create_index('ix_feature_usage_intervals_started_at','feature_usage_intervals',['started_at'])

def downgrade():
    op.drop_table('feature_usage_intervals')
