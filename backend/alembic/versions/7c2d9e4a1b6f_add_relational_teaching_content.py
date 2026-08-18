"""add relational teaching content tables

Revision ID: 7c2d9e4a1b6f
Revises: 1faccfc2dca1
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "7c2d9e4a1b6f"
down_revision = "1faccfc2dca1"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("content_subjects", sa.Column("id", sa.String(128), primary_key=True), sa.Column("code", sa.String(64), nullable=False, unique=True), sa.Column("name", sa.String(160), nullable=False), sa.Column("status", sa.String(24), nullable=False, server_default="active"), sa.Column("content_metadata", postgresql.JSONB, nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False), sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))
    op.create_table("content_taxonomies", sa.Column("id", sa.String(128), primary_key=True), sa.Column("subject_id", sa.String(128), sa.ForeignKey("content_subjects.id", ondelete="RESTRICT"), nullable=False), sa.Column("version", sa.Integer, nullable=False, server_default="1"), sa.Column("status", sa.String(24), nullable=False, server_default="draft"), sa.Column("title", sa.String(240), nullable=False, server_default=""), sa.Column("content_metadata", postgresql.JSONB, nullable=False), sa.Column("published_at", sa.DateTime(timezone=True)), sa.Column("created_by", sa.String(64), sa.ForeignKey("users.username", ondelete="SET NULL")), sa.Column("updated_by", sa.String(64), sa.ForeignKey("users.username", ondelete="SET NULL")), sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False), sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False), sa.UniqueConstraint("subject_id", "version", name="uq_content_taxonomy_subject_version"), sa.CheckConstraint("status IN ('draft', 'published', 'archived')", name="ck_content_taxonomy_status"))
    op.create_table("taxonomy_nodes", sa.Column("id", sa.String(160), primary_key=True), sa.Column("taxonomy_id", sa.String(128), sa.ForeignKey("content_taxonomies.id", ondelete="CASCADE"), nullable=False), sa.Column("node_id", sa.String(128), nullable=False), sa.Column("parent_node_id", sa.String(128)), sa.Column("title", sa.String(300), nullable=False, server_default=""), sa.Column("record", postgresql.JSONB, nullable=False), sa.Column("position", sa.Integer, nullable=False, server_default="0"), sa.Column("status", sa.String(24), nullable=False, server_default="active"), sa.UniqueConstraint("taxonomy_id", "node_id", name="uq_taxonomy_node_id"))
    op.create_table("activity_collections", sa.Column("id", sa.String(128), primary_key=True), sa.Column("subject_id", sa.String(128), sa.ForeignKey("content_subjects.id", ondelete="RESTRICT"), nullable=False), sa.Column("title", sa.String(240), nullable=False, server_default=""), sa.Column("status", sa.String(24), nullable=False, server_default="active"), sa.Column("content_metadata", postgresql.JSONB, nullable=False))
    op.create_table("activity_tags", sa.Column("id", sa.String(128), primary_key=True), sa.Column("collection_id", sa.String(128), sa.ForeignKey("activity_collections.id", ondelete="CASCADE"), nullable=False), sa.Column("tag", sa.String(128), nullable=False), sa.UniqueConstraint("collection_id", "tag", name="uq_activity_collection_tag"))
    op.create_table("activity_overrides", sa.Column("id", sa.String(128), primary_key=True), sa.Column("collection_id", sa.String(128), sa.ForeignKey("activity_collections.id", ondelete="CASCADE"), nullable=False), sa.Column("activity_id", sa.String(128), nullable=False), sa.Column("record", postgresql.JSONB, nullable=False), sa.Column("revision", sa.Integer, nullable=False, server_default="1"), sa.Column("updated_by", sa.String(64), sa.ForeignKey("users.username", ondelete="SET NULL")), sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False), sa.UniqueConstraint("collection_id", "activity_id", name="uq_activity_override"))
    op.create_table("recall_association_libraries", sa.Column("id", sa.String(128), primary_key=True), sa.Column("subject_id", sa.String(128), sa.ForeignKey("content_subjects.id", ondelete="RESTRICT"), nullable=False), sa.Column("version", sa.Integer, nullable=False, server_default="1"), sa.Column("status", sa.String(24), nullable=False, server_default="published"), sa.Column("nodes", postgresql.JSONB, nullable=False), sa.Column("edges", postgresql.JSONB, nullable=False), sa.Column("content_metadata", postgresql.JSONB, nullable=False), sa.Column("updated_by", sa.String(64), sa.ForeignKey("users.username", ondelete="SET NULL")), sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False), sa.UniqueConstraint("subject_id", "version", name="uq_recall_library_subject_version"))
    op.create_table("teaching_content_audits", sa.Column("id", sa.String(64), primary_key=True), sa.Column("entity_type", sa.String(48), nullable=False), sa.Column("entity_id", sa.String(128), nullable=False), sa.Column("action", sa.String(48), nullable=False), sa.Column("actor_username", sa.String(64), nullable=False), sa.Column("before", postgresql.JSONB, nullable=False), sa.Column("after", postgresql.JSONB, nullable=False), sa.Column("detail", sa.Text), sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))
    for table, column in (("activity_collections", "subject_id"), ("activity_overrides", "collection_id"), ("activity_tags", "collection_id"), ("content_taxonomies", "subject_id"), ("recall_association_libraries", "subject_id"), ("taxonomy_nodes", "taxonomy_id"), ("teaching_content_audits", "actor_username"), ("teaching_content_audits", "entity_id"), ("teaching_content_audits", "entity_type")):
        op.create_index(f"ix_{table}_{column}", table, [column])


def downgrade():
    for table in ("teaching_content_audits", "recall_association_libraries", "activity_overrides", "activity_tags", "activity_collections", "taxonomy_nodes", "content_taxonomies", "content_subjects"):
        op.drop_table(table)
