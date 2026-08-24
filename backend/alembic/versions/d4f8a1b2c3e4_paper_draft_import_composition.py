"""paper draft import and composition

Revision ID: d4f8a1b2c3e4
Revises: 9a4e7c2b1d80
Create Date: 2026-08-24
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "d4f8a1b2c3e4"
down_revision: Union[str, None] = "9a4e7c2b1d80"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "paper_categories",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("owner_id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("order_index", sa.Integer(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", sa.String(length=64), nullable=True),
        sa.Column("updated_by", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.username"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["owner_id"], ["users.username"]),
        sa.ForeignKeyConstraint(["updated_by"], ["users.username"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_paper_categories_owner_id", "paper_categories", ["owner_id"])
    op.create_index("ix_paper_categories_archived_at", "paper_categories", ["archived_at"])

    op.create_table(
        "paper_generation_batches",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("owner_id", sa.String(length=64), nullable=False),
        sa.Column("actor_username", sa.String(length=64), nullable=False),
        sa.Column("idempotency_key", sa.String(length=120), nullable=False),
        sa.Column("subject", sa.String(length=32), nullable=False),
        sa.Column("bank_ids", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("filter_config", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("quota_config", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("random_seed", sa.String(length=128), nullable=False),
        sa.Column("requested_variants", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_paper_ids", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["actor_username"], ["users.username"]),
        sa.ForeignKeyConstraint(["owner_id"], ["users.username"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("actor_username", "idempotency_key", name="uq_paper_generation_actor_key"),
    )
    op.create_index("ix_paper_generation_batches_owner_id", "paper_generation_batches", ["owner_id"])
    op.create_index("ix_paper_generation_batches_actor_username", "paper_generation_batches", ["actor_username"])

    op.add_column("exam_papers", sa.Column("category_id", sa.String(length=64), nullable=True))
    op.add_column(
        "exam_papers",
        sa.Column(
            "access_policy",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
    )
    op.add_column(
        "exam_papers",
        sa.Column(
            "enabled_modes",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
    )
    op.add_column("exam_papers", sa.Column("mode_config_version", sa.Integer(), server_default="2", nullable=False))
    op.add_column("exam_papers", sa.Column("purpose", sa.String(length=32), server_default="learning", nullable=False))
    op.add_column("exam_papers", sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("exam_papers", sa.Column("restored_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("exam_papers", sa.Column("withdrawn_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("exam_papers", sa.Column("published_release_id", sa.String(length=64), nullable=True))
    op.add_column("exam_papers", sa.Column("published_version", sa.Integer(), server_default="0", nullable=False))
    op.add_column("exam_papers", sa.Column("generation_batch_id", sa.String(length=64), nullable=True))
    op.add_column("exam_papers", sa.Column("variant_code", sa.String(length=16), nullable=True))
    op.add_column(
        "exam_papers",
        sa.Column(
            "generation_config",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
    )
    op.add_column(
        "exam_papers",
        sa.Column(
            "import_metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
    )
    op.create_foreign_key("fk_exam_papers_category", "exam_papers", "paper_categories", ["category_id"], ["id"], ondelete="SET NULL")
    op.create_foreign_key("fk_exam_papers_generation_batch", "exam_papers", "paper_generation_batches", ["generation_batch_id"], ["id"], ondelete="SET NULL")
    op.create_foreign_key("fk_exam_papers_published_release", "exam_papers", "paper_releases", ["published_release_id"], ["id"], ondelete="SET NULL")
    op.create_index("ix_exam_papers_category_id", "exam_papers", ["category_id"])
    op.create_index("ix_exam_papers_generation_batch_id", "exam_papers", ["generation_batch_id"])

    op.add_column(
        "paper_questions",
        sa.Column("score", sa.Numeric(precision=8, scale=2), server_default="1", nullable=False),
    )
    op.create_unique_constraint(
        "uq_paper_questions_paper_order",
        "paper_questions",
        ["paper_id", "order_index"],
    )

    op.create_table(
        "paper_import_operations",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("owner_id", sa.String(length=64), nullable=False),
        sa.Column("actor_username", sa.String(length=64), nullable=False),
        sa.Column("idempotency_key", sa.String(length=120), nullable=False),
        sa.Column("request_hash", sa.String(length=64), nullable=False),
        sa.Column("conflict_action", sa.String(length=32), nullable=False),
        sa.Column("result_paper_id", sa.String(length=64), nullable=True),
        sa.Column("result_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["actor_username"], ["users.username"]),
        sa.ForeignKeyConstraint(["owner_id"], ["users.username"]),
        sa.ForeignKeyConstraint(["result_paper_id"], ["exam_papers.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("actor_username", "idempotency_key", name="uq_paper_import_actor_key"),
    )
    op.create_index("ix_paper_import_operations_owner_id", "paper_import_operations", ["owner_id"])
    op.create_index("ix_paper_import_operations_actor_username", "paper_import_operations", ["actor_username"])
    op.create_index("ix_paper_import_operations_result_paper_id", "paper_import_operations", ["result_paper_id"])

    for column in (
        "access_policy",
        "enabled_modes",
        "mode_config_version",
        "purpose",
        "published_version",
        "generation_config",
        "import_metadata",
    ):
        op.alter_column("exam_papers", column, server_default=None)
    op.alter_column("paper_questions", "score", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_paper_import_operations_result_paper_id", table_name="paper_import_operations")
    op.drop_index("ix_paper_import_operations_actor_username", table_name="paper_import_operations")
    op.drop_index("ix_paper_import_operations_owner_id", table_name="paper_import_operations")
    op.drop_table("paper_import_operations")

    op.drop_constraint("uq_paper_questions_paper_order", "paper_questions", type_="unique")
    op.drop_column("paper_questions", "score")

    op.drop_index("ix_exam_papers_generation_batch_id", table_name="exam_papers")
    op.drop_index("ix_exam_papers_category_id", table_name="exam_papers")
    op.drop_constraint("fk_exam_papers_published_release", "exam_papers", type_="foreignkey")
    op.drop_constraint("fk_exam_papers_generation_batch", "exam_papers", type_="foreignkey")
    op.drop_constraint("fk_exam_papers_category", "exam_papers", type_="foreignkey")
    for column in (
        "import_metadata",
        "generation_config",
        "variant_code",
        "generation_batch_id",
        "published_version",
        "published_release_id",
        "withdrawn_at",
        "restored_at",
        "archived_at",
        "purpose",
        "mode_config_version",
        "enabled_modes",
        "access_policy",
        "category_id",
    ):
        op.drop_column("exam_papers", column)

    op.drop_index("ix_paper_generation_batches_actor_username", table_name="paper_generation_batches")
    op.drop_index("ix_paper_generation_batches_owner_id", table_name="paper_generation_batches")
    op.drop_table("paper_generation_batches")
    op.drop_index("ix_paper_categories_archived_at", table_name="paper_categories")
    op.drop_index("ix_paper_categories_owner_id", table_name="paper_categories")
    op.drop_table("paper_categories")
