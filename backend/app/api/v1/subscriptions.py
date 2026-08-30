"""订阅路由：学员查看/兑换/下单/微信支付回调；管理员开通/审批/卡密。"""

import json
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser, require_role
from app.core.security import uid
from app.db.session import get_db
from app.models.subscription import SubscriptionOrder
from app.models.user import User
from app.schemas.subscription import (
    AdminOrderCancellationRequest,
    AdminSubscriptionUpdate,
    RedeemCodeGenerationRequest,
    RedeemCodeStatusUpdate,
)
from app.services import subscription_service, system_service, wechat_pay_service

router = APIRouter(prefix="/subscriptions", tags=["subscriptions"])
DB = Annotated[AsyncSession, Depends(get_db)]
AdminUser = Annotated[User, Depends(require_role("admin"))]


@router.get("/me")
async def my_subscription(db: DB, user: CurrentUser):
    subscription = await subscription_service.get_subscription(db, user.username)
    return {
        "subscription": subscription_service.sub_to_dict(subscription),
        "entitlements": subscription_service.entitlements_for(user.role, subscription),
    }


@router.get("/plans")
async def plans(db: DB):
    """公开展示数据库中的套餐配置；下单仍要求已登录的学员。"""
    return {"plans": await system_service.get_subscription_plans(db)}


@router.post("/redeem")
async def redeem(body: dict, db: DB, user: CurrentUser):
    try:
        s = await subscription_service.redeem(db, user.username, body.get("code", ""))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"subscription": subscription_service.sub_to_dict(s)}


@router.post("/orders")
async def create_order(body: dict, db: DB, user: CurrentUser):
    try:
        o = await subscription_service.request_order(
            db, user.username, body.get("planId", "free")
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return {"order": subscription_service.order_to_dict(o)}


@router.get("/orders/{order_id}/status")
async def order_status(order_id: str, db: DB, user: CurrentUser):
    """前端轮询订单支付状态。"""
    o = await db.get(SubscriptionOrder, order_id)
    if not o or o.username != user.username:
        raise HTTPException(status_code=404, detail="订单不存在")
    return {
        "orderId": o.id,
        "payStatus": o.pay_status,
        "status": o.status,
        "subscription": subscription_service.sub_to_dict(
            await subscription_service.get_subscription(db, user.username)
        ),
    }


@router.get("/orders/{order_id}/qrcode")
async def order_qrcode(order_id: str, db: DB, user: CurrentUser):
    """仅订单本人可获取 Native 支付二维码。"""
    o = await db.get(SubscriptionOrder, order_id)
    if not o or o.username != user.username or not o.code_url:
        raise HTTPException(status_code=404, detail="支付二维码不存在")
    return Response(content=wechat_pay_service.native_qrcode_png(o.code_url), media_type="image/png")


@router.post("/orders/{order_id}/self-cancel")
async def self_cancel(order_id: str, db: DB, user: CurrentUser):
    try:
        order = await subscription_service.cancel_own_order(db, order_id, user.username)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return {"order": subscription_service.order_to_dict(order)}


# ---------- 微信支付回调（公开，微信服务器调用；无登录态）----------
@router.post("/wechat-pay/notify")
async def wechat_pay_notify(request: Request, db: DB):
    cfg = await system_service.get_wechat_pay_config(db)
    body = (await request.body()).decode("utf-8")
    timestamp = request.headers.get("Wechatpay-Timestamp", "")
    nonce = request.headers.get("Wechatpay-Nonce", "")
    signature = request.headers.get("Wechatpay-Signature", "")
    if not wechat_pay_service.verify_signature(timestamp, nonce, body, signature, cfg):
        return JSONResponse(status_code=400, content={"code": "FAIL", "message": "验签失败"})
    try:
        payload = json.loads(body)
        plain = wechat_pay_service.decrypt_resource(payload.get("resource", {}), cfg["apiV3Key"])
    except Exception:  # noqa: BLE001
        return JSONResponse(status_code=400, content={"code": "FAIL", "message": "解密失败"})
    if plain.get("trade_state") == "SUCCESS":
        try:
            await subscription_service.activate_paid_order(
                db,
                plain.get("out_trade_no"),
                plain.get("transaction_id"),
                (plain.get("amount") or {}).get("total"),
                validate_amount=True,
            )
        except ValueError:
            return JSONResponse(status_code=400, content={"code": "FAIL", "message": "订单不存在"})
    return {"code": "SUCCESS", "message": "OK"}


@router.post("/wechat-pay/demo-notify")
async def wechat_pay_demo_notify(body: dict, db: DB):
    """演示模式：前端点"模拟支付成功"调此接口直接激活订单（不走微信）。"""
    cfg = await system_service.get_wechat_pay_config(db)
    if not cfg.get("enableDemo"):
        raise HTTPException(status_code=403, detail="演示模式未开启")
    try:
        o = await subscription_service.activate_paid_order(db, body.get("orderId", ""), "demo_txn_" + uid(""))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"code": "SUCCESS", "order": subscription_service.order_to_dict(o)}


# ---------- 管理员 ----------
@router.put("/admin/{username}")
async def admin_set(username: str, body: AdminSubscriptionUpdate, db: DB, _: AdminUser):
    try:
        s = await subscription_service.admin_set(
            db,
            username,
            body.plan_id,
            body.status,
            body.note,
            "admin",
            started_at=body.started_at,
            expires_at=body.expires_at,
            update_started_at="started_at" in body.model_fields_set,
            update_expires_at="expires_at" in body.model_fields_set,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return {"subscription": subscription_service.sub_to_dict(s)}


@router.get("/orders")
async def list_orders(db: DB, _: AdminUser, status: str | None = Query(None)):
    return {"orders": [subscription_service.order_to_dict(o) for o in await subscription_service.list_orders(db, status)]}


@router.post("/orders/{order_id}/approve")
async def approve(order_id: str, db: DB, admin: AdminUser):
    try:
        o = await subscription_service.approve_order(db, order_id, admin.username)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"order": subscription_service.order_to_dict(o)}


@router.post("/orders/{order_id}/cancel")
async def cancel(
    order_id: str, body: AdminOrderCancellationRequest, db: DB, admin: AdminUser
):
    try:
        o = await subscription_service.cancel_order(
            db, order_id, admin.username, body.note
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return {"order": subscription_service.order_to_dict(o)}


@router.get("/redeem-codes")
async def list_codes(db: DB, _: AdminUser):
    return {"codes": [subscription_service.code_to_dict(c) for c in await subscription_service.list_codes(db)]}


@router.post("/redeem-codes/generate")
async def generate_codes(body: RedeemCodeGenerationRequest, db: DB, admin: AdminUser):
    try:
        codes = await subscription_service.generate_codes(
            db,
            body.plan_id,
            body.count,
            admin.username,
            prefix=body.prefix,
            note=body.note,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return {"codes": codes}


@router.patch("/redeem-codes/{code_id}")
async def update_code_status(
    code_id: str, body: RedeemCodeStatusUpdate, db: DB, admin: AdminUser
):
    try:
        code = await subscription_service.update_redeem_code_status(
            db, code_id, body.status, admin.username
        )
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return {"code": subscription_service.code_to_dict(code)}


@router.delete("/redeem-codes/{code_id}")
async def delete_code(code_id: str, db: DB, admin: AdminUser):
    try:
        code = await subscription_service.delete_redeem_code(db, code_id, admin.username)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return {"code": code}
