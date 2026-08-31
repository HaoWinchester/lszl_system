"""训练进度与深度回忆进度模型。按 owner + question 隔离。"""

from datetime import datetime
import uuid

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class TrainingProgress(Base):
    """用户对每个发布版本内题目的作答进度。"""

    __tablename__ = "training_progress"
    __table_args__ = (
        Index(
            "uq_training_owner_question_release",
            "owner_id", "question_id", func.coalesce(text("release_id"), text("''")), unique=True,
        ),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(64), ForeignKey("users.username"), nullable=False)
    # 发布快照在 canonical 题目删除后仍需可续学，因此这里只保存稳定引用。
    question_id: Mapped[str] = mapped_column(String(64), nullable=False)
    release_id: Mapped[str | None] = mapped_column(
        String(64), ForeignKey("paper_releases.id", ondelete="RESTRICT"), nullable=True
    )
    bank_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    paper_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    selected_answer: Mapped[str | None] = mapped_column(String(64), nullable=True)
    submitted: Mapped[bool] = mapped_column(default=False)
    found_clues: Mapped[list] = mapped_column(JSONB, default=list)
    reasoning_state: Mapped[dict] = mapped_column(JSONB, default=dict)
    session_data: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class RecallProgress(Base):
    """用户对每道题及可选发布版本的深度回忆画布进度。"""

    __tablename__ = "recall_progress"
    __table_args__ = (
        Index(
            "uq_recall_progress_owner_question_release",
            "owner_id", "question_id", func.coalesce(text("release_id"), text("''")), unique=True,
        ),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: str(uuid.uuid4()))
    owner_id: Mapped[str] = mapped_column(String(64), ForeignKey("users.username"), nullable=False)
    question_id: Mapped[str] = mapped_column(String(64), nullable=False)
    release_id: Mapped[str | None] = mapped_column(
        String(64), ForeignKey("paper_releases.id", ondelete="RESTRICT"), nullable=True
    )
    bank_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    source_question_revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    source_content_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    recall_library_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    graph_schema_version: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    nodes: Mapped[list] = mapped_column(JSONB, default=list)
    edges: Mapped[list] = mapped_column(JSONB, default=list)
    custom_nodes: Mapped[list | dict] = mapped_column(JSONB, default=list)
    active_keywords: Mapped[list] = mapped_column(JSONB, default=list)
    choice_offsets: Mapped[dict] = mapped_column(JSONB, default=dict)
    transform: Mapped[dict] = mapped_column(
        JSONB,
        default=lambda: {"x": 0, "y": 0, "scale": 1},
    )
    metrics: Mapped[dict] = mapped_column(JSONB, default=dict)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    saved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class RecallQuestionSnapshot(Base):
    """深度回忆使用的不可变题目版本快照。"""

    __tablename__ = "recall_question_snapshots"
    __table_args__ = (
        Index(
            "uq_recall_question_snapshot_revision_release",
            "question_id", "question_revision", func.coalesce(text("release_id"), text("''")), unique=True,
        ),
    )

    id: Mapped[str] = mapped_column(
        String(64),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )
    question_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    release_id: Mapped[str | None] = mapped_column(
        String(64), ForeignKey("paper_releases.id", ondelete="RESTRICT"), nullable=True
    )
    bank_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    question_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    subject: Mapped[str] = mapped_column(String(100), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class RecallLibrarySnapshot(Base):
    """深度回忆使用的不可变正式 Recall 联想库快照。"""

    __tablename__ = "recall_library_snapshots"
    __table_args__ = (
        UniqueConstraint(
            "subject",
            "content_hash",
            name="uq_recall_library_snapshot_hash",
        ),
    )

    id: Mapped[str] = mapped_column(
        String(64),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )
    subject: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    source_revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class LearningEvent(Base):
    """用户学习过程中产生的追加式领域事件。"""

    __tablename__ = "learning_events"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(64), ForeignKey("users.username"), nullable=False, index=True)
    question_id: Mapped[str | None] = mapped_column(
        String(64), ForeignKey("questions.id", ondelete="SET NULL"), nullable=True, index=True
    )
    event_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class PracticeSession(Base):
    """Learner-owned, resumable practice progress and frozen result facts."""

    __tablename__ = "practice_sessions"
    __table_args__ = (
        CheckConstraint(
            "mode IN ('challenge', 'scholar', 'revenge', 'practice')",
            name="ck_practice_sessions_mode",
        ),
        CheckConstraint(
            "status IN ('active', 'paused', 'completed', 'abandoned')",
            name="ck_practice_sessions_status",
        ),
        CheckConstraint("revision >= 1", name="ck_practice_sessions_revision"),
        Index(
            "uq_practice_sessions_one_resumable",
            "owner_id",
            "paper_id",
            "release_id",
            "mode",
            unique=True,
            postgresql_where=text("status IN ('active', 'paused')"),
        ),
        Index(
            "ix_practice_sessions_owner_saved",
            "owner_id",
            "last_saved_at",
        ),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("users.username", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    paper_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    release_id: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey("paper_releases.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    mode: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active", index=True)
    question_order: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    answers: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    runtime_state: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    stats: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    scoring_snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    report_snapshot: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    last_saved_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
        index=True,
    )
    paused_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    abandoned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class PracticeMistake(Base):
    """A learner-owned wrong-answer record and its remediation state machine."""

    __tablename__ = "practice_mistakes"
    __table_args__ = (
        Index(
            "uq_practice_mistake_owner_question_release",
            "owner_id", "question_id", func.coalesce(text("release_id"), text("''")), unique=True,
        ),
        CheckConstraint(
            "status IN ('pending', 'needs_remediation', 'verification_due', 'mastered')",
            name="ck_practice_mistakes_status",
        ),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(64), ForeignKey("users.username", ondelete="CASCADE"), nullable=False, index=True)
    question_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    bank_id: Mapped[str | None] = mapped_column(String(64), ForeignKey("question_banks.id", ondelete="SET NULL"), nullable=True)
    paper_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    release_id: Mapped[str | None] = mapped_column(
        String(64), ForeignKey("paper_releases.id", ondelete="RESTRICT"), nullable=True
    )
    paper_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    paper_name: Mapped[str] = mapped_column(String(200), nullable=False, default="错题来源试卷")
    source_mode: Mapped[str] = mapped_column(String(32), nullable=False, default="challenge")
    language_mode: Mapped[str] = mapped_column(String(16), nullable=False, default="zh")
    question_snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    knowledge: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    selected_answers: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending", index=True)
    wrong_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    revenge_attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    revenge_wrong_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    revenge_correct_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    verification_attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    verification_pass_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    verification_fail_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    first_wrong_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    last_wrong_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    last_revenge_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    next_review_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    remediation_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    mastered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False, index=True
    )


