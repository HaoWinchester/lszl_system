"""Server-authoritative feedback and in-app message workflows.

The original v9 pages stored both collections in the current browser runtime.
This service keeps the public collections in ``shared_runtime_states`` while
leaving per-user read receipts in ``runtime_states``.
"""

from __future__ import annotations

import base64
import binascii
import json
import re
import time
import uuid
from typing import Any
from urllib.parse import quote

from sqlalchemy import select, text as sql_text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.runtime_state import RuntimeState
from app.models.shared_runtime_state import SharedRuntimeState
from app.models.user import User

FEEDBACK_KEY = "kg_user_feedback_v1"
ANNOUNCEMENT_KEY = "kg_announcements_v1"
FEEDBACK_READ_PREFIX = "kg_user_feedback_reply_reads_v1__"
MESSAGE_READ_PREFIX = "kg_user_message_reads_v1__"
FEEDBACK_STATUSES = {"pending", "in_progress", "resolved", "closed"}
MESSAGE_STATUSES = {"draft", "published", "withdrawn"}
MAX_ENGAGEMENT_PAYLOAD_BYTES = 256 * 1024
MAX_ATTACHMENT_BYTES = 160 * 1024
MAX_ENGAGEMENT_ROWS = 1000
MAX_ENGAGEMENT_COLLECTION_BYTES = 8 * 1024 * 1024
MAX_RECEIPTS = 5000
MAX_PAGE_SIZE = 200
MAX_FEEDBACK_TITLE_LENGTH = 100
MAX_FEEDBACK_DETAIL_LENGTH = 4000
MAX_FEEDBACK_CONTACT_LENGTH = 120
MAX_MESSAGE_TITLE_LENGTH = 120
MAX_MESSAGE_BODY_LENGTH = 6000
MAX_MESSAGE_LINK_LENGTH = 2048
MAX_AUDIENCE_USERS = 200
MAX_FEEDBACK_WRITES_PER_MINUTE = 5
MAX_MESSAGE_WRITES_PER_MINUTE = 30
ATTACHMENT_DATA_URL_RE = re.compile(
    r"^data:image/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$",
    re.IGNORECASE,
)


class EngagementNotFoundError(ValueError):
    pass


class EngagementValidationError(ValueError):
    pass


class EngagementRateLimitError(EngagementValidationError):
    pass


def _now() -> int:
    return int(time.time() * 1000)


