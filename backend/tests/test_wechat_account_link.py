import asyncio
from datetime import timedelta
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.core.config import settings
from app.core.security import now_utc
from app.db.session import AsyncSessionLocal
from app.models.user import User
from app.models.subscription import Subscription, SubscriptionOrder
from app.services import wechat_service

@pytest.fixture
def flow(monkeypatch):
    key = uuid4().hex[:12]
    profile = {'openid': 'choice_'+key, 'unionid': 'union_'+key, 'nickname': '测试微信'}
    async def exchange(*_): return {**profile, 'access_token': 'mock'}
    async def info(*_): return profile
    monkeypatch.setattr(wechat_service, 'exchange_code', exchange)
    monkeypatch.setattr(wechat_service, 'fetch_userinfo', info)
    for name, value in [('WECHAT_ENABLE_OFFICIAL', True), ('WECHAT_APP_ID', 'test'), ('WECHAT_APP_SECRET', 'mock')]:
        monkeypatch.setattr(settings, name, value)
    with TestClient(app) as client: yield client, key, profile

def register(client, username):
    r = client.post('/api/v1/auth/register', json={'username': username, 'password': 'choice-password'})
    assert r.status_code == 200, r.text
    return r.json()

def scan(client, intent='login'):
    r = client.get('/api/v1/auth/wechat/auth-url', params={'intent': intent, 'return_path': '/index.html'})
    assert r.status_code == 200, r.text
    return client.get('/api/v1/auth/wechat/callback', params={'state': r.json()['state'], 'code': 'mock'}, follow_redirects=False)

def complete(client, action='bind', username='', password='choice-password'):
    return client.post('/api/v1/auth/wechat/account', json={'action': action, 'username': username, 'password': password})

def seed_membership(username, kind='subscription'):
    async def run():
        async with AsyncSessionLocal() as db:
            if kind == 'subscription':
                db.add(Subscription(username=username, plan_id='monthly', expires_at=now_utc()+timedelta(days=20)))
            else:
                db.add(SubscriptionOrder(id=uuid4().hex, username=username, plan_id='monthly', status='pending', pay_status='pending'))
            await db.commit()
    asyncio.run(run())

def test_first_scan_does_not_create_user(flow):
    client, _, profile = flow
    assert 'wechat=account-required' in scan(client).headers['location']
    assert client.get('/api/v1/auth/me').status_code == 401
    r = client.get('/api/v1/auth/wechat/account')
    assert r.status_code == 200 and r.json()['mode'] == 'choose'
    assert profile['openid'] not in r.text and profile['unionid'] not in r.text
    async def check():
        async with AsyncSessionLocal() as db:
            assert await wechat_service.find_by_wechat_identity(db, profile['openid']) is None
    asyncio.run(check())

def test_bind_keeps_membership_and_next_login_skips_choice(flow):
    client, key, _ = flow
    username = 'member_'+key
    register(client, username)
    seed_membership(username)
    client.post('/api/v1/auth/logout')
    scan(client)
    r = complete(client, username=username)
    assert r.status_code == 200, r.text
    assert r.json()['user']['username'] == username
    assert client.get('/api/v1/subscriptions/me').json()['subscription']['planId'] == 'monthly'
    client.post('/api/v1/auth/logout')
    assert 'wechat=login-success' in scan(client).headers['location']
    assert client.get('/api/v1/auth/me').json()['user']['username'] == username
    assert client.get('/api/v1/auth/wechat/account').status_code == 401

def test_explicit_create_and_replay(flow):
    client, _, _ = flow
    scan(client)
    cookies = dict(client.cookies)
    r = complete(client, 'create')
    assert r.status_code == 200, r.text
    username = r.json()['user']['username']
    client.cookies.clear(); client.cookies.update(cookies)
    assert complete(client, 'create').status_code == 401
    client.post('/api/v1/auth/logout'); scan(client)
    assert client.get('/api/v1/auth/me').json()['user']['username'] == username

@pytest.mark.parametrize('attempts', [1, 5])
def test_wrong_password_is_retryable_until_limit(flow, attempts):
    client, key, _ = flow
    username = 'wrong_'+key
    register(client, username); client.post('/api/v1/auth/logout'); scan(client)
    for _ in range(attempts):
        assert complete(client, username=username, password='wrong').status_code == 401
    assert client.get('/api/v1/auth/me').status_code == 401
    assert complete(client, username=username).status_code == (200 if attempts == 1 else 401)

def test_recovery_moves_identity_preserving_both_accounts(flow):
    client, key, profile = flow
    username = 'recover_'+key
    register(client, username); seed_membership(username); client.post('/api/v1/auth/logout'); scan(client)
    r = complete(client, 'create')
    assert r.status_code == 200, r.text
    old = r.json()['user']['username']
    assert 'account-required' in scan(client, 'recover').headers['location']
    r = complete(client, username=username)
    assert r.status_code == 200, r.text
    assert r.json()['user']['username'] == username
    assert client.get('/api/v1/subscriptions/me').json()['subscription']['planId'] == 'monthly'
    async def check():
        async with AsyncSessionLocal() as db:
            source = await db.get(User, old)
            assert source and source.wechat is None
            assert (await wechat_service.find_by_wechat_identity(db, profile['openid'])).username == username
    asyncio.run(check())