class PracticeVerification(Base):
    """Immutable evidence from a different question used after remediation."""

    __tablename__ = "practice_verifications"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    mistake_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("practice_mistakes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    owner_id: Mapped[str] = mapped_column(String(64), ForeignKey("users.username", ondelete="CASCADE"), nullable=False, index=True)
    question_id: Mapped[str | None] = mapped_column(String(64), ForeignKey("questions.id", ondelete="SET NULL"), nullable=True)
    bank_id: Mapped[str | None] = mapped_column(String(64), ForeignKey("question_banks.id", ondelete="SET NULL"), nullable=True)
    selected_answer: Mapped[str | None] = mapped_column(String(64), nullable=True)
    selected_answer_ids: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    correct: Mapped[bool] = mapped_column(nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class CanvasWorkspace(Base):
    """多题归纳画布；内容采用 new-legacy workspace schema。"""

    __tablename__ = "canvas_workspaces"
    __table_args__ = (UniqueConstraint("owner_id", "id", name="uq_canvas_workspace_owner_id"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(64), ForeignKey("users.username"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    schema_version: Mapped[int] = mapped_column(Integer, default=6)
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), index=True
    )


class PersonalSynthesisCard(Base):
    """A learner-owned synthesis card reusable across canvas workspaces."""

    __tablename__ = "personal_synthesis_cards"
    __table_args__ = (
        Index("ix_personal_cards_owner_archived_updated", "owner_id", "archived_at", "updated_at"),
        CheckConstraint(
            "synthesis_type IN ('principle', 'routine', 'trap', 'note')",
            name="ck_personal_cards_type",
        ),
        CheckConstraint(
            "status IN ('draft', 'verified', 'mastered')",
            name="ck_personal_cards_status",
        ),
        CheckConstraint("revision >= 1", name="ck_personal_cards_revision"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("users.username", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    synthesis_type: Mapped[str] = mapped_column(String(32), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    tags: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="draft")
    source_question_refs: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False, index=True
    )
