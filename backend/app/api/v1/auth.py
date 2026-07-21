"""认证路由：注册 / 登录 / 退出 / 当前用户 / 微信扫码登录。

登录成功/失败/登出/微信登录均写审计日志。
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser
from app.db.session import get_db
from app.schemas.auth import LoginRequest, RegisterRequest, WechatLoginRequest
from app.schemas.user import UserCreate
from app.services import system_service, user_service, wechat_service

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


# ---------- 微信扫码登录 ----------
@router.get("/wechat/config")
async def wechat_config(db: DB):
    """登录页据此决定显示哪个按钮。绝不返回 appSecret。"""
    cfg = await system_service.get_wechat_config(db)
    return {
        "mode": wechat_service.compute_mode(cfg),
        "hasAppId": bool(cfg.get("appId")),
        "hasSecret": bool(cfg.get("appSecret")),
        "scope": cfg.get("scope", "snsapi_login"),
        "enableDemo": bool(cfg.get("enableDemo")),
    }


@router.get("/wechat/auth-url")
async def wechat_auth_url(request: Request, db: DB):
    cfg = await system_service.get_wechat_config(db)
    if wechat_service.compute_mode(cfg) != "official":
        raise HTTPException(status_code=400, detail="未配置正式微信登录（缺 AppID/AppSecret 或未启用）")
    url, state = wechat_service.build_auth_url(cfg)
    request.session["wechat_state"] = state
    return {"authUrl": url, "state": state}


@router.post("/wechat/login")
async def wechat_login(req: WechatLoginRequest, request: Request, db: DB):
    cfg = await system_service.get_wechat_config(db)
    expected = request.session.pop("wechat_state", None)
    if not expected or expected != req.state:
        raise HTTPException(status_code=400, detail="登录状态校验失败，请重新扫码")
    try:
        token = await wechat_service.exchange_code(cfg, req.code)
        info = await wechat_service.fetch_userinfo(
            cfg, token.get("access_token", ""), token.get("openid", "")
        )
        profile = {
            "openid": token.get("openid", ""),
            "unionid": token.get("unionid") or info.get("unionid", ""),
            "nickname": info.get("nickname", ""),
            "avatar": info.get("avatar", ""),
        }
        user = await wechat_service.find_or_create_user(db, profile, cfg, "wechat")
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"微信登录失败：{e}")
    if not user:
        raise HTTPException(status_code=403, detail="该微信未绑定本系统账号，请联系管理员")
    ip, ua = _client_info(request)
    await user_service.log_action(db, "wechat_login", user.username, user.username, "微信扫码登录", ip, ua)
    await db.commit()
    request.session["username"] = user.username
    return {"user": user_service.to_dict(user)}


@router.post("/wechat/demo-login")
async def wechat_demo_login(request: Request, db: DB):
    cfg = await system_service.get_wechat_config(db)
    if not cfg.get("enableDemo"):
        raise HTTPException(status_code=403, detail="演示模式未开启")
    profile = wechat_service.profile_for_demo()
    user = await wechat_service.find_or_create_user(db, profile, cfg, "wechat-demo")
    ip, ua = _client_info(request)
    await user_service.log_action(
        db, "wechat_demo_login", user.username, user.username, "微信演示扫码登录", ip, ua
    )
    await db.commit()
    request.session["username"] = user.username
    return {"user": user_service.to_dict(user)}
