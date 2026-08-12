"""题库、题目、试卷模型。按 owner_id 隔离；认知标注（关键词/知识点/推理）作为题目 JSONB 字段。"""

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

DRAFT = "draft"
PUBLISHED = "published"


class QuestionBank(Base):
    __tablename__ = "question_banks"
    __table_args__ = (
        UniqueConstraint("owner_id", "source_id", name="uq_question_banks_owner_source_id"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(64), ForeignKey("users.username"), nullable=False, index=True)
    # Stable identity supplied by a Question Family / Prep Studio import.  It is
    # deliberately distinct from the database primary key so retries can update
    # the same owned bank without exposing internal IDs to clients.
    source_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    subject: Mapped[str] = mapped_column(String(32), default="PMP")
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    version: Mapped[str] = mapped_column(String(32), default="1.0")
    visibility: Mapped[str] = mapped_column(String(32), default="private")  # private/public-demo
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_by: Mapped[str | None] = mapped_column(
        String(64), ForeignKey("users.username", ondelete="SET NULL"), nullable=True
    )
    updated_by: Mapped[str | None] = mapped_column(
        String(64), ForeignKey("users.username", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Question(Base):
    __tablename__ = "questions"
    __table_args__ = (
        CheckConstraint("scope IN ('public', 'internal')", name="ck_questions_scope"),
        Index("ix_questions_bank_scope_lifecycle", "bank_id", "scope"),
        UniqueConstraint("bank_id", "source_id", name="uq_questions_bank_source_id"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    bank_id: Mapped[str] = mapped_column(String(64), ForeignKey("question_banks.id"), nullable=False, index=True)
    source_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    type: Mapped[str] = mapped_column(String(32), default="single_choice")
    subject: Mapped[str | None] = mapped_column(String(32), nullable=True)
    difficulty: Mapped[str | None] = mapped_column(String(32), nullable=True)
    domain: Mapped[str | None] = mapped_column(String(100), nullable=True)
    topic: Mapped[str | None] = mapped_column(String(100), nullable=True)
    teacher_number: Mapped[str | None] = mapped_column(String(64), nullable=True)
    scope: Mapped[str] = mapped_column(String(16), nullable=False, default="internal")
    content_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    creator_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    creator_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_by: Mapped[str | None] = mapped_column(
        String(64), ForeignKey("users.username", ondelete="SET NULL"), nullable=True
    )
    updated_by: Mapped[str | None] = mapped_column(
        String(64), ForeignKey("users.username", ondelete="SET NULL"), nullable=True
    )
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    tags: Mapped[list] = mapped_column(JSONB, default=list)
    stem_parts: Mapped[list] = mapped_column(JSONB, default=list)  # [{text, clue?}]
    options: Mapped[list] = mapped_column(JSONB, default=list)  # [{id, text, trap, correct}]
    correct_answer: Mapped[str | None] = mapped_column(String(20), nullable=True)
    analysis: Mapped[str | None] = mapped_column(Text, nullable=True)
    clues: Mapped[list] = mapped_column(JSONB, default=list)
    concepts: Mapped[list] = mapped_column(JSONB, default=list)
    reasoning_steps: Mapped[list] = mapped_column(JSONB, default=list)
    status: Mapped[dict] = mapped_column(JSONB, default=dict)
    translations: Mapped[dict] = mapped_column(JSONB, default=dict)
    content_metadata: Mapped[dict] = mapped_column("metadata", JSONB, default=dict)
    key_path: Mapped[dict] = mapped_column(JSONB, default=dict)
    lifecycle: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ExamPaper(Base):
    __tablename__ = "exam_papers"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(64), ForeignKey("users.username"), nullable=False, index=True)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    created_by: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey("users.username", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    updated_by: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey("users.username", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    deleted_by: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey("users.username", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        index=True,
    )
    deletion_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    subject: Mapped[str] = mapped_column(String(32), default="PMP")
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    total_count: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(16), default=DRAFT)  # draft/published
    quotas: Mapped[dict] = mapped_column(JSONB, default=dict)  # {domain: count}
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class PaperQuestion(Base):
    __tablename__ = "paper_questions"

    paper_id: Mapped[str] = mapped_column(String(64), ForeignKey("exam_papers.id"), primary_key=True)
    question_id: Mapped[str] = mapped_column(String(64), ForeignKey("questions.id"), primary_key=True)
    order_index: Mapped[int] = mapped_column(Integer, default=0)


class QuestionCleanupAudit(Base):
    """Append-only evidence for one successfully committed pool cleanup."""

    __tablename__ = "question_cleanup_audits"
    __table_args__ = (
        Index(
            "ix_question_cleanup_audits_manifest_hash",
            "manifest_hash",
            unique=True,
        ),
        Index(
            "ix_question_cleanup_audits_completed_at",
            "completed_at",
        ),
        Index(
            "ix_question_cleanup_audits_actor_username",
            "actor_username",
        ),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    manifest_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    snapshot_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    actor_username: Mapped[str] = mapped_column(String(64), nullable=False)
    backup_path: Mapped[str] = mapped_column(Text, nullable=False)
    backup_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    total_count: Mapped[int] = mapped_column(Integer, nullable=False)
    retained_count: Mapped[int] = mapped_column(Integer, nullable=False)
    deleted_count: Mapped[int] = mapped_column(Integer, nullable=False)
    repaired_reference_count: Mapped[int] = mapped_column(Integer, nullable=False)
    preserved_reference_count: Mapped[int] = mapped_column(Integer, nullable=False)
    deleted_question_ids: Mapped[list] = mapped_column(
        JSONB,
        nullable=False,
        default=list,
    )
    repair_summary: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
    )
    teaching_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )
    completed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )
