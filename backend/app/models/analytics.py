"""用户功能偏好遥测事件。

与题目级 learning_events 刻意分离：本表只承载允许列表内的功能使用事件，
用于管理员去标识化聚合，不含题目答案、身份细节或自由 payload。
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class FeatureUsageEvent(Base):
    """用户在各功能模块产生的允许列表内遥测事件。"""

    __tablename__ = "feature_usage_events"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("users.username", ondelete="CASCADE"), nullable=False, index=True
    )
    feature_key: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    action_key: Mapped[str | None] = mapped_column(String(32), nullable=True)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
