"""角色主题与系统设置模型。"""

from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class RoleTheme(Base):
    __tablename__ = "role_themes"

    role: Mapped[str] = mapped_column(String(16), primary_key=True)
    primary_color: Mapped[str] = mapped_column(String(16), nullable=False)
    accent_color: Mapped[str] = mapped_column(String(16), nullable=False)
    soft_color: Mapped[str] = mapped_column(String(16), nullable=False)
    text_color: Mapped[str] = mapped_column(String(16), nullable=False)


class SystemSetting(Base):
    """全局 KV 配置：订阅套餐展示、微信登录配置、权限模板等。"""

    __tablename__ = "system_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[dict] = mapped_column(JSONB, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
