"""用户功能偏好遥测：事件持久化与去标识化聚合。

写入路径只接收会话用户身份 + 已校验的允许列表事件；
聚合路径在 SQL 内用 distinct owner 计数，从不序列化用户标识。
"""

import statistics
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import uid
from app.models.analytics import FeatureUsageEvent
from app.models.user import User
from app.schemas.analytics import ALLOWED_FEATURES, FeatureAnalyticsQuery, FeatureEventCreate

SHANGHAI = ZoneInfo("Asia/Shanghai")

FEATURE_LABELS = {
    "graph": "图谱编辑",
    "files": "文件管理",
    "question_bank": "题库",
    "training": "训练",
    "recall": "回忆",
    "learning_path": "学习路径",
}


async def append_feature_event(db: AsyncSession, owner: str, event: FeatureEventCreate) -> None:
    """落库一条允许列表内的功能遥测事件。

    不接收 role / 时间戳 / payload / 用户标识字段——owner 永远来自会话用户。
    """
    row = FeatureUsageEvent(
        id=uid("fue_"),
        owner_id=owner,
        feature_key=event.feature_key,
        event_type=event.event_type,
        action_key=event.action_key,
        duration_seconds=event.duration_seconds,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)


def _zero_feature(feature_key: str) -> dict:
    return {
        "featureKey": feature_key,
        "activeUsers": 0,
        "keyActions": 0,
        "engagedSeconds": 0,
        "outcomeUsers": 0,
        "outcomeUserRate": 0.0,
        "quality": {"label": "答题正确率", "value": None},
    }


def _local_day_bounds(query: FeatureAnalyticsQuery) -> tuple[datetime, datetime]:
    """按 Asia/Shanghai 计算 [start 当天 0 点, end 次日 0 点) 的左闭右开区间。"""
    start_local = datetime.combine(query.start, time(0, 0), tzinfo=SHANGHAI)
    end_exclusive = datetime.combine(query.end + timedelta(days=1), time(0, 0), tzinfo=SHANGHAI)
    return start_local, end_exclusive


def _range_filter(start_local: datetime, end_exclusive: datetime) -> list:
    return [
        FeatureUsageEvent.occurred_at >= start_local,
        FeatureUsageEvent.occurred_at < end_exclusive,
    ]


def _with_role(stmt, role: str | None):
    return stmt.where(User.role == role) if role else stmt


async def aggregate_feature_analytics(db: AsyncSession, query: FeatureAnalyticsQuery) -> dict:
    """按功能聚合常用度与成果用户率；全程不外泄用户标识。"""
    start_local, end_exclusive = _local_day_bounds(query)
    base = _range_filter(start_local, end_exclusive)

    metrics_stmt = (
        select(
            FeatureUsageEvent.feature_key,
            func.count(FeatureUsageEvent.owner_id.distinct()).label("active_users"),
            func.count(FeatureUsageEvent.id)
            .filter(FeatureUsageEvent.event_type == "key_action")
            .label("key_actions"),
            func.coalesce(
                func.sum(FeatureUsageEvent.duration_seconds)
                .filter(FeatureUsageEvent.event_type == "engaged"),
                0,
            ).label("engaged_seconds"),
            func.count(FeatureUsageEvent.owner_id.distinct())
            .filter(FeatureUsageEvent.event_type == "outcome")
            .label("outcome_users"),
            func.count(FeatureUsageEvent.id)
            .filter(FeatureUsageEvent.action_key == "answer_correct")
            .label("correct_count"),
            func.count(FeatureUsageEvent.id)
            .filter(FeatureUsageEvent.action_key == "answer_incorrect")
            .label("incorrect_count"),
        )
        .join(User, User.username == FeatureUsageEvent.owner_id)
        .where(*base)
    )
    metrics_stmt = _with_role(metrics_stmt, query.role).group_by(FeatureUsageEvent.feature_key)
    rows = {row.feature_key: row for row in (await db.execute(metrics_stmt)).all()}

    features: list[dict] = []
    for feature_key in ALLOWED_FEATURES:
        row = rows.get(feature_key)
        if row is None:
            features.append(_zero_feature(feature_key))
            continue
        active_users = int(row.active_users)
        outcome_users = int(row.outcome_users)
        outcome_user_rate = round(outcome_users / active_users, 4) if active_users else 0.0
        quality = {"label": "答题正确率", "value": None}
        if feature_key == "training":
            correct = int(row.correct_count)
            incorrect = int(row.incorrect_count)
            total = correct + incorrect
            if total:
                quality = {"label": "答题正确率", "value": round(correct / total, 4)}
        features.append(
            {
                "featureKey": feature_key,
                "activeUsers": active_users,
                "keyActions": int(row.key_actions),
                "engagedSeconds": int(row.engaged_seconds),
                "outcomeUsers": outcome_users,
                "outcomeUserRate": outcome_user_rate,
                "quality": quality,
            }
        )

    # 稳定排序：相等时保持 ALLOWED_FEATURES 顺序（空区间返回六个固定行）。
    features.sort(
        key=lambda item: (item["activeUsers"], item["keyActions"], item["engagedSeconds"]),
        reverse=True,
    )

    sample_stmt = (
        select(func.count(FeatureUsageEvent.id))
        .join(User, User.username == FeatureUsageEvent.owner_id)
        .where(*base)
    )
    sample_size = int((await db.execute(_with_role(sample_stmt, query.role))).scalar_one())

    trends = await _daily_trends(db, base, query.role) if sample_size > 0 else []

    return {
        "filters": {
            "start": query.start.isoformat(),
            "end": query.end.isoformat(),
            "role": query.role,
        },
        "sampleSize": sample_size,
        "features": features,
        "trends": trends,
        "insights": _build_insights(features),
    }


