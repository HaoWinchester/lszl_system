"""用户功能偏好遥测写入路由（仅会话用户，允许列表内事件）。"""

from typing import Annotated

from fastapi import APIRouter, Depends, Request, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser, get_login_session_id
from app.db.session import get_db
from app.schemas.analytics import FeatureEventCreate
from app.services import analytics_service

from app.schemas.feature_usage import FeatureIntervalCreate
from app.services import feature_usage_service

router = APIRouter(prefix="/analytics", tags=["analytics"])
DB = Annotated[AsyncSession, Depends(get_db)]


@router.post("/feature-events", status_code=201)
async def append_feature_event(body: FeatureEventCreate, db: DB, user: CurrentUser):
    await analytics_service.append_feature_event(db, user.username, body)
    return {"ok": True}


@router.post('/feature-intervals', status_code=201)
async def append_feature_interval(body: FeatureIntervalCreate, request: Request, db: DB, user: CurrentUser):
    client = 'mini' if getattr(request.state, 'auth_transport', '') == 'bearer' else 'web'
    if client == 'web' and body.login_session_id != get_login_session_id(request):
        raise HTTPException(status_code=409, detail='登录状态已变更，已丢弃旧统计片段')
    await feature_usage_service.append_interval(db, user, body, client)
    return {'ok': True}
