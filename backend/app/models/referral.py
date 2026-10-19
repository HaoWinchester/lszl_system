"""Registration attribution and atomic two-sided membership reward receipt."""
from datetime import datetime
from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class ReferralCode(Base):
    __tablename__ = 'referral_codes'
    username: Mapped[str] = mapped_column(String(64), ForeignKey('users.username', ondelete='CASCADE'), primary_key=True)
    code: Mapped[str] = mapped_column(String(16), nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class ReferralBinding(Base):
    __tablename__ = 'referral_bindings'
    __table_args__ = (
        CheckConstraint('invitee_username <> inviter_username', name='ck_referral_no_self'),
        Index('ix_referral_bindings_inviter', 'inviter_username'),
    )
    invitee_username: Mapped[str] = mapped_column(String(64), ForeignKey('users.username', ondelete='CASCADE'), primary_key=True)
    inviter_username: Mapped[str] = mapped_column(String(64), ForeignKey('users.username', ondelete='CASCADE'), nullable=False)
    rewards_granted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
