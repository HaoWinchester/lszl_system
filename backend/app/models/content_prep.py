"""Server-authoritative Content Prep metadata, edit leases, batches and audit records."""

from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class QuestionBankCollaborator(Base):
    __tablename__ = "question_bank_collaborators"
    __table_args__ = (
        UniqueConstraint("bank_id", "username", name="uq_question_bank_collaborator"),
        CheckConstraint("permission IN ('view', 'edit')", name="ck_question_bank_collaborator_permission"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    bank_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("question_banks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    username: Mapped[str] = mapped_column(
        String(64), ForeignKey("users.username", ondelete="CASCADE"), nullable=False, index=True
    )
    permission: Mapped[str] = mapped_column(String(16), nullable=False, default="view")
    granted_by: Mapped[str | None] = mapped_column(
        String(64), ForeignKey("users.username", ondelete="SET NULL"), nullable=True
    )
    granted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Principle(Base):
    __tablename__ = "principles"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    name: Mapped[str] = mapped_column(String(300), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active")
    confusable_principle_ids: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
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


class SynthesisPreset(Base):
    __tablename__ = "synthesis_presets"
    __table_args__ = (
        UniqueConstraint(
            "principle_id",
            name="uq_synthesis_presets_principle_id",
        ),
    )

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    principle_id: Mapped[str] = mapped_column(
        String(128), ForeignKey("principles.id", ondelete="RESTRICT"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active")
    business_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
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


class QuestionTagConfig(Base):
    __tablename__ = "question_tag_configs"
    __table_args__ = (
        Index(
            "uq_question_tag_configs_active",
            "active",
            unique=True,
            postgresql_where=text("active IS true"),
        ),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    names: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    group_names: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    category_names: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    aliases: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    slot_schema: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
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


class QuestionEditLock(Base):
    __tablename__ = "question_edit_locks"

    question_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("questions.id", ondelete="CASCADE"), primary_key=True
    )
    locked_by: Mapped[str] = mapped_column(
        String(64), ForeignKey("users.username", ondelete="CASCADE"), nullable=False, index=True
    )
    creator_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    creator_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    client_instance_id: Mapped[str] = mapped_column(String(128), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    acquired_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    heartbeat_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)


class QuestionUploadBatch(Base):
    __tablename__ = "question_upload_batches"
    __table_args__ = (
        UniqueConstraint("actor_username", "idempotency_key", name="uq_question_upload_actor_key"),
        CheckConstraint(
            "status IN ('pending', 'committed', 'rolled_back')",
            name="ck_question_upload_batch_status",
        ),
        CheckConstraint(
            "(creator_id IS NULL) = (creator_name IS NULL)",
            name="ck_question_upload_batch_creator_pair",
        ),
        Index("ix_question_upload_batches_actor_created", "actor_username", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    idempotency_key: Mapped[str] = mapped_column(String(120), nullable=False)
    bank_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("question_banks.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    actor_username: Mapped[str] = mapped_column(String(64), nullable=False)
    actor_role: Mapped[str] = mapped_column(String(32), nullable=False)
    creator_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    creator_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    client_instance_id: Mapped[str] = mapped_column(String(128), nullable=False)
    prep_version: Mapped[str | None] = mapped_column(String(32), nullable=True)
    workspace_version: Mapped[str | None] = mapped_column(String(32), nullable=True)
    manifest_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    input_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    skipped_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="pending")
    result: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    error_summary: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    committed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class QuestionAuditLog(Base):
    __tablename__ = "question_audit_logs"
    __table_args__ = (
        Index("ix_question_audit_logs_entity_created", "entity_type", "entity_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    entity_type: Mapped[str] = mapped_column(String(32), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(128), nullable=False)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    actor_username: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    actor_role: Mapped[str] = mapped_column(String(32), nullable=False)
    creator_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    creator_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    bank_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    question_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    batch_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    before_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    after_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    before_revision: Mapped[int | None] = mapped_column(Integer, nullable=True)
    after_revision: Mapped[int | None] = mapped_column(Integer, nullable=True)
    outcome: Mapped[str] = mapped_column(String(32), nullable=False, default="success")
    detail: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
