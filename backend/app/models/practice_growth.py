"""Persistent, server-accounted practice growth."""

from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PracticeGrowthSetting(Base):
    __tablename__ = "practice_growth_settings"

    owner_id: Mapped[str] = mapped_column(String(64), ForeignKey("users.username", ondelete="CASCADE"), primary_key=True)
    configured_goal: Mapped[int] = mapped_column(Integer, nullable=False, default=10)
    goal_effective_date: Mapped[date] = mapped_column(Date, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class PracticeGrowthDay(Base):
    __tablename__ = "practice_growth_days"
    __table_args__ = (UniqueConstraint("owner_id", "local_date", name="uq_practice_growth_day_owner_date"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    owner_id: Mapped[str] = mapped_column(String(64), ForeignKey("users.username", ondelete="CASCADE"), nullable=False, index=True)
    local_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    goal: Mapped[int] = mapped_column(Integer, nullable=False)
    answered: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PracticeGrowthAnswer(Base):
    __tablename__ = "practice_growth_answers"
    __table_args__ = (UniqueConstraint("owner_id", "local_date", "question_id", name="uq_practice_growth_answer_owner_day_question"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    owner_id: Mapped[str] = mapped_column(String(64), ForeignKey("users.username", ondelete="CASCADE"), nullable=False, index=True)
    local_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    question_id: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
