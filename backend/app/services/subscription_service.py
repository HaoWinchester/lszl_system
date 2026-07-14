"""订阅业务逻辑：当前订阅、卡密兑换、订单申请/审批、管理员开通、卡密生成。"""

import secrets
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import DEFAULT_PLANS
from app.core.security import now_utc, uid
from app.models.subscription import RedeemCode, Subscription, SubscriptionOrder


def _plan(plan_id: str) -> dict:
    for p in DEFAULT_PLANS:
        if p["planId"] == plan_id:
            return p
    return DEFAULT_PLANS[0]


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
    p = _plan(plan_id)
    o = SubscriptionOrder(
        id=uid("o_"), username=username, plan_id=plan_id, plan_name=p["name"], status="pending"
    )
    db.add(o)
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
