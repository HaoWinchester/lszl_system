"""Relational monotonic revision protocol for shared teaching content."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.teaching_content import TeachingContentRevision


REVISION_LOCK_KEY = "kg_teaching_content_revision_v1"
CLEANUP_LOCK_KEY = "question-pool-cleanup-v1"
MAX_CHANGES = 100


def _empty_payload() -> dict[str, Any]:
    return {
        "revision": 0,
        "changes": [],
        "updatedAt": None,
        "updatedBy": None,
    }


def _normalize_changes(changes: list[Any]) -> list[dict[str, str]]:
    normalized: list[dict[str, str]] = []
    seen: set[tuple[str, str, str]] = set()
    for change in changes:
        if not isinstance(change, dict):
            continue
        entity_type = change.get("entityType")
        entity_id = change.get("entityId")
        action = change.get("action")
        if not all(
            isinstance(value, str) and value
            for value in (entity_type, entity_id, action)
        ):
            continue
        identity = (entity_type, entity_id, action)
        if identity in seen:
            continue
        seen.add(identity)
        normalized.append(
            {
                "entityType": entity_type,
                "entityId": entity_id,
                "action": action,
            }
        )
        if len(normalized) == MAX_CHANGES:
            break
    return normalized


def _serialize_revision(row: TeachingContentRevision) -> dict[str, Any]:
    return {
        "revision": int(row.revision),
        "changes": _normalize_changes(
            row.changes if isinstance(row.changes, list) else []
        ),
        "updatedAt": row.updated_at.isoformat() if row.updated_at else None,
        "updatedBy": row.updated_by if isinstance(row.updated_by, str) else None,
    }


async def current(db: AsyncSession) -> dict[str, Any]:
    row = await db.get(TeachingContentRevision, 1)
    return _serialize_revision(row) if row is not None else _empty_payload()


async def acquire_lock(db: AsyncSession) -> None:
    """Serialize teaching-content transactions before they touch domain rows."""

    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": REVISION_LOCK_KEY},
    )


async def acquire_read_lock(db: AsyncSession) -> None:
    """Hold a shared snapshot lock while allowing other readers to overlap."""

    await db.execute(
        text("SELECT pg_advisory_xact_lock_shared(hashtextextended(:key, 0))"),
        {"key": REVISION_LOCK_KEY},
    )


async def acquire_cleanup_lock(db: AsyncSession) -> None:
    """Serialize cleanup after the global teaching-content writer lock.

    Every supported teaching writer takes ``REVISION_LOCK_KEY`` first. Keeping
    that shared lock order prevents writers from entering between cleanup's
    snapshot recheck and its destructive mutations.
    """

    await acquire_lock(db)
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": CLEANUP_LOCK_KEY},
    )


async def bump(
    db: AsyncSession,
    actor_username: str,
    changes: list[dict[str, str]],
) -> dict[str, Any]:
    await acquire_lock(db)
    row = await db.scalar(
        select(TeachingContentRevision)
        .where(TeachingContentRevision.id == 1)
        .with_for_update()
    )
    if row is None:
        row = TeachingContentRevision(id=1, revision=0, changes=[])
        db.add(row)
        await db.flush()
    row.revision += 1
    row.changes = _normalize_changes(changes)
    row.updated_by = actor_username
    row.updated_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(row)
    return _serialize_revision(row)


async def bump_cleanup(
    db: AsyncSession,
    actor_username: str,
    manifest_hash: str,
) -> dict[str, Any]:
    """Publish exactly one shared-content change for a committed cleanup."""

    return await bump(
        db,
        actor_username,
        [
            {
                "entityType": "question_pool",
                "entityId": manifest_hash,
                "action": "cleanup",
            }
        ],
    )
