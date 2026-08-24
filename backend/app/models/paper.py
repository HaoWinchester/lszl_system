"""Relational paper categories and idempotent paper operations."""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PaperCategory(Base):
    __tablename__ = "paper_categories"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("users.username"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    order_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    archived_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    created_by: Mapped[str | None] = mapped_column(
        String(64), ForeignKey("users.username", ondelete="SET NULL"), nullable=True
    )
    updated_by: Mapped[str | None] = mapped_column(
        String(64), ForeignKey("users.username", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class PaperGenerationBatch(Base):
    __tablename__ = "paper_generation_batches"
    __table_args__ = (
        UniqueConstraint(
            "actor_username",
            "idempotency_key",
            name="uq_paper_generation_actor_key",
        ),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("users.username"), nullable=False, index=True
    )
    actor_username: Mapped[str] = mapped_column(
        String(64), ForeignKey("users.username"), nullable=False, index=True
    )
    idempotency_key: Mapped[str] = mapped_column(String(120), nullable=False)
    subject: Mapped[str] = mapped_column(String(32), nullable=False, default="PMP")
    bank_ids: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    filter_config: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    quota_config: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    random_seed: Mapped[str] = mapped_column(String(128), nullable=False)
    requested_variants: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    created_paper_ids: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="created")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class PaperImportOperation(Base):
    __tablename__ = "paper_import_operations"
    __table_args__ = (
        UniqueConstraint(
            "actor_username",
            "idempotency_key",
            name="uq_paper_import_actor_key",
        ),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("users.username"), nullable=False, index=True
    )
    actor_username: Mapped[str] = mapped_column(
        String(64), ForeignKey("users.username"), nullable=False, index=True
    )
    idempotency_key: Mapped[str] = mapped_column(String(120), nullable=False)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    conflict_action: Mapped[str] = mapped_column(String(32), nullable=False)
    result_paper_id: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey("exam_papers.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    result_payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    completed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
