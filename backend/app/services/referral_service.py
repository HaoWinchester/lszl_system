"""Database-backed referral code issuance and registration attribution.

Mutations flush only: the caller owns the transaction, including registration.
"""
import re
import secrets
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.referral import ReferralBinding, ReferralCode
from app.models.user import ACTIVE, User
from app.core.security import now_utc
from app.services import subscription_service

REFERRAL_REWARD_DAYS = 7


async def summary(db: AsyncSession, username: str) -> dict:
    code = (await db.execute(select(ReferralCode.code).where(ReferralCode.username == username))).scalar_one_or_none()
    count = (await db.execute(select(func.count()).select_from(ReferralBinding).where(ReferralBinding.inviter_username == username))).scalar_one()
    return {'code': code, 'registeredCount': count, 'rewardEnabled': True, 'rewardDays': REFERRAL_REWARD_DAYS}


async def ensure_code(db: AsyncSession, username: str) -> str:
    # Serialize first issuance for the same account; unique(code) also protects
    # independent accounts when their random candidates happen to collide.
    await db.execute(select(User.username).where(User.username == username).with_for_update())
    existing = (await db.execute(select(ReferralCode.code).where(ReferralCode.username == username))).scalar_one_or_none()
    if existing:
        return existing
    for _ in range(5):
        code = secrets.token_hex(8).upper()
        try:
            async with db.begin_nested():
                db.add(ReferralCode(username=username, code=code))
                await db.flush()
            return code
        except IntegrityError:
            continue
    raise ValueError('推荐码生成暂不可用，请重试')


async def bind_registration(db: AsyncSession, user: User, code: str) -> None:
    normalized = str(code or '').strip().upper()
    if not normalized:
        return
    if not re.fullmatch(r'[0-9A-F]{16}', normalized):
        raise ValueError('推荐码无效，请检查或清空后注册')
    inviter = (await db.execute(select(ReferralCode.username).join(User, User.username == ReferralCode.username)
        .where(ReferralCode.code == normalized, User.status == ACTIVE))).scalar_one_or_none()
    if not inviter:
        raise ValueError('推荐码无效，请检查或清空后注册')
    if inviter == user.username:
        raise ValueError('不能使用自己的推荐码')
    if await db.get(ReferralBinding, user.username):
        raise ValueError('该账号已绑定推荐关系')
    db.add(ReferralBinding(invitee_username=user.username, inviter_username=inviter))
    await db.flush()
    await grant_registration_rewards(db, user.username)


async def grant_registration_rewards(db: AsyncSession, invitee_username: str) -> bool:
    """Issue both gifts once; caller commits registration and this receipt together."""
    binding = (await db.execute(select(ReferralBinding)
        .where(ReferralBinding.invitee_username == invitee_username)
        .with_for_update().execution_options(populate_existing=True))).scalar_one_or_none()
    if not binding or binding.rewards_granted_at is not None:
        return False
    granted_at = now_utc()
    for recipient in sorted((binding.inviter_username, binding.invitee_username)):
        await subscription_service.grant_membership_days(
            db, recipient, days=REFERRAL_REWARD_DAYS, source='referral', granted_at=granted_at)
    binding.rewards_granted_at = granted_at
    await db.flush()
    return True
