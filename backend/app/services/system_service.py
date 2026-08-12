"""系统设置：主题覆盖、微信配置、订阅套餐展示配置（DB KV 覆盖默认常量）。"""

from collections.abc import Mapping
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import re
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import (
    DEFAULT_PLANS,
    DEFAULT_THEMES,
    DEFAULT_WECHAT_CONFIG,
    DEFAULT_WECHAT_PAY_CONFIG,
    PERMISSION_KEYS,
    PERMISSION_LABELS,
    ROLE_LABELS,
    ROLE_PERMISSIONS,
    ROLES,
)
from app.core.config import settings
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
WECHAT_BROWSER_CONFIG_KEYS = (
    "enableDemo",
    "enableOfficial",
    "autoCreateUser",
    "appId",
    "redirectUri",
    "scope",
    "defaultRole",
    "defaultSubject",
)


def public_wechat_config(config: dict) -> dict:
    """可传到管理页面或普通浏览器的非敏感微信配置。"""
    return {key: config[key] for key in WECHAT_BROWSER_CONFIG_KEYS if key in config}


def _environment_wechat_overrides() -> dict:
    overrides = {
        "appId": settings.WECHAT_APP_ID,
        "appSecret": settings.WECHAT_APP_SECRET,
        "redirectUri": settings.WECHAT_REDIRECT_URI,
    }
    if settings.WECHAT_ENABLE_OFFICIAL is not None:
        overrides["enableOfficial"] = settings.WECHAT_ENABLE_OFFICIAL
    if settings.WECHAT_ENABLE_DEMO is not None:
        overrides["enableDemo"] = settings.WECHAT_ENABLE_DEMO
    return {key: value for key, value in overrides.items() if value not in (None, "")}


async def get_wechat_config(db: AsyncSession) -> dict:
    s = await _get_setting(db, "wechat_config")
    stored = dict(s.value or {}) if s else {}
    # 登录凭证仅允许由部署环境提供。清理旧版本写入数据库的敏感字段，
    # 避免管理端历史数据在迁移后仍能成为正式登录的凭证来源。
    stored.pop("appSecret", None)
    stored.pop("backendExchangeUrl", None)
    return {**DEFAULT_WECHAT_CONFIG, **stored, **_environment_wechat_overrides()}


async def set_wechat_config(db: AsyncSession, patch: dict) -> dict:
    current = await get_wechat_config(db)
    current.update(public_wechat_config(patch))
    s = await _get_setting(db, "wechat_config")
    if s:
        s.value = current
    else:
        db.add(SystemSetting(key="wechat_config", value=current))
    await db.commit()
    return public_wechat_config(current)


# ---------- 微信支付配置 ----------
WECHAT_PAY_BROWSER_CONFIG_KEYS = (
    "enableDemo",
    "mchId",
    "mchSerialNo",
    "wxPubKeyId",
    "appId",
    "notifyUrl",
)


def wechat_pay_ready(config: dict) -> bool:
    return all(
        config.get(key)
        for key in (
            "mchId",
            "apiV3Key",
            "mchSerialNo",
            "mchPrivateKey",
            "wxPubKey",
            "wxPubKeyId",
            "appId",
            "notifyUrl",
        )
    )


def public_wechat_pay_config(config: dict) -> dict:
    """返回管理端可见的支付配置，永不包含密钥或 PEM 内容。"""
    result = {key: config[key] for key in WECHAT_PAY_BROWSER_CONFIG_KEYS if key in config}
    result["ready"] = wechat_pay_ready(config)
    return result


def _parse_environment_bool(value: object) -> bool:
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _read_secret_file(path: str) -> str:
    try:
        return Path(path).read_text(encoding="utf-8").strip() if path else ""
    except OSError:
        return ""


