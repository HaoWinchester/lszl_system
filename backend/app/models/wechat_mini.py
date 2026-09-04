"""Persisted authentication state for the native WeChat mini program."""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class WechatMiniAuthTicket(Base):
    """Short-lived, one-time proof of an unbound WeChat identity."""

    __tablename__ = "wechat_mini_auth_tickets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    ticket_digest: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    openid: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    unionid: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class WechatMiniSession(Base):
    """Revocable opaque-token session issued to a mini-program client."""

    __tablename__ = "wechat_mini_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    token_digest: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    username: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("users.username", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    login_session_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    client_metadata: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
