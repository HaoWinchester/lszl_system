"""已发布试卷的不可变版本及题目快照。"""

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PaperRelease(Base):
    __tablename__ = "paper_releases"
    __table_args__ = (
        UniqueConstraint("paper_id", "version", name="uq_paper_releases_paper_version"),
        CheckConstraint(
            "paper_type IN ('standard', 'multiple_choice')",
            name="ck_paper_releases_paper_type",
        ),
        Index(
            "uq_paper_releases_one_active",
            "paper_id",
            unique=True,
            postgresql_where=text("status = 'published'"),
        ),
        Index("ix_paper_releases_catalog", "status", "published_at"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    paper_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="published")
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    subject: Mapped[str] = mapped_column(String(32), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    paper_type: Mapped[str] = mapped_column(String(32), nullable=False, default="standard")
    publisher_id: Mapped[str] = mapped_column(String(64), ForeignKey("users.username"), nullable=False)
    access_level: Mapped[str] = mapped_column(String(16), nullable=False, default="free")
    enabled_modes: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    allowed_roles: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    release_metadata: Mapped[dict] = mapped_column("metadata", JSONB, nullable=False, default=dict)
    source_payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    question_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    withdrawn_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    withdrawn_by: Mapped[str | None] = mapped_column(String(64), ForeignKey("users.username"), nullable=True)


class PaperReleaseQuestion(Base):
    __tablename__ = "paper_release_questions"
    __table_args__ = (
        Index("ix_paper_release_questions_question", "question_id"),
    )

    release_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("paper_releases.id", ondelete="RESTRICT"), primary_key=True
    )
    order_index: Mapped[int] = mapped_column(Integer, primary_key=True)
    bank_id: Mapped[str] = mapped_column(String(64), nullable=False)
    question_id: Mapped[str] = mapped_column(String(64), nullable=False)
    snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False)
