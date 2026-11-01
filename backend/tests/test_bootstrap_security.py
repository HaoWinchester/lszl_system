"""First-hit bulk-read enforcement, persisted across clients and auth transports."""

import asyncio
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.user import User, UserAdminLog

URL = "/api/v1/question-catalog/bootstrap"
BULK = {"include_questions": "true"}
PASSWORD = "bootstrap-security-pass"


def client_at(ip):
    async def with_peer(scope, receive, send):
        if scope["type"] == "http":
            scope = {**scope, "client": (ip, 12345)}
        await app(scope, receive, send)
    return TestClient(with_peer)


def seed_user(role="student"):
    name = "bulk-security-" + uuid4().hex[:12]
    async def seed():
        async with AsyncSessionLocal() as db:
            db.add(User(username=name, password_hash=hash_password(PASSWORD), role=role, status="active"))
            await db.commit()
    asyncio.run(seed())
    return name


def login(client, name):
    response = client.post("/api/v1/auth/login", json={"username": name, "password": PASSWORD})
    assert response.status_code == 200, response.text


def test_anonymous_first_bulk_attempt_returns_no_content_and_locks_ip():
    ip = "198.51.100.11"
    with client_at(ip) as client:
        response = client.get(URL, params=BULK)
        assert response.status_code == 403
        assert response.json()["detail"]["code"] == "BULK_READ_BLOCKED"
        assert "questions" not in response.json()
    # A fresh browser/session cannot evade the database-backed lock.
    with client_at(ip) as client:
        assert client.get(URL).status_code == 403
        assert client.post("/api/v1/auth/login", json={"username": "anything", "password": "x"}).status_code == 403
        assert client.get("/").status_code == 403
        assert client.get("/api/v1/health").status_code == 200
    with client_at("198.51.100.12") as other:
        assert other.get(URL).status_code == 200

    async def inspect():
        from app.models.security import SecurityIPBlock
        async with AsyncSessionLocal() as db:
            assert await db.get(SecurityIPBlock, ip)
            log = await db.scalar(select(UserAdminLog).where(UserAdminLog.action == "bulk_read_blocked", UserAdminLog.client_ip == ip))
            assert log and log.target_username is None
    asyncio.run(inspect())


def test_student_first_bulk_attempt_pauses_account_and_invalidates_existing_session():
    name = seed_user()
    with client_at("198.51.100.21") as client, client_at("198.51.100.22") as existing:
        login(client, name)
        login(existing, name)
        response = client.get(URL, params=BULK)
        assert response.status_code == 403
        assert response.json()["detail"]["code"] == "BULK_READ_BLOCKED"
        assert existing.get("/api/v1/auth/me").status_code == 401
        assert existing.post("/api/v1/auth/login", json={"username": name, "password": PASSWORD}).status_code == 403
    async def inspect():
        async with AsyncSessionLocal() as db:
            assert (await db.get(User, name)).status == "paused"
            assert await db.scalar(select(UserAdminLog.id).where(UserAdminLog.action == "bulk_read_blocked", UserAdminLog.target_username == name))
    asyncio.run(inspect())


@pytest.mark.parametrize("role", ["teacher", "admin"])
def test_authorized_management_bulk_reads_and_learning_summaries_remain_available(role):
    name = seed_user(role)
    ip = "198.51.100.31" if role == "teacher" else "198.51.100.32"
    with client_at(ip) as client:
        login(client, name)
        for mode in ("managed", "learning"):
            response = client.get(URL, params={**BULK, "mode": mode})
            assert response.status_code == 200, response.text
            assert isinstance(response.json()["questions"], list)
        assert client.get("/api/v1/auth/me").status_code == 200


def test_normal_learning_and_rate_limits_do_not_suspend_or_lock(monkeypatch):
    from app.core.config import settings
    name = seed_user()
    monkeypatch.setattr(settings, "RATE_LIMIT_QUESTIONS_PER_MINUTE", 3)
    with client_at("198.51.100.41") as client:
        assert client.get(URL).status_code == 200
        login(client, name)
        assert client.get(URL, params={"include_questions": "false"}).status_code == 200
        assert client.get("/api/v1/question-catalog/learning/questions", params={"page_size": 1}).status_code == 200
        assert client.get(URL).status_code == 200
        assert client.get(URL).status_code == 429
        assert client.get("/api/v1/auth/me").status_code == 200
    async def inspect():
        from app.models.security import SecurityIPBlock
        async with AsyncSessionLocal() as db:
            assert (await db.get(User, name)).status == "active"
            assert await db.get(SecurityIPBlock, "198.51.100.41") is None
    asyncio.run(inspect())


