"""题目留言与点赞模型。评论是学员间公共讨论内容，读不限 owner；管理删除走软删。"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

VISIBLE = "visible"
HIDDEN = "hidden"


class QuestionComment(Base):
    __tablename__ = "question_comments"
    __table_args__ = (
        Index("ix_question_comments_question_created", "question_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    question_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("questions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    owner_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("users.username"), nullable=False, index=True
    )
    content: Mapped[str] = mapped_column(String(200), nullable=False)
    like_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=VISIBLE, server_default=VISIBLE)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class QuestionCommentLike(Base):
    __tablename__ = "question_comment_likes"
    __table_args__ = (
        UniqueConstraint("comment_id", "owner_id", name="uq_question_comment_likes_comment_owner"),
    )

    comment_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("question_comments.id", ondelete="CASCADE"),
        primary_key=True,
    )
    owner_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("users.username"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
