"""Run the actual mini client auth code against a disposable FastAPI/PG service."""
import os
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


def test_mini_client_first_login_register_bind_and_retry(monkeypatch):
    prefix = uuid4().hex
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
        env = dict(os.environ, MINI_LOGIN_TEST_BASE=f"http://127.0.0.1:{port}", MINI_LOGIN_TEST_PREFIX=prefix)
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
