"""系统设置路由：权限矩阵 / 角色主题 / 微信配置 / 订阅套餐配置 / 操作日志。

GET 类登录即可（前端需读主题），写操作仅管理员。
"""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser, require_role
from app.db.session import get_db
from app.models.user import User
from app.services import system_service, user_service

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
    return {"config": await system_service.get_wechat_config(db)}


@router.put("/wechat-config")
async def update_wechat_config(body: dict, db: DB, _: AdminUser):
    return {"config": await system_service.set_wechat_config(db, body)}


# ---------- 订阅套餐展示配置 ----------
@router.get("/subscription-plans")
async def subscription_plans(db: DB, _: CurrentUser):
    return {"plans": await system_service.get_subscription_plans(db)}


@router.put("/subscription-plans/{plan_id}")
async def update_plan(plan_id: str, body: dict, db: DB, _: AdminUser):
    plan = await system_service.set_plan_setting(db, plan_id, body)
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
