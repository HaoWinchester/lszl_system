"""微信扫码登录业务：授权 URL、code 换 token、拉取用户信息、找/建用户、演示模式。

模式由配置决定（wechat_config，存 system_settings）：
- 演示模式（enableDemo）：不依赖微信凭证，返回假 profile，供本地开发验收。
- 正式模式（enableOfficial && appId && appSecret）：走 open.weixin.qq.com qrconnect。
"""

import hashlib
from datetime import datetime, timezone
from urllib.parse import urlencode

import httpx
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import now_utc, uid
from app.models.user import ACTIVE, User
from app.services import user_service


def compute_mode(cfg: dict) -> str:
    """official = 已开正式且 appId/appSecret 齐全；否则 demo。"""
    if cfg.get("enableOfficial") and cfg.get("appId") and cfg.get("appSecret"):
        return "official"
    return "demo"


def _wx_username(openid: str) -> str:
    """同一 openid 生成稳定的 wx_ 前缀用户名（沿用 legacy 命名约定）。"""
    return "wx_" + hashlib.sha256(str(openid).encode("utf-8")).hexdigest()[:10]


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def build_auth_url(cfg: dict) -> tuple[str, str]:
    """拼接 qrconnect 授权 URL，返回 (url, state)；state 由调用方写入 session 防 CSRF。"""
    state = "kgwechat_" + uid("state_")
    params = {
        "appid": cfg.get("appId", ""),
        "redirect_uri": cfg.get("redirectUri", ""),
        "response_type": "code",
        "scope": cfg.get("scope", "snsapi_login"),
        "state": state,
    }
    url = "https://open.weixin.qq.com/connect/qrconnect?" + urlencode(params) + "#wechat_redirect"
    return url, state


async def exchange_code(cfg: dict, code: str) -> dict:
    """用 code 换 access_token / openid / unionid。失败抛 ValueError。"""
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(
            "https://api.weixin.qq.com/sns/oauth2/access_token",
            params={
                "appid": cfg.get("appId", ""),
                "secret": cfg.get("appSecret", ""),
                "code": code,
                "grant_type": "authorization_code",
            },
        )
    data = r.json()
    if data.get("errcode"):
        raise ValueError(f"微信换取 token 失败：{data.get('errmsg', data.get('errcode'))}")
    return data


async def fetch_userinfo(cfg: dict, access_token: str, openid: str) -> dict:
    """拉取昵称/头像（scope 需含 snsapi_login / snsapi_userinfo）。失败返回空。"""
    if not access_token or not openid:
        return {}
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(
            "https://api.weixin.qq.com/sns/userinfo",
            params={"access_token": access_token, "openid": openid},
        )
    data = r.json()
    if data.get("errcode"):
        return {}
    return {
        "nickname": data.get("nickname", ""),
        "avatar": data.get("headimgurl", ""),
        "unionid": data.get("unionid", ""),
    }


def profile_for_demo() -> dict:
    """演示模式假 profile（固定 openid，便于多次演示回到同一账号）。"""
    return {
        "openid": "wx_demo_openid",
        "unionid": "wx_demo_unionid",
        "nickname": "微信演示用户",
        "avatar": "",
    }


def _wechat_payload(profile: dict, existing: dict | None, source: str) -> dict:
    now = now_utc()
    return {
        "openid": str(profile.get("openid") or ""),
        "unionid": str(profile.get("unionid") or ""),
        "nickname": str(profile.get("nickname") or "微信用户"),
        "avatar": str(profile.get("avatar") or ""),
        "boundAt": (existing or {}).get("boundAt", _iso(now)),
        "lastLoginAt": _iso(now),
        "source": source,
    }


async def find_by_wechat_identity(
    db: AsyncSession, openid: str, unionid: str = ""
) -> User | None:
    """按 openid 与可选 unionid 查询已绑定用户。"""
    conditions = [User.wechat["openid"].astext == openid]
    if unionid:
        conditions.append(User.wechat["unionid"].astext == unionid)
    return (await db.execute(select(User).where(or_(*conditions)))).scalar_one_or_none()


async def bind_user(db: AsyncSession, user: User, profile: dict, source: str) -> User:
    """将未被他人占用的微信身份绑定到当前用户；同用户重复绑定幂等。"""
    openid = str(profile.get("openid") or "")
    unionid = str(profile.get("unionid") or "")
    if not openid:
        raise ValueError("微信绑定失败：缺少 openid")
    owner = await find_by_wechat_identity(db, openid, unionid)
    if owner and owner.username != user.username:
        raise ValueError("该微信已绑定其他账号，不能重复绑定")
    user.wechat = _wechat_payload(profile, user.wechat, source)
    await db.commit()
    await db.refresh(user)
    return user


async def unbind_user(db: AsyncSession, user: User) -> User:
    """仅移除微信登录标识，保留账号和所有业务数据。"""
    user.wechat = None
    await db.commit()
    await db.refresh(user)
    return user


async def find_or_create_user(
    db: AsyncSession, profile: dict, cfg: dict, source: str
) -> User | None:
    """按 openid/unionid 找用户；未命中且 autoCreateUser 则建微信用户（无密码）。"""
    openid = str(profile.get("openid") or "")
    unionid = str(profile.get("unionid") or "")
    nickname = str(profile.get("nickname") or "微信用户")
    avatar = str(profile.get("avatar") or "")
    if not openid:
        raise ValueError("微信登录失败：缺少 openid")

    found = await find_by_wechat_identity(db, openid, unionid)

    now = now_utc()
    wechat_payload = _wechat_payload(
        {"openid": openid, "unionid": unionid, "nickname": nickname, "avatar": avatar},
        found.wechat if found else None,
        source,
    )

    if found:
        if found.status != ACTIVE:
            raise PermissionError("该微信绑定账号已停用或归档")
        found.wechat = wechat_payload
        found.display_name = found.display_name or nickname
        found.last_login_at = now
        found.last_active_at = now
        await db.commit()
        await db.refresh(found)
        return found

    if not cfg.get("autoCreateUser", True):
        return None

    username = _wx_username(openid)
    while await user_service.get_by_username(db, username):
        username = _wx_username(openid + uid())  # 极小概率冲突，加随机重算
    user = User(
        username=username,
        password_hash="",  # 微信用户无密码；to_dict 的 has_password=False
        role=cfg.get("defaultRole", "student"),
        status=ACTIVE,
        display_name=nickname,
        subject=cfg.get("defaultSubject", "PMP"),
        tags=[],
        source=source,
        wechat=wechat_payload,
        last_login_at=now,
        last_active_at=now,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user
