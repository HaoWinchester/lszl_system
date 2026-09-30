"""Read responses must not restore a cookie after a concurrent logout."""
import asyncio
from base64 import b64encode
import json
from unittest.mock import patch

import httpx
from itsdangerous import TimestampSigner
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from app.main import SessionMiddleware


def test_late_read_response_does_not_restore_logged_out_session():
    asyncio.run(_late_read_response())


async def _late_read_response():
    started, finish = asyncio.Event(), asyncio.Event()

    async def login(request: Request):
        request.session['username'] = 'test-student'
        return JSONResponse({'ok': True})

    async def slow(request: Request):
        assert request.session.get('username') == 'test-student'
        started.set()
        await finish.wait()
        return JSONResponse({'ok': True})

    async def logout(request: Request):
        request.session.clear()
        return JSONResponse({'ok': True})

    async def me(request: Request):
        return JSONResponse({}, status_code=200 if request.session else 401)

    app = Starlette(routes=[Route('/login', login), Route('/slow', slow), Route('/logout', logout), Route('/me', me)])
    app.add_middleware(SessionMiddleware, secret_key='unit-test-only')
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        assert 'set-cookie' in (await client.get('/login')).headers
        pending = asyncio.create_task(client.get('/slow'))
        await asyncio.wait_for(started.wait(), 1)
        assert 'expires=' in (await client.get('/logout')).headers['set-cookie'].lower()
        assert (await client.get('/me')).status_code == 401
        finish.set()
        response = await pending
        assert 'set-cookie' not in response.headers
        assert (await client.get('/me')).status_code == 401


def test_nested_session_updates_preserve_other_response_cookies():
    asyncio.run(_nested_updates())


async def _nested_updates():
    async def view(request: Request):
        if not request.session:
            request.session['proof'] = {'step': 1}
        elif request.query_params.get('change'):
            request.session['proof']['step'] = 2
        response = JSONResponse(request.session)
        response.set_cookie('other', 'unrelated')
        return response

    app = Starlette(routes=[Route('/', view)])
    app.add_middleware(SessionMiddleware, secret_key='unit-test-only')
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        assert len((await client.get('/')).headers.get_list('set-cookie')) == 2
        read = await client.get('/')
        assert read.headers.get_list('set-cookie') == ['other=unrelated; Path=/; SameSite=lax']
        changed = await client.get('/?change=1')
        assert changed.json()['proof']['step'] == 2
        assert len(changed.headers.get_list('set-cookie')) == 2


def test_expired_cookie_is_rejected_and_route_deletion_is_retained():
    asyncio.run(_expiry_and_explicit_deletion())


async def _expiry_and_explicit_deletion():
    async def view(request: Request):
        response = JSONResponse({'authenticated': bool(request.session)})
        if request.url.path == '/delete':
            response.delete_cookie('session')
        return response

    app = Starlette(routes=[Route('/', view), Route('/delete', view)])
    app.add_middleware(SessionMiddleware, secret_key='unit-test-only', max_age=60)
    data = b64encode(json.dumps({'username': 'test-student'}).encode())
    signer = TimestampSigner('unit-test-only')
    with patch.object(TimestampSigner, 'get_timestamp', return_value=1):
        expired = signer.sign(data).decode()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        client.cookies.set('session', expired)
        assert (await client.get('/')).json() == {'authenticated': False}
        client.cookies.set('session', signer.sign(data).decode())
        deleted = await client.get('/delete')
        assert deleted.json() == {'authenticated': True}
        assert len(deleted.headers.get_list('set-cookie')) == 1
        assert 'max-age=0' in deleted.headers['set-cookie'].lower()
