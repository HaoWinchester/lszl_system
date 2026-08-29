"""订阅、订阅订单、卡密模型。订阅记录按 username 一对一。"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Subscription(Base):
    """学员订阅记录（每用户一条）。"""

    __tablename__ = "subscriptions"

    username: Mapped[str] = mapped_column(String(64), ForeignKey("users.username"), primary_key=True)
    plan_id: Mapped[str] = mapped_column(String(32), default="free")
    status: Mapped[str] = mapped_column(String(16), default="active")  # active/expired/paused
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)  # None=永久
    source: Mapped[str] = mapped_column(String(32), default="default")
    order_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class SubscriptionOrder(Base):
    """学员订阅订单（管理员审批 或 微信支付）。"""

    __tablename__ = "subscription_orders"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    username: Mapped[str] = mapped_column(String(64), ForeignKey("users.username"), nullable=False, index=True)
    plan_id: Mapped[str] = mapped_column(String(32), nullable=False)
    plan_name: Mapped[str] = mapped_column(String(64), default="")
    status: Mapped[str] = mapped_column(String(16), default="pending")  # pending/approved/cancelled
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # 微信支付相关（可空，兼容管理员审批流程的老订单）
    prepay_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    code_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    transaction_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    pay_status: Mapped[str | None] = mapped_column(String(16), nullable=True)  # pending/paid/refunded
    amount: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 分
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    pay_method: Mapped[str | None] = mapped_column(String(32), nullable=True)


class RedeemCode(Base):
    """会员卡密。"""

    __tablename__ = "subscription_redeem_codes"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)
    plan_id: Mapped[str] = mapped_column(String(32), nullable=False)
    plan_name: Mapped[str] = mapped_column(String(64), default="")
    status: Mapped[str] = mapped_column(String(16), default="unused")  # unused/used/disabled
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    used_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_by: Mapped[str] = mapped_column(String(64), default="admin")
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
