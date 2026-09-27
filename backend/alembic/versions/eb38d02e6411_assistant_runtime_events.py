"""Persistent native sessions and bounded public stream events."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
revision='eb38d02e6411'
down_revision='ea27c91d5300'
branch_labels=None
depends_on=None

def upgrade():
    op.add_column('teacher_assistant_sessions',sa.Column('runtime',JSONB,nullable=False,server_default='{}'))
    op.add_column('teacher_assistant_jobs',sa.Column('stream',JSONB,nullable=False,server_default='{}'))
    op.create_table('teacher_assistant_events',
        sa.Column('id',sa.BigInteger,primary_key=True,autoincrement=True),
        sa.Column('session_id',sa.String(64),sa.ForeignKey('teacher_assistant_sessions.id',ondelete='CASCADE'),nullable=False,index=True),
        sa.Column('job_id',sa.String(64),sa.ForeignKey('teacher_assistant_jobs.id',ondelete='CASCADE'),nullable=False),
        sa.Column('type',sa.String(24),nullable=False),sa.Column('data',JSONB,nullable=False))

def downgrade():
    op.drop_table('teacher_assistant_events')
    op.drop_column('teacher_assistant_jobs','stream')
    op.drop_column('teacher_assistant_sessions','runtime')
