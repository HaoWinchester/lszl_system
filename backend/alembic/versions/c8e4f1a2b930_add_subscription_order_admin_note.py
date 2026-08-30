"""Add a distinct administrator note to subscription orders.

Revision ID: c8e4f1a2b930
Revises: b7f2c9d4e610
"""

from alembic import op
import sqlalchemy as sa


revision = "c8e4f1a2b930"
down_revision = "b7f2c9d4e610"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "subscription_orders",
        sa.Column("admin_note", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("subscription_orders", "admin_note")
