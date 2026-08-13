import asyncio
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.user import User


LEGAL_VERSION = "2026-08-13-v1"


async def _cleanup(username: str) -> None:
    async with AsyncSessionLocal() as db:
        await db.execute(delete(User).where(User.username == username))
        await db.commit()


async def _consent(username: str) -> tuple[str | None, object | None]:
    async with AsyncSessionLocal() as db:
        user = await db.get(User, username)
        assert user is not None
        return user.legal_consent_version, user.legal_consent_at


def test_register_and_login_persist_the_accepted_legal_version(monkeypatch) -> None:
    from app.core.config import settings

    monkeypatch.setattr(settings, "LEGAL_CONSENT_REQUIRED", True)
    username = f"legal-consent-{uuid4().hex[:10]}"
    try:
        with TestClient(app) as client:
            registered = client.post(
                "/api/v1/auth/register",
                json={
                    "username": username,
                    "password": "legal-consent-pass",
                    "acceptedTermsVersion": LEGAL_VERSION,
                },
            )
            assert registered.status_code == 200, registered.text
            assert registered.json()["user"]["legalConsentVersion"] == LEGAL_VERSION
            assert registered.json()["user"]["legalConsentAt"]

            client.post("/api/v1/auth/logout")
            logged_in = client.post(
                "/api/v1/auth/login",
                json={
                    "username": username,
                    "password": "legal-consent-pass",
                    "acceptedTermsVersion": LEGAL_VERSION,
                },
            )
            assert logged_in.status_code == 200, logged_in.text
            assert logged_in.json()["user"]["legalConsentVersion"] == LEGAL_VERSION
            version, accepted_at = asyncio.run(_consent(username))
            assert version == LEGAL_VERSION
            assert accepted_at is not None
    finally:
        asyncio.run(_cleanup(username))


def test_credentials_are_rejected_without_the_current_legal_consent(monkeypatch) -> None:
    from app.core.config import settings

    monkeypatch.setattr(settings, "LEGAL_CONSENT_REQUIRED", True)
    username = f"legal-required-{uuid4().hex[:10]}"
    try:
        with TestClient(app) as client:
            registration = client.post(
                "/api/v1/auth/register",
                json={"username": username, "password": "legal-consent-pass"},
            )
            assert registration.status_code == 400
            assert "隐私政策" in registration.json()["detail"]

            registered = client.post(
                "/api/v1/auth/register",
                json={
                    "username": username,
                    "password": "legal-consent-pass",
                    "acceptedTermsVersion": LEGAL_VERSION,
                },
            )
            assert registered.status_code == 200, registered.text
            client.post("/api/v1/auth/logout")

            login = client.post(
                "/api/v1/auth/login",
                json={"username": username, "password": "legal-consent-pass"},
            )
            assert login.status_code == 400
            assert "隐私政策" in login.json()["detail"]
    finally:
        asyncio.run(_cleanup(username))


def test_demo_wechat_login_requires_the_current_legal_consent(monkeypatch) -> None:
    from app.core.config import settings

    monkeypatch.setattr(settings, "LEGAL_CONSENT_REQUIRED", True)
    monkeypatch.setattr(settings, "WECHAT_ENABLE_DEMO", True)
    with TestClient(app) as client:
        rejected = client.post("/api/v1/auth/wechat/demo-login")
        assert rejected.status_code == 400
        accepted = client.post(
            "/api/v1/auth/wechat/demo-login",
            params={"accepted_terms_version": LEGAL_VERSION},
        )
        assert accepted.status_code == 200, accepted.text
        assert accepted.json()["user"]["legalConsentVersion"] == LEGAL_VERSION
