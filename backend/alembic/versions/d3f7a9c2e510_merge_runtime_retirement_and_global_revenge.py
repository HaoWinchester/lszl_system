"""merge runtime retirement and global revenge migration heads

Revision ID: d3f7a9c2e510
Revises: a8f2c7d9e104, c9f2e6a1b430
"""

from typing import Sequence, Union


revision: str = "d3f7a9c2e510"
down_revision: tuple[str, str] = ("a8f2c7d9e104", "c9f2e6a1b430")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
