"""认证路由：注册 / 登录 / 退出 / 当前用户。登录成功/失败/登出均写审计日志。"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser
from app.db.session import get_db
from app.schemas.auth import LoginRequest, RegisterRequest
from app.schemas.user import UserCreate
from app.services import user_service

router = APIRouter(prefix="/auth", tags=["auth"])
DB = Annotated[AsyncSession, Depends(get_db)]


def _client_info(request: Request) -> tuple[str | None, str | None]:
    ip = request.client.host if request.client else None
    ua = request.headers.get("user-agent")
    return ip, ua


@router.post("/register")
async def register(req: RegisterRequest, request: Request, db: DB):
    ip, ua = _client_info(request)
    data = UserCreate(
        username=req.username,
        password=req.password,
        display_name=req.display_name,
        subject=req.subject,
        role="student",
        source="self-register",
    )
    try:
        user = await user_service.create_user(db, data, actor=req.username)
    except ValueError as e:
        await user_service.log_action(db, "register_failed", req.username, req.username, str(e), ip, ua)
        await db.commit()
        raise HTTPException(status_code=400, detail=str(e))
    await user_service.log_action(db, "login_success", user.username, user.username, "注册并登录", ip, ua)
    await db.commit()
    request.session["username"] = user.username
    return {"user": user_service.to_dict(user)}


@router.post("/login")
async def login(req: LoginRequest, request: Request, db: DB):
    ip, ua = _client_info(request)
    try:
        user = await user_service.authenticate(db, req.username, req.password)
    except PermissionError as e:
        await user_service.log_action(
            db, "login_failed", req.username, req.username, f"账号不可用：{e}", ip, ua
        )
        await db.commit()
        raise HTTPException(status_code=403, detail=str(e))
    if not user:
        await user_service.log_action(
            db, "login_failed", req.username, req.username, "用户名或密码错误", ip, ua
        )
        await db.commit()
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    await user_service.log_action(db, "login_success", user.username, user.username, "登录成功", ip, ua)
    await db.commit()
    request.session["username"] = user.username
    return {"user": user_service.to_dict(user)}


@router.post("/logout")
async def logout(request: Request, db: DB):
    un = request.session.get("username")
    if un:
        ip, ua = _client_info(request)
        await user_service.log_action(db, "logout", un, un, "退出登录", ip, ua)
        await db.commit()
    request.session.clear()
    return {"ok": True, "username": un}


@router.get("/me")
async def me(user: CurrentUser):
    return {"user": user_service.to_dict(user)}
