"""Shared test state helpers for the teaching-content revision singleton."""

from __future__ import annotations

from copy import deepcopy
from typing import Any, TypeAlias

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import AsyncSessionLocal
from app.models import TeachingContentRevision


RevisionSnapshot: TypeAlias = dict[str, Any] | None


def snapshot_revision_row(
    row: TeachingContentRevision | None,
) -> RevisionSnapshot:
    if row is None:
        return None
    return {
        "revision": int(row.revision),
        "changes": deepcopy(row.changes),
        "updated_by": row.updated_by,
        "updated_at": row.updated_at,
    }


def apply_revision_snapshot(
    row: TeachingContentRevision,
    snapshot: dict[str, Any],
) -> None:
    row.revision = int(snapshot["revision"])
    row.changes = deepcopy(snapshot["changes"])
    row.updated_by = snapshot["updated_by"]
    row.updated_at = snapshot["updated_at"]


async def snapshot_teaching_content_revision(
    db: AsyncSession,
) -> RevisionSnapshot:
    return snapshot_revision_row(await db.get(TeachingContentRevision, 1))


async def restore_teaching_content_revision(
    db: AsyncSession,
    snapshot: RevisionSnapshot,
) -> None:
    await db.execute(delete(TeachingContentRevision))
    if snapshot is not None:
        db.add(TeachingContentRevision(id=1, **deepcopy(snapshot)))


async def snapshot_teaching_content_revision_state() -> RevisionSnapshot:
    async with AsyncSessionLocal() as db:
        return await snapshot_teaching_content_revision(db)


async def restore_teaching_content_revision_state(
    snapshot: RevisionSnapshot,
) -> None:
    async with AsyncSessionLocal() as db:
        await restore_teaching_content_revision(db, snapshot)
        await db.commit()
