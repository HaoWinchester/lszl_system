"""Transactional growth accounting derived only from accepted server answers."""

from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.practice_growth import PracticeGrowthAnswer, PracticeGrowthDay, PracticeGrowthSetting
from app.core.security import now_utc

TIMEZONE_NAME = "Asia/Shanghai"
LOCAL_ZONE = ZoneInfo(TIMEZONE_NAME)
DEFAULT_GOAL = 10
ALLOWED_GOALS = {5, 10, 20, 30}


def _local_day(now: datetime | None) -> date:
    value = now or now_utc()
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(LOCAL_ZONE).date()


async def _lock_owner(db: AsyncSession, owner: str) -> None:
    await db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:owner), hashtext('practice-growth'))"), {"owner": owner})


async def _setting(db: AsyncSession, owner: str) -> PracticeGrowthSetting | None:
    return await db.get(PracticeGrowthSetting, owner)


def _goal_for_day(setting: PracticeGrowthSetting | None, local_day: date) -> int:
    if setting is not None and setting.goal_effective_date <= local_day:
        return setting.configured_goal
    return DEFAULT_GOAL


async def _ensure_day(db: AsyncSession, owner: str, local_day: date, setting: PracticeGrowthSetting | None = None) -> None:
    goal = _goal_for_day(setting if setting is not None else await _setting(db, owner), local_day)
    await db.execute(insert(PracticeGrowthDay).values(owner_id=owner, local_date=local_day, goal=goal, answered=0).on_conflict_do_nothing(constraint="uq_practice_growth_day_owner_date"))


async def record_answers(db: AsyncSession, owner: str, question_ids: list[str] | set[str], now: datetime | None = None) -> int:
    """Credit stable source IDs in the caller transaction; never commits."""
    ids = sorted({str(value).strip() for value in question_ids if str(value).strip()})
    if not ids:
        return 0
    local_day = _local_day(now)
    await _lock_owner(db, owner)
    await _ensure_day(db, owner, local_day)
    inserted = 0
    for question_id in ids:
        result = await db.execute(insert(PracticeGrowthAnswer).values(owner_id=owner, local_date=local_day, question_id=question_id).on_conflict_do_nothing(constraint="uq_practice_growth_answer_owner_day_question").returning(PracticeGrowthAnswer.id))
        inserted += int(result.scalar_one_or_none() is not None)
    if inserted:
        await db.execute(PracticeGrowthDay.__table__.update().where(PracticeGrowthDay.owner_id == owner, PracticeGrowthDay.local_date == local_day).values(answered=PracticeGrowthDay.answered + inserted))
    return inserted


async def growth_summary(db: AsyncSession, owner: str, now: datetime | None = None) -> dict:
    today = _local_day(now)
    setting = await _setting(db, owner)
    start = today - timedelta(days=today.weekday())
    rows = (await db.execute(select(PracticeGrowthDay).where(PracticeGrowthDay.owner_id == owner).order_by(PracticeGrowthDay.local_date))).scalars().all()
    by_day = {row.local_date: row for row in rows}
    def item(day: date) -> dict:
        row = by_day.get(day)
        goal = row.goal if row else _goal_for_day(setting, day)
        answered = row.answered if row else 0
        return {"date": day.isoformat(), "answered": answered, "goal": goal, "completed": answered >= goal, "isToday": day == today}
    week = [item(start + timedelta(days=offset)) for offset in range(7)]
    completed = {row.local_date for row in rows if row.answered >= row.goal}
    longest = current_run = 0
    previous = None
    for day in sorted(completed):
        current_run = current_run + 1 if previous is not None and day == previous + timedelta(days=1) else 1
        longest = max(longest, current_run)
        previous = day
    cursor = today if today in completed else today - timedelta(days=1)
    current = 0
    while cursor in completed:
        current += 1
        cursor -= timedelta(days=1)
    today_item = item(today)
    return {
        "date": today.isoformat(), "timezone": TIMEZONE_NAME,
        "today": {key: today_item[key] for key in ("answered", "goal", "completed")},
        "configuredGoal": setting.configured_goal if setting else DEFAULT_GOAL,
        "goalEffectiveDate": (setting.goal_effective_date if setting else today).isoformat(),
        "currentStreak": current, "longestStreak": longest, "totalCompletedDays": len(completed),
        "week": week,
        "milestones": [{"days": days, "unlocked": longest >= days} for days in (7, 30, 100)],
    }


async def update_goal(db: AsyncSession, owner: str, goal: int, now: datetime | None = None) -> dict:
    if goal not in ALLOWED_GOALS:
        raise ValueError("goal must be one of 5, 10, 20, 30")
    today = _local_day(now)
    await _lock_owner(db, owner)
    setting = await _setting(db, owner)
    # Preserve every already-visible day in this week's calendar before the
    # configuration changes. Answered days are already snapshotted on write.
    week_start = today - timedelta(days=today.weekday())
    for offset in range((today - week_start).days + 1):
        await _ensure_day(db, owner, week_start + timedelta(days=offset), setting)
    effective = today + timedelta(days=1)
    if setting is None:
        db.add(PracticeGrowthSetting(owner_id=owner, configured_goal=goal, goal_effective_date=effective))
    else:
        setting.configured_goal = goal
        setting.goal_effective_date = effective
    await db.commit()
    return await growth_summary(db, owner, now)
