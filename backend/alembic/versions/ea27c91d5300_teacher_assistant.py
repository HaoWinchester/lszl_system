"""Private teacher conversations, uploads, and durable task leases."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
revision='ea27c91d5300'
down_revision='e9c2a7b4d610'
branch_labels=None
depends_on=None

def upgrade():
    op.create_table('teacher_assistant_sessions',
        sa.Column('id',sa.String(64),primary_key=True),
        sa.Column('owner_id',sa.String(64),sa.ForeignKey('users.username',ondelete='CASCADE'),nullable=False,index=True),
        sa.Column('title',sa.String(200),nullable=False),
        sa.Column('messages',JSONB,nullable=False),sa.Column('plan',JSONB,nullable=False),sa.Column('receipt',JSONB,nullable=False),
        sa.Column('revision',sa.Integer,nullable=False),
        sa.Column('created_at',sa.DateTime(timezone=True),server_default=sa.func.now()),
        sa.Column('updated_at',sa.DateTime(timezone=True),server_default=sa.func.now()))
    op.create_table('teacher_assistant_uploads',
        sa.Column('id',sa.String(64),primary_key=True),
        sa.Column('session_id',sa.String(64),sa.ForeignKey('teacher_assistant_sessions.id',ondelete='CASCADE'),nullable=False,index=True),
        sa.Column('name',sa.String(255),nullable=False),sa.Column('size',sa.Integer,nullable=False),sa.Column('digest',sa.String(64),nullable=False),
        sa.Column('status',sa.String(24),nullable=False),sa.Column('extracted',JSONB,nullable=False),sa.Column('warnings',JSONB,nullable=False),
        sa.Column('created_at',sa.DateTime(timezone=True),server_default=sa.func.now()))
    op.create_table('teacher_assistant_jobs',
        sa.Column('id',sa.String(64),primary_key=True),
        sa.Column('session_id',sa.String(64),sa.ForeignKey('teacher_assistant_sessions.id',ondelete='CASCADE'),nullable=False,index=True),
        sa.Column('owner_id',sa.String(64),sa.ForeignKey('users.username',ondelete='CASCADE'),nullable=False,index=True),
        sa.Column('request_id',sa.String(80),nullable=False),sa.Column('kind',sa.String(24),nullable=False),
        sa.Column('status',sa.String(24),nullable=False,index=True),sa.Column('payload',JSONB,nullable=False),
        sa.Column('error',sa.Text,nullable=False),sa.Column('attempts',sa.Integer,nullable=False),
        sa.Column('lease_until',sa.DateTime(timezone=True)),
        sa.Column('created_at',sa.DateTime(timezone=True),server_default=sa.func.now()),
        sa.Column('updated_at',sa.DateTime(timezone=True),server_default=sa.func.now()),
        sa.UniqueConstraint('session_id','request_id',name='uq_teacher_assistant_operation'))

def downgrade():
    op.drop_table('teacher_assistant_jobs');op.drop_table('teacher_assistant_uploads');op.drop_table('teacher_assistant_sessions')
