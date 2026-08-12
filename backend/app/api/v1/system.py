"""系统设置路由：权限矩阵 / 角色主题 / 微信配置 / 订阅套餐配置 / 操作日志。

GET 类登录即可（前端需读主题），写操作仅管理员。
"""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser, require_role
from app.db.session import get_db
from app.models.user import User
from app.schemas.analytics import FeatureAnalyticsQuery
from app.services import analytics_service, system_service, user_service

router = APIRouter(prefix="/system", tags=["system"])
DB = Annotated[AsyncSession, Depends(get_db)]
AdminUser = Annotated[User, Depends(require_role("admin"))]


# ---------- 权限矩阵 ----------
@router.get("/permissions")
async def permissions(_: CurrentUser):
    return system_service.permission_matrix()


# ---------- 角色主题 ----------
@router.get("/themes")
async def themes(db: DB, _: CurrentUser):
    return {"themes": await system_service.get_themes(db)}


@router.put("/themes/{role}")
async def update_theme(role: str, body: dict, db: DB, _: AdminUser):
    theme = await system_service.set_theme(
        db,
        role,
        body.get("primary_color", "#0ea5e9"),
        body.get("accent_color", "#0284c7"),
        body.get("soft_color", "#e0f2fe"),
        body.get("text_color"),
    )
    return {"theme": theme}


# ---------- 微信配置 ----------
@router.get("/wechat-config")
async def wechat_config(db: DB, _: AdminUser):
    return {"config": system_service.public_wechat_config(await system_service.get_wechat_config(db))}


@router.put("/wechat-config")
async def update_wechat_config(body: dict, db: DB, _: AdminUser):
    return {"config": await system_service.set_wechat_config(db, body)}


# ---------- 微信支付配置 ----------
@router.get("/wechat-pay-config")
async def wechat_pay_config(db: DB, _: AdminUser):
    return {"config": system_service.public_wechat_pay_config(await system_service.get_wechat_pay_config(db))}


@router.put("/wechat-pay-config")
async def update_wechat_pay_config(body: dict, db: DB, _: AdminUser):
    return {"config": await system_service.set_wechat_pay_config(db, body)}


# ---------- 订阅套餐展示配置 ----------
@router.get("/subscription-plans")
async def subscription_plans(db: DB, _: CurrentUser):
    return {"plans": await system_service.get_subscription_plans(db)}


@router.put("/subscription-plans/{plan_id}")
async def update_plan(plan_id: str, body: dict, db: DB, _: AdminUser):
    try:
        plan = await system_service.set_plan_setting(db, plan_id, body)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return {"plan": plan}


# ---------- 操作日志 ----------
@router.get("/logs")
async def logs(db: DB, _: AdminUser, limit: int = 100):
    rows = await user_service.list_logs(db, limit=limit)
    return {"logs": [user_service.log_to_dict(l) for l in rows]}


@router.delete("/logs")
async def clear_logs(db: DB, admin: AdminUser):
    await user_service.clear_logs(db, actor=admin.username)
    return {"ok": True}


# ---------- 用户功能偏好分析 ----------
@router.get("/feature-analytics")
async def feature_analytics(
    db: DB,
    _: AdminUser,
    start: date,
    end: date,
    role: str | None = None,
):
    """管理员查看各功能的常用度与成果用户率聚合（不含任何用户标识）。"""
    try:
        query = FeatureAnalyticsQuery(start=start, end=end, role=role)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return await analytics_service.aggregate_feature_analytics(db, query)
