"""题目类接口的进程内滑动窗口限流。"""

from __future__ import annotations

import logging
import time
from collections import deque
from typing import Annotated

from fastapi import Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import optional_current_user
from app.core.config import settings
from app.db.session import get_db
from app.models.user import User
from app.services import user_service

logger = logging.getLogger(__name__)
_BUCKET_TTL_SECONDS = 3600.0
_WINDOW_SECONDS = 60.0
_hits: dict[str, deque[float]] = {}


def client_ip(request: Request) -> str:
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def reset_all() -> None:
    _hits.clear()


def _prune_stale_buckets() -> None:
    now = time.monotonic()
    stale = [key for key, hits in _hits.items() if not hits or now - hits[-1] > _BUCKET_TTL_SECONDS]
    for key in stale:
        _hits.pop(key, None)


def _seconds_until_slot(key: str, limit: int) -> float:
    now = time.monotonic()
    hits = _hits.setdefault(key, deque())
    while hits and now - hits[0] >= _WINDOW_SECONDS:
        hits.popleft()
    if len(hits) >= limit:
        return _WINDOW_SECONDS - (now - hits[0])
    hits.append(now)
    return 0.0


async def _audit_rejection(
    db: AsyncSession, request: Request, user: User | None, scope: str, retry_after: float
) -> None:
    username = getattr(user, "username", None) or "anonymous"
    logger.warning(
        "rate limit exceeded: scope=%s user=%s ip=%s path=%s retry_after=%.1fs",
        scope, username, client_ip(request), request.url.path, retry_after,
    )
    try:
        await user_service.log_action(
            db,
            action="rate_limit_rejected",
            target_username=username,
            actor="system",
            detail=f"scope={scope} path={request.url.path} retry_after={retry_after:.1f}s",
            client_ip=client_ip(request),
            user_agent=request.headers.get("user-agent"),
        )
        await db.commit()
    except Exception:  # noqa: BLE001 - 审计失败不能阻断限流响应
        logger.exception("failed to persist rate limit audit log")


async def question_rate_limiter(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    if not settings.RATE_LIMIT_ENABLED:
        return
    user = await optional_current_user(request, db)
    _prune_stale_buckets()
    waits = [
        _seconds_until_slot(
            f"questions:ip:{client_ip(request)}",
            settings.RATE_LIMIT_QUESTIONS_IP_PER_MINUTE,
        )
    ]
    if user is not None:
        waits.append(
            _seconds_until_slot(
                f"questions:u:{user.username}",
                settings.RATE_LIMIT_QUESTIONS_PER_MINUTE,
            )
        )
    retry_after = max(waits)
    if retry_after > 0:
        await _audit_rejection(db, request, user, "questions", retry_after)
        raise HTTPException(
            status_code=429,
            detail={"code": "RATE_LIMITED", "message": "请求过于频繁，请稍后再试"},
            headers={"Retry-After": str(max(1, int(retry_after) + 1))},
        )


QuestionRateLimited = Annotated[None, Depends(question_rate_limiter)]
