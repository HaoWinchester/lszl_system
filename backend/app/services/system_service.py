"""系统设置：主题覆盖、微信配置、订阅套餐展示配置（DB KV 覆盖默认常量）。"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import (
    DEFAULT_PLANS,
    DEFAULT_THEMES,
    DEFAULT_WECHAT_CONFIG,
    PERMISSION_KEYS,
    PERMISSION_LABELS,
    ROLE_LABELS,
    ROLE_PERMISSIONS,
    ROLES,
)
from app.models.system import RoleTheme, SystemSetting


async def _get_setting(db: AsyncSession, key: str) -> SystemSetting | None:
    r = await db.execute(select(SystemSetting).where(SystemSetting.key == key))
    return r.scalar_one_or_none()


# ---------- 权限矩阵（常量）----------
def permission_matrix() -> dict:
    rows = [
        {
            "role": role,
            "label": ROLE_LABELS.get(role, role),
            "permissions": sorted(ROLE_PERMISSIONS.get(role, set())),
        }
        for role in ROLES
    ]
    return {
        "roles": ROLES,
        "labels": ROLE_LABELS,
        "keys": PERMISSION_KEYS,
        "keyLabels": PERMISSION_LABELS,
        "rows": rows,
    }


# ---------- 角色主题 ----------
async def get_themes(db: AsyncSession) -> dict:
    rows = (await db.execute(select(RoleTheme))).scalars().all()
    by_role = {r.role: r for r in rows}
    result = {}
    for role, default in DEFAULT_THEMES.items():
        r = by_role.get(role)
        result[role] = {
            "primary_color": r.primary_color if r else default["primary_color"],
            "accent_color": r.accent_color if r else default["accent_color"],
            "soft_color": r.soft_color if r else default["soft_color"],
            "text_color": r.text_color if r else default["text_color"],
        }
    return result


async def set_theme(
    db: AsyncSession, role: str, primary: str, accent: str, soft: str, text: str | None = None
) -> dict:
    existing = await db.get(RoleTheme, role)
    default = DEFAULT_THEMES.get(role, {})
    if existing:
        existing.primary_color = primary
        existing.accent_color = accent
        existing.soft_color = soft
        if text:
            existing.text_color = text
    else:
        db.add(
            RoleTheme(
                role=role,
                primary_color=primary,
                accent_color=accent,
                soft_color=soft,
                text_color=text or default.get("text_color", "#0f172a"),
            )
        )
    await db.commit()
    return (await get_themes(db))[role]


# ---------- 微信配置 ----------
async def get_wechat_config(db: AsyncSession) -> dict:
    s = await _get_setting(db, "wechat_config")
    return {**DEFAULT_WECHAT_CONFIG, **(s.value if s else {})}


async def set_wechat_config(db: AsyncSession, patch: dict) -> dict:
    current = await get_wechat_config(db)
    current.update({k: v for k, v in patch.items() if k in DEFAULT_WECHAT_CONFIG})
    s = await _get_setting(db, "wechat_config")
    if s:
        s.value = current
    else:
        db.add(SystemSetting(key="wechat_config", value=current))
    await db.commit()
    return current


# ---------- 订阅套餐展示配置 ----------
async def get_subscription_plans(db: AsyncSession) -> list[dict]:
    s = await _get_setting(db, "subscription_plan_settings")
    overrides = s.value if s else {}
    plans = []
    for p in DEFAULT_PLANS:
        merged = {**p, **overrides.get(p["planId"], {})}
        plans.append(merged)
    return plans


async def set_plan_setting(db: AsyncSession, plan_id: str, patch: dict) -> dict | None:
    s = await _get_setting(db, "subscription_plan_settings")
    val = s.value if s else {}
    val.setdefault(plan_id, {}).update(patch)
    if s:
        s.value = val
    else:
        db.add(SystemSetting(key="subscription_plan_settings", value=val))
    await db.commit()
    for p in await get_subscription_plans(db):
        if p["planId"] == plan_id:
            return p
    return None
