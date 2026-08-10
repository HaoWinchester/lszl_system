"""Monotonic revision protocol for shared teaching content."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.shared_runtime_state import SharedRuntimeState


REVISION_KEY = "kg_teaching_content_revision_v1"
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


def _parse_payload(value: str) -> dict[str, Any]:
    try:
        raw = json.loads(value)
    except (TypeError, ValueError):
        return _empty_payload()
    if not isinstance(raw, dict):
        return _empty_payload()
    revision = raw.get("revision")
    if not isinstance(revision, int) or isinstance(revision, bool) or revision < 0:
        revision = 0
    raw_changes = raw.get("changes")
    changes = _normalize_changes(raw_changes if isinstance(raw_changes, list) else [])
    updated_at = raw.get("updatedAt")
    updated_by = raw.get("updatedBy")
    return {
        "revision": revision,
        "changes": changes,
        "updatedAt": updated_at if isinstance(updated_at, str) else None,
        "updatedBy": updated_by if isinstance(updated_by, str) else None,
    }


async def current(db: AsyncSession) -> dict[str, Any]:
    row = await db.get(SharedRuntimeState, REVISION_KEY)
    return _parse_payload(row.value) if row is not None else _empty_payload()


async def acquire_lock(db: AsyncSession) -> None:
    """Serialize teaching-content transactions before they touch domain rows."""

    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": REVISION_KEY},
    )


async def acquire_read_lock(db: AsyncSession) -> None:
    """Hold a shared snapshot lock while allowing other readers to overlap."""

    await db.execute(
        text("SELECT pg_advisory_xact_lock_shared(hashtextextended(:key, 0))"),
        {"key": REVISION_KEY},
    )


async def acquire_cleanup_lock(db: AsyncSession) -> None:
    """Serialize cleanup after the global teaching-content writer lock.

    Every supported teaching writer takes ``REVISION_KEY`` first.  Keeping
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
    row = (
        await db.execute(
            select(SharedRuntimeState)
            .where(SharedRuntimeState.key == REVISION_KEY)
            .with_for_update()
        )
    ).scalar_one_or_none()
    previous = _parse_payload(row.value) if row is not None else _empty_payload()
    payload = {
        "revision": int(previous["revision"]) + 1,
        "changes": _normalize_changes(changes),
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "updatedBy": actor_username,
    }
    value = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    if row is None:
        db.add(
            SharedRuntimeState(
                key=REVISION_KEY,
                value=value,
                updated_by=actor_username,
            )
        )
    else:
        row.value = value
        row.updated_by = actor_username
    await db.flush()
    return payload


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