@pytest.mark.parametrize('kind', ['subscription', 'pending-order'])
def test_recovery_blocks_source_paid_or_pending_order(flow, kind):
    client, key, _ = flow
    username = 'conflict_'+key
    register(client, username); client.post('/api/v1/auth/logout'); scan(client)
    r = complete(client, 'create')
    assert r.status_code == 200, r.text
    old = r.json()['user']['username']
    seed_membership(old, kind); scan(client, 'recover')
    r = complete(client, username=username)
    assert r.status_code == 409 and '人工' in r.text, r.text
    assert client.get('/api/v1/auth/me').json()['user']['username'] == old

def test_recovery_requires_session_and_matching_wechat(flow):
    client, key, _ = flow
    assert client.get('/api/v1/auth/wechat/auth-url', params={'intent': 'recover'}).status_code == 401
    register(client, 'other_'+key)
    assert 'wechat=bind-failed' in scan(client, 'recover').headers['location']
    assert client.get('/api/v1/auth/wechat/account').status_code == 401

def test_cancel_discards_choice(flow):
    client, _, _ = flow
    scan(client)
    assert client.delete('/api/v1/auth/wechat/account').status_code == 200
    assert complete(client, 'create').status_code == 401


def test_expired_ticket_requires_rescan(flow):
    from app.models.wechat_account import WechatAccountTicket
    from sqlalchemy import update
    client, _, _ = flow
    scan(client)
    async def expire():
        async with AsyncSessionLocal() as db:
            await db.execute(update(WechatAccountTicket).values(expires_at=now_utc()-timedelta(seconds=1)))
            await db.commit()
    asyncio.run(expire())
    assert complete(client, 'create').status_code == 401


def test_target_binding_cannot_be_overwritten(flow):
    client, key, _ = flow
    username='bound_'+key
    register(client, username)
    async def bind():
        async with AsyncSessionLocal() as db:
            user=await db.get(User, username)
            user.wechat={'openid':'different_'+key, 'unionid':'different_union_'+key}
            await db.commit()
    asyncio.run(bind())
    client.post('/api/v1/auth/logout');scan(client)
    assert complete(client, username=username).status_code == 409


def test_web_login_preserves_mini_identity_and_known_unionid(flow):
    client, key, profile=flow
    username='mini_'+key
    register(client, username)
    async def check():
        async with AsyncSessionLocal() as db:
            user=await db.get(User, username)
            user.wechat={**profile, 'miniOpenid':'mini_'+key}
            await db.commit()
            updated=await wechat_service.find_or_create_user(db, {**profile, 'unionid':''}, {}, 'wechat')
            assert updated.wechat['miniOpenid']=='mini_'+key
            assert updated.wechat['unionid']==profile['unionid']
    asyncio.run(check())


def test_two_requests_cannot_consume_one_ticket(flow):
    from concurrent.futures import ThreadPoolExecutor
    client, _, _ = flow
    scan(client)
    cookies=dict(client.cookies)
    def consume():
        with TestClient(app) as other:
            other.cookies.update(cookies)
            return complete(other, 'create').status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(lambda _:consume(), range(2))) == [200, 401]


def test_cancelled_source_session_cannot_finish_recovery(flow):
    client, key, _=flow
    register(client,'original_'+key);client.post('/api/v1/auth/logout');scan(client)
    assert complete(client,'create').status_code == 200
    scan(client,'recover')
    saved_cookies=dict(client.cookies)
    client.post('/api/v1/auth/logout')
    client.cookies.clear();client.cookies.update(saved_cookies)
    assert complete(client,username='original_'+key).status_code == 401


def test_recovery_does_not_move_unverified_mini_identity(flow):
    client,key,_=flow
    username='safe_'+key
    register(client,username);client.post('/api/v1/auth/logout');scan(client)
    source=complete(client,'create').json()['user']['username']
    async def add_mini():
        async with AsyncSessionLocal() as db:
            user=await db.get(User,source)
            user.wechat={**user.wechat,'miniOpenid':'unrelated_mini_'+key}
            await db.commit()
    asyncio.run(add_mini())
    scan(client,'recover')
    result=complete(client,username=username)
    assert result.status_code==409 and '小程序' in result.text
    assert client.get('/api/v1/auth/me').json()['user']['username']==source


def test_recovery_observes_concurrent_subscription_update(flow):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event
    from sqlalchemy import event, update
    from app.db.session import engine
    client,key,_=flow
    username='race_'+key
    register(client,username);client.post('/api/v1/auth/logout');scan(client)
    source=complete(client,'create').json()['user']['username']
    scan(client,'recover')
    reached_lock=Event()
    def observe(_conn,_cursor,statement,_params,_context,_executemany):
        if 'FROM subscriptions' in statement and 'FOR UPDATE' in statement:
            reached_lock.set()
    async def scenario():
        async with AsyncSessionLocal() as db:
            db.add(Subscription(username=source,plan_id='free'))
            await db.commit()
            await db.execute(update(Subscription).where(Subscription.username==source).values(plan_id='monthly'))
            event.listen(engine.sync_engine,'before_cursor_execute',observe)
            try:
                with ThreadPoolExecutor(max_workers=1) as pool:
                    result=pool.submit(complete,client,'bind',username)
                    observed=await asyncio.to_thread(reached_lock.wait,5)
                    await db.commit()
                    response=await asyncio.to_thread(result.result,10)
                    assert observed,'membership guard must lock the subscription row'
                    assert response.status_code==409,response.text
            finally:
                event.remove(engine.sync_engine,'before_cursor_execute',observe)
    asyncio.run(scenario())
