"""Runtime state 领域迁移的可审计执行账本。"""

from datetime import datetime
import uuid

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class RuntimeMigrationRun(Base):
    __tablename__ = "runtime_migration_runs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: str(uuid.uuid4()))
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="scanning")
    report: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    source_snapshot_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    source_snapshot_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    backup_reference: Mapped[str | None] = mapped_column(Text, nullable=True)
    snapshot_created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class RuntimeMigrationItem(Base):
    __tablename__ = "runtime_migration_items"
    __table_args__ = (
        UniqueConstraint(
            "run_id",
            "source_type",
            "source_key",
            "owner_scope",
            "source_hash",
            name="uq_runtime_migration_item_source_hash",
        ),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: str(uuid.uuid4()))
    run_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("runtime_migration_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    source_type: Mapped[str] = mapped_column(String(32), nullable=False)
    source_key: Mapped[str] = mapped_column(String(255), nullable=False)
    owner_scope: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    source_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    source_payload: Mapped[object] = mapped_column(JSONB, nullable=False)
    required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # Explicit ledger classification prevents an unreviewed legacy key from being dropped.
    disposition: Mapped[str] = mapped_column(String(40), nullable=False, default="unknown")
    target_domain: Mapped[str | None] = mapped_column(String(80), nullable=True)
    discard_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    verification_metadata: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    source_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    expected_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    expected_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    target_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    target_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
