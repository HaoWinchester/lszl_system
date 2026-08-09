"""add server-authoritative content prep catalog

Revision ID: a91c4d7e2f60
Revises: 3545e387bfac
Create Date: 2026-08-09 15:45:00

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "a91c4d7e2f60"
down_revision: Union[str, None] = "3545e387bfac"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "question_banks",
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
    )
    op.add_column("question_banks", sa.Column("created_by", sa.String(length=64), nullable=True))
    op.add_column("question_banks", sa.Column("updated_by", sa.String(length=64), nullable=True))
    op.create_foreign_key(
        "fk_question_banks_created_by_users",
        "question_banks",
        "users",
        ["created_by"],
        ["username"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_question_banks_updated_by_users",
        "question_banks",
        "users",
        ["updated_by"],
        ["username"],
        ondelete="SET NULL",
    )

    op.add_column("questions", sa.Column("teacher_number", sa.String(length=64), nullable=True))
    op.add_column(
        "questions",
        sa.Column("scope", sa.String(length=16), server_default="internal", nullable=False),
    )
    op.add_column("questions", sa.Column("content_hash", sa.String(length=64), nullable=True))
    op.add_column("questions", sa.Column("creator_id", sa.String(length=64), nullable=True))
    op.add_column("questions", sa.Column("creator_name", sa.String(length=120), nullable=True))
    op.add_column("questions", sa.Column("created_by", sa.String(length=64), nullable=True))
    op.add_column("questions", sa.Column("updated_by", sa.String(length=64), nullable=True))
    op.add_column(
        "questions",
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
    )
    op.add_column(
        "questions",
        sa.Column(
            "translations",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
    )
    op.add_column(
        "questions",
        sa.Column(
            "metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
    )
    op.add_column(
        "questions",
        sa.Column(
            "key_path",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
    )
    op.add_column(
        "questions",
        sa.Column(
            "lifecycle",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
    )
    op.create_check_constraint(
        "ck_questions_scope",
        "questions",
        "scope IN ('public', 'internal')",
    )
    op.create_foreign_key(
        "fk_questions_created_by_users",
        "questions",
        "users",
        ["created_by"],
        ["username"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_questions_updated_by_users",
        "questions",
        "users",
        ["updated_by"],
        ["username"],
        ondelete="SET NULL",
    )
    op.create_index("ix_questions_content_hash", "questions", ["content_hash"], unique=False)
    op.create_index(
        "ix_questions_bank_scope_lifecycle",
        "questions",
        ["bank_id", "scope"],
        unique=False,
    )

    op.create_table(
        "question_bank_collaborators",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("bank_id", sa.String(length=64), nullable=False),
        sa.Column("username", sa.String(length=64), nullable=False),
        sa.Column("permission", sa.String(length=16), server_default="view", nullable=False),
        sa.Column("granted_by", sa.String(length=64), nullable=True),
        sa.Column(
            "granted_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "permission IN ('view', 'edit')",
            name="ck_question_bank_collaborator_permission",
        ),
        sa.ForeignKeyConstraint(["bank_id"], ["question_banks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["granted_by"], ["users.username"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["username"], ["users.username"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("bank_id", "username", name="uq_question_bank_collaborator"),
    )
    op.create_index(
        "ix_question_bank_collaborators_bank_id",
        "question_bank_collaborators",
        ["bank_id"],
        unique=False,
    )
    op.create_index(
        "ix_question_bank_collaborators_username",
        "question_bank_collaborators",
        ["username"],
        unique=False,
    )

    op.create_table(
        "principles",
        sa.Column("id", sa.String(length=128), nullable=False),
        sa.Column("name", sa.String(length=300), nullable=False),
        sa.Column("status", sa.String(length=32), server_default="active", nullable=False),
        sa.Column(
            "confusable_principle_ids",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("created_by", sa.String(length=64), nullable=True),
        sa.Column("updated_by", sa.String(length=64), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["created_by"], ["users.username"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by"], ["users.username"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "synthesis_presets",
        sa.Column("id", sa.String(length=128), nullable=False),
        sa.Column("principle_id", sa.String(length=128), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=32), server_default="active", nullable=False),
        sa.Column("business_version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("created_by", sa.String(length=64), nullable=True),
        sa.Column("updated_by", sa.String(length=64), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["created_by"], ["users.username"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["principle_id"], ["principles.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["updated_by"], ["users.username"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_synthesis_presets_principle_id",
        "synthesis_presets",
        ["principle_id"],
        unique=False,
    )

    op.create_table(
        "question_tag_configs",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("schema_version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("names", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("group_names", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("category_names", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("aliases", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("slot_schema", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("created_by", sa.String(length=64), nullable=True),
        sa.Column("updated_by", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.username"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by"], ["users.username"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_question_tag_configs_active",
        "question_tag_configs",
        ["active"],
        unique=True,
        postgresql_where=sa.text("active IS true"),
    )

    op.create_table(
        "question_edit_locks",
        sa.Column("question_id", sa.String(length=64), nullable=False),
        sa.Column("locked_by", sa.String(length=64), nullable=False),
        sa.Column("creator_id", sa.String(length=64), nullable=True),
        sa.Column("creator_name", sa.String(length=120), nullable=True),
        sa.Column("client_instance_id", sa.String(length=128), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("acquired_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("heartbeat_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["locked_by"], ["users.username"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["question_id"], ["questions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("question_id"),
    )
    op.create_index("ix_question_edit_locks_expires_at", "question_edit_locks", ["expires_at"], unique=False)
    op.create_index("ix_question_edit_locks_locked_by", "question_edit_locks", ["locked_by"], unique=False)

    op.create_table(
        "question_upload_batches",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("idempotency_key", sa.String(length=120), nullable=False),
        sa.Column("bank_id", sa.String(length=64), nullable=False),
        sa.Column("actor_username", sa.String(length=64), nullable=False),
        sa.Column("actor_role", sa.String(length=32), nullable=False),
        sa.Column("creator_id", sa.String(length=64), nullable=False),
        sa.Column("creator_name", sa.String(length=120), nullable=False),
        sa.Column("client_instance_id", sa.String(length=128), nullable=False),
        sa.Column("prep_version", sa.String(length=32), nullable=True),
        sa.Column("workspace_version", sa.String(length=32), nullable=True),
        sa.Column("manifest_hash", sa.String(length=64), nullable=False),
        sa.Column("input_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("updated_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("skipped_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("status", sa.String(length=24), server_default="pending", nullable=False),
        sa.Column("result", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("error_summary", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("committed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('pending', 'committed', 'rolled_back')",
            name="ck_question_upload_batch_status",
        ),
        sa.ForeignKeyConstraint(["bank_id"], ["question_banks.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("actor_username", "idempotency_key", name="uq_question_upload_actor_key"),
    )
    op.create_index("ix_question_upload_batches_bank_id", "question_upload_batches", ["bank_id"], unique=False)
    op.create_index(
        "ix_question_upload_batches_actor_created",
        "question_upload_batches",
        ["actor_username", "created_at"],
        unique=False,
    )

    op.create_table(
        "question_audit_logs",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("entity_type", sa.String(length=32), nullable=False),
        sa.Column("entity_id", sa.String(length=128), nullable=False),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("actor_username", sa.String(length=64), nullable=False),
        sa.Column("actor_role", sa.String(length=32), nullable=False),
        sa.Column("creator_id", sa.String(length=64), nullable=True),
        sa.Column("creator_name", sa.String(length=120), nullable=True),
        sa.Column("bank_id", sa.String(length=64), nullable=True),
        sa.Column("question_id", sa.String(length=64), nullable=True),
        sa.Column("batch_id", sa.String(length=64), nullable=True),
        sa.Column("before_hash", sa.String(length=64), nullable=True),
        sa.Column("after_hash", sa.String(length=64), nullable=True),
        sa.Column("before_revision", sa.Integer(), nullable=True),
        sa.Column("after_revision", sa.Integer(), nullable=True),
        sa.Column("outcome", sa.String(length=32), server_default="success", nullable=False),
        sa.Column("detail", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_question_audit_logs_actor_username", "question_audit_logs", ["actor_username"], unique=False)
    op.create_index("ix_question_audit_logs_bank_id", "question_audit_logs", ["bank_id"], unique=False)
    op.create_index("ix_question_audit_logs_batch_id", "question_audit_logs", ["batch_id"], unique=False)
    op.create_index("ix_question_audit_logs_question_id", "question_audit_logs", ["question_id"], unique=False)
    op.create_index(
        "ix_question_audit_logs_entity_created",
        "question_audit_logs",
        ["entity_type", "entity_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_question_audit_logs_entity_created", table_name="question_audit_logs")
    op.drop_index("ix_question_audit_logs_question_id", table_name="question_audit_logs")
    op.drop_index("ix_question_audit_logs_batch_id", table_name="question_audit_logs")
    op.drop_index("ix_question_audit_logs_bank_id", table_name="question_audit_logs")
    op.drop_index("ix_question_audit_logs_actor_username", table_name="question_audit_logs")
    op.drop_table("question_audit_logs")

    op.drop_index("ix_question_upload_batches_actor_created", table_name="question_upload_batches")
    op.drop_index("ix_question_upload_batches_bank_id", table_name="question_upload_batches")
    op.drop_table("question_upload_batches")

    op.drop_index("ix_question_edit_locks_locked_by", table_name="question_edit_locks")
    op.drop_index("ix_question_edit_locks_expires_at", table_name="question_edit_locks")
    op.drop_table("question_edit_locks")

    op.drop_index("uq_question_tag_configs_active", table_name="question_tag_configs")
    op.drop_table("question_tag_configs")
    op.drop_index("ix_synthesis_presets_principle_id", table_name="synthesis_presets")
    op.drop_table("synthesis_presets")
    op.drop_table("principles")
    op.drop_index("ix_question_bank_collaborators_username", table_name="question_bank_collaborators")
    op.drop_index("ix_question_bank_collaborators_bank_id", table_name="question_bank_collaborators")
    op.drop_table("question_bank_collaborators")

    op.drop_index("ix_questions_bank_scope_lifecycle", table_name="questions")
    op.drop_index("ix_questions_content_hash", table_name="questions")
    op.drop_constraint("fk_questions_updated_by_users", "questions", type_="foreignkey")
    op.drop_constraint("fk_questions_created_by_users", "questions", type_="foreignkey")
    op.drop_constraint("ck_questions_scope", "questions", type_="check")
    op.drop_column("questions", "lifecycle")
    op.drop_column("questions", "key_path")
    op.drop_column("questions", "metadata")
    op.drop_column("questions", "translations")
    op.drop_column("questions", "revision")
    op.drop_column("questions", "updated_by")
    op.drop_column("questions", "created_by")
    op.drop_column("questions", "creator_name")
    op.drop_column("questions", "creator_id")
    op.drop_column("questions", "content_hash")
    op.drop_column("questions", "scope")
    op.drop_column("questions", "teacher_number")

    op.drop_constraint("fk_question_banks_updated_by_users", "question_banks", type_="foreignkey")
    op.drop_constraint("fk_question_banks_created_by_users", "question_banks", type_="foreignkey")
    op.drop_column("question_banks", "updated_by")
    op.drop_column("question_banks", "created_by")
    op.drop_column("question_banks", "revision")
