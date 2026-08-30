"""Add relational course drafts, releases, and learning tasks.

Revision ID: ca3f5a7b9d20
Revises: b9d2e4f6a810
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "ca3f5a7b9d20"
down_revision = "b9d2e4f6a810"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "course_drafts",
        sa.Column("id", sa.String(128), primary_key=True),
        sa.Column(
            "owner_id",
            sa.String(64),
            sa.ForeignKey("users.username", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column(
            "structure",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("status", sa.String(24), nullable=False, server_default="draft"),
        sa.Column(
            "created_by",
            sa.String(64),
            sa.ForeignKey("users.username", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "updated_by",
            sa.String(64),
            sa.ForeignKey("users.username", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status IN ('draft', 'archived')", name="ck_course_drafts_status"
        ),
    )
    op.create_index("ix_course_drafts_owner_id", "course_drafts", ["owner_id"])
    op.create_index(
        "ix_course_drafts_owner_updated",
        "course_drafts",
        ["owner_id", "updated_at"],
    )

    op.create_table(
        "course_releases",
        sa.Column("id", sa.String(128), primary_key=True),
        sa.Column(
            "owner_id",
            sa.String(64),
            sa.ForeignKey("users.username", ondelete="CASCADE"),
            nullable=False,
        ),
        # This is a stable logical source identifier, not an FK: old UI
        # semantics require releases to survive deletion of their draft.
        sa.Column("course_id", sa.String(128), nullable=False),
        sa.Column("source_draft_id", sa.String(128), nullable=False),
        sa.Column("source_draft_revision", sa.Integer(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(24), nullable=False, server_default="published"),
        sa.Column("course_snapshot", postgresql.JSONB(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column(
            "published_by",
            sa.String(64),
            sa.ForeignKey("users.username", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "withdrawn_by",
            sa.String(64),
            sa.ForeignKey("users.username", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "published_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("withdrawn_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "owner_id",
            "course_id",
            "version",
            name="uq_course_releases_owner_course_version",
        ),
        sa.UniqueConstraint("id", "owner_id", name="uq_course_releases_id_owner"),
        sa.CheckConstraint(
            "status IN ('published', 'superseded', 'withdrawn')",
            name="ck_course_releases_status",
        ),
    )
    op.create_index("ix_course_releases_owner_id", "course_releases", ["owner_id"])
    op.create_index("ix_course_releases_course_id", "course_releases", ["course_id"])
    op.create_index(
        "ix_course_releases_owner_published",
        "course_releases",
        ["owner_id", "published_at"],
    )
    op.create_index(
        "uq_course_releases_one_published",
        "course_releases",
        ["owner_id", "course_id"],
        unique=True,
        postgresql_where=sa.text("status = 'published'"),
    )

    op.create_table(
        "learning_tasks",
        sa.Column("id", sa.String(128), primary_key=True),
        sa.Column(
            "owner_id",
            sa.String(64),
            sa.ForeignKey("users.username", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("release_id", sa.String(128), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "audience",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "content",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("status", sa.String(24), nullable=False, server_default="draft"),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column(
            "created_by",
            sa.String(64),
            sa.ForeignKey("users.username", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "updated_by",
            sa.String(64),
            sa.ForeignKey("users.username", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["release_id", "owner_id"],
            ["course_releases.id", "course_releases.owner_id"],
            name="fk_learning_tasks_release_owner",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "status IN ('draft', 'published', 'archived')",
            name="ck_learning_tasks_status",
        ),
    )
    op.create_index("ix_learning_tasks_owner_id", "learning_tasks", ["owner_id"])
    op.create_index("ix_learning_tasks_release", "learning_tasks", ["release_id"])
    op.create_index(
        "ix_learning_tasks_owner_updated",
        "learning_tasks",
        ["owner_id", "updated_at"],
    )


def downgrade() -> None:
    op.drop_table("learning_tasks")
    op.drop_table("course_releases")
    op.drop_table("course_drafts")
