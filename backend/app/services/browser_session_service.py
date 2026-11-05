"""Browser-cookie identities and durable, device-scoped revocation.

Existing cookies require no backfill. Tombstones are deliberately retained:
never discard one while a delayed response could still sign its old identity.
"""
import hashlib
import hmac

from fastapi import Request
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.browser_session import RevokedBrowserSession


def identity(request: Request) -> str | None:
    if not request.session.get('username'):
        return None
    value = request.session.get('login_session_id')
    if isinstance(value, str) and value:
        return value
    # Stable across concurrent legacy reads and their eventual upgrade cookie.
    # HMAC prevents exposing the original signed cookie in a public session ID.
    if not request.scope.get('headers'):
        return None
    cookie = request.cookies.get(settings.SESSION_COOKIE_NAME, '')
    if not cookie:
        return None
    return 'legacy-' + hmac.new(settings.SECRET_KEY.encode(), cookie.encode(), hashlib.sha256).hexdigest()


def _hash(username: str, value: str) -> str:
    # Scope even legacy/non-random session IDs to their authenticated account.
    return hashlib.sha256((username + "\0" + value).encode()).hexdigest()


async def is_revoked(db: AsyncSession, request: Request) -> bool:
    value = identity(request)
    return value is not None and await db.get(RevokedBrowserSession, _hash(str(request.session["username"]), value)) is not None


async def revoke(db: AsyncSession, request: Request) -> None:
    value = identity(request)
    if value:
        await db.execute(insert(RevokedBrowserSession).values(session_hash=_hash(str(request.session["username"]), value)).on_conflict_do_nothing())
