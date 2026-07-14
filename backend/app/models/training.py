"""训练进度与深度回忆进度模型。按 owner + question 隔离。"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func
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
    saved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
