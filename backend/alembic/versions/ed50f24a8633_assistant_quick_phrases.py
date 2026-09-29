"""Store teacher assistant personal quick phrases with the owning account."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
revision = 'ed50f24a8633'
down_revision = 'ec49e13f7522'
branch_labels = None
depends_on = None

def upgrade():
    op.add_column('users', sa.Column('assistant_phrases', postgresql.JSONB(), nullable=False, server_default='[]'))

def downgrade():
    op.drop_column('users', 'assistant_phrases')
