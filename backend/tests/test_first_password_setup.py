"""First password setup requires recent, account-bound website WeChat proof."""
import asyncio
from base64 import b64encode
from datetime import timedelta
import json
from uuid import uuid4

from fastapi.testclient import TestClient
from itsdangerous import TimestampSigner
import pytest

from app.core.config import settings
from app.core.security import hash_password, now_utc
from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.user import User
from app.services import wechat_service


@pytest.fixture
def account():
    username = 'first_password_' + uuid4().hex[:10]
    async def create():
        async with AsyncSessionLocal() as db:
            db.add(User(username=username, password_hash='', role='student', status='active',
                        tags=[], wechat={'openid': username}))
            await db.commit()
    asyncio.run(create())
    yield username
    async def remove():
        async with AsyncSessionLocal() as db:
            user = await db.get(User, username)
            if user:
                await db.delete(user)
                await db.commit()
    asyncio.run(remove())


def session(client, username, proof=None):
    value = {'username': username, 'login_session_id': 'test-session'}
    if proof is not None:
        value['wechat_password_proof'] = proof
    signed = TimestampSigner(settings.SECRET_KEY).sign(b64encode(json.dumps(value).encode())).decode()
    client.cookies.set(settings.SESSION_COOKIE_NAME, signed)


def proof(username, age=0):
    return {'username': username, 'authenticated_at': (now_utc() - timedelta(seconds=age)).timestamp()}


def test_recent_same_account_wechat_proof_allows_first_password(account):
    client = TestClient(app)
    session(client, account, proof(account, 599))
    result = client.put('/api/v1/auth/me', json={'new_password': 'new-pass-123'})
    assert result.status_code == 200, result.text
    assert result.json()['user']['has_password'] is True
    assert client.post('/api/v1/auth/login', json={'username': account, 'password': 'new-pass-123'}).status_code == 200


@pytest.mark.parametrize('kind', ['missing', 'expired', 'other-account', 'future', 'malformed'])
def test_untrusted_or_stale_session_cannot_set_first_password(account, kind):
    cases = {'missing': None, 'expired': proof(account, 601), 'other-account': proof('someone-else'),
             'future': proof(account, -60), 'malformed': {'username': account, 'authenticated_at': 'bad'}}
    client = TestClient(app)
    session(client, account, cases[kind])
    response = client.put('/api/v1/auth/me', json={'new_password': 'new-pass-123'})
    assert response.status_code == 400
    assert '重新微信登录' in response.json()['detail']
    assert client.get('/api/v1/auth/me').json()['user']['has_password'] is False
    assert client.put('/api/v1/auth/me', json={'display_name': '资料仍可更新'}).status_code == 200


def test_existing_password_still_requires_current_password_with_recent_proof(account):
    async def set_password():
        async with AsyncSessionLocal() as db:
            user = await db.get(User, account)
            user.password_hash = hash_password('old-pass-123')
            await db.commit()
    asyncio.run(set_password())
    client = TestClient(app)
    session(client, account, proof(account))
    for current in [None, 'wrong']:
        response = client.put('/api/v1/auth/me', json={'new_password': 'new-pass-123', 'current_password': current})
        assert response.status_code == 400
        assert response.json()['detail'] == '当前密码不正确'
    assert client.put('/api/v1/auth/me', json={'new_password': 'new-pass-123', 'current_password': 'old-pass-123'}).status_code == 200


