"""extend file manager lifecycle

Revision ID: 9a4e7c2b1d80
Revises: b8e2d4f6a130
Create Date: 2026-08-24
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "9a4e7c2b1d80"
down_revision: Union[str, None] = "b8e2d4f6a130"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "folders",
        sa.Column("restore_parent_id", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "graph_files",
        sa.Column("restore_folder_id", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "graph_files",
        sa.Column(
            "favorite",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.alter_column("graph_files", "favorite", server_default=None)


def downgrade() -> None:
    op.drop_column("graph_files", "favorite")
    op.drop_column("graph_files", "restore_folder_id")
    op.drop_column("folders", "restore_parent_id")