async def _daily_trends(db: AsyncSession, base: list, role: str | None) -> list[dict]:
    local_day = func.date_trunc(
        "day", FeatureUsageEvent.occurred_at.op("AT TIME ZONE")("Asia/Shanghai")
    )
    stmt = (
        select(
            local_day.label("day"),
            func.count(FeatureUsageEvent.id).label("events"),
            func.count(FeatureUsageEvent.owner_id.distinct()).label("active"),
        )
        .join(User, User.username == FeatureUsageEvent.owner_id)
        .where(*base)
    )
    stmt = _with_role(stmt, role).group_by(local_day).order_by(local_day)
    trends: list[dict] = []
    for row in (await db.execute(stmt)).all():
        day_value = row.day
        if isinstance(day_value, datetime):
            date_str = day_value.date().isoformat()
        elif hasattr(day_value, "isoformat"):
            date_str = str(day_value.isoformat())[:10]
        else:
            date_str = str(day_value)[:10]
        trends.append(
            {
                "date": date_str,
                "events": int(row.events),
                "activeUsers": int(row.active),
            }
        )
    return trends


def _build_insights(features: list[dict]) -> list[dict]:
    """基于活跃用户与成果率中位数的确定性分类，绝不调用外部 AI。"""
    if not any(feature["activeUsers"] for feature in features):
        return []
    active_median = statistics.median([feature["activeUsers"] for feature in features])
    rate_median = statistics.median([feature["outcomeUserRate"] for feature in features])
    buckets: dict[str, list[str]] = {
        "high_value": [],
        "volume_only": [],
        "hidden_gem": [],
        "low_use": [],
    }
    for feature in features:
        name = FEATURE_LABELS.get(feature["featureKey"], feature["featureKey"])
        high_active = feature["activeUsers"] > 0 and feature["activeUsers"] >= active_median
        high_rate = feature["outcomeUserRate"] > 0 and feature["outcomeUserRate"] >= rate_median
        if high_active and high_rate:
            buckets["high_value"].append(name)
        elif high_active:
            buckets["volume_only"].append(name)
        elif high_rate:
            buckets["hidden_gem"].append(name)
        else:
            buckets["low_use"].append(name)

    def join(names: list[str]) -> str:
        return "、".join(names) or "暂无"

    return [
        {"category": "high_value", "title": "高价值功能", "detail": f"常用且成果用户率高：{join(buckets['high_value'])}"},
        {"category": "volume_only", "title": "使用量大但转化弱", "detail": f"常用但成果转化偏低：{join(buckets['volume_only'])}"},
        {"category": "hidden_gem", "title": "潜力功能", "detail": f"成果率高但使用较少：{join(buckets['hidden_gem'])}"},
        {"category": "low_use", "title": "低使用功能", "detail": f"使用与成果均偏低：{join(buckets['low_use'])}"},
    ]
