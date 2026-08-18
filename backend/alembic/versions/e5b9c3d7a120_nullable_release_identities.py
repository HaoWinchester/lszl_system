"""nullable release identities and snapshot-safe events

Revision ID: e5b9c3d7a120
Revises: c4e8f2a7d910
Create Date: 2026-08-18 15:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "e5b9c3d7a120"
down_revision: Union[str, None] = "c4e8f2a7d910"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("training_progress", "release_id", nullable=True, server_default=None)
    op.execute("UPDATE training_progress SET release_id = NULL WHERE release_id = ''")
    op.drop_constraint("uq_training_owner_question_release", "training_progress", type_="unique")
    op.create_foreign_key(
        "training_progress_release_id_fkey", "training_progress", "paper_releases",
        ["release_id"], ["id"], ondelete="RESTRICT",
    )
    op.create_index(
        "uq_training_owner_question_release", "training_progress",
        ["owner_id", "question_id", sa.text("COALESCE(release_id, '')")], unique=True,
    )

    op.alter_column("recall_question_snapshots", "release_id", nullable=True, server_default=None)
    op.execute("UPDATE recall_question_snapshots SET release_id = NULL WHERE release_id = ''")
    op.drop_constraint(
        "uq_recall_question_snapshot_revision_release", "recall_question_snapshots", type_="unique"
    )
    op.create_foreign_key(
        "recall_question_snapshots_release_id_fkey", "recall_question_snapshots", "paper_releases",
        ["release_id"], ["id"], ondelete="RESTRICT",
    )
    op.create_index(
        "uq_recall_question_snapshot_revision_release", "recall_question_snapshots",
        ["question_id", "question_revision", sa.text("COALESCE(release_id, '')")], unique=True,
    )

    op.drop_constraint("recall_progress_pkey", "recall_progress", type_="primary")
    op.alter_column("recall_progress", "release_id", nullable=True, server_default=None)
    op.execute("UPDATE recall_progress SET release_id = NULL WHERE release_id = ''")
    op.add_column("recall_progress", sa.Column("id", sa.String(length=64), nullable=True))
    op.execute("UPDATE recall_progress SET id = md5(owner_id || ':' || question_id || ':' || COALESCE(release_id, ''))")
    op.alter_column("recall_progress", "id", nullable=False)
    op.create_primary_key("recall_progress_pkey", "recall_progress", ["id"])
    op.create_foreign_key(
        "recall_progress_release_id_fkey", "recall_progress", "paper_releases",
        ["release_id"], ["id"], ondelete="RESTRICT",
    )
    op.create_index(
        "uq_recall_progress_owner_question_release", "recall_progress",
        ["owner_id", "question_id", sa.text("COALESCE(release_id, '')")], unique=True,
    )

    op.execute("UPDATE practice_mistakes SET release_id = NULL WHERE release_id = ''")
    op.drop_constraint("uq_practice_mistake_owner_question_release", "practice_mistakes", type_="unique")
    op.alter_column("practice_mistakes", "release_id", type_=sa.String(length=64), nullable=True)
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM practice_mistakes AS mistake
                WHERE mistake.release_id IS NOT NULL
                  AND mistake.release_id <> ''
                  AND NOT EXISTS (
                      SELECT 1 FROM paper_releases AS release
                      WHERE release.id = mistake.release_id
                  )
            ) THEN
                RAISE EXCEPTION 'orphan practice_mistakes.release_id rows must be repaired before upgrade';
            END IF;
        END $$
    """)
    op.create_foreign_key(
        "practice_mistakes_release_id_fkey", "practice_mistakes", "paper_releases",
        ["release_id"], ["id"], ondelete="RESTRICT",
    )
    op.create_index(
        "uq_practice_mistake_owner_question_release", "practice_mistakes",
        ["owner_id", "question_id", sa.text("COALESCE(release_id, '')")], unique=True,
    )

    op.drop_constraint("learning_events_question_id_fkey", "learning_events", type_="foreignkey")
    op.create_foreign_key(
        "learning_events_question_id_fkey", "learning_events", "questions",
        ["question_id"], ["id"], ondelete="SET NULL",
    )


def downgrade() -> None:
    raise RuntimeError("release identity migration is intentionally irreversible")
