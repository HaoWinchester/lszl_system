"""引导式学习课程、Activity Schema 活动与用户进度。"""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class GuidedCourse(Base):
    __tablename__ = "guided_courses"

    id: Mapped[str] = mapped_column(String(96), primary_key=True)
    version: Mapped[str] = mapped_column(String(32), nullable=False)
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    structure: Mapped[dict] = mapped_column(JSONB, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(80), nullable=False)
    published: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class GuidedActivity(Base):
    __tablename__ = "guided_activities"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    version: Mapped[str] = mapped_column(String(32), nullable=False)
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    activity_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    record: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class GuidedCourseActivity(Base):
    __tablename__ = "guided_course_activities"
    __table_args__ = (
        UniqueConstraint("course_id", "position", name="uq_guided_course_activity_position"),
    )

    course_id: Mapped[str] = mapped_column(
        String(96), ForeignKey("guided_courses.id", ondelete="CASCADE"), primary_key=True
    )
    activity_id: Mapped[str] = mapped_column(
        String(128), ForeignKey("guided_activities.id", ondelete="CASCADE"), primary_key=True
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)


class GuidedLearningProgress(Base):
    __tablename__ = "guided_learning_progress"
    __table_args__ = (
        UniqueConstraint("owner_id", "course_id", name="uq_guided_progress_owner_course"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("users.username", ondelete="CASCADE"), nullable=False, index=True
    )
    course_id: Mapped[str] = mapped_column(
        String(96), ForeignKey("guided_courses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False, default=4)
    progress: Mapped[dict] = mapped_column(JSONB, nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
