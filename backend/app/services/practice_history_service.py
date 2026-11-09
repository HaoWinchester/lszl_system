"""Learner history summaries, globally deduplicated and paged in PostgreSQL."""

import base64
import binascii
from datetime import datetime
import json

from sqlalchemy import String, case, func, literal, select, union_all
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.paper_release import PaperRelease
from app.models.training import LearningEvent, PracticeSession

PRACTICE_SESSION_EVENT_TYPE = "PRACTICE_SESSION_COMPLETED"
STAT_FIELDS = ("total", "answered", "correct", "experience", "durationMs")
SUMMARY_FIELDS = (
    "sessionId", "releaseId", "paperId", "paperName", "mode", "status", *STAT_FIELDS,
)


def _decode_cursor(cursor: str) -> tuple[datetime, str]:
    try:
        if not cursor or len(cursor) > 1024:
            raise ValueError()
        payload = json.loads(base64.b64decode(
            cursor + "=" * (-len(cursor) % 4), altchars=b"-_", validate=True,
        ))
        if not isinstance(payload, list) or len(payload) != 2:
            raise ValueError()
        stamp, identifier = payload
        if not isinstance(stamp, str) or not isinstance(identifier, str):
            raise ValueError()
        stamp = datetime.fromisoformat(stamp)
        if stamp.tzinfo is None or not identifier.startswith(("modern:", "legacy:")):
            raise ValueError()
        if not identifier.partition(":")[2] or len(identifier) > 80:
            raise ValueError()
        return stamp, identifier
    except (ValueError, TypeError, UnicodeError, binascii.Error) as error:
        raise ValueError("分页游标无效") from error


def _history_query(owner: str):
    # JSON scalar projections preserve legacy summary types, while never
    # fetching the saved payload, stats, answer, or report bodies.
    paper_name = func.coalesce(
        PaperRelease.name,
        case((PracticeSession.mode == "revenge", "复仇错题"), else_="练习试卷"),
    )
    modern_values = {
        "sessionId": PracticeSession.id,
        "releaseId": PracticeSession.release_id,
        "paperId": PracticeSession.paper_id,
        "paperName": paper_name,
        "mode": PracticeSession.mode,
        "status": PracticeSession.status,
    }
    modern = (
        select(
            literal(True).label("modern"),
            (literal("modern:") + PracticeSession.id).label("sort_id"),
            func.coalesce(
                PracticeSession.completed_at, PracticeSession.abandoned_at,
                PracticeSession.last_saved_at,
            ).label("history_at"),
            literal(None, String).label("event_id"),
            func.jsonb_typeof(PracticeSession.report_snapshot).label("report_type"),
            *(func.to_jsonb(value, type_=JSONB).label(key) for key, value in modern_values.items()),
            *(PracticeSession.stats[key].label(key) for key in STAT_FIELDS),
        )
        .outerjoin(PaperRelease, PaperRelease.id == PracticeSession.release_id)
        .where(
            PracticeSession.owner_id == owner,
            PracticeSession.status.in_(["active", "paused", "completed", "abandoned"]),
            PracticeSession.stats["historyHidden"].as_boolean().isnot(True),
        )
    )
    session_key = func.nullif(func.btrim(LearningEvent.payload["sessionId"].astext), "")
    # Empty legacy session IDs identify independent events. Real IDs identify
    # one history entry; select its newest event before applying any cursor.
    ranked_events = (
        select(
            LearningEvent.id,
            func.row_number().over(
                partition_by=(session_key.is_(None), func.coalesce(session_key, LearningEvent.id)),
                order_by=(LearningEvent.created_at.desc(), LearningEvent.id.desc()),
            ).label("position"),
        )
        .where(
            LearningEvent.owner_id == owner,
            LearningEvent.event_type == PRACTICE_SESSION_EVENT_TYPE,
        )
        .subquery("ranked_history_events")
    )
    modern_exists = (
        select(PracticeSession.id)
        .where(PracticeSession.owner_id == owner, PracticeSession.id == session_key)
        .correlate(LearningEvent)
        .exists()
    )
    legacy = (
        select(
            literal(False).label("modern"),
            (literal("legacy:") + LearningEvent.id).label("sort_id"),
            LearningEvent.created_at.label("history_at"),
            LearningEvent.id.label("event_id"),
            literal(None, String).label("report_type"),
            *(LearningEvent.payload[key].label(key) for key in SUMMARY_FIELDS),
        )
        .join(ranked_events, ranked_events.c.id == LearningEvent.id)
        .where(ranked_events.c.position == 1, ~modern_exists)
    )
    return union_all(modern, legacy).subquery("practice_history")


def _summary(row) -> dict:
    if row["modern"]:
        summary = {key: row[key] for key in SUMMARY_FIELDS}
        summary.update({key: max(0, int(row[key] or 0)) for key in STAT_FIELDS})
    else:
        summary = {key: row[key] for key in SUMMARY_FIELDS if row[key] is not None}
        summary["eventId"] = row["event_id"]
    return {
        **summary,
        "reportAvailable": row["modern"] and row["status"] == "completed" and row["report_type"] == "object",
        "createdAt": row["history_at"].isoformat(),
    }


async def list_practice_sessions(
    db: AsyncSession, owner: str, *, limit: int = 20, cursor: str | None = None,
) -> dict:
    """Read one summary page and count all visible unique history entries."""
    if not 1 <= limit <= 100:
        raise ValueError("每页记录数必须在 1 到 100 之间")
    boundary = _decode_cursor(cursor) if cursor is not None else None
    history = _history_query(owner)
    total = await db.scalar(select(func.count()).select_from(history))
    query = select(history)
    if boundary:
        stamp, identifier = boundary
        query = query.where(
            (history.c.history_at < stamp)
            | ((history.c.history_at == stamp) & (history.c.sort_id < identifier))
        )
    rows = (await db.execute(
        query.order_by(history.c.history_at.desc(), history.c.sort_id.desc()).limit(limit + 1)
    )).mappings().all()
    next_cursor = None
    if len(rows) > limit:
        last = rows[limit - 1]
        next_cursor = base64.urlsafe_b64encode(json.dumps([
            last["history_at"].isoformat(), last["sort_id"],
        ]).encode()).decode().rstrip("=")
    return {
        "sessions": [_summary(row) for row in rows[:limit]],
        "total": int(total or 0),
        "nextCursor": next_cursor,
    }
