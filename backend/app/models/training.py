"""训练进度与深度回忆进度模型。按 owner + question 隔离。"""

from datetime import datetime
import uuid

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, func
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
        UniqueConstraint(
            "question_id",
            "question_revision",
            name="uq_recall_question_snapshot_revision",
        ),
    )

    id: Mapped[str] = mapped_column(
        String(64),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )
    question_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
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
    question_id: Mapped[str | None] = mapped_column(String(64), ForeignKey("questions.id"), nullable=True, index=True)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


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
