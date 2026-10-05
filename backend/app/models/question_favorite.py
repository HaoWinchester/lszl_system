"""题目收藏模型：按 owner 隔离，(question_id, owner_id) 唯一。"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class QuestionFavorite(Base):
    __tablename__ = "question_favorites"
    __table_args__ = (
        Index("ix_question_favorites_owner_created", "owner_id", "created_at"),
    )

    question_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("questions.id", ondelete="CASCADE"), primary_key=True
    )
    owner_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("users.username", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