def test_real_wechat_callback_issues_first_password_proof(account, monkeypatch):
    monkeypatch.setattr(settings, 'WECHAT_ENABLE_OFFICIAL', True)
    monkeypatch.setattr(settings, 'WECHAT_APP_ID', 'test-app')
    monkeypatch.setattr(settings, 'WECHAT_APP_SECRET', 'mock-only')
    async def exchange(_config, _code):
        return {'openid': account, 'access_token': 'mock-only'}
    async def userinfo(*_args):
        return {}
    monkeypatch.setattr(wechat_service, 'exchange_code', exchange)
    monkeypatch.setattr(wechat_service, 'fetch_userinfo', userinfo)
    client = TestClient(app)
    start = client.get('/api/v1/auth/wechat/auth-url')
    callback = client.get('/api/v1/auth/wechat/callback', params={'state': start.json()['state'], 'code': 'valid'}, follow_redirects=False)
    assert 'login-success' in callback.headers['location']
    result = client.put('/api/v1/auth/me', json={'new_password': 'new-pass-123'})
    assert result.status_code == 200, result.text
    # Password now exists: replaying a WeChat proof must not bypass the old password.
    assert client.put('/api/v1/auth/me', json={'new_password': 'another-pass'}).status_code == 400


def test_new_wechat_account_choice_allows_first_password(monkeypatch):
    openid = 'new-' + uuid4().hex
    username = wechat_service._wx_username(openid)
    monkeypatch.setattr(settings, 'WECHAT_ENABLE_OFFICIAL', True)
    monkeypatch.setattr(settings, 'WECHAT_APP_ID', 'test-app')
    monkeypatch.setattr(settings, 'WECHAT_APP_SECRET', 'mock-only')
    async def exchange(*_args):
        return {'openid': openid, 'access_token': 'mock-only'}
    async def userinfo(*_args):
        return {}
    monkeypatch.setattr(wechat_service, 'exchange_code', exchange)
    monkeypatch.setattr(wechat_service, 'fetch_userinfo', userinfo)
    client = TestClient(app)
    start = client.get('/api/v1/auth/wechat/auth-url')
    callback = client.get('/api/v1/auth/wechat/callback', params={'state': start.json()['state'], 'code': 'valid'}, follow_redirects=False)
    assert 'account-required' in callback.headers['location']
    created = client.post('/api/v1/auth/wechat/account', json={'action': 'create'})
    assert created.status_code == 200, created.text
    try:
        assert client.put('/api/v1/auth/me', json={'new_password': 'new-pass-123'}).status_code == 200
        assert client.post('/api/v1/auth/logout').status_code == 200
        assert client.put('/api/v1/auth/me', json={'new_password': 'changed'}).status_code == 401
    finally:
        async def remove():
            async with AsyncSessionLocal() as db:
                user = await db.get(User, username)
                if user:
                    await db.delete(user)
                    await db.commit()
        asyncio.run(remove())


def test_bearer_transport_cannot_borrow_browser_proof(account):
    from starlette.requests import Request
    from app.core.auth import has_recent_wechat_password_proof
    request = Request({'type': 'http', 'session': {'wechat_password_proof': proof(account)}})
    request.state.auth_transport = 'bearer'
    assert has_recent_wechat_password_proof(request, account) is False


def test_demo_login_does_not_issue_password_setup_proof(monkeypatch):
    from base64 import b64decode
    monkeypatch.setattr(settings, 'WECHAT_ENABLE_DEMO', True)
    client = TestClient(app)
    assert client.post('/api/v1/auth/wechat/demo-login').status_code == 200
    encoded = TimestampSigner(settings.SECRET_KEY).unsign(client.cookies.get(settings.SESSION_COOKIE_NAME))
    assert 'wechat_password_proof' not in json.loads(b64decode(encoded))


def test_stale_parallel_first_password_request_cannot_replace_password(account):
    from app.schemas.auth import SelfProfileUpdate
    from app.services import user_service
    async def scenario():
        async with AsyncSessionLocal() as first, AsyncSessionLocal() as second:
            user1 = await first.get(User, account)
            user2 = await second.get(User, account)
            await user_service.update_self_profile(first, user1, SelfProfileUpdate(new_password='first-password'), recent_wechat_auth=True)
            with pytest.raises(ValueError, match='当前密码不正确'):
                await user_service.update_self_profile(second, user2, SelfProfileUpdate(new_password='replacement-password'), recent_wechat_auth=True)
    asyncio.run(scenario())
