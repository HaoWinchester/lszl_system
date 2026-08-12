"""Persist the active plan-card price as the authoritative payment amount.

Revision ID: 9d2a4b6c8e1f
Revises: 7b1f0e2a4c6d
Create Date: 2026-08-12
"""

from alembic import op
import sqlalchemy as sa


revision = "9d2a4b6c8e1f"
down_revision = "7b1f0e2a4c6d"
branch_labels = None
depends_on = None


# These values are the legacy card amounts after its own one-decimal discount
# formatting. Persisting them eliminates the former card/Native-order split.
_LEGACY_EFFECTIVE_AMOUNTS = {
    "monthly": 2990,
    "quarterly": 2990,
    "half_year": 11880,
    "lifetime": 36790,
}


def upgrade() -> None:
    connection = op.get_bind()
    for plan_id, amount_fen in _LEGACY_EFFECTIVE_AMOUNTS.items():
        connection.execute(
            sa.text(
                """
                UPDATE system_settings
                   SET value = jsonb_set(
                       value,
                       ARRAY[:plan_id, 'paymentAmountFen']::text[],
                       to_jsonb(CAST(:amount_fen AS integer)),
                       true
                   )
                 WHERE key = 'subscription_plan_settings'
                   AND COALESCE(value -> :plan_id ->> 'paymentAmountFen', '') = ''
                """
            ),
            {"plan_id": plan_id, "amount_fen": amount_fen},
        )


def downgrade() -> None:
    connection = op.get_bind()
    for plan_id in _LEGACY_EFFECTIVE_AMOUNTS:
        connection.execute(
            sa.text(
                """
                UPDATE system_settings
                   SET value = value #- ARRAY[:plan_id, 'paymentAmountFen']::text[]
                 WHERE key = 'subscription_plan_settings'
                """
            ),
            {"plan_id": plan_id},
        )
