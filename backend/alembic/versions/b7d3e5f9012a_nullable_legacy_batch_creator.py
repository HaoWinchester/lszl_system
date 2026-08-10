"""allow durable idempotency batches for legacy null-creator questions

Revision ID: b7d3e5f9012a
Revises: 1f4c2a9d7e10
Create Date: 2026-08-10 00:00:00

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b7d3e5f9012a"
down_revision: Union[str, None] = "1f4c2a9d7e10"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "question_upload_batches",
        "creator_id",
        existing_type=sa.String(length=64),
        nullable=True,
    )
    op.alter_column(
        "question_upload_batches",
        "creator_name",
        existing_type=sa.String(length=120),
        nullable=True,
    )
    op.create_check_constraint(
        "ck_question_upload_batch_creator_pair",
        "question_upload_batches",
        "(creator_id IS NULL) = (creator_name IS NULL)",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_question_upload_batch_creator_pair",
        "question_upload_batches",
        type_="check",
    )
    # This intentionally fails rather than fabricating attribution if legacy
    # null-creator batches still exist. Operators must archive those rows before
    # downgrading to a schema that cannot represent their provenance.
    op.alter_column(
        "question_upload_batches",
        "creator_name",
        existing_type=sa.String(length=120),
        nullable=False,
    )
    op.alter_column(
        "question_upload_batches",
        "creator_id",
        existing_type=sa.String(length=64),
        nullable=False,
    )
