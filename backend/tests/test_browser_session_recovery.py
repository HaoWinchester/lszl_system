"""Active browser renewal must never authenticate a revoked signed cookie."""
import asyncio
from base64 import b64encode
import json
import time
from unittest.mock import patch
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient
from itsdangerous import TimestampSigner
from sqlalchemy import select

from app.core.config import settings
from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.user import UserAdminLog


COOKIE = settings.SESSION_COOKIE_NAME
REFRESH = '/api/v1/auth/refresh'


def login(client):
    response = client.post('/api/v1/auth/login', json={'username': '老师', 'password': '111111'})
    assert response.status_code == 200, response.text
    return response.json()['loginSessionId']


def install_cookie(client, cookie):
    client.cookies.clear()
    client.cookies.set(COOKIE, cookie, domain='testserver.local')


def legacy_cookie():
    return TimestampSigner(settings.SECRET_KEY).sign(b64encode(json.dumps({'username': 'admin', 'nonce': uuid4().hex}).encode())).decode()


def test_active_refresh_extends_cookie_lifetime_without_rotating_identity():
    now = int(time.time())
    with TestClient(app) as client:
        with patch.object(TimestampSigner, 'get_timestamp', return_value=now - 6 * 86400):
            identity = login(client)
            original = client.cookies.get(COOKIE)
        with patch.object(TimestampSigner, 'get_timestamp', return_value=now - 86400):
            read = client.get('/api/v1/auth/me')
            assert 'set-cookie' not in read.headers
            renewed = client.post(REFRESH)
            assert renewed.status_code == 200, renewed.text
            assert renewed.json() == {'ok': True, 'loginSessionId': identity, 'expiresIn': settings.SESSION_MAX_AGE_SECONDS}
            assert renewed.headers['cache-control'] == 'no-store'
            assert 'httponly' in renewed.headers['set-cookie'].lower()
            refreshed = client.cookies.get(COOKIE)
        with patch.object(TimestampSigner, 'get_timestamp', return_value=now + 2 * 86400):
            assert client.get('/api/v1/auth/me').status_code == 200
            install_cookie(client, original)
            assert client.get('/api/v1/auth/me').status_code == 401
            install_cookie(client, refreshed)
            assert client.get('/api/v1/auth/me').json()['loginSessionId'] == identity


def test_refresh_requires_authenticated_active_cookie():
    with TestClient(app) as client:
        assert client.post(REFRESH).status_code == 401
        assert 'set-cookie' not in client.post(REFRESH).headers
        login(client)
        cookie = client.cookies.get(COOKIE)
        client.post('/api/v1/auth/logout')
        install_cookie(client, cookie)
        assert client.post(REFRESH).status_code == 401
        assert client.get('/api/v1/auth/me').status_code == 401


def test_replacement_revokes_only_presented_browser_session():
    with TestClient(app) as first, TestClient(app) as other:
        first_identity = login(first)
        old = first.cookies.get(COOKIE)
        other_identity = login(other)
        replacement = login(first)
        assert replacement != first_identity
        assert other.get('/api/v1/auth/me').json()['loginSessionId'] == other_identity
        install_cookie(first, old)
        assert first.get('/api/v1/auth/me').status_code == 401
        assert first.post(REFRESH).status_code == 401


def test_legacy_cookie_logout_revokes_old_and_upgraded_versions():
    with TestClient(app) as client:
        original = legacy_cookie()
        install_cookie(client, original)
        identity = client.get('/api/v1/auth/me').json()['loginSessionId']
        upgraded = client.cookies.get(COOKIE)
        install_cookie(client, original)
        client.post('/api/v1/auth/logout')
        for cookie in (original, upgraded):
            install_cookie(client, cookie)
            assert client.get('/api/v1/auth/me').status_code == 401
            page = client.get('/index.html')
            assert page.status_code == 200, page.text
            assert '"authenticated":false' in page.text
        assert identity


def test_late_refresh_after_logout_or_replacement_cannot_authenticate():
    asyncio.run(_late_refresh(False))
    asyncio.run(_late_refresh(True))


async def _late_refresh(replace):
    started, finish = asyncio.Event(), asyncio.Event()

    async def delayed_app(scope, receive, send):
        async def delayed_send(message):
            if scope.get('path') == REFRESH and message['type'] == 'http.response.start':
                started.set()
                await finish.wait()
            await send(message)
        await app(scope, receive, delayed_send)

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=delayed_app), base_url='http://test') as client:
        result = await client.post('/api/v1/auth/login', json={'username': '老师', 'password': '111111'})
        assert result.status_code == 200
        pending = asyncio.create_task(client.post(REFRESH))
        await asyncio.wait_for(started.wait(), 5)
        if replace:
            assert (await client.post('/api/v1/auth/login', json={'username': '老师', 'password': '111111'})).status_code == 200
        else:
            assert (await client.post('/api/v1/auth/logout')).status_code == 200
        finish.set()
        renewed = await pending
        assert renewed.status_code == 200
        assert 'set-cookie' in renewed.headers
        assert (await client.get('/api/v1/auth/me')).status_code == 401
        assert (await client.post(REFRESH)).status_code == 401


