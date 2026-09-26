"""Shared actor-scoped idempotency locking helpers."""

from __future__ import annotations

import hashlib
from contextlib import asynccontextmanager

from fastapi import HTTPException

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import AsyncSessionLocal


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


@asynccontextmanager
async def import_lock(actor_username: str):
    """Reject concurrent imports across workers without queuing large payloads.

    A separate transaction keeps the lock through business commits/rollbacks.
    Connection/transaction cleanup also releases it on exceptions or cancellation.
    This is an in-flight guard; durable retries still use each domain's idempotency.
    """
    async with AsyncSessionLocal() as guard_db:
        async with guard_db.begin():
            acquired = await guard_db.scalar(select(func.pg_try_advisory_xact_lock(
                advisory_key(actor_username, 'import-submission'),
            )))
            if not acquired:
                raise HTTPException(
                    status_code=409,
                    detail={'code': 'IMPORT_IN_PROGRESS', 'message': '已有导入正在处理中，请等待完成后再试。'},
                    headers={'Retry-After': '2'},
                )
            yield
