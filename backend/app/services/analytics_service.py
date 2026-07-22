"""用户功能偏好遥测：事件持久化与去标识化聚合。

写入路径只接收会话用户身份 + 已校验的允许列表事件；
聚合路径在 SQL 内用 distinct owner 计数，从不序列化用户标识。
"""

from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import uid
from app.models.analytics import FeatureUsageEvent
from app.models.user import User
from app.schemas.analytics import FeatureEventCreate

SHANGHAI = ZoneInfo("Asia/Shanghai")


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
