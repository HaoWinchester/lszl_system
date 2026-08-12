"""rotate the deployed default administrator password

Revision ID: 7b1f0e2a4c6d
Revises: 6f0f9e1b2d3c
Create Date: 2026-08-12 00:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "7b1f0e2a4c6d"
down_revision: Union[str, None] = "6f0f9e1b2d3c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# bcrypt hash for the credential specified for the single seeded `admin` account.
# Keeping a one-way hash in the migration lets an existing deployment rotate the
# account without ever persisting the plaintext password in PostgreSQL.
ADMIN_PASSWORD_HASH = "$2b$12$5oR5O51RL/5UzB6CkwydT.FY1OaEU.h0.3j7RZzgBLfxcDdFG9jLW"


def upgrade() -> None:
    op.get_bind().execute(
        sa.text(
            "UPDATE users "
            "SET password_hash = :password_hash, updated_at = now() "
            "WHERE username = 'admin'"
        ),
        {"password_hash": ADMIN_PASSWORD_HASH},
    )


def downgrade() -> None:
    # Password rotations are intentionally non-reversible: restoring the retired
    # credential during a schema downgrade would reintroduce an insecure account.
    pass
