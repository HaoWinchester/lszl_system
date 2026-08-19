"""release scoped learning state and frozen migration payloads

Revision ID: c4e8f2a7d910
Revises: a7c3e9f1b205
Create Date: 2026-08-18 10:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "c4e8f2a7d910"
down_revision: Union[str, None] = "a7c3e9f1b205"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("paper_releases_paper_id_fkey", "paper_releases", type_="foreignkey")
    op.drop_constraint("practice_mistakes_question_id_fkey", "practice_mistakes", type_="foreignkey")


def downgrade() -> None:
    op.create_foreign_key(
        "practice_mistakes_question_id_fkey", "practice_mistakes", "questions",
        ["question_id"], ["id"], ondelete="SET NULL",
    )
    op.create_foreign_key(
        "paper_releases_paper_id_fkey", "paper_releases", "exam_papers",
        ["paper_id"], ["id"], ondelete="CASCADE",
    )
