"""enforce one synthesis preset per principle

Revision ID: e1439a1eb412
Revises: 5c84e1d3a720
Create Date: 2026-08-11 18:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e1439a1eb412"
down_revision: Union[str, None] = "5c84e1d3a720"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    connection = op.get_bind()
    duplicate_principle_id = connection.execute(
        sa.text(
            """
            SELECT principle_id
            FROM synthesis_presets
            GROUP BY principle_id
            HAVING COUNT(*) > 1
            ORDER BY principle_id
            LIMIT 1
            """
        )
    ).scalar_one_or_none()
    if duplicate_principle_id is not None:
        raise RuntimeError(
            "无法升级：原则存在多张归纳卡，请先归档重复数据："
            f"{duplicate_principle_id}"
        )
    op.drop_index("ix_synthesis_presets_principle_id", table_name="synthesis_presets")
    op.create_unique_constraint(
        "uq_synthesis_presets_principle_id",
        "synthesis_presets",
        ["principle_id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_synthesis_presets_principle_id",
        "synthesis_presets",
        type_="unique",
    )
    op.create_index(
        "ix_synthesis_presets_principle_id",
        "synthesis_presets",
        ["principle_id"],
        unique=False,
    )
