"""Verify both identities before attaching a website WeChat login to an account."""
import hashlib
import secrets
from datetime import timedelta

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import now_utc, verify_password
from app.models.user import ACTIVE, User
from app.models.subscription import Subscription, SubscriptionOrder
from app.models.wechat_account import WechatAccountTicket
from app.services import wechat_service

class AccountLinkError(ValueError):
    def __init__(self, message: str, status_code: int = 409):
        super().__init__(message)
        self.status_code = status_code


def digest(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()

async def issue(db: AsyncSession, profile: dict, source_username: str | None = None) -> str:
    raw = secrets.token_urlsafe(36)
    await db.execute(delete(WechatAccountTicket).where(WechatAccountTicket.expires_at < now_utc()))
    db.add(WechatAccountTicket(digest=digest(raw), profile=profile, source_username=source_username,
        expires_at=now_utc()+timedelta(minutes=10), attempts=0))
    await db.commit()
    return raw

async def pending(db: AsyncSession, raw: str, username: str | None) -> WechatAccountTicket:
    ticket = (await db.execute(select(WechatAccountTicket).where(
        WechatAccountTicket.digest == digest(raw)).with_for_update())).scalar_one_or_none()
    if (not ticket or ticket.consumed_at or ticket.expires_at <= now_utc() or ticket.attempts >= 5
            or (ticket.source_username and ticket.source_username != username)):
        raise AccountLinkError('微信授权已失效，请重新扫码。', 401)
    return ticket

async def cancel(db: AsyncSession, raw: str) -> None:
    ticket = await db.get(WechatAccountTicket, digest(raw))
    if ticket:
        ticket.consumed_at = now_utc()
        await db.commit()

async def complete(db: AsyncSession, ticket: WechatAccountTicket, action: str,
                   username: str, password: str, cfg: dict) -> User:
    profile = ticket.profile
    # Serialize web identity changes even when distinct OAuth tickets are issued concurrently.
    await wechat_service.lock_identity(db, profile)
    if action == 'create':
        if ticket.source_username:
            raise AccountLinkError('找回原账号时不能创建新账号。')
        if not cfg.get('autoCreateUser', True):
            raise AccountLinkError('当前未开放微信新用户注册，请绑定已有账号。')
        user = await wechat_service.find_or_create_user(db, profile, cfg, 'wechat', commit=False)
        if not user:
            raise AccountLinkError('微信账号创建失败，请重新扫码。')
    else:
        # Lock both accounts in stable order and refresh any session-loaded ORM instance.
        names = sorted({username.strip(), ticket.source_username or ''} - {''})
        users = (await db.execute(select(User).where(User.username.in_(names)).order_by(User.username)
            .with_for_update().execution_options(populate_existing=True))).scalars().all()
        user = next((u for u in users if u.username == username.strip()), None)
        if not user or not verify_password(password, user.password_hash):
            ticket.attempts += 1
            await db.commit()
            raise AccountLinkError('用户名或密码错误，请填写原注册账号。', 401)
        if user.status != ACTIVE:
            raise AccountLinkError('原账号已停用或归档，请联系管理员。', 403)
        previous = user.wechat or {}
        if previous.get('openid') and previous['openid'] != profile['openid']:
            raise AccountLinkError('原账号已绑定其他微信，请联系管理员核对。')
        if previous.get('unionid') and profile.get('unionid') and previous['unionid'] != profile['unionid']:
            raise AccountLinkError('原账号已绑定其他微信，请联系管理员核对。')
        if previous.get('miniOpenid') and not previous.get('openid') and (
            not profile.get('unionid') or previous.get('unionid') != profile['unionid']):
            raise AccountLinkError('无法确认与原账号小程序微信为同一身份，请联系管理员核对。')
        owner = await wechat_service.find_by_wechat_identity(db, profile['openid'], profile.get('unionid', ''))
        if ticket.source_username:
            source = next((u for u in users if u.username == ticket.source_username), None)
            if not source or source.status != ACTIVE or not owner or owner.username != source.username:
                raise AccountLinkError('当前微信绑定已变化，请重新扫码。')
            if source.username != user.username:
                if source.role != 'student' or user.role != 'student':
                    raise AccountLinkError('此账号身份需要管理员人工核对。')
                if (source.wechat or {}).get('miniOpenid'):
                    raise AccountLinkError('当前账号还绑定了小程序微信，请联系管理员人工核对，避免关联错误。')
                subscription = (await db.execute(select(Subscription).where(
                    Subscription.username == source.username).with_for_update()
                    .execution_options(populate_existing=True))).scalar_one_or_none()
                orders = (await db.execute(select(SubscriptionOrder.id).where(
                    SubscriptionOrder.username == source.username)
                    .limit(1))).first()
                if (subscription and subscription.plan_id != 'free') or orders:
                    raise AccountLinkError('当前微信账号有会员或订单，请联系管理员人工核对；双方权益均已保留。')
                # Retain both accounts and their business rows. Move only verified login identifiers.
                source_wechat = source.wechat or {}
                profile = {**source_wechat, **profile,
                           'unionid': profile.get('unionid') or source_wechat.get('unionid', '')}
                source.wechat = None
                await db.flush()
        elif owner and owner.username != user.username:
            raise AccountLinkError('该微信已绑定其他账号，请重新微信登录后使用找回原账号会员。')
        user.wechat = wechat_service._wechat_payload(profile, previous, 'wechat-account-link')
        user.last_login_at = now_utc()
        user.last_active_at = now_utc()
    ticket.consumed_at = now_utc()
    return user
