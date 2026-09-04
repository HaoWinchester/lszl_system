"""add WeChat mini-program authentication state

Revision ID: f4c8b6d9e120
Revises: e7b4c2d8a910
Create Date: 2026-09-04 12:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "f4c8b6d9e120"
down_revision: Union[str, None] = "e7b4c2d8a910"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "wechat_mini_auth_tickets",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("ticket_digest", sa.String(length=64), nullable=False),
        sa.Column("openid", sa.String(length=128), nullable=False),
        sa.Column("unionid", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_wechat_mini_auth_tickets_ticket_digest", "wechat_mini_auth_tickets", ["ticket_digest"], unique=True)
    op.create_index("ix_wechat_mini_auth_tickets_openid", "wechat_mini_auth_tickets", ["openid"])
    op.create_index("ix_wechat_mini_auth_tickets_unionid", "wechat_mini_auth_tickets", ["unionid"])
    op.create_index("ix_wechat_mini_auth_tickets_expires_at", "wechat_mini_auth_tickets", ["expires_at"])

    op.create_table(
        "wechat_mini_sessions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("token_digest", sa.String(length=64), nullable=False),
        sa.Column("username", sa.String(length=64), nullable=False),
        sa.Column("login_session_id", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("client_metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.ForeignKeyConstraint(["username"], ["users.username"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_wechat_mini_sessions_token_digest", "wechat_mini_sessions", ["token_digest"], unique=True)
    op.create_index("ix_wechat_mini_sessions_username", "wechat_mini_sessions", ["username"])
    op.create_index("ix_wechat_mini_sessions_login_session_id", "wechat_mini_sessions", ["login_session_id"])
    op.create_index("ix_wechat_mini_sessions_expires_at", "wechat_mini_sessions", ["expires_at"])


def downgrade() -> None:
    op.drop_index("ix_wechat_mini_sessions_expires_at", table_name="wechat_mini_sessions")
    op.drop_index("ix_wechat_mini_sessions_login_session_id", table_name="wechat_mini_sessions")
    op.drop_index("ix_wechat_mini_sessions_username", table_name="wechat_mini_sessions")
    op.drop_index("ix_wechat_mini_sessions_token_digest", table_name="wechat_mini_sessions")
    op.drop_table("wechat_mini_sessions")
    op.drop_index("ix_wechat_mini_auth_tickets_expires_at", table_name="wechat_mini_auth_tickets")
    op.drop_index("ix_wechat_mini_auth_tickets_unionid", table_name="wechat_mini_auth_tickets")
    op.drop_index("ix_wechat_mini_auth_tickets_openid", table_name="wechat_mini_auth_tickets")
    op.drop_index("ix_wechat_mini_auth_tickets_ticket_digest", table_name="wechat_mini_auth_tickets")
    op.drop_table("wechat_mini_auth_tickets")
