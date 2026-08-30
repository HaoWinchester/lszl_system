"""Revision-safe, owner-isolated recall acceptance record persistence."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.recall_acceptance import ContentPrepRecallAcceptance
from app.models.user import User
from app.schemas.recall_acceptance import RecallAcceptanceRecord


MAX_RECORDS = 2000
RUNTIME_SOURCE_KEY = "pmp_recall_acceptance_records_v1"


class RecallAcceptanceRevisionConflict(RuntimeError):
    def __init__(self, current_revision: int):
        super().__init__("验收记录已在其他会话更新，请刷新后重试")
        self.current_revision = current_revision


def _payload(row: ContentPrepRecallAcceptance | None) -> dict[str, Any]:
    if row is None:
        return {"revision": 0, "records": [], "updatedAt": None}
    return {
        "revision": row.revision,
        "records": row.records,
        "updatedAt": row.updated_at.isoformat() if row.updated_at else None,
    }


async def get_records(db: AsyncSession, actor: User) -> dict[str, Any]:
    row = await db.get(ContentPrepRecallAcceptance, actor.username)
    return _payload(row)


async def replace_records(
    db: AsyncSession,
    actor: User,
    *,
    revision: int,
    records: list[RecallAcceptanceRecord],
) -> dict[str, Any]:
    await db.execute(
        insert(ContentPrepRecallAcceptance)
        .values(owner_id=actor.username, records=[], revision=0)
        .on_conflict_do_nothing(index_elements=[ContentPrepRecallAcceptance.owner_id])
    )
    row = (
        await db.execute(
            select(ContentPrepRecallAcceptance)
            .where(ContentPrepRecallAcceptance.owner_id == actor.username)
            .with_for_update()
        )
    ).scalar_one()
    if row.revision != revision:
        current_revision = row.revision
        await db.rollback()
        raise RecallAcceptanceRevisionConflict(current_revision)

    row.records = [
        record.model_dump(by_alias=True, exclude_none=True)
        for record in records[-MAX_RECORDS:]
    ]
    row.revision += 1
    await db.commit()
    await db.refresh(row)
    return _payload(row)


async def clear_records(
    db: AsyncSession,
    actor: User,
    *,
    revision: int,
) -> dict[str, Any]:
    return await replace_records(db, actor, revision=revision, records=[])
