from __future__ import annotations

import asyncio
import os
from pathlib import Path
import subprocess
import sys

from sqlalchemy import text

from app.db.session import AsyncSessionLocal


BACKEND_ROOT = Path(__file__).resolve().parents[1]
PREVIOUS_REVISION = "ca3f5a7b9d20"


def _alembic(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=BACKEND_ROOT,
        env=dict(os.environ),
        check=True,
        capture_output=True,
        text=True,
    )


async def _column_exists() -> bool:
    async with AsyncSessionLocal() as db:
        return bool(
            (
                await db.execute(
                    text(
                        """
                        SELECT 1
                        FROM information_schema.columns
                        WHERE table_schema = 'public'
                          AND table_name = 'activity_tags'
                          AND column_name = 'content_metadata'
                        """
                    )
                )
            ).scalar_one_or_none()
        )


def test_activity_tag_metadata_migration_upgrades_downgrades_and_renders_offline() -> None:
    try:
        _alembic("upgrade", "head")
        assert asyncio.run(_column_exists())
        _alembic("downgrade", PREVIOUS_REVISION)
        assert not asyncio.run(_column_exists())
        _alembic("upgrade", "head")
        assert asyncio.run(_column_exists())

        offline = _alembic("upgrade", f"{PREVIOUS_REVISION}:head", "--sql").stdout
        assert "ADD COLUMN content_metadata JSONB" in offline
        assert "activity_tags" in offline
    finally:
        _alembic("upgrade", "head")
