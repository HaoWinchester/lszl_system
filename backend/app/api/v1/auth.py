"""认证路由：注册 / 登录 / 退出 / 当前用户 / 微信扫码登录。

登录成功/失败/登出/微信登录均写审计日志。
"""

from typing import Annotated, Literal
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser
from app.db.session import get_db
from app.schemas.auth import LoginRequest, RegisterRequest, SelfProfileUpdate
from app.schemas.user import UserCreate
from app.models.user import ACTIVE
from app.services import system_service, user_service, wechat_service

router = APIRouter(prefix="/auth", tags=["auth"])
DB = Annotated[AsyncSession, Depends(get_db)]

SAFE_WECHAT_RETURN_PATHS = {
    "/",
    "/graph",
    "/training",
    "/workspace",
    "/learning/node",
    "/learning/placement-test",
    "/files",
    "/question-bank",
    "/recall",
    "/users",
    "/settings",
    "/login",
    "/member",
    "/index.html",
    "/workbench.html",
    "/learning-path.html",
    "/file-manager.html",
    "/question-bank.html",
    "/question-training.html",
    "/question-workspace.html",
    "/knowledge-recall.html",
    "/user-management.html",
    "/system-settings.html",
    "/guided-learning-node.html",
    "/guided-learning-placement-test.html",
}


def _client_info(request: Request) -> tuple[str | None, str | None]:
    ip = request.client.host if request.client else None
    ua = request.headers.get("user-agent")
    return ip, ua


def _safe_return_path(value: str | None) -> str:
    parsed = urlsplit(str(value or "/"))
    if (
        not str(value or "/").startswith("/")
        or str(value or "/").startswith("//")
        or parsed.scheme
        or parsed.netloc
        or parsed.path not in SAFE_WECHAT_RETURN_PATHS
    ):
        return "/"
    return urlunsplit(("", "", parsed.path, parsed.query, parsed.fragment))


def _wechat_redirect(return_path: str, result: str) -> RedirectResponse:
    parsed = urlsplit(_safe_return_path(return_path))
    query = [(key, value) for key, value in parse_qsl(parsed.query, keep_blank_values=True) if key != "wechat"]
    query.append(("wechat", result))
    location = urlunsplit(("", "", parsed.path, urlencode(query), parsed.fragment))
    return RedirectResponse(url=location, status_code=303)


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


@router.put("/me")
async def update_me(req: SelfProfileUpdate, user: CurrentUser, db: DB):
    try:
        updated = await user_service.update_self_profile(db, user, req)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"user": user_service.to_dict(updated)}


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
async def wechat_auth_url(
    request: Request,
    db: DB,
    intent: Literal["login", "bind"] = "login",
    return_path: str = "/",
):
    cfg = await system_service.get_wechat_config(db)
    if wechat_service.compute_mode(cfg) != "official":
        raise HTTPException(status_code=400, detail="未配置正式微信登录（缺 AppID/AppSecret 或未启用）")
    username = str(request.session.get("username") or "")
    if intent == "bind" and not username:
        raise HTTPException(status_code=401, detail="请先登录后再绑定微信")
    url, state = wechat_service.build_auth_url(cfg)
    request.session["wechat_oauth"] = {
        "state": state,
        "intent": intent,
        "returnPath": _safe_return_path(return_path),
        "username": username,
    }
    return {"authUrl": url, "state": state}


@router.get("/wechat/callback")
async def wechat_callback(code: str, state: str, request: Request, db: DB):
    pending = request.session.pop("wechat_oauth", None)
    if not pending or pending.get("state") != state:
        return _wechat_redirect("/", "state-invalid")

    return_path = _safe_return_path(pending.get("returnPath"))
    cfg = await system_service.get_wechat_config(db)
    try:
        token = await wechat_service.exchange_code(cfg, code)
        info = await wechat_service.fetch_userinfo(
            cfg, token.get("access_token", ""), token.get("openid", "")
        )
        profile = {
            "openid": token.get("openid", ""),
            "unionid": token.get("unionid") or info.get("unionid", ""),
            "nickname": info.get("nickname", ""),
            "avatar": info.get("avatar", ""),
        }
        if pending.get("intent") == "bind":
            username = str(pending.get("username") or "")
            if not username or request.session.get("username") != username:
                return _wechat_redirect(return_path, "bind-failed")
            user = await user_service.get_by_username(db, username)
            if not user or user.status != ACTIVE:
                return _wechat_redirect(return_path, "bind-failed")
            user = await wechat_service.bind_user(db, user, profile, "wechat-bind")
            action, detail, result = "wechat_bind", "微信账号绑定成功", "bind-success"
        else:
            user = await wechat_service.find_or_create_user(db, profile, cfg, "wechat")
            if not user:
                return _wechat_redirect(return_path, "login-failed")
            request.session["username"] = user.username
            action, detail, result = "wechat_login", "微信扫码登录", "login-success"
    except (PermissionError, ValueError):
        return _wechat_redirect(return_path, "bind-failed" if pending.get("intent") == "bind" else "login-failed")
    except Exception:  # noqa: BLE001
        return _wechat_redirect(return_path, "provider-failed")
    ip, ua = _client_info(request)
    await user_service.log_action(db, action, user.username, user.username, detail, ip, ua)
    await db.commit()
    return _wechat_redirect(return_path, result)


@router.delete("/wechat/binding")
async def unbind_wechat(request: Request, user: CurrentUser, db: DB):
    updated = await wechat_service.unbind_user(db, user)
    ip, ua = _client_info(request)
    await user_service.log_action(db, "wechat_unbind", updated.username, updated.username, "解除微信绑定", ip, ua)
    await db.commit()
    return {"user": user_service.to_dict(updated)}


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
