"""关系化课程草稿、不可变发布快照与学习任务。"""

from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class CourseDraft(Base):
    __tablename__ = "course_drafts"
    __table_args__ = (
        CheckConstraint(
            "status IN ('draft', 'archived')",
            name="ck_course_drafts_status",
        ),
        Index("ix_course_drafts_owner_updated", "owner_id", "updated_at"),
    )

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    owner_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("users.username", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    structure: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="draft")
    created_by: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey("users.username", ondelete="SET NULL"),
        nullable=True,
    )
    updated_by: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey("users.username", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class CourseRelease(Base):
    __tablename__ = "course_releases"
    __table_args__ = (
        UniqueConstraint(
            "owner_id",
            "course_id",
            "version",
            name="uq_course_releases_owner_course_version",
        ),
        UniqueConstraint("id", "owner_id", name="uq_course_releases_id_owner"),
        CheckConstraint(
            "status IN ('published', 'superseded', 'withdrawn')",
            name="ck_course_releases_status",
        ),
        Index(
            "uq_course_releases_one_published",
            "owner_id",
            "course_id",
            unique=True,
            postgresql_where=text("status = 'published'"),
        ),
        Index("ix_course_releases_owner_published", "owner_id", "published_at"),
    )

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    owner_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("users.username", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Deliberately not a foreign key: deleting a draft must not delete or block
    # access to its immutable release history.
    course_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    source_draft_id: Mapped[str] = mapped_column(String(128), nullable=False)
    source_draft_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="published")
    course_snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False)
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    published_by: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey("users.username", ondelete="SET NULL"),
        nullable=True,
    )
    withdrawn_by: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey("users.username", ondelete="SET NULL"),
        nullable=True,
    )
    published_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    withdrawn_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class LearningTask(Base):
    __tablename__ = "learning_tasks"
    __table_args__ = (
        ForeignKeyConstraint(
            ["release_id", "owner_id"],
            ["course_releases.id", "course_releases.owner_id"],
            name="fk_learning_tasks_release_owner",
            ondelete="CASCADE",
        ),
        CheckConstraint(
            "status IN ('draft', 'published', 'archived')",
            name="ck_learning_tasks_status",
        ),
        Index("ix_learning_tasks_owner_updated", "owner_id", "updated_at"),
        Index("ix_learning_tasks_release", "release_id"),
    )

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    owner_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("users.username", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    release_id: Mapped[str] = mapped_column(String(128), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    audience: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    content: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="draft")
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_by: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey("users.username", ondelete="SET NULL"),
        nullable=True,
    )
    updated_by: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey("users.username", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
