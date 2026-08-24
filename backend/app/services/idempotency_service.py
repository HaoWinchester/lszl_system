"""Shared actor-scoped idempotency locking helpers."""

from __future__ import annotations

import hashlib

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession


def advisory_key(actor_username: str, idempotency_key: str) -> int:
    digest = hashlib.sha256(
        f"{actor_username}\0{idempotency_key}".encode("utf-8")
    ).digest()
    return int.from_bytes(digest[:8], byteorder="big", signed=True)


async def lock(
    db: AsyncSession,
    actor_username: str,
    idempotency_key: str,
) -> None:
    await db.execute(
        select(
            func.pg_advisory_xact_lock(
                advisory_key(actor_username, idempotency_key)
            )
        )
    )