def wechat_pay_environment_overrides(environment: Mapping[str, object]) -> dict:
    """将部署环境映射为运行时支付配置，PEM 仅从服务器文件读取。"""
    result = {
        "mchId": str(environment.get("WECHAT_PAY_MCH_ID") or ""),
        "apiV3Key": str(environment.get("WECHAT_PAY_API_V3_KEY") or ""),
        "mchSerialNo": str(environment.get("WECHAT_PAY_MCH_SERIAL_NO") or ""),
        "mchPrivateKey": _read_secret_file(
            str(environment.get("WECHAT_PAY_MCH_PRIVATE_KEY_FILE") or "")
        ),
        "wxPubKey": _read_secret_file(
            str(environment.get("WECHAT_PAY_WX_PUBLIC_KEY_FILE") or "")
        ),
        "wxPubKeyId": str(environment.get("WECHAT_PAY_WX_PUBLIC_KEY_ID") or ""),
        "appId": str(environment.get("WECHAT_PAY_APP_ID") or ""),
        "notifyUrl": str(environment.get("WECHAT_PAY_NOTIFY_URL") or ""),
    }
    enable_demo = environment.get("WECHAT_PAY_ENABLE_DEMO")
    if enable_demo not in (None, ""):
        result["enableDemo"] = _parse_environment_bool(enable_demo)
    return {key: value for key, value in result.items() if value not in (None, "")}


def _environment_wechat_pay_overrides() -> dict:
    return wechat_pay_environment_overrides(
        {
            "WECHAT_PAY_ENABLE_DEMO": settings.WECHAT_PAY_ENABLE_DEMO,
            "WECHAT_PAY_MCH_ID": settings.WECHAT_PAY_MCH_ID,
            "WECHAT_PAY_API_V3_KEY": settings.WECHAT_PAY_API_V3_KEY,
            "WECHAT_PAY_MCH_SERIAL_NO": settings.WECHAT_PAY_MCH_SERIAL_NO,
            "WECHAT_PAY_MCH_PRIVATE_KEY_FILE": settings.WECHAT_PAY_MCH_PRIVATE_KEY_FILE,
            "WECHAT_PAY_WX_PUBLIC_KEY_FILE": settings.WECHAT_PAY_WX_PUBLIC_KEY_FILE,
            "WECHAT_PAY_WX_PUBLIC_KEY_ID": settings.WECHAT_PAY_WX_PUBLIC_KEY_ID,
            "WECHAT_PAY_APP_ID": settings.WECHAT_PAY_APP_ID,
            "WECHAT_PAY_NOTIFY_URL": settings.WECHAT_PAY_NOTIFY_URL,
        }
    )


async def get_wechat_pay_config(db: AsyncSession) -> dict:
    s = await _get_setting(db, "wechat_pay_config")
    stored = dict(s.value or {}) if s else {}
    # 历史版本可能把敏感凭证写进数据库；运行时绝不再读取它们。
    stored = {key: stored[key] for key in WECHAT_PAY_BROWSER_CONFIG_KEYS if key in stored}
    return {**DEFAULT_WECHAT_PAY_CONFIG, **stored, **_environment_wechat_pay_overrides()}


async def set_wechat_pay_config(db: AsyncSession, patch: dict) -> dict:
    current = await get_wechat_pay_config(db)
    current.update({key: patch[key] for key in WECHAT_PAY_BROWSER_CONFIG_KEYS if key in patch})
    stored = {key: current[key] for key in WECHAT_PAY_BROWSER_CONFIG_KEYS if key in current}
    s = await _get_setting(db, "wechat_pay_config")
    if s:
        s.value = stored
    else:
        db.add(SystemSetting(key="wechat_pay_config", value=stored))
    await db.commit()
    return public_wechat_pay_config(await get_wechat_pay_config(db))


# ---------- 订阅套餐展示配置 ----------
def format_payment_amount_fen(amount_fen: int) -> str:
    """Return the exact server-authoritative amount in the UI's currency format."""
    yuan = amount_fen / 100
    return f"￥{int(yuan)}" if amount_fen % 100 == 0 else f"￥{yuan:.2f}"


