"""订阅业务逻辑：当前订阅、卡密兑换、订单申请/审批/支付、管理员开通、卡密生成。"""

import secrets
import re
from collections.abc import Mapping
from datetime import timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import DEFAULT_PLANS
from app.core.security import now_utc, uid
from app.models.subscription import RedeemCode, Subscription, SubscriptionOrder
from app.services import system_service, wechat_pay_service

FINITE_PAID_PLAN_IDS = frozenset({"monthly", "quarterly", "half_year"})
PAID_PLAN_IDS = FINITE_PAID_PLAN_IDS | {"lifetime"}
VALID_PLAN_IDS = PAID_PLAN_IDS | {"free"}
WECHAT_NATIVE_OUT_TRADE_NO_MAX_LENGTH = 32


def native_out_trade_no() -> str:
    """微信 Native out_trade_no 最长 32 字符，UUID hex 恰好满足且全为字母数字。"""
    return uid()[:WECHAT_NATIVE_OUT_TRADE_NO_MAX_LENGTH]


def validate_plan_id(plan_id: str, *, allow_free: bool = True) -> str:
    """Normalize a supported plan ID or reject it before any write occurs."""
    normalized = str(plan_id or "").strip().lower()
    allowed = VALID_PLAN_IDS if allow_free else PAID_PLAN_IDS
    if normalized not in allowed:
        raise ValueError("套餐不存在")
    return normalized


def _plan(plan_id: str) -> dict:
    normalized = validate_plan_id(plan_id)
    for p in DEFAULT_PLANS:
        if p["planId"] == normalized:
            return p
    raise ValueError("套餐不存在")


def _configured_plan_amount_fen(plan: Mapping[str, object]) -> int:
    """Derive a payment amount from the same stored fields shown to users.

    ``originalPriceText`` may include currency and duration copy (for example
    ``￥39.9 / 月``); the first decimal amount is the configured base price.
    The rounding precision intentionally matches the browser's visible plan
    price, so a QR code can never charge a different amount from the UI.
    """

    raw_price = str(plan.get("originalPriceText") or plan.get("priceText") or "").strip()
    match = re.search(r"(?<![\d.])(\d+(?:\.\d+)?)(?![\d.])", raw_price)
    if match is None:
        raise ValueError("套餐价格未配置，请联系管理员在系统设置中填写原价")
    price_number = match.group(1)
    decimal_places = min(len(price_number.partition(".")[2]), 2)
    try:
        base_amount = Decimal(price_number)
        raw_discount = str(plan.get("discountPercent") or "").strip().rstrip("%")
        discount = Decimal("100") if not raw_discount else Decimal(raw_discount)
        if Decimal("0") < discount <= Decimal("1"):
            discount *= Decimal("100")
    except (InvalidOperation, ValueError) as error:
        raise ValueError("套餐价格或折扣配置无效，请联系管理员检查系统设置") from error
    if base_amount <= 0 or discount <= 0 or discount > 100:
        raise ValueError("套餐价格或折扣配置无效，请联系管理员检查系统设置")
    visible_amount = base_amount * discount / Decimal("100")
    precision = Decimal("1") if decimal_places == 0 else Decimal(f"1e-{decimal_places}")
    visible_amount = visible_amount.quantize(precision, rounding=ROUND_HALF_UP)
    amount_fen = (visible_amount * Decimal("100")).quantize(
        Decimal("1"), rounding=ROUND_HALF_UP
    )
    if amount_fen < 1:
        raise ValueError("套餐实付金额必须大于 0")
    return int(amount_fen)


def entitlements_for(role: str, subscription: Subscription | None) -> dict[str, bool]:
    """Return server-authoritative subscription capabilities for one account."""
    normalized_role = str(role or "viewer").lower()
    if normalized_role in {"admin", "teacher"}:
        return {"allExamPapers": True}
    if normalized_role != "student" or subscription is None:
        return {"allExamPapers": False}
    if str(subscription.status or "").lower() != "active":
        return {"allExamPapers": False}
    plan_id = str(subscription.plan_id or "free").strip().lower()
    if plan_id not in PAID_PLAN_IDS:
        return {"allExamPapers": False}
    expires_at = subscription.expires_at
    if expires_at is None:
        return {"allExamPapers": plan_id == "lifetime"}
    try:
        is_future = expires_at > now_utc()
    except TypeError:
        return {"allExamPapers": False}
    if plan_id in FINITE_PAID_PLAN_IDS and not is_future:
        return {"allExamPapers": False}
    return {"allExamPapers": is_future}


