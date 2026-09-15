"""题目接口限流契约。"""

import asyncio
from uuid import uuid4

from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.user import User

PASSWORD = "rate-limit-pass"
URL = "/api/v1/question-catalog/learning/questions"


def _login(client: TestClient, username: str) -> None:
    assert client.post(
        "/api/v1/auth/login", json={"username": username, "password": PASSWORD}
    ).status_code == 200


def _seed_users(usernames: list[str]) -> None:
    async def seed() -> None:
        async with AsyncSessionLocal() as db:
            password_hash = hash_password(PASSWORD)
            db.add_all([
                User(username=name, password_hash=password_hash, role="student", status="active")
                for name in usernames
            ])
            await db.commit()

    asyncio.run(seed())


def test_public_question_catalog_stays_anonymous_and_is_ip_limited(monkeypatch) -> None:
    monkeypatch.setattr(settings, "RATE_LIMIT_QUESTIONS_IP_PER_MINUTE", 2)
    with TestClient(app) as client:
        assert client.get(URL).status_code == 200
        assert client.get(URL).status_code == 200
        limited = client.get(URL)
        assert limited.status_code == 429
        assert limited.json()["detail"]["code"] == "RATE_LIMITED"
        assert int(limited.headers["Retry-After"]) >= 1


def test_question_rate_limit_has_an_account_bucket(monkeypatch) -> None:
    monkeypatch.setattr(settings, "RATE_LIMIT_QUESTIONS_PER_MINUTE", 2)
    monkeypatch.setattr(settings, "RATE_LIMIT_QUESTIONS_IP_PER_MINUTE", 120)
    username = f"rate-limit-user-{uuid4().hex[:10]}"
    _seed_users([username])
    with TestClient(app) as client:
        _login(client, username)
        assert client.get(URL).status_code == 200
        assert client.get(URL).status_code == 200
        assert client.get(URL).status_code == 429


def test_question_rate_limit_ip_bucket_is_shared_across_accounts(monkeypatch) -> None:
    monkeypatch.setattr(settings, "RATE_LIMIT_QUESTIONS_PER_MINUTE", 20)
    monkeypatch.setattr(settings, "RATE_LIMIT_QUESTIONS_IP_PER_MINUTE", 3)
    users = [f"rate-limit-ip-{suffix}-{uuid4().hex[:8]}" for suffix in ("a", "b")]
    _seed_users(users)
    with TestClient(app) as client:
        _login(client, users[0])
        assert client.get(URL).status_code == 200
        assert client.get(URL).status_code == 200
        client.post("/api/v1/auth/logout")
        _login(client, users[1])
        assert client.get(URL).status_code == 200
        assert client.get(URL).status_code == 429


def test_question_rate_limit_can_be_disabled(monkeypatch) -> None:
    monkeypatch.setattr(settings, "RATE_LIMIT_ENABLED", False)
    monkeypatch.setattr(settings, "RATE_LIMIT_QUESTIONS_IP_PER_MINUTE", 1)
    with TestClient(app) as client:
        for _ in range(3):
            assert client.get(URL).status_code == 200
