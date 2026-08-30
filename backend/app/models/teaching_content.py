"""关系化教学内容目录、活动覆盖、联想库及审计记录。"""

from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ContentSubject(Base):
    __tablename__ = "content_subjects"
    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="active")
    content_metadata: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class ContentTaxonomy(Base):
    __tablename__ = "content_taxonomies"
    __table_args__ = (
        UniqueConstraint("subject_id", "version", name="uq_content_taxonomy_subject_version"),
        CheckConstraint("status IN ('draft', 'published', 'archived')", name="ck_content_taxonomy_status"),
    )
    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    subject_id: Mapped[str] = mapped_column(String(128), ForeignKey("content_subjects.id", ondelete="RESTRICT"), nullable=False, index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="draft")
    title: Mapped[str] = mapped_column(String(240), nullable=False, default="")
    content_metadata: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(64), ForeignKey("users.username", ondelete="SET NULL"), nullable=True)
    updated_by: Mapped[str | None] = mapped_column(String(64), ForeignKey("users.username", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class TaxonomyNode(Base):
    __tablename__ = "taxonomy_nodes"
    __table_args__ = (UniqueConstraint("taxonomy_id", "node_id", name="uq_taxonomy_node_id"),)
    id: Mapped[str] = mapped_column(String(160), primary_key=True)
    taxonomy_id: Mapped[str] = mapped_column(String(128), ForeignKey("content_taxonomies.id", ondelete="CASCADE"), nullable=False, index=True)
    node_id: Mapped[str] = mapped_column(String(128), nullable=False)
    parent_node_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    record: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="active")


class ActivityCollection(Base):
    __tablename__ = "activity_collections"
    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    subject_id: Mapped[str] = mapped_column(String(128), ForeignKey("content_subjects.id", ondelete="RESTRICT"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(240), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="active")
    content_metadata: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    owner_username: Mapped[str | None] = mapped_column(
        String(64), ForeignKey("users.username", ondelete="SET NULL"), nullable=True, index=True
    )


class ActivityTag(Base):
    __tablename__ = "activity_tags"
    __table_args__ = (UniqueConstraint("collection_id", "tag", name="uq_activity_collection_tag"),)
    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    collection_id: Mapped[str] = mapped_column(String(128), ForeignKey("activity_collections.id", ondelete="CASCADE"), nullable=False, index=True)
    tag: Mapped[str] = mapped_column(String(128), nullable=False)
    content_metadata: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    owner_username: Mapped[str | None] = mapped_column(
        String(64), ForeignKey("users.username", ondelete="SET NULL"), nullable=True, index=True
    )


class ActivityOverride(Base):
    __tablename__ = "activity_overrides"
    __table_args__ = (UniqueConstraint("collection_id", "activity_id", name="uq_activity_override"),)
    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    collection_id: Mapped[str] = mapped_column(String(128), ForeignKey("activity_collections.id", ondelete="CASCADE"), nullable=False, index=True)
    activity_id: Mapped[str] = mapped_column(String(128), nullable=False)
    record: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    updated_by: Mapped[str | None] = mapped_column(String(64), ForeignKey("users.username", ondelete="SET NULL"), nullable=True)
    owner_username: Mapped[str | None] = mapped_column(
        String(64), ForeignKey("users.username", ondelete="SET NULL"), nullable=True, index=True
    )
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class RecallAssociationLibrary(Base):
    __tablename__ = "recall_association_libraries"
    __table_args__ = (UniqueConstraint("subject_id", "version", name="uq_recall_library_subject_version"),)
    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    subject_id: Mapped[str] = mapped_column(String(128), ForeignKey("content_subjects.id", ondelete="RESTRICT"), nullable=False, index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="published")
    nodes: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    edges: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    content_metadata: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    updated_by: Mapped[str | None] = mapped_column(String(64), ForeignKey("users.username", ondelete="SET NULL"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class TeachingContentAudit(Base):
    __tablename__ = "teaching_content_audits"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    entity_type: Mapped[str] = mapped_column(String(48), nullable=False, index=True)
    entity_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(48), nullable=False)
    actor_username: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    before: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    after: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class TeachingContentRevision(Base):
    """Singleton monotonic revision for all shared teaching-content writes."""

    __tablename__ = "teaching_content_revisions"
    __table_args__ = (
        CheckConstraint("id = 1", name="ck_teaching_content_revision_singleton"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    revision: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )
    changes: Mapped[list] = mapped_column(
        JSONB,
        nullable=False,
        default=list,
        server_default=text("'[]'::jsonb"),
    )
    updated_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
