"""Versioned server-owned graph publications and independent load receipts."""
from enum import Enum
from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base

class TemplateCategory(str, Enum):
    pmp = 'pmp'
    prince2 = 'prince2'
    cspm = 'cspm'
    gaoxiang = 'gaoxiang'
    general = 'general'


CATEGORY_LABELS = {
    TemplateCategory.pmp: 'PMP', TemplateCategory.prince2: 'PRINCE2',
    TemplateCategory.cspm: 'CSPM', TemplateCategory.gaoxiang: '高项',
    TemplateCategory.general: '通用学习',
}


class GraphTemplate(Base):
    __tablename__ = 'graph_templates'
    __table_args__ = (CheckConstraint("category IN (" + ", ".join(repr(category.value) for category in TemplateCategory) + ")", name='ck_graph_templates_category'),)
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(64), ForeignKey('users.username'), index=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default='')
    member_only: Mapped[bool] = mapped_column(Boolean, default=False)
    listed: Mapped[bool] = mapped_column(Boolean, default=True)
    category: Mapped[str] = mapped_column(String(16), default=TemplateCategory.general.value, server_default='general')
    current_version: Mapped[int] = mapped_column(Integer, default=1)

class GraphTemplateVersion(Base):
    __tablename__ = 'graph_template_versions'
    __table_args__ = (UniqueConstraint('template_id', 'version'),)
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    template_id: Mapped[str] = mapped_column(String(64), ForeignKey('graph_templates.id'), index=True)
    version: Mapped[int] = mapped_column(Integer)
    source_file_id: Mapped[str] = mapped_column(String(64))
    source_revision: Mapped[int] = mapped_column(Integer)
    asset_owner: Mapped[str] = mapped_column(String(64), ForeignKey('users.username'))
    graph_data: Mapped[dict] = mapped_column(JSONB)
    bindings: Mapped[dict] = mapped_column(JSONB)

class GraphTemplateLoad(Base):
    __tablename__ = 'graph_template_loads'
    __table_args__ = (UniqueConstraint('owner_id', 'request_id'),)
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(64), ForeignKey('users.username'), index=True)
    request_id: Mapped[str] = mapped_column(String(128))
    template_id: Mapped[str] = mapped_column(String(64), ForeignKey('graph_templates.id'))
    version: Mapped[int] = mapped_column(Integer)
    file_id: Mapped[str] = mapped_column(String(64))
    id_map: Mapped[dict] = mapped_column(JSONB)
