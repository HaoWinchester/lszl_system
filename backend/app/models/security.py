"""Persistent source-IP locks for confirmed forbidden bulk content reads."""

from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class SecurityIPBlock(Base):
    __tablename__ = "security_ip_blocks"

    ip: Mapped[str] = mapped_column(String(45), primary_key=True)
    reason: Mapped[str] = mapped_column(String(64), nullable=False)
    path: Mapped[str] = mapped_column(String(255), nullable=False)
    username: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
