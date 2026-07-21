"""订阅业务逻辑：当前订阅、卡密兑换、订单申请/审批/支付、管理员开通、卡密生成。"""

import secrets
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import DEFAULT_PLANS
from app.core.security import now_utc, uid
from app.models.subscription import RedeemCode, Subscription, SubscriptionOrder
from app.services import system_service, wechat_pay_service

PLAN_AMOUNT_FEN = {
    "monthly": 2900,
    "quarterly": 7900,
    "half_year": 13900,
    "lifetime": 39900,
}


def _plan(plan_id: str) -> dict:
    for p in DEFAULT_PLANS:
        if p["planId"] == plan_id:
            return p
    return DEFAULT_PLANS[0]


def _plan_amount_fen(plan_id: str) -> int:
    return PLAN_AMOUNT_FEN.get(plan_id, 0)


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


async def admin_set(
    db: AsyncSession, username: str, plan_id: str, status: str | None, note: str | None, actor: str
) -> Subscription:
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
    p = _plan(plan_id)
    amount_fen = _plan_amount_fen(plan_id)
    o = SubscriptionOrder(
        id=uid("o_"),
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
    db: AsyncSession, order_id: str, transaction_id: str | None
) -> SubscriptionOrder:
    """支付成功激活订阅（幂等：已 paid 直接返回）。"""
    o = await db.get(SubscriptionOrder, order_id)
    if not o:
        raise ValueError("订单不存在")
    if o.pay_status == "paid":
        return o
    o.pay_status = "paid"
    o.transaction_id = transaction_id
    o.paid_at = now_utc()
    o.status = "approved"
    s = await get_subscription(db, o.username)
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
    o = await db.get(SubscriptionOrder, order_id)
    if not o or o.status != "pending":
        raise ValueError("订单不存在或已处理")
    o.status = "approved"
    o.approved_at = now_utc()
    o.approved_by = actor
    s = await get_subscription(db, o.username)
    _apply_plan(s, o.plan_id)
    s.status = "active"
    s.source = "order"
    s.order_id = o.id
    await db.commit()
    await db.refresh(o)
    return o


async def cancel_order(db: AsyncSession, order_id: str, actor: str) -> SubscriptionOrder:
    o = await db.get(SubscriptionOrder, order_id)
    if not o:
        raise ValueError("订单不存在")
    o.status = "cancelled"
    await db.commit()
    await db.refresh(o)
    return o


async def generate_codes(db: AsyncSession, plan_id: str, count: int, actor: str) -> list[str]:
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
