"""训练进度与深度回忆进度模型。按 owner + question 隔离。"""

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class TrainingProgress(Base):
    """用户对每道题的作答进度（owner + question 唯一）。"""

    __tablename__ = "training_progress"
    __table_args__ = (UniqueConstraint("owner_id", "question_id", name="uq_training_owner_question"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(64), ForeignKey("users.username"), nullable=False)
    question_id: Mapped[str] = mapped_column(String(64), ForeignKey("questions.id"), nullable=False)
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
    """用户对每道题的深度回忆画布进度（owner + question 复合主键）。"""

    __tablename__ = "recall_progress"

    owner_id: Mapped[str] = mapped_column(String(64), ForeignKey("users.username"), primary_key=True)
    question_id: Mapped[str] = mapped_column(String(64), ForeignKey("questions.id"), primary_key=True)
    nodes: Mapped[list] = mapped_column(JSONB, default=list)
    edges: Mapped[list] = mapped_column(JSONB, default=list)
    custom_nodes: Mapped[dict] = mapped_column(JSONB, default=dict)
    active_keywords: Mapped[list] = mapped_column(JSONB, default=list)
    choice_offsets: Mapped[dict] = mapped_column(JSONB, default=dict)
    metrics: Mapped[dict] = mapped_column(JSONB, default=dict)
    transform: Mapped[dict] = mapped_column(JSONB, default=dict)
    saved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class LearningEvent(Base):
    """用户学习过程中产生的追加式领域事件。"""

    __tablename__ = "learning_events"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(64), ForeignKey("users.username"), nullable=False, index=True)
    question_id: Mapped[str | None] = mapped_column(String(64), ForeignKey("questions.id"), nullable=True, index=True)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class PracticeMistake(Base):
    """A learner-owned wrong-answer record and its remediation state machine."""

    __tablename__ = "practice_mistakes"
    __table_args__ = (
        UniqueConstraint("owner_id", "question_id", "release_id", name="uq_practice_mistake_owner_question_release"),
        CheckConstraint(
            "status IN ('pending', 'needs_remediation', 'verification_due', 'mastered')",
            name="ck_practice_mistakes_status",
        ),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(64), ForeignKey("users.username", ondelete="CASCADE"), nullable=False, index=True)
    question_id: Mapped[str | None] = mapped_column(String(64), ForeignKey("questions.id", ondelete="SET NULL"), nullable=True, index=True)
    bank_id: Mapped[str | None] = mapped_column(String(64), ForeignKey("question_banks.id", ondelete="SET NULL"), nullable=True)
    paper_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    release_id: Mapped[str] = mapped_column(String(128), nullable=False, default="")
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
