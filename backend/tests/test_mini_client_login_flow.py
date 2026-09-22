"""Run the actual mini client auth code against a disposable FastAPI/PG service."""
import os
import asyncio
from pathlib import Path
import socket
import subprocess
import threading
import time
from uuid import uuid4
import uvicorn
from app.core.config import settings
from app.main import app
from app.services import wechat_mini_service
from app.db.session import AsyncSessionLocal
from app.models.paper_release import PaperReleaseQuestion
from sqlalchemy import select
from test_practice_sessions import _practice_fixture_ids, _seed_released_pmp_paper


async def _seed_bilingual_paper(ids):
    await _seed_released_pmp_paper(ids, domains=["people", "process", "business-environment"])
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(PaperReleaseQuestion).where(
            PaperReleaseQuestion.release_id == ids["release"]
        ))).scalars().all()
        for row in rows:
            snapshot = dict(row.snapshot)
            snapshot["translations"] = {"en": {
                "stem": f"Review question {row.order_index + 1}: choose the best answer.",
                "options": [{"id": "A", "text": "Correct choice"}, {"id": "B", "text": "Other choice"}],
            }}
            row.snapshot = snapshot
        await db.commit()


def test_mini_client_first_login_register_bind_and_retry(monkeypatch):
    prefix = uuid4().hex
    ids = _practice_fixture_ids()
    asyncio.run(_seed_bilingual_paper(ids))
    async def exchange(code):
        return {"openid": f"client_flow_{prefix}_{code}"}
    monkeypatch.setattr(wechat_mini_service, "exchange_code", exchange)
    monkeypatch.setattr(settings, "LEGAL_CONSENT_REQUIRED", True)
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, log_level="error", access_log=False))
    worker = threading.Thread(target=server.run, kwargs={"sockets": [sock]}, daemon=True)
    worker.start()
    try:
        deadline = time.monotonic() + 15
        while not server.started:
            assert worker.is_alive() and time.monotonic() < deadline
            time.sleep(.05)
        env = dict(os.environ, MINI_LOGIN_TEST_BASE=f"http://127.0.0.1:{port}", MINI_LOGIN_TEST_PREFIX=prefix,
                   MINI_LOGIN_TEST_RELEASE=ids["release"])
        result = subprocess.run(
            ["node", "--experimental-strip-types", "miniprogram/tests/manual/first-login-flow.mjs"],
            cwd=Path(__file__).resolve().parents[2], env=env, capture_output=True, text=True, timeout=40,
        )
        assert result.returncode == 0, result.stdout + result.stderr
        assert "FIRST_LOGIN_FLOW_OK" in result.stdout
    finally:
        server.should_exit = True
        worker.join(timeout=15)
        sock.close()