def test_untrusted_forwarding_cannot_lock_a_victims_ip():
    with client_at("198.51.100.51") as client:
        response = client.get(URL, params=BULK, headers={"X-Real-IP": "198.51.100.52", "X-Forwarded-For": "198.51.100.52"})
        assert response.status_code == 403
    with client_at("198.51.100.52") as victim:
        assert victim.get(URL).status_code == 200
    with client_at("198.51.100.51") as attacker:
        assert attacker.get(URL, headers={"X-Real-IP": "198.51.100.53"}).status_code == 403


def test_trusted_proxy_locks_real_client_without_locking_the_proxy():
    with client_at("127.0.0.1") as proxy:
        headers = {"X-Real-IP": "198.51.100.54"}
        assert proxy.get(URL, params=BULK, headers=headers).status_code == 403
        assert proxy.get(URL, headers=headers).status_code == 403
        assert proxy.get(URL, headers={"X-Real-IP": "198.51.100.55"}).status_code == 200


def test_bearer_bulk_attempt_suspends_account_and_all_of_its_tokens():
    from app.services import wechat_mini_service
    name = seed_user()
    async def issue():
        async with AsyncSessionLocal() as db:
            user = await db.get(User, name)
            one = await wechat_mini_service.issue_session(db, user, {"platform": "test"})
            two = await wechat_mini_service.issue_session(db, user, {"platform": "test"})
            return one.token, two.token
    one, two = asyncio.run(issue())
    with client_at("198.51.100.56") as client:
        response = client.get(URL, params=BULK, headers={"Authorization": f"Bearer {one}"})
        assert response.status_code == 403
        assert response.json()["detail"]["code"] == "BULK_READ_BLOCKED"
    with client_at("198.51.100.57") as elsewhere:
        for token in (one, two):
            assert elsewhere.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401


@pytest.mark.parametrize("value, expected", [
    ("2001:db8::1", "2001:db8::1"),
    ("::ffff:198.51.100.1", "198.51.100.1"),
])
def test_client_ip_normalizes_equivalent_addresses(value, expected):
    from app.core.client_ip import normalize_ip
    assert normalize_ip(value) == expected


@pytest.mark.parametrize("headers", [
    {"Sec-Fetch-Site": "cross-site"},
    {"Origin": "https://untrusted.example"},
    {"Referer": "https://untrusted.example/"},
])
def test_cross_site_bulk_request_is_rejected_without_sanctioning_the_victim(headers):
    name = seed_user()
    with client_at("198.51.100.61") as client:
        login(client, name)
        response = client.get(URL, params=BULK, headers=headers)
        assert response.status_code == 403
        assert client.get(URL).status_code == 200
        assert client.get("/api/v1/auth/me").status_code == 200


def test_bulk_guard_runs_before_rate_limit_and_independently_of_rate_limit_switch(monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "RATE_LIMIT_QUESTIONS_IP_PER_MINUTE", 1)
    with client_at("198.51.100.71") as client:
        assert client.get(URL).status_code == 200
        assert client.get(URL, params=BULK).status_code == 403
    monkeypatch.setattr(settings, "RATE_LIMIT_ENABLED", False)
    with client_at("198.51.100.72") as client:
        assert client.get(URL, params=BULK).status_code == 403
        assert client.get(URL).status_code == 403


def test_admin_can_list_and_release_ip_lock_without_reactivating_the_account():
    name, admin = seed_user(), seed_user("admin")
    with client_at("198.51.100.81") as client:
        login(client, name)
        assert client.get(URL, params=BULK).status_code == 403
    with client_at("198.51.100.82") as control:
        assert control.get("/api/v1/system/security/ip-blocks").status_code == 401
        login(control, seed_user("teacher"))
        assert control.get("/api/v1/system/security/ip-blocks").status_code == 403
        assert control.delete("/api/v1/system/security/ip-blocks/198.51.100.81").status_code == 403
        login(control, name=admin)
        listing = control.get("/api/v1/system/security/ip-blocks")
        assert listing.status_code == 200
        assert any(row["ip"] == "198.51.100.81" for row in listing.json()["blocks"])
        assert control.delete("/api/v1/system/security/ip-blocks/198.51.100.81").status_code == 200
    with client_at("198.51.100.81") as released:
        assert released.get(URL).status_code == 200
        assert released.post("/api/v1/auth/login", json={"username": name, "password": PASSWORD}).status_code == 403


@pytest.fixture(autouse=True)
def clean_test_blocks():
    yield
    # Only delete this module's reserved documentation-range IP fixtures.
    try:
        from app.models.security import SecurityIPBlock
    except ImportError:
        return
    async def cleanup():
        async with AsyncSessionLocal() as db:
            await db.execute(delete(SecurityIPBlock).where(SecurityIPBlock.ip.like("198.51.100.%")))
            await db.commit()
    asyncio.run(cleanup())