def normalize_payment_amount_fen(plan_id: str, value: object) -> int:
    """Reject ambiguous money input before storing it in the JSONB plan config."""
    if isinstance(value, bool):
        raise ValueError("支付金额必须是整数分")
    try:
        amount_fen = int(str(value).strip())
    except (TypeError, ValueError) as error:
        raise ValueError("支付金额必须是整数分") from error
    if str(value).strip() != str(amount_fen):
        raise ValueError("支付金额必须是整数分")
    if plan_id == "free":
        if amount_fen != 0:
            raise ValueError("免费套餐支付金额必须为 0")
    elif amount_fen <= 0:
        raise ValueError("付费套餐支付金额必须大于 0")
    return amount_fen


def legacy_payment_amount_fen(plan: dict) -> int | None:
    """Translate pre-paymentAmountFen price config once, without using it as a future source of truth."""
    price_text = str(plan.get("priceText") or "").strip()
    raw = price_text if re.search(r"\d", price_text) else str(plan.get("originalPriceText") or "").strip()
    match = re.search(r"\d+(?:\.\d+)?", raw)
    if not match:
        return None
    try:
        yuan = Decimal(match.group(0))
        if not re.search(r"\d", price_text):
            discount = Decimal(str(plan.get("discountPercent") or "100").replace("%", "").strip())
            if Decimal("0") < discount <= Decimal("1"):
                discount *= Decimal("100")
            yuan *= discount / Decimal("100")
            decimals = len(match.group(0).partition(".")[2])
            if decimals:
                yuan = yuan.quantize(Decimal("1." + "0" * decimals), rounding=ROUND_HALF_UP)
        return int((yuan * Decimal("100")).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    except (InvalidOperation, ValueError):
        return None


def _merged_subscription_plan(default: dict, override: object) -> dict:
    patch = override if isinstance(override, dict) else {}
    merged = {**default, **patch}
    if "paymentAmountFen" not in patch:
        legacy_amount = legacy_payment_amount_fen(patch)
        if legacy_amount is not None:
            merged["paymentAmountFen"] = legacy_amount
    merged["paymentAmountFen"] = normalize_payment_amount_fen(
        str(default["planId"]), merged.get("paymentAmountFen", default["paymentAmountFen"])
    )
    # 价格牌、订单、回调三者都由 paymentAmountFen 派生；不要再由原价/折扣文案推导。
    merged["priceText"] = format_payment_amount_fen(merged["paymentAmountFen"])
    return merged


async def get_subscription_plans(db: AsyncSession) -> list[dict]:
    s = await _get_setting(db, "subscription_plan_settings")
    overrides = s.value if s else {}
    plans = []
    for p in DEFAULT_PLANS:
        plans.append(_merged_subscription_plan(p, overrides.get(p["planId"], {})))
    return plans


async def set_plan_setting(db: AsyncSession, plan_id: str, patch: dict) -> dict | None:
    default = next((plan for plan in DEFAULT_PLANS if plan["planId"] == plan_id), None)
    if default is None:
        raise ValueError("套餐不存在")
    if not isinstance(patch, dict):
        raise ValueError("套餐配置必须是对象")
    s = await _get_setting(db, "subscription_plan_settings")
    # JSON columns do not track nested in-place mutations reliably. Build fresh
    # dicts so SQLAlchemy always emits the UPDATE and a new request sees it.
    val = dict(s.value or {}) if s else {}
    plan = dict(val.get(plan_id) or {})
    plan.update(patch)
    if "paymentAmountFen" in plan:
        plan["paymentAmountFen"] = normalize_payment_amount_fen(plan_id, plan["paymentAmountFen"])
    val[plan_id] = plan
    if s:
        s.value = val
    else:
        db.add(SystemSetting(key="subscription_plan_settings", value=val))
    await db.commit()
    for p in await get_subscription_plans(db):
        if p["planId"] == plan_id:
            return p
    return None
