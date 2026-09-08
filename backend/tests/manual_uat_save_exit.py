"""Provision/revoke three isolated UAT-only identities for the mini HTTP probe.

Provision output contains credentials: pipe directly to the probe, never log it.
No real learner, payment, paper, or production configuration is changed.
"""
import asyncio
import json
import logging
import secrets
import sys
from datetime import timedelta

from sqlalchemy import update

from app.core.security import hash_password, now_utc
from app.db.session import AsyncSessionLocal, engine
from app.models.user import User
from app.models.subscription import Subscription
from app.models.wechat_mini import WechatMiniSession
from app.services.wechat_mini_service import issue_session

logging.getLogger('httpx').setLevel(logging.WARNING)


async def main():
    assert engine.url.database == 'kg_graph_uat', 'Only the isolated UAT database is allowed'
    audit = sys.argv[1:] == ['--audit']
    if len(sys.argv) > 1 and not audit:
        names = sys.argv[1:]
        import re
        assert len(names) == 3 and all(re.fullmatch(r'mini_uat_save_[a-f0-9]{12}_[012]', n) for n in names)
        async with AsyncSessionLocal() as db:
            await db.execute(update(WechatMiniSession).where(WechatMiniSession.username.in_(names)).values(revoked_at=now_utc()))
            await db.execute(update(User).where(User.username.in_(names), User.source == 'uat-selftest').values(status='archived', archived_at=now_utc()))
            await db.commit()
        print('Test tokens revoked; three test identities archived, records retained')
        return
    prefix = 'mini_uat_save_' + secrets.token_hex(6)
    accounts = []
    async with AsyncSessionLocal() as db:
        for index in range(3):
            username = prefix + '_' + str(index)
            assert await db.get(User, username) is None
            password = secrets.token_urlsafe(32)
            user = User(username=username, password_hash=hash_password(password),
                        role='student', status='active', source='uat-selftest', display_name='UAT 保存退出自检',
                        legal_consent_version='2026-08-13-v1', legal_consent_at=now_utc())
            db.add(user)
            await db.commit()
            await db.refresh(user)
            plan, status, days = [('free', 'active', 0), ('monthly', 'active', 30), ('monthly', 'expired', -1)][index] if audit else ('free', 'active', 0)
            db.add(Subscription(username=username, plan_id=plan, status=status,
                                expires_at=now_utc()+timedelta(days=days) if days else None,
                                source='uat-selftest', note=prefix))
            await db.commit()
            await db.refresh(user)
            first = await issue_session(db, user, {'platform': 'uat-selftest'})
            second = await issue_session(db, user, {'platform': 'uat-selftest-second-client'})
            accounts.append({'username': username, 'token': first.token, 'secondToken': second.token,
                             'plan': plan, 'status': status, 'entitled': plan != 'free' and days > 0,
                             **({'password': password} if audit else {})})
    print(json.dumps({'base': 'https://uat.aihuanpu.com', 'accounts': accounts}))


asyncio.run(main())
