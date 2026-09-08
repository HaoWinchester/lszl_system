"""One-time website WeChat account-choice tickets."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
revision = 'ab9012cd3456'
down_revision = 'f4c8b6d9e120'
branch_labels = None
depends_on = None

def upgrade():
    op.create_table('wechat_account_tickets',
        sa.Column('digest', sa.String(64), primary_key=True),
        sa.Column('profile', postgresql.JSONB(), nullable=False),
        sa.Column('source_username', sa.String(64), nullable=True),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('consumed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('attempts', sa.Integer(), nullable=False, server_default='0'))

def downgrade():
    op.drop_table('wechat_account_tickets')
