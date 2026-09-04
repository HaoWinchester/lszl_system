"""Shared legal-consent policy for every authentication transport."""

from app.core.config import settings

LEGAL_CONSENT_VERSION = "2026-08-13-v1"
LEGAL_CONSENT_MESSAGE = "请先阅读并同意《隐私政策》和《使用条款》"


def accepted_legal_consent(version: str | None) -> str | None:
    normalized = str(version or "").strip()
    if not settings.LEGAL_CONSENT_REQUIRED:
        return normalized or None
    if normalized != LEGAL_CONSENT_VERSION:
        raise ValueError(LEGAL_CONSENT_MESSAGE)
    return normalized
