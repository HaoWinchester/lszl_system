"""用户功能偏好遥测写入路由（仅会话用户，允许列表内事件）。"""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser
from app.db.session import get_db
from app.schemas.analytics import FeatureEventCreate
from app.services import analytics_service

router = APIRouter(prefix="/analytics", tags=["analytics"])
DB = Annotated[AsyncSession, Depends(get_db)]


@router.post("/feature-events", status_code=201)
async def append_feature_event(body: FeatureEventCreate, db: DB, user: CurrentUser):
    await analytics_service.append_feature_event(db, user.username, body)
    return {"ok": True}