def payment_amount_matches(expected_amount_fen: int | None, received_amount_fen: object) -> bool:
    """微信回调金额必须是整数分，且与本地订单金额完全一致。"""
    return (
        expected_amount_fen is not None
        and isinstance(received_amount_fen, int)
        and not isinstance(received_amount_fen, bool)
        and expected_amount_fen == received_amount_fen
    )


def _expires(plan_id: str, started=None):
    days = _plan(plan_id).get("validDays", 0)
    if days == 0:
        return None
    return (started or now_utc()) + timedelta(days=days)


def sub_to_dict(s: Subscription) -> dict:
    return {
        "username": s.username,
        "planId": s.plan_id,
        "status": s.status,
        "startedAt": s.started_at.isoformat() if s.started_at else None,
        "expiresAt": s.expires_at.isoformat() if s.expires_at else None,
        "source": s.source,
        "note": s.note,
    }


def order_to_dict(o: SubscriptionOrder) -> dict:
    return {
        "id": o.id,
        "username": o.username,
        "planId": o.plan_id,
        "planName": o.plan_name,
        "status": o.status,
        "note": o.note,
        "createdAt": o.created_at.isoformat() if o.created_at else None,
        "approvedAt": o.approved_at.isoformat() if o.approved_at else None,
        "approvedBy": o.approved_by,
        "payStatus": o.pay_status,
        "amount": o.amount,
        "codeUrl": o.code_url,
        "payMethod": o.pay_method,
        "transactionId": o.transaction_id,
    }


def code_to_dict(c: RedeemCode) -> dict:
    return {
        "id": c.id,
        "code": c.code,
        "planId": c.plan_id,
        "planName": c.plan_name,
        "status": c.status,
        "usedBy": c.used_by,
        "createdAt": c.created_at.isoformat() if c.created_at else None,
    }


def _apply_plan(sub: Subscription, plan_id: str) -> None:
    plan_id = validate_plan_id(plan_id)
    sub.plan_id = plan_id
    if plan_id in ("free", "lifetime"):
        sub.expires_at = None
    elif not sub.expires_at or sub.expires_at < now_utc():
        sub.expires_at = _expires(plan_id)
    else:
        sub.expires_at = sub.expires_at + timedelta(days=_plan(plan_id).get("validDays", 0))


async def get_subscription(db: AsyncSession, username: str) -> Subscription:
    s = await db.get(Subscription, username)
    if not s:
        s = Subscription(username=username, plan_id="free", status="active", source="default")
        db.add(s)
        await db.commit()
        await db.refresh(s)
    return s


async def _subscription_for_update(db: AsyncSession, username: str) -> Subscription:
    result = await db.execute(
        select(Subscription).where(Subscription.username == username).with_for_update()
    )
    subscription = result.scalar_one_or_none()
    if subscription is None:
        subscription = Subscription(
            username=username, plan_id="free", status="active", source="default"
        )
        db.add(subscription)
        await db.flush()
    return subscription


async def admin_set(
    db: AsyncSession, username: str, plan_id: str, status: str | None, note: str | None, actor: str
) -> Subscription:
    plan_id = validate_plan_id(plan_id)
    s = await get_subscription(db, username)
    _apply_plan(s, plan_id)
    if status:
        s.status = status
    s.source = "manual"
    if note is not None:
        s.note = note
    await db.commit()
    await db.refresh(s)
    return s


async def redeem(db: AsyncSession, username: str, code: str) -> Subscription:
    r = await db.execute(select(RedeemCode).where(RedeemCode.code == code.strip().upper()))
    c = r.scalar_one_or_none()
    if not c:
        raise ValueError("卡密不存在")
    if c.status != "unused":
        raise ValueError("卡密已使用或已停用")
    s = await get_subscription(db, username)
    _apply_plan(s, c.plan_id)
    s.status = "active"
    s.source = "redeem_code"
    c.status = "used"
    c.used_at = now_utc()
    c.used_by = username
    await db.commit()
    await db.refresh(s)
    return s


async def request_order(db: AsyncSession, username: str, plan_id: str) -> SubscriptionOrder:
    """创建订单并按支付配置生成微信扫码 code_url。"""
    plan_id = validate_plan_id(plan_id, allow_free=False)
    plans = await system_service.get_subscription_plans(db)
    p = next((plan for plan in plans if plan.get("planId") == plan_id), None)
    if p is None:
        raise ValueError("套餐不存在")
    amount_fen = _configured_plan_amount_fen(p)
    o = SubscriptionOrder(
        id=native_out_trade_no(),
        username=username,
        plan_id=plan_id,
        plan_name=p["name"],
        status="pending",
        pay_status="pending",
        amount=amount_fen,
        pay_method="wechat",
    )
    db.add(o)
    await db.flush()  # 拿 o.id 作为 out_trade_no

    pay_cfg = await system_service.get_wechat_pay_config(db)
    if pay_cfg.get("enableDemo"):
        o.code_url = wechat_pay_service.demo_code_url(o.id)
    elif wechat_pay_service.is_ready(pay_cfg):
        try:
            o.code_url = await wechat_pay_service.create_native_order(
                o.id, p["name"], amount_fen, pay_cfg
            )
        except Exception:  # noqa: BLE001
            o.code_url = None  # 下单失败，前端提示重试
    else:
        o.code_url = None  # 未配置，退回管理员审批流程
    await db.commit()
    await db.refresh(o)
    return o