def _clean(value: Any) -> str:
    return str(value or "").strip()


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _parse_rows(value: Any) -> list[dict[str, Any]]:
    try:
        rows = json.loads(value) if isinstance(value, str) else value
    except (TypeError, ValueError, json.JSONDecodeError):
        return []
    return [dict(row) for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []


def _parse_map(value: Any) -> dict[str, int]:
    try:
        result = json.loads(value) if isinstance(value, str) else value
    except (TypeError, ValueError, json.JSONDecodeError):
        return {}
    if not isinstance(result, dict):
        return {}
    parsed: dict[str, int] = {}
    for key, timestamp in result.items():
        try:
            parsed[str(key)] = int(timestamp or 0)
        except (TypeError, ValueError):
            continue
    return parsed


def validate_payload_size(payload: dict[str, Any]) -> None:
    try:
        size = len(_json(payload).encode("utf-8"))
    except (TypeError, ValueError) as error:
        raise EngagementValidationError("请求内容无法解析。") from error
    if size > MAX_ENGAGEMENT_PAYLOAD_BYTES:
        raise EngagementValidationError("请求内容过大，请缩小附件或正文后重试。")


def _require_max_length(label: str, value: Any, limit: int) -> str:
    cleaned = _clean(value)
    if len(cleaned) > limit:
        raise EngagementValidationError(f"{label}不能超过 {limit} 个字符。")
    return cleaned


def validate_feedback_fields(payload: dict[str, Any]) -> tuple[str, str]:
    title = _require_max_length("反馈标题", payload.get("title"), MAX_FEEDBACK_TITLE_LENGTH)
    detail = _require_max_length("详细描述", payload.get("detail"), MAX_FEEDBACK_DETAIL_LENGTH)
    _require_max_length("联系方式", payload.get("contact"), MAX_FEEDBACK_CONTACT_LENGTH)
    _require_max_length("页面地址", payload.get("page"), 255)
    _require_max_length("应用版本", payload.get("appVersion"), 64)
    if not title or not detail:
        raise EngagementValidationError("请填写反馈标题和详细描述。")
    return title, detail


def validate_feedback_attachment(value: Any) -> dict[str, Any] | None:
    if value in (None, ""):
        return None
    if not isinstance(value, dict):
        raise EngagementValidationError("截图附件格式无效。")
    data_url = _clean(value.get("dataUrl"))
    match = ATTACHMENT_DATA_URL_RE.fullmatch(data_url)
    if not match:
        raise EngagementValidationError("截图仅支持规范的 PNG、JPG、WebP 或 GIF 数据。")
    try:
        decoded = base64.b64decode(match.group(2), validate=True)
    except (ValueError, binascii.Error) as error:
        raise EngagementValidationError("截图内容无法解析。") from error
    if not decoded or len(decoded) > MAX_ATTACHMENT_BYTES:
        raise EngagementValidationError("截图不能超过 160KB。")
    declared_size = value.get("size")
    if isinstance(declared_size, bool):
        raise EngagementValidationError("截图大小无效。")
    try:
        size = int(declared_size)
    except (TypeError, ValueError) as error:
        raise EngagementValidationError("截图大小无效。") from error
    if size != len(decoded):
        raise EngagementValidationError("截图大小与内容不一致。")
    mime = f"image/{match.group(1).lower()}"
    signatures = {
        "image/png": decoded.startswith(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg": decoded.startswith(b"\xff\xd8\xff"),
        "image/gif": decoded.startswith((b"GIF87a", b"GIF89a")),
        "image/webp": decoded.startswith(b"RIFF")
        and len(decoded) >= 12
        and decoded[8:12] == b"WEBP",
    }
    if not signatures.get(mime, False):
        raise EngagementValidationError("截图内容与图片类型不一致。")
    declared_mime = _clean(value.get("type")).lower()
    if declared_mime and declared_mime != mime:
        raise EngagementValidationError("截图类型与内容不一致。")
    return {
        "name": _require_max_length("截图文件名", value.get("name") or "附件", 120),
        "type": mime,
        "size": size,
        "dataUrl": data_url,
    }


def validate_message_fields(payload: dict[str, Any], base: dict[str, Any] | None = None) -> tuple[str, str]:
    current = base or {}
    title = _require_max_length(
        "消息标题", payload.get("title", current.get("title")), MAX_MESSAGE_TITLE_LENGTH
    )
    body = _require_max_length(
        "消息正文", payload.get("body", current.get("body")), MAX_MESSAGE_BODY_LENGTH
    )
    _require_max_length(
        "消息链接", payload.get("link", current.get("link")), MAX_MESSAGE_LINK_LENGTH
    )
    if not title or not body:
        raise EngagementValidationError("请填写消息标题和正文。")
    return title, body


def page_rows(
    rows: list[dict[str, Any]], *, limit: int, offset: int
) -> tuple[list[dict[str, Any]], dict[str, int | bool]]:
    bounded_limit = max(1, min(int(limit), MAX_PAGE_SIZE))
    bounded_offset = max(0, int(offset))
    total = len(rows)
    page = rows[bounded_offset : bounded_offset + bounded_limit]
    return page, {
        "total": total,
        "limit": bounded_limit,
        "offset": bounded_offset,
        "hasMore": bounded_offset + len(page) < total,
    }


def bound_collection(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep the JSON-backed compatibility collection within fixed work/size bounds."""
    result: list[dict[str, Any]] = []
    encoded_size = 2
    for row in rows[:MAX_ENGAGEMENT_ROWS]:
        row_size = len(_json(row).encode("utf-8")) + (1 if result else 0)
        if encoded_size + row_size > MAX_ENGAGEMENT_COLLECTION_BYTES:
            continue
        result.append(row)
        encoded_size += row_size
    return result


def merge_receipts(current: dict[str, int], updates: dict[str, int]) -> dict[str, int]:
    merged = dict(current)
    for key, timestamp in updates.items():
        cleaned = _clean(key)
        if not cleaned:
            continue
        merged[cleaned] = max(int(merged.get(cleaned, 0) or 0), int(timestamp or 0))
    newest = sorted(merged.items(), key=lambda item: item[1], reverse=True)[:MAX_RECEIPTS]
    return dict(newest)


def enforce_feedback_rate(rows: list[dict[str, Any]], username: str, *, now: int | None = None) -> None:
    current = _now() if now is None else int(now)
    window_start = current - 60_000
    recent = 0
    for row in rows:
        actor = row.get("submittedBy") if isinstance(row.get("submittedBy"), dict) else {}
        if _clean(actor.get("username")) != username:
            continue
        if int(row.get("createdAt") or 0) >= window_start:
            recent += 1
    if recent >= MAX_FEEDBACK_WRITES_PER_MINUTE:
        raise EngagementRateLimitError("反馈提交过于频繁，请稍后再试。")


def enforce_message_rate(rows: list[dict[str, Any]], username: str, *, now: int | None = None) -> None:
    current = _now() if now is None else int(now)
    window_start = current - 60_000
    recent = sum(
        1
        for row in rows
        if _clean(row.get("createdBy")) == username
        and int(row.get("createdAt") or 0) >= window_start
    )
    if recent >= MAX_MESSAGE_WRITES_PER_MINUTE:
        raise EngagementRateLimitError("消息创建过于频繁，请稍后再试。")


def trusted_legacy_rows(
    key: str, owner: str, role: str, storage: dict[str, Any]
) -> list[dict[str, Any]]:
    """Convert legacy account-local data without trusting browser-supplied identity."""
    rows = _parse_rows(storage.get(key)) if isinstance(storage, dict) else []
    if key == ANNOUNCEMENT_KEY:
        if role != "admin":
            return []
        result = []
        for row in rows:
            item = dict(row)
            item["createdBy"] = owner
            result.append(item)
        return result
    if key != FEEDBACK_KEY:
        return []
    if role == "admin":
        return rows
    result = []
    for row in rows:
        actor = row.get("submittedBy") if isinstance(row.get("submittedBy"), dict) else {}
        if _clean(actor.get("username")) != owner:
            continue
        item = dict(row)
        item["submittedBy"] = {**actor, "username": owner}
        item["status"] = "pending"
        item["replies"] = []
        result.append(item)
    return result


async def _lock(db: AsyncSession, name: str) -> None:
    await db.execute(
        sql_text("SELECT pg_advisory_xact_lock(hashtextextended(:name, 0))"),
        {"name": name},
    )


async def _global_rows(db: AsyncSession, key: str) -> list[dict[str, Any]]:
    """Read the canonical collection, migrating account-local copies once.

    Once the shared row exists it is authoritative. Continuing to merge stale
    account-local snapshots would resurrect messages deleted by an administrator.
    """

    candidates: list[dict[str, Any]] = []
    shared = await db.get(SharedRuntimeState, key)
    if shared:
        candidates.extend(_parse_rows(shared.value))
    else:
        result = await db.execute(
            select(RuntimeState.owner_id, RuntimeState.storage, User.role).join(
                User, User.username == RuntimeState.owner_id
            )
        )
        for owner, storage, role in result:
            candidates.extend(trusted_legacy_rows(key, owner, role, storage))

    deduped: dict[str, dict[str, Any]] = {}
    for row in candidates:
        row = dict(row)
        if key == FEEDBACK_KEY:
            try:
                row["attachment"] = validate_feedback_attachment(row.get("attachment"))
            except EngagementValidationError:
                row["attachment"] = None
        row_id = _clean(row.get("id"))
        if not row_id:
            continue
        previous = deduped.get(row_id)
        if previous is None or int(row.get("updatedAt") or 0) >= int(previous.get("updatedAt") or 0):
            deduped[row_id] = row
    return bound_collection(list(deduped.values()))


async def _save_global_rows(
    db: AsyncSession, key: str, rows: list[dict[str, Any]], actor: str
) -> None:
    shared = await db.get(SharedRuntimeState, key)
    value = _json(bound_collection(rows))
    if shared is None:
        db.add(SharedRuntimeState(key=key, value=value, updated_by=actor))
    else:
        shared.value = value
        shared.updated_by = actor


async def _read_receipts(db: AsyncSession, username: str, prefix: str) -> dict[str, int]:
    result = await db.execute(
        select(RuntimeState)
        .where(RuntimeState.owner_id == username)
        .execution_options(populate_existing=True)
    )
    row = result.scalar_one_or_none()
    if not row:
        return {}
    return _parse_map((row.storage or {}).get(prefix + quote(username, safe="")))


async def _save_receipts(
    db: AsyncSession, username: str, prefix: str, updates: dict[str, int]
) -> None:
    await _lock(db, username)
    receipts = merge_receipts(await _read_receipts(db, username, prefix), updates)
    row = await db.get(RuntimeState, username)
    storage = dict(row.storage or {}) if row else {}
    storage[prefix + quote(username, safe="")] = _json(receipts)
    if row is None:
        db.add(RuntimeState(owner_id=username, storage=storage, revision=1))
    else:
        row.storage = storage
        row.revision += 1
    await db.commit()


def _actor(user: User) -> dict[str, str]:
    return {
        "username": user.username,
        "displayName": user.display_name or user.username,
        "role": user.role,
    }


async def submit_feedback(
    db: AsyncSession, user: User, payload: dict[str, Any]
) -> dict[str, Any]:
    validate_payload_size(payload)
    title, detail = validate_feedback_fields(payload)
    attachment = validate_feedback_attachment(payload.get("attachment"))
    now = _now()
    row = {
        "id": f"feedback-{uuid.uuid4().hex}",
        "type": _clean(payload.get("type")) or "suggestion",
        "title": title,
        "detail": detail,
        "page": _clean(payload.get("page")),
        "appVersion": _clean(payload.get("appVersion")),
        "contact": _clean(payload.get("contact")),
        "attachment": attachment,
        "status": "pending",
        "submittedBy": _actor(user),
        "createdAt": now,
        "updatedAt": now,
        "replies": [],
    }
    await _lock(db, f"engagement:{FEEDBACK_KEY}")
    rows = await _global_rows(db, FEEDBACK_KEY)
    enforce_feedback_rate(rows, user.username, now=now)
    rows.insert(0, row)
    await _save_global_rows(db, FEEDBACK_KEY, rows, user.username)
    await db.commit()
    return row


async def list_feedback(db: AsyncSession) -> list[dict[str, Any]]:
    rows = await _global_rows(db, FEEDBACK_KEY)
    return sorted(rows, key=lambda row: int(row.get("updatedAt") or 0), reverse=True)


async def list_my_feedback(
    db: AsyncSession, user: User
) -> list[dict[str, Any]]:
    reads = await _read_receipts(db, user.username, FEEDBACK_READ_PREFIX)
    result = []
    for row in await list_feedback(db):
        actor = row.get("submittedBy") if isinstance(row.get("submittedBy"), dict) else {}
        if _clean(actor.get("username")) != user.username:
            continue
        item = dict(row)
        last_read = reads.get(_clean(item.get("id")), 0)
        replies = item.get("replies") if isinstance(item.get("replies"), list) else []
        item["lastReadAt"] = last_read
        item["unreadReplyCount"] = sum(
            1 for reply in replies if isinstance(reply, dict) and int(reply.get("createdAt") or 0) > last_read
        )
        result.append(item)
    return result


async def mark_feedback_read(db: AsyncSession, user: User, feedback_id: str) -> None:
    target = next(
        (
            row
            for row in await list_feedback(db)
            if _clean(row.get("id")) == feedback_id
            and _clean((row.get("submittedBy") or {}).get("username")) == user.username
        ),
        None,
    )
    if target is None:
        raise EngagementNotFoundError("反馈不存在。")
    replies = target.get("replies") if isinstance(target.get("replies"), list) else []
    latest = max([int(reply.get("createdAt") or 0) for reply in replies if isinstance(reply, dict)] or [0])
    await _save_receipts(
        db,
        user.username,
        FEEDBACK_READ_PREFIX,
        {feedback_id: max(_now(), latest)},
    )


async def update_feedback(
    db: AsyncSession, user: User, feedback_id: str, payload: dict[str, Any]
) -> dict[str, Any]:
    validate_payload_size(payload)
    await _lock(db, f"engagement:{FEEDBACK_KEY}")
    rows = await _global_rows(db, FEEDBACK_KEY)
    target = next((row for row in rows if _clean(row.get("id")) == feedback_id), None)
    if target is None:
        raise EngagementNotFoundError("反馈不存在或已删除。")
    status = _clean(payload.get("status"))
    if status not in FEEDBACK_STATUSES:
        raise EngagementValidationError("反馈状态无效。")
    target["status"] = status
    target["updatedAt"] = _now()
    await _save_global_rows(db, FEEDBACK_KEY, rows, user.username)
    await db.commit()
    return target


async def reply_feedback(
    db: AsyncSession, user: User, feedback_id: str, payload: dict[str, Any]
) -> dict[str, Any]:
    validate_payload_size(payload)
    message = _clean(payload.get("message"))
    if not message:
        raise EngagementValidationError("回复内容不能为空。")
    await _lock(db, f"engagement:{FEEDBACK_KEY}")
    rows = await _global_rows(db, FEEDBACK_KEY)
    target = next((row for row in rows if _clean(row.get("id")) == feedback_id), None)
    if target is None:
        raise EngagementNotFoundError("反馈不存在或已删除。")
    now = _now()
    replies = target.get("replies") if isinstance(target.get("replies"), list) else []
    replies.append(
        {
            "id": f"reply-{uuid.uuid4().hex}",
            "message": message,
            "actor": user.display_name or user.username,
            "createdAt": now,
        }
    )
    target["replies"] = replies
    if target.get("status") == "pending":
        target["status"] = "in_progress"
    target["updatedAt"] = now
    await _save_global_rows(db, FEEDBACK_KEY, rows, user.username)
    await db.commit()
    return target


def _normalize_audience(payload: Any) -> dict[str, Any]:
    payload = payload if isinstance(payload, dict) else {}
    audience_type = _clean(payload.get("type")) or "all"
    if audience_type not in {"all", "roles", "users"}:
        raise EngagementValidationError("消息受众类型无效。")
    roles = list(dict.fromkeys(_clean(value) for value in payload.get("roles", []) if _clean(value)))
    users = list(dict.fromkeys(_clean(value) for value in payload.get("users", []) if _clean(value)))
    if len(users) > MAX_AUDIENCE_USERS:
        raise EngagementValidationError(f"指定用户不能超过 {MAX_AUDIENCE_USERS} 个。")
    if any(len(username) > 64 for username in users):
        raise EngagementValidationError("指定用户名不能超过 64 个字符。")
    if audience_type == "roles" and not roles:
        raise EngagementValidationError("请选择至少一个接收角色。")
    if audience_type == "users" and not users:
        raise EngagementValidationError("请选择至少一个接收用户。")
    return {"type": audience_type, "roles": roles, "users": users}


def _message_payload(payload: dict[str, Any], base: dict[str, Any] | None = None) -> dict[str, Any]:
    row = dict(base or {})
    title, body = validate_message_fields(payload, row)
    row.update(
        {
            "title": title,
            "body": body,
            "link": _clean(payload.get("link", row.get("link"))),
            "audience": _normalize_audience(payload.get("audience", row.get("audience"))),
            "publishAt": int(payload.get("publishAt", row.get("publishAt")) or 0),
            "expiresAt": int(payload.get("expiresAt", row.get("expiresAt")) or 0),
        }
    )
    return row


async def list_announcements(db: AsyncSession) -> list[dict[str, Any]]:
    rows = await _global_rows(db, ANNOUNCEMENT_KEY)
    return sorted(rows, key=lambda row: int(row.get("updatedAt") or 0), reverse=True)


async def save_announcement(
    db: AsyncSession,
    user: User,
    payload: dict[str, Any],
    message_id: str | None = None,
) -> dict[str, Any]:
    validate_payload_size(payload)
    await _lock(db, f"engagement:{ANNOUNCEMENT_KEY}")
    rows = await _global_rows(db, ANNOUNCEMENT_KEY)
    target = next((row for row in rows if _clean(row.get("id")) == message_id), None) if message_id else None
    if message_id and target is None:
        raise EngagementNotFoundError("消息不存在。")
    now = _now()
    if target is None:
        enforce_message_rate(rows, user.username, now=now)
        target = {
            "id": f"message-{uuid.uuid4().hex}",
            "status": "draft",
            "createdBy": user.username,
            "createdAt": now,
            "publishedAt": 0,
            "withdrawnAt": 0,
        }
        rows.insert(0, target)
    target.update(_message_payload(payload, target))
    target["updatedAt"] = now
    await _save_global_rows(db, ANNOUNCEMENT_KEY, rows, user.username)
    await db.commit()
    return target


async def publish_announcement(
    db: AsyncSession, user: User, message_id: str, payload: dict[str, Any]
) -> dict[str, Any]:
    validate_payload_size(payload)
    await _lock(db, f"engagement:{ANNOUNCEMENT_KEY}")
    rows = await _global_rows(db, ANNOUNCEMENT_KEY)
    target = next((row for row in rows if _clean(row.get("id")) == message_id), None)
    if target is None:
        raise EngagementNotFoundError("消息不存在。")
    _message_payload(target, target)
    now = _now()
    target.update(
        {
            "status": "published",
            "publishAt": int(payload.get("publishAt") or now),
            "publishedAt": now,
            "withdrawnAt": 0,
            "updatedAt": now,
        }
    )
    await _save_global_rows(db, ANNOUNCEMENT_KEY, rows, user.username)
    await db.commit()
    return target


async def withdraw_announcement(db: AsyncSession, user: User, message_id: str) -> dict[str, Any]:
    await _lock(db, f"engagement:{ANNOUNCEMENT_KEY}")
    rows = await _global_rows(db, ANNOUNCEMENT_KEY)
    target = next((row for row in rows if _clean(row.get("id")) == message_id), None)
    if target is None:
        raise EngagementNotFoundError("消息不存在。")
    now = _now()
    target.update({"status": "withdrawn", "withdrawnAt": now, "updatedAt": now})
    await _save_global_rows(db, ANNOUNCEMENT_KEY, rows, user.username)
    await db.commit()
    return target


async def delete_announcement(db: AsyncSession, user: User, message_id: str) -> None:
    await _lock(db, f"engagement:{ANNOUNCEMENT_KEY}")
    rows = await _global_rows(db, ANNOUNCEMENT_KEY)
    target = next((row for row in rows if _clean(row.get("id")) == message_id), None)
    if target is None:
        raise EngagementNotFoundError("消息不存在。")
    if target.get("status") == "published":
        raise EngagementValidationError("已发布消息请先撤回，不能直接删除。")
    await _save_global_rows(
        db, ANNOUNCEMENT_KEY, [row for row in rows if row is not target], user.username
    )
    await db.commit()


def _audience_allows(row: dict[str, Any], user: User) -> bool:
    audience = row.get("audience") if isinstance(row.get("audience"), dict) else {"type": "all"}
    audience_type = audience.get("type") or "all"
    if audience_type == "all":
        return True
    if audience_type == "roles":
        return user.role in (audience.get("roles") or [])
    if audience_type == "users":
        return user.username in (audience.get("users") or [])
    return False


async def list_user_messages(db: AsyncSession, user: User) -> list[dict[str, Any]]:
    now = _now()
    reads = await _read_receipts(db, user.username, MESSAGE_READ_PREFIX)
    result = []
    for row in await list_announcements(db):
        start = int(row.get("publishAt") or row.get("publishedAt") or 0)
        expires = int(row.get("expiresAt") or 0)
        if row.get("status") != "published" or (start and start > now) or (expires and expires <= now):
            continue
        if not _audience_allows(row, user):
            continue
        item = dict(row)
        item["readAt"] = reads.get(_clean(row.get("id")), 0)
        item["read"] = bool(item["readAt"])
        result.append(item)
    return result


async def unread_summary(db: AsyncSession, user: User) -> dict[str, int]:
    messages = sum(1 for row in await list_user_messages(db, user) if not row.get("read"))
    feedback_replies = sum(
        max(0, int(row.get("unreadReplyCount") or 0))
        for row in await list_my_feedback(db, user)
    )
    return {
        "messages": messages,
        "feedbackReplies": feedback_replies,
        "total": messages + feedback_replies,
    }


async def mark_message_read(db: AsyncSession, user: User, message_id: str) -> None:
    messages = await list_user_messages(db, user)
    if not any(_clean(row.get("id")) == message_id for row in messages):
        raise EngagementNotFoundError("消息不存在或当前不可见。")
    await _save_receipts(db, user.username, MESSAGE_READ_PREFIX, {message_id: _now()})


async def mark_all_messages_read(db: AsyncSession, user: User) -> None:
    now = _now()
    updates: dict[str, int] = {}
    for row in await list_user_messages(db, user):
        updates[_clean(row.get("id"))] = now
    await _save_receipts(db, user.username, MESSAGE_READ_PREFIX, updates)
