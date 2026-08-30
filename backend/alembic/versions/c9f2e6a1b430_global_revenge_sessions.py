"""allow global revenge practice sessions

Revision ID: c9f2e6a1b430
Revises: a8c1d4e7f920
Create Date: 2026-08-30 13:10:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c9f2e6a1b430"
down_revision: Union[str, None] = "a8c1d4e7f920"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("practice_sessions", "paper_id", nullable=True)
    op.alter_column("practice_sessions", "release_id", nullable=True)


def downgrade() -> None:
    bind = op.get_bind()
    global_count = bind.execute(
        sa.text(
            "SELECT count(*) FROM practice_sessions "
            "WHERE paper_id IS NULL OR release_id IS NULL"
        )
    ).scalar_one()
    if global_count:
        raise RuntimeError(
            "cannot restore non-null practice session scope while global revenge sessions exist"
        )
    op.alter_column("practice_sessions", "release_id", nullable=False)
    op.alter_column("practice_sessions", "paper_id", nullable=False)