async def activate_paid_order(
    db: AsyncSession,
    order_id: str,
    transaction_id: str | None,
    received_amount_fen: object = None,
    validate_amount: bool = False,
) -> SubscriptionOrder:
    """支付成功激活订阅（幂等：已 paid 直接返回）。"""
    result = await db.execute(
        select(SubscriptionOrder)
        .where(SubscriptionOrder.id == order_id)
        .with_for_update()
    )
    o = result.scalar_one_or_none()
    if not o:
        raise ValueError("订单不存在")
    if o.pay_status == "paid":
        return o
    if validate_amount and not payment_amount_matches(o.amount, received_amount_fen):
        raise ValueError("支付金额不匹配")
    already_activated = o.status == "approved"
    o.pay_status = "paid"
    o.transaction_id = transaction_id
    o.paid_at = now_utc()
    o.status = "approved"
    s = await _subscription_for_update(db, o.username)
    if not already_activated:
        _apply_plan(s, o.plan_id)
        s.status = "active"
        s.source = "wechat_pay"
        s.order_id = o.id
    await db.commit()
    await db.refresh(o)
    return o


async def list_orders(db: AsyncSession, status: str | None = None) -> list[SubscriptionOrder]:
    q = select(SubscriptionOrder)
    if status:
        q = q.where(SubscriptionOrder.status == status)
    r = await db.execute(q.order_by(SubscriptionOrder.created_at.desc()))
    return list(r.scalars().all())


async def approve_order(db: AsyncSession, order_id: str, actor: str) -> SubscriptionOrder:
    result = await db.execute(
        select(SubscriptionOrder)
        .where(SubscriptionOrder.id == order_id)
        .with_for_update()
    )
    o = result.scalar_one_or_none()
    if not o or o.status != "pending" or o.pay_status == "paid":
        raise ValueError("订单不存在或已处理")
    o.status = "approved"
    o.approved_at = now_utc()
    o.approved_by = actor
    s = await _subscription_for_update(db, o.username)
    _apply_plan(s, o.plan_id)
    s.status = "active"
    s.source = "order"
    s.order_id = o.id
    await db.commit()
    await db.refresh(o)
    return o


async def cancel_order(db: AsyncSession, order_id: str, actor: str) -> SubscriptionOrder:
    result = await db.execute(
        select(SubscriptionOrder)
        .where(SubscriptionOrder.id == order_id)
        .with_for_update()
    )
    o = result.scalar_one_or_none()
    if not o or o.status != "pending" or o.pay_status not in {None, "pending"}:
        raise ValueError("订单不存在或已处理")
    o.status = "cancelled"
    await db.commit()
    await db.refresh(o)
    return o


async def cancel_own_order(
    db: AsyncSession, order_id: str, username: str
) -> SubscriptionOrder:
    result = await db.execute(
        select(SubscriptionOrder)
        .where(SubscriptionOrder.id == order_id)
        .with_for_update()
    )
    order = result.scalar_one_or_none()
    if not order or order.username != username:
        raise LookupError("订单不存在")
    if order.status != "pending" or order.pay_status not in {None, "pending"}:
        raise ValueError("订单不存在或已处理")
    order.status = "cancelled"
    await db.commit()
    await db.refresh(order)
    return order


async def generate_codes(db: AsyncSession, plan_id: str, count: int, actor: str) -> list[str]:
    plan_id = validate_plan_id(plan_id, allow_free=False)
    p = _plan(plan_id)
    codes: list[str] = []
    for _ in range(max(1, min(count, 500))):
        code = secrets.token_hex(6).upper()
        db.add(
            RedeemCode(id=uid("rc_"), code=code, plan_id=plan_id, plan_name=p["name"], created_by=actor)
        )
        codes.append(code)
    await db.commit()
    return codes


async def list_codes(db: AsyncSession) -> list[RedeemCode]:
    r = await db.execute(select(RedeemCode).order_by(RedeemCode.created_at.desc()))
    return list(r.scalars().all())
