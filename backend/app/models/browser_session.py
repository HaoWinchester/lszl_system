"""Compact durable tombstones; cookie payloads and credentials are never stored."""
from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class RevokedBrowserSession(Base):
    __tablename__ = 'revoked_browser_sessions'

    session_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    revoked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
