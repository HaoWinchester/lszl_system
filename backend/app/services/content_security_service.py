"""Shared permission boundary, persistent sanctions and administrator recovery."""

from urllib.parse import urlsplit

from fastapi import HTTPException, Request
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.client_ip import client_ip, normalize_ip
from app.core.permissions import can
from app.models.security import SecurityIPBlock
from app.models.user import PAUSED
from app.services import user_service


async def is_ip_blocked(db: AsyncSession, ip: str | None) -> bool:
    return ip is not None and await db.get(SecurityIPBlock, ip) is not None


async def guard_bootstrap_bulk_read(db: AsyncSession, request: Request, include_questions: bool) -> None:
    if not include_questions:
        return
    # Import locally because auth also resolves users through service modules.
    from app.core.auth import optional_current_user

    try:
        user = await optional_current_user(request, db)
    except HTTPException as error:
        if error.status_code != 401:
            raise
        user = None
    if user is not None and can(user.role, "accessQuestionBank"):
        return

    # A third-party page must not be able to get a victim banned via an image/link.
    cross_site = request.headers.get("sec-fetch-site") == "cross-site"
    for header in ("origin", "referer"):
        source = request.headers.get(header)
        if source and urlsplit(source).netloc.lower() != request.headers.get("host", "").lower():
            cross_site = True
    if cross_site:
        raise HTTPException(status_code=403, detail={"code": "BULK_READ_FORBIDDEN", "message": "不允许批量读取题目"})

    ip = client_ip(request)
    username = user.username if user is not None else None
    if ip is not None:
        await db.execute(insert(SecurityIPBlock).values(
            ip=ip, reason="bootstrap_bulk_read", path=request.url.path, username=username,
        ).on_conflict_do_nothing(index_elements=[SecurityIPBlock.ip]))
    if user is not None:
        user.status = PAUSED
    await user_service.log_action(
        db, "bulk_read_blocked", username, "system",
        "未经授权的 bootstrap 全量取题；账号暂停、来源 IP 锁定（如可识别）",
        ip, request.headers.get("user-agent"),
    )
    await db.commit()
    if user is not None:
        await db.refresh(user)
    request.session.clear()
    raise HTTPException(
        status_code=403,
        detail={"code": "BULK_READ_BLOCKED", "message": "检测到未经授权的批量取题，访问已锁定，请联系管理员"},
        headers={"Cache-Control": "no-store"},
    )


async def list_ip_blocks(db: AsyncSession, *, limit: int, offset: int) -> list[dict]:
    rows = (await db.scalars(select(SecurityIPBlock).order_by(SecurityIPBlock.created_at.desc(), SecurityIPBlock.ip).limit(limit).offset(offset))).all()
    return [{"ip": row.ip, "reason": row.reason, "path": row.path, "username": row.username, "createdAt": row.created_at.isoformat()} for row in rows]


async def release_ip_block(db: AsyncSession, ip: str, actor: str) -> None:
    normalized = normalize_ip(ip)
    await db.execute(delete(SecurityIPBlock).where(SecurityIPBlock.ip == normalized))
    await user_service.log_action(db, "ip_block_released", None, actor, f"管理员解除 IP 锁定：{normalized}", normalized)
    await db.commit()
