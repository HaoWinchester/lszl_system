"""Durable browser-session revocation across renewal and logout races.

Revision ID: 1b6f9a2d4c80
Revises: 0a585dfcab1f
"""
from alembic import op
import sqlalchemy as sa

revision = '1b6f9a2d4c80'
down_revision = '0a585dfcab1f'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('revoked_browser_sessions',
        sa.Column('session_hash', sa.String(64), primary_key=True),
        sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
    )


def downgrade():
    op.drop_table('revoked_browser_sessions')
