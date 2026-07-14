"""图谱文件存储模型：文件夹 / 文件索引 / 文件正文 / 标签 / 当前文件。

沿用原 v2 设计：轻量索引（GraphFile，列表/搜索/排序用）与完整正文（FileContent，打开时才读）分离。
owner_id 关联 users.username。
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

ACTIVE = "active"
TRASHED = "trashed"


class Folder(Base):
    __tablename__ = "folders"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(64), ForeignKey("users.username"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    parent_id: Mapped[str | None] = mapped_column(String(64), ForeignKey("folders.id"), nullable=True)
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(16), default=ACTIVE)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class GraphFile(Base):
    """文件轻量索引（不含正文）。"""

    __tablename__ = "graph_files"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(64), ForeignKey("users.username"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    folder_id: Mapped[str | None] = mapped_column(String(64), ForeignKey("folders.id"), nullable=True)
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(16), default=ACTIVE)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    node_count: Mapped[int] = mapped_column(Integer, default=0)
    link_count: Mapped[int] = mapped_column(Integer, default=0)
    byte_size: Mapped[int] = mapped_column(Integer, default=0)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    source: Mapped[str] = mapped_column(String(32), default="created")
    source_file_id: Mapped[str | None] = mapped_column(String(64), nullable=True)

    preview: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    structure_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    last_opened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class FileContent(Base):
    """文件完整正文（graphData + learning_state），打开/保存时才读写。"""

    __tablename__ = "file_contents"

    file_id: Mapped[str] = mapped_column(String(64), ForeignKey("graph_files.id"), primary_key=True)
    graph_data: Mapped[dict] = mapped_column(JSONB, nullable=False)
    learning_state: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    saved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Tag(Base):
    __tablename__ = "tags"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(64), ForeignKey("users.username"), nullable=False)
    name: Mapped[str] = mapped_column(String(40), nullable=False)
    color: Mapped[str] = mapped_column(String(16), default="#64748b")


class FileTag(Base):
    __tablename__ = "file_tags"

    file_id: Mapped[str] = mapped_column(String(64), ForeignKey("graph_files.id"), primary_key=True)
    tag_id: Mapped[str] = mapped_column(String(64), ForeignKey("tags.id"), primary_key=True)


class CurrentFile(Base):
    """每个用户当前打开的文件（首页页签用）。"""

    __tablename__ = "current_files"

    owner_id: Mapped[str] = mapped_column(String(64), ForeignKey("users.username"), primary_key=True)
    file_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