def test_logout_diagnostics_keep_only_allowlisted_context():
    request_id = str(uuid4())
    with TestClient(app) as client:
        login(client)
        response = client.post('/api/v1/auth/logout', headers={
            'X-KG-Page': '/question-training.html?password=secret#token',
            'X-KG-Entry': 'account-menu', 'X-Request-ID': request_id,
            'Authorization': 'Bearer must-not-log',
        })
        assert response.status_code == 200
    async def detail():
        async with AsyncSessionLocal() as db:
            return (await db.scalars(select(UserAdminLog.detail).where(UserAdminLog.action == 'logout', UserAdminLog.detail.contains(request_id)).order_by(UserAdminLog.at.desc()).limit(1))).one()
    value = asyncio.run(detail())
    assert request_id in value
    assert '/question-training.html' in value
    assert 'account-menu' in value
    assert 'secret' not in value and 'token' not in value and 'must-not-log' not in value


def test_legacy_identity_survives_cookie_mutation_before_logout():
    # Account cancellation writes a legacy signed cookie before visiting /me.
    with TestClient(app) as client:
        payload = {'username': 'admin', 'wechat_account': {'ticket': 'already-gone'}}
        original = TimestampSigner(settings.SECRET_KEY).sign(b64encode(json.dumps(payload).encode())).decode()
        install_cookie(client, original)
        response = client.delete('/api/v1/auth/wechat/account')
        assert response.status_code == 200, response.text
        assert 'set-cookie' in response.headers
        client.post('/api/v1/auth/logout')
        install_cookie(client, original)
        assert client.get('/api/v1/auth/me').status_code == 401


def test_browser_refresh_does_not_renew_a_mini_bearer_or_change_cookie_identity():
    from app.models.user import User
    from app.services import wechat_mini_service

    async def issue():
        async with AsyncSessionLocal() as db:
            user = await db.get(User, '学生')
            return await wechat_mini_service.issue_session(db, user, {'platform': 'test'})
    issued = asyncio.run(issue())
    with TestClient(app) as client:
        browser_id = login(client)
        result = client.post(REFRESH, headers={'Authorization': f'Bearer {issued.token}'})
        assert result.status_code == 400
        assert 'set-cookie' not in result.headers
        assert client.get('/api/v1/auth/me').json()['loginSessionId'] == browser_id
        bearer = client.get('/api/v1/auth/me', headers={'Authorization': f'Bearer {issued.token}', 'X-KG-Login-Session-ID': 'stale-browser'})
        assert bearer.status_code == 200
        assert bearer.json()['loginSessionId'] == issued.login_session_id


def test_logout_diagnostics_reject_arbitrary_values():
    from starlette.requests import Request
    from app.api.v1.auth import _logout_detail

    request = Request({'type': 'http', 'headers': [
        (b'x-kg-page', b'http://[secret?token=secret'),
        (b'x-kg-entry', b'secret-cookie'),
        (b'x-request-id', b'secret-password'),
    ]})
    detail = _logout_detail(request)
    assert 'secret' not in detail
    assert detail.count('unknown') == 3


@pytest.mark.parametrize('state', ['revoked', 'inactive'])
@pytest.mark.parametrize('path', [REFRESH, '/index.html'])
def test_late_rejection_does_not_delete_replacement_cookie(state, path):
    asyncio.run(_late_rejection(state, path))


