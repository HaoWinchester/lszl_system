"""v9 全局共享内容（published 试卷/课程/学习任务）。

v9 前端把这些键当"全局共享"读（无 scope 前缀，所有用户读同一份）。
独立于按账号隔离的 runtime_states，让教师发布的内容能被学员跨账号读到。
每个共享键一行（key 主键），由发布者做 read-modify-write 合并后整键覆盖。
"""

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class SharedRuntimeState(Base):
    __tablename__ = "shared_runtime_states"

    key: Mapped[str] = mapped_column(String(120), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False, default="")
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    updated_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
