"""Proof that every pytest process owns a disposable PostgreSQL database."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

from sqlalchemy import delete, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import settings
from app.db.session import AsyncSessionLocal
from app.models.shared_runtime_state import SharedRuntimeState
from app.services import (
    teaching_content_projection_service,
)


PROTOCOL_KEYS = (
    teaching_content_projection_service.PRINCIPLE_KEY,
    teaching_content_projection_service.PRESET_KEY,
)


async def _database_name_and_protocol_fingerprint(database_url: str) -> tuple[str, str]:
    engine = create_async_engine(
        database_url,
        poolclass=NullPool,
        connect_args={"host": "/tmp"} if "host=" in database_url else {},
    )
    try:
        async with engine.connect() as connection:
            database_name = str(
                (await connection.execute(text("SELECT current_database()"))).scalar_one()
            )
            rows = (
                await connection.execute(
                    select(
                        SharedRuntimeState.key,
                        SharedRuntimeState.value,
                        SharedRuntimeState.schema_version,
                        SharedRuntimeState.updated_by,
                        SharedRuntimeState.created_at,
                        SharedRuntimeState.updated_at,
                    )
                    .where(SharedRuntimeState.key.in_(PROTOCOL_KEYS))
                    .order_by(SharedRuntimeState.key)
                )
            ).all()
            revision_table = (
                await connection.execute(
                    text("SELECT to_regclass('public.teaching_content_revisions')")
                )
            ).scalar_one()
            revision_rows = []
            if revision_table is not None:
                revision_rows = (
                    await connection.execute(
                        text(
                            """
                            SELECT id, revision, changes, updated_by, updated_at
                            FROM teaching_content_revisions
                            ORDER BY id
                            """
                        )
                    )
                ).all()
        encoded = json.dumps(
            {
                "runtime": [tuple(str(value) for value in row) for row in rows],
                "revision": [
                    tuple(str(value) for value in row) for row in revision_rows
                ],
            },
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
        return database_name, hashlib.sha256(encoded).hexdigest()
    finally:
        await engine.dispose()


async def _run_child_probe(sentinel: str, other: str, barrier_dir: Path) -> dict:
    own_key = f"kg_pytest_process_sentinel_{sentinel}"
    other_key = f"kg_pytest_process_sentinel_{other}"
    saw_other = False
    database_name = ""
    try:
        async with AsyncSessionLocal() as db:
            database_name = str(
                (await db.execute(text("SELECT current_database()"))).scalar_one()
            )
            db.add(
                SharedRuntimeState(
                    key=own_key,
                    value=json.dumps({"sentinel": sentinel}),
                    updated_by="pytest-isolation-proof",
                )
            )
            await db.commit()

        (barrier_dir / f"{sentinel}.ready").write_text("ready", encoding="utf-8")
        deadline = time.monotonic() + 15
        while not (barrier_dir / f"{other}.ready").exists():
            if time.monotonic() >= deadline:
                raise AssertionError("peer pytest process did not reach the sentinel barrier")
            time.sleep(0.02)

        async with AsyncSessionLocal() as db:
            saw_other = await db.get(SharedRuntimeState, other_key) is not None

        (barrier_dir / f"{sentinel}.checked").write_text("checked", encoding="utf-8")
        deadline = time.monotonic() + 15
        while not (barrier_dir / f"{other}.checked").exists():
            if time.monotonic() >= deadline:
                raise AssertionError("peer pytest process did not finish its sentinel read")
            time.sleep(0.02)
    finally:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(SharedRuntimeState).where(SharedRuntimeState.key == own_key))
            await db.commit()
    return {"database": database_name, "sawOther": saw_other}


def test_each_pytest_process_uses_an_isolated_disposable_database(tmp_path: Path) -> None:
    child_sentinel = os.environ.get("KG_PYTEST_ISOLATION_CHILD")
    if child_sentinel:
        other = os.environ["KG_PYTEST_ISOLATION_OTHER"]
        barrier_dir = Path(os.environ["KG_PYTEST_ISOLATION_BARRIER"])
        result = asyncio.run(_run_child_probe(child_sentinel, other, barrier_dir))
        print(f"ISOLATION_PROBE={json.dumps(result, sort_keys=True)}", flush=True)
        assert result["sawOther"] is False
        return

    source_url = os.environ.get(
        "KG_PYTEST_SOURCE_DATABASE_URL",
        settings.DATABASE_URL,
    )
    source_database_before, source_hash_before = asyncio.run(
        _database_name_and_protocol_fingerprint(source_url)
    )
    barrier_dir = tmp_path / "barrier"
    barrier_dir.mkdir()
    test_node = (
        Path(__file__).resolve().as_posix()
        + "::test_each_pytest_process_uses_an_isolated_disposable_database"
    )
    processes: list[subprocess.Popen[str]] = []
    for sentinel, other in (("alpha", "beta"), ("beta", "alpha")):
        child_env = dict(os.environ)
        child_env.update(
            {
                "KG_PYTEST_ISOLATION_CHILD": sentinel,
                "KG_PYTEST_ISOLATION_OTHER": other,
                "KG_PYTEST_ISOLATION_BARRIER": str(barrier_dir),
            }
        )
        processes.append(
            subprocess.Popen(
                [sys.executable, "-m", "pytest", test_node, "-q", "-s"],
                cwd=Path(__file__).resolve().parents[1],
                env=child_env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
            )
        )

    outputs: list[str] = []
    for process in processes:
        output, _ = process.communicate(timeout=45)
        outputs.append(output)
        assert process.returncode == 0, output

    probe_results = []
    for output in outputs:
        marker = next(
            line.removeprefix("ISOLATION_PROBE=")
            for line in output.splitlines()
            if line.startswith("ISOLATION_PROBE=")
        )
        probe_results.append(json.loads(marker))
    child_databases = {result["database"] for result in probe_results}
    assert len(child_databases) == 2
    assert source_database_before not in child_databases

    source_database_after, source_hash_after = asyncio.run(
        _database_name_and_protocol_fingerprint(source_url)
    )
    assert source_database_after == source_database_before
    assert source_hash_after == source_hash_before
    assert make_url(source_url).database == source_database_before
