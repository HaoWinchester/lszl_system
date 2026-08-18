"""Relational engagement records replacing runtime JSON collections."""

from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Announcement(Base):
    __tablename__ = "announcements"
    __table_args__ = (CheckConstraint("status IN ('draft','published','withdrawn')", name="ck_announcements_status"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    link: Mapped[str] = mapped_column(String(2048), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft")
    publish_at: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    expires_at: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    published_at: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    withdrawn_at: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    created_by: Mapped[str] = mapped_column(String(64), ForeignKey("users.username", ondelete="CASCADE"), nullable=False, index=True)
    created_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    updated_at: Mapped[int] = mapped_column(BigInteger, nullable=False)


class AnnouncementAudience(Base):
    __tablename__ = "announcement_audiences"
    __table_args__ = (UniqueConstraint("announcement_id", "audience_type", "audience_value", name="uq_announcement_audience"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    announcement_id: Mapped[str] = mapped_column(String(64), ForeignKey("announcements.id", ondelete="CASCADE"), nullable=False, index=True)
    audience_type: Mapped[str] = mapped_column(String(16), nullable=False)
    audience_value: Mapped[str] = mapped_column(String(64), nullable=False, default="")


class Feedback(Base):
    __tablename__ = "feedback"
    __table_args__ = (CheckConstraint("status IN ('pending','in_progress','resolved','closed')", name="ck_feedback_status"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    type: Mapped[str] = mapped_column(String(32), nullable=False, default="suggestion")
    title: Mapped[str] = mapped_column(String(100), nullable=False)
    detail: Mapped[str] = mapped_column(Text, nullable=False)
    page: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    app_version: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    contact: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    attachment: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    submitted_by: Mapped[str] = mapped_column(String(64), ForeignKey("users.username", ondelete="CASCADE"), nullable=False, index=True)
    created_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    updated_at: Mapped[int] = mapped_column(BigInteger, nullable=False)


class FeedbackReply(Base):
    __tablename__ = "feedback_replies"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    feedback_id: Mapped[str] = mapped_column(String(64), ForeignKey("feedback.id", ondelete="CASCADE"), nullable=False, index=True)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    actor: Mapped[str] = mapped_column(String(120), nullable=False)
    actor_username: Mapped[str] = mapped_column(String(64), ForeignKey("users.username", ondelete="CASCADE"), nullable=False)
    created_at: Mapped[int] = mapped_column(BigInteger, nullable=False)


class MessageReceipt(Base):
    __tablename__ = "message_receipts"
    __table_args__ = (UniqueConstraint("announcement_id", "username", name="uq_message_receipt"),)
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    announcement_id: Mapped[str] = mapped_column(String(64), ForeignKey("announcements.id", ondelete="CASCADE"), nullable=False, index=True)
    username: Mapped[str] = mapped_column(String(64), ForeignKey("users.username", ondelete="CASCADE"), nullable=False, index=True)
    read_at: Mapped[int] = mapped_column(BigInteger, nullable=False)


class FeedbackReceipt(Base):
    __tablename__ = "feedback_receipts"
    __table_args__ = (UniqueConstraint("feedback_id", "username", name="uq_feedback_receipt"),)
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    feedback_id: Mapped[str] = mapped_column(String(64), ForeignKey("feedback.id", ondelete="CASCADE"), nullable=False, index=True)
    username: Mapped[str] = mapped_column(String(64), ForeignKey("users.username", ondelete="CASCADE"), nullable=False, index=True)
    read_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
