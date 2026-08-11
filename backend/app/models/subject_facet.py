"""Versioned, shared subject-facet schema snapshots for the question catalog."""

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class SubjectFacetSchema(Base):
    """The current canonical schema for one subject.

    ``schema_id`` is deliberately stable.  The mutable definition lives in one
    row per subject; ``schema_version`` records the public schema version while
    ``revision`` records every server-side write for audit/concurrency clients.
    Existing values are never silently removed by the service layer, which
    keeps facet snapshots previously stored on questions interpretable.
    """

    __tablename__ = "subject_facet_schemas"
    __table_args__ = (
        UniqueConstraint("subject_id", name="uq_subject_facet_schemas_subject_id"),
        CheckConstraint(
            "status IN ('active', 'inactive', 'deprecated')",
            name="ck_subject_facet_schemas_status",
        ),
        Index("ix_subject_facet_schemas_subject_id", "subject_id"),
    )

    schema_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    subject_id: Mapped[str] = mapped_column(String(128), nullable=False)
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    name: Mapped[str] = mapped_column(String(300), nullable=False)
    subject_codes: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    dimensions: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active")
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_by: Mapped[str | None] = mapped_column(
        String(64), ForeignKey("users.username", ondelete="SET NULL"), nullable=True
    )
    updated_by: Mapped[str | None] = mapped_column(
        String(64), ForeignKey("users.username", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