async def _late_rejection(state, path):
    from app.models.user import User

    started, finish = asyncio.Event(), asyncio.Event()
    username = 'rejected_' + uuid4().hex[:12]

    async def delayed_app(scope, receive, send):
        async def delayed_send(message):
            if scope.get('path') == path and message['type'] == 'http.response.start':
                started.set()
                await finish.wait()
            await send(message)
        await app(scope, receive, delayed_send)

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=delayed_app), base_url='http://test') as client:
        registered = await client.post('/api/v1/auth/register', json={'username': username, 'password': 'test-password'})
        assert registered.status_code == 200
        original = client.cookies.get(COOKIE)
        if state == 'revoked':
            await client.post('/api/v1/auth/logout')
        else:
            async with AsyncSessionLocal() as db:
                user = await db.get(User, username)
                user.status = 'paused'
                await db.commit()
        pending = asyncio.create_task(client.request('POST' if path == REFRESH else 'GET', path,
            headers={'Cookie': f'{COOKIE}={original}'}))
        await asyncio.wait_for(started.wait(), 5)
        replacement = await client.post('/api/v1/auth/login', json={'username': '老师', 'password': '111111'})
        assert replacement.status_code == 200
        finish.set()
        rejected = await pending
        assert rejected.status_code == (401 if path == REFRESH else 200)
        assert 'set-cookie' not in rejected.headers
        current = await client.get('/api/v1/auth/me')
        assert current.status_code == 200
        assert current.json()['loginSessionId'] == replacement.json()['loginSessionId']
        if state == 'inactive':
            async with AsyncSessionLocal() as db:
                user = await db.get(User, username)
                user.status = 'active'
                await db.commit()
        # Even a reactivated account must not make the rejected cookie valid.
        replayed = await client.get('/api/v1/auth/me', headers={'Cookie': f'{COOKIE}={original}'})
        assert replayed.status_code == 401


def test_stale_identity_header_cannot_write_progress_into_replacement_account():
    with TestClient(app) as client:
        original = login(client)
        bank = client.post('/api/v1/banks', json={'name': 'session-' + uuid4().hex, 'subject': 'PMP', 'visibility': 'published'})
        assert bank.status_code == 200, bank.text
        question = client.post(f"/api/v1/banks/{bank.json()['bank']['id']}/questions", json={
            'title': 'Session guard', 'stemParts': [{'text': 'Choose A'}],
            'options': [{'id': 'A', 'text': 'A', 'correct': True}], 'correctAnswer': 'A',
        })
        assert question.status_code == 200, question.text
        question_id = question.json()['question']['id']
        assert client.put(f'/api/v1/questions/{question_id}', json={'scope': 'public'}).status_code == 200
        replacement = client.post('/api/v1/auth/login', json={'username': '学生', 'password': '111111'})
        assert replacement.status_code == 200
        identity = replacement.json()['loginSessionId']
        path = f'/api/v1/training/progress/{question_id}'
        rejected = client.put(path, json={'selectedAnswer': 'A'}, headers={'X-KG-Login-Session-ID': original})
        assert rejected.status_code == 401
        assert rejected.json()['detail']['code'] == 'LOGIN_SESSION_CHANGED'
        assert 'set-cookie' not in rejected.headers
        assert client.get(path).json()['progress'] is None
        assert client.get('/api/v1/auth/me').json()['loginSessionId'] == identity
        saved = client.put(path, json={'selectedAnswer': 'A'}, headers={'X-KG-Login-Session-ID': identity})
        assert saved.status_code == 200
        assert saved.json()['progress']['selectedAnswer'] == 'A'
        legacy = client.put(path, json={'selectedAnswer': 'B'})
        assert legacy.status_code == 200
        assert client.get(path).json()['progress']['selectedAnswer'] == 'B'


def test_wechat_account_chooser_revokes_replaced_browser_identity(monkeypatch):
    from app.services import wechat_service

    monkeypatch.setattr(settings, 'WECHAT_ENABLE_OFFICIAL', True)
    monkeypatch.setattr(settings, 'WECHAT_APP_ID', 'test-app')
    monkeypatch.setattr(settings, 'WECHAT_APP_SECRET', 'test-only')
    openid = 'chooser-' + uuid4().hex

    async def exchange(*_args):
        return {'openid': openid, 'access_token': 'test-only'}

    async def userinfo(*_args):
        return {}

    monkeypatch.setattr(wechat_service, 'exchange_code', exchange)
    monkeypatch.setattr(wechat_service, 'fetch_userinfo', userinfo)
    with TestClient(app) as client:
        login(client)
        original = client.cookies.get(COOKIE)
        start = client.get('/api/v1/auth/wechat/auth-url')
        assert start.status_code == 200
        result = client.get('/api/v1/auth/wechat/callback', params={'state': start.json()['state'], 'code': 'valid'}, follow_redirects=False)
        assert 'account-required' in result.headers['location']
        install_cookie(client, original)
        assert client.get('/api/v1/auth/me').status_code == 401


def test_web_bootstrap_remains_cookie_only_with_unrelated_bearer():
    from starlette.requests import Request
    from app.web.bootstrap import optional_user

    async def scenario():
        request = Request({'type': 'http', 'session': {'username': '老师', 'login_session_id': uuid4().hex},
                           'headers': [(b'authorization', b'Bearer unrelated')]})
        async with AsyncSessionLocal() as db:
            user = await optional_user(request, db)
            assert user is not None and user.username == '老师'
    asyncio.run(scenario())
