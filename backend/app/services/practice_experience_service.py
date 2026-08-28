"""Server-only, transactional experience deltas for practice sessions."""

from datetime import datetime
from hashlib import sha256

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.training import LearningEvent, PracticeSession

EXPERIENCE_EVENT_TYPE = "PRACTICE_EXPERIENCE_SETTLED"
EXPERIENCE_ID_PREFIX = "pxp_"


async def settle_experience_delta(
    db: AsyncSession,
    session: PracticeSession,
    total_experience: int,
    settled_at: datetime,
) -> int:
    """Caller owns the session row lock and commits this with the saved answers."""
    stats = dict(session.stats or {})
    credited = int(stats.get("creditedExperience") or 0)
    total = int(total_experience)
    if total < credited or total < 0:
        raise ValueError("已结算经验不能倒退")
    delta = total - credited
    if delta:
        key = f"{session.owner_id}:{session.id}:{total}"
        db.add(
            LearningEvent(
                id=EXPERIENCE_ID_PREFIX + sha256(key.encode()).hexdigest()[:60],
                owner_id=session.owner_id,
                question_id=None,
                event_type=EXPERIENCE_EVENT_TYPE,
                created_at=settled_at,
                payload={
                    "sessionId": session.id,
                    "delta": delta,
                    "totalExperience": total,
                    "settlementKey": key,
                },
            )
        )
    stats["creditedExperience"] = total
    stats["experienceAccountingVersion"] = 1
    session.stats = stats
    return delta
