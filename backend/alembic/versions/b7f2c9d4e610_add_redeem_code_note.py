"""Persist administrator notes on subscription redeem codes.

Revision ID: b7f2c9d4e610
Revises: a8c1d4e7f920
"""

from alembic import op
import sqlalchemy as sa


revision = "b7f2c9d4e610"
down_revision = "a8c1d4e7f920"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "subscription_redeem_codes",
        sa.Column("note", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("subscription_redeem_codes", "note")
