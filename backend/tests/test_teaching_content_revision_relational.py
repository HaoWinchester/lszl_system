"""Relational persistence contract for the global teaching-content revision."""

from __future__ import annotations

import asyncio
import inspect
import json
from pathlib import Path
import subprocess
import sys

from sqlalchemy import delete, text
from sqlalchemy.exc import IntegrityError

from app.db.session import AsyncSessionLocal
from app.models import TeachingContentRevision
from app.models.shared_runtime_state import SharedRuntimeState
from app.services import teaching_content_revision_service


BACKEND_ROOT = Path(__file__).resolve().parents[1]
LEGACY_KEY = "kg_teaching_content_revision_v1"


def _run_alembic(*args: str) -> None:
    result = subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=BACKEND_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, f"{result.stdout}\n{result.stderr}"


async def _protocol_snapshot() -> tuple[dict | None, dict | None]:
    async with AsyncSessionLocal() as db:
        relation = await db.get(TeachingContentRevision, 1)
        legacy = await db.get(SharedRuntimeState, LEGACY_KEY)
        return (
            None
            if relation is None
            else {
                "revision": relation.revision,
                "changes": list(relation.changes),
                "updated_by": relation.updated_by,
                "updated_at": relation.updated_at,
            },
            None
            if legacy is None
            else {
                "value": legacy.value,
                "schema_version": legacy.schema_version,
                "updated_by": legacy.updated_by,
                "created_at": legacy.created_at,
                "updated_at": legacy.updated_at,
            },
        )


async def _replace_legacy(value: str, updated_by: str | None = None) -> None:
    async with AsyncSessionLocal() as db:
        await db.execute(
            delete(SharedRuntimeState).where(SharedRuntimeState.key == LEGACY_KEY)
        )
        db.add(
            SharedRuntimeState(
                key=LEGACY_KEY,
                value=value,
                updated_by=updated_by,
            )
        )
        await db.commit()


async def _restore_protocol(
    relation_snapshot: dict | None,
    legacy_snapshot: dict | None,
) -> None:
    async with AsyncSessionLocal() as db:
        await db.execute(delete(TeachingContentRevision))
        if relation_snapshot is not None:
            db.add(TeachingContentRevision(id=1, **relation_snapshot))
        await db.execute(
            delete(SharedRuntimeState).where(SharedRuntimeState.key == LEGACY_KEY)
        )
        if legacy_snapshot is not None:
            db.add(
                SharedRuntimeState(
                    key=LEGACY_KEY,
                    **legacy_snapshot,
                )
            )
        await db.commit()


def test_bump_uses_relational_revision_without_shared_runtime() -> None:
    """Catch a revision bump falling back to the retiring Runtime KV row."""

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            snapshot = await db.get(TeachingContentRevision, 1)
            saved = None if snapshot is None else {
                "revision": snapshot.revision,
                "changes": list(snapshot.changes),
                "updated_by": snapshot.updated_by,
                "updated_at": snapshot.updated_at,
            }
            await db.execute(delete(TeachingContentRevision))
            await db.commit()

        try:
            async with AsyncSessionLocal() as db:
                first = await teaching_content_revision_service.bump(
                    db,
                    "admin",
                    [
                        {
                            "entityType": "question",
                            "entityId": "q1",
                            "action": "updated",
                        }
                    ],
                )
                await db.commit()
                row = await db.get(TeachingContentRevision, 1)
                assert row is not None
                assert first["revision"] == row.revision == 1
                assert row.changes == [
                    {
                        "entityType": "question",
                        "entityId": "q1",
                        "action": "updated",
                    }
                ]
                assert row.updated_by == "admin"
                assert first["updatedAt"] == row.updated_at.isoformat()
        finally:
            async with AsyncSessionLocal() as db:
                await db.execute(delete(TeachingContentRevision))
                if saved is not None:
                    db.add(TeachingContentRevision(id=1, **saved))
                await db.commit()

    asyncio.run(scenario())

    source = inspect.getsource(teaching_content_revision_service)
    assert "SharedRuntimeState" not in source
    assert "shared_runtime_states" not in source


def test_database_rejects_a_second_revision_identity() -> None:
    """Catch removal of the singleton constraint permitting split revision streams."""

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            db.add(
                TeachingContentRevision(
                    id=2,
                    revision=99,
                    changes=[],
                    updated_by="admin",
                )
            )
            try:
                await db.commit()
            except IntegrityError:
                await db.rollback()
            else:
                raise AssertionError("revision singleton constraint accepted id=2")

    asyncio.run(scenario())


def test_migration_backfills_parseable_legacy_payload_and_downgrade_keeps_it() -> None:
    """Catch a cutover that loses the live revision or destroys its source row."""

    relation_snapshot, legacy_snapshot = asyncio.run(_protocol_snapshot())
    legacy_value = json.dumps(
        {
            "revision": 7,
            "changes": [
                {
                    "entityType": "question",
                    "entityId": "migrated-q",
                    "action": "updated",
                },
                {
                    "entityType": "question",
                    "entityId": "migrated-q",
                    "action": "updated",
                },
                "damaged-change",
            ],
            "updatedAt": "2026-08-29T10:11:12+00:00",
            "updatedBy": "migration-teacher",
        },
        separators=(",", ":"),
    )
    try:
        _run_alembic("downgrade", "c8e4f1a2b930")
        asyncio.run(_replace_legacy(legacy_value, "legacy-writer"))
        _run_alembic("upgrade", "b9d2e4f6a810")

        async def assert_backfill() -> None:
            async with AsyncSessionLocal() as db:
                row = await db.get(TeachingContentRevision, 1)
                assert row is not None
                assert row.revision == 7
                assert row.changes == [
                    {
                        "entityType": "question",
                        "entityId": "migrated-q",
                        "action": "updated",
                    }
                ]
                assert row.updated_by == "migration-teacher"
                assert row.updated_at.isoformat() == "2026-08-29T10:11:12+00:00"

        asyncio.run(assert_backfill())
        _run_alembic("downgrade", "c8e4f1a2b930")

        async def assert_downgrade() -> None:
            async with AsyncSessionLocal() as db:
                table_name = (
                    await db.execute(
                        text("SELECT to_regclass('public.teaching_content_revisions')")
                    )
                ).scalar_one()
                legacy = await db.get(SharedRuntimeState, LEGACY_KEY)
                assert table_name is None
                assert legacy is not None and legacy.value == legacy_value

        asyncio.run(assert_downgrade())
    finally:
        _run_alembic("upgrade", "b9d2e4f6a810")
        asyncio.run(_restore_protocol(relation_snapshot, legacy_snapshot))


def test_migration_initializes_zero_when_legacy_payload_is_not_json() -> None:
    """Catch malformed Runtime data aborting deployment or becoming a false revision."""

    relation_snapshot, legacy_snapshot = asyncio.run(_protocol_snapshot())
    try:
        _run_alembic("downgrade", "c8e4f1a2b930")
        asyncio.run(_replace_legacy("{broken-json", "legacy-writer"))
        _run_alembic("upgrade", "b9d2e4f6a810")

        async def assert_default() -> None:
            async with AsyncSessionLocal() as db:
                row = await db.get(TeachingContentRevision, 1)
                assert row is not None
                assert row.revision == 0
                assert row.changes == []
                assert row.updated_by is None

        asyncio.run(assert_default())
    finally:
        _run_alembic("upgrade", "b9d2e4f6a810")
        asyncio.run(_restore_protocol(relation_snapshot, legacy_snapshot))
