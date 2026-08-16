"""Create one migrated, disposable PostgreSQL database per pytest process.

This module deliberately prepares ``DATABASE_URL`` before importing anything
from ``app``.  That keeps the module-level SQLAlchemy engine and every test in
the process pointed at the disposable database, including parallel pytest
workers and pytest subprocesses.
"""

from __future__ import annotations

import atexit
import asyncio
import os
from pathlib import Path
import subprocess
import sys
from urllib.parse import urlencode
from uuid import uuid4

from dotenv import dotenv_values
from sqlalchemy.engine import URL, make_url


BACKEND_ROOT = Path(__file__).resolve().parents[1]
SOURCE_DATABASE_URL_ENV = "KG_PYTEST_SOURCE_DATABASE_URL"
TEST_DATABASE_NAME_ENV = "KG_PYTEST_DATABASE_NAME"
DEFAULT_DATABASE_URL = "postgresql+asyncpg://menghao@/kg_graph_dev?host=/tmp"


def _source_database_url() -> str:
    inherited_source = os.environ.get(SOURCE_DATABASE_URL_ENV)
    if inherited_source:
        return inherited_source
    configured = os.environ.get("DATABASE_URL")
    if configured:
        return configured
    dotenv_url = dotenv_values(BACKEND_ROOT / ".env").get("DATABASE_URL")
    return str(dotenv_url or DEFAULT_DATABASE_URL)


def _postgres_command(command: str, database_url: URL, database_name: str) -> None:
    args = [command]
    host = database_url.query.get("host") or database_url.host
    if host:
        args.extend(["--host", str(host)])
    if database_url.port:
        args.extend(["--port", str(database_url.port)])
    if database_url.username:
        args.extend(["--username", database_url.username])
    if command == "dropdb":
        args.extend(["--if-exists", "--force"])
    args.append(database_name)
    command_env = dict(os.environ)
    if database_url.password:
        command_env["PGPASSWORD"] = database_url.password
    subprocess.run(
        args,
        cwd=BACKEND_ROOT,
        env=command_env,
        check=True,
        capture_output=True,
        text=True,
    )


_SOURCE_DATABASE_URL = _source_database_url()
_SOURCE_URL = make_url(_SOURCE_DATABASE_URL)
if not _SOURCE_URL.drivername.startswith("postgresql"):
    raise RuntimeError("pytest disposable database isolation requires PostgreSQL")

_TEST_DATABASE_NAME = f"kg_pytest_{os.getpid()}_{uuid4().hex[:12]}"
_query_items: list[tuple[str, str]] = []
for _query_key, _query_value in _SOURCE_URL.query.items():
    if isinstance(_query_value, tuple):
        _query_items.extend((_query_key, str(value)) for value in _query_value)
    else:
        _query_items.append((_query_key, str(_query_value)))
_TEST_DATABASE_URL = _SOURCE_URL.set(
    database=_TEST_DATABASE_NAME,
    query={},
).render_as_string(hide_password=False)
if _query_items:
    _TEST_DATABASE_URL += "?" + urlencode(_query_items, doseq=True, safe="/")
os.environ[SOURCE_DATABASE_URL_ENV] = _SOURCE_DATABASE_URL
os.environ[TEST_DATABASE_NAME_ENV] = _TEST_DATABASE_NAME
os.environ["DATABASE_URL"] = _TEST_DATABASE_URL
# Existing test fixtures deliberately exercise permissions rather than the
# consent prompt. Consent-specific tests enable the production guard directly.
os.environ["LEGAL_CONSENT_REQUIRED"] = "false"

_database_created = False
_database_dropped = False


def _drop_test_database() -> None:
    global _database_dropped
    if not _database_created or _database_dropped:
        return
    _postgres_command("dropdb", _SOURCE_URL, _TEST_DATABASE_NAME)
    _database_dropped = True


try:
    _postgres_command("createdb", _SOURCE_URL, _TEST_DATABASE_NAME)
    _database_created = True
    migration = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=BACKEND_ROOT,
        env=dict(os.environ),
        check=False,
        capture_output=True,
        text=True,
    )
    if migration.returncode != 0:
        raise RuntimeError(
            "disposable test database migration failed:\n"
            f"{migration.stdout}\n{migration.stderr}"
        )
except BaseException:
    _drop_test_database()
    raise

atexit.register(_drop_test_database)


# These imports must remain below the database creation, environment override,
# and Alembic migration above.
from app.core.config import settings  # noqa: E402
from app.db.session import engine  # noqa: E402
from app.main import _seed_admin, _seed_guided_course  # noqa: E402

# 本地 .env 可能临时开启 CONTENT_PREP_VALIDATION_DISABLED(dev 提速),但测试永远跑默认校验路径;
# 需要开关行为的测试(test_content_prep_validation_switch)自行显式设置。
settings.CONTENT_PREP_VALIDATION_DISABLED = False

asyncio.run(_seed_admin())
asyncio.run(_seed_guided_course())


def pytest_sessionfinish(session, exitstatus) -> None:
    """Close the process engine, then remove exactly its disposable database."""

    asyncio.run(engine.dispose())
    _drop_test_database()
