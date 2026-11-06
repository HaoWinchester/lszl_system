"""Immutable audio explanations attached to stable published node identities."""
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, LargeBinary, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class KnowledgeAudio(Base):
    __tablename__ = 'knowledge_node_audios'
    __table_args__ = (
        UniqueConstraint('taxonomy_id', 'node_id', 'sha256', name='uq_knowledge_node_audio_content'),
        CheckConstraint('byte_length > 0 AND byte_length <= 67108864', name='ck_knowledge_audio_size'),
        CheckConstraint('duration_ms > 0 AND duration_ms <= 43200000', name='ck_knowledge_audio_duration'),
    )
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    taxonomy_id: Mapped[str] = mapped_column(String(128), ForeignKey('content_taxonomies.id', ondelete='CASCADE'), nullable=False)
    # Node rows are replaced when a catalog is saved. Its business ID survives.
    node_id: Mapped[str] = mapped_column(String(128), nullable=False)
    title: Mapped[str] = mapped_column(String(240), nullable=False)
    filename: Mapped[str] = mapped_column(String(200), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(32), nullable=False)
    byte_length: Mapped[int] = mapped_column(Integer, nullable=False)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    data: Mapped[bytes] = mapped_column(LargeBinary, nullable=False, deferred=True)
    created_by: Mapped[str | None] = mapped_column(String(64), ForeignKey('users.username', ondelete='SET NULL'), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
