"""Referral attribution in the existing per-process disposable PostgreSQL DB."""
import asyncio
import os
import pytest
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import text

from app.main import app
from app.db.session import AsyncSessionLocal

PREFIX='/api/v1/auth'

def signup(client, *, username=None, code=None):
    name=username or 'referral_'+uuid4().hex[:16]
    payload={'username':name,'password':'test-only-password'}
    if code is not None: payload['referralCode']=code
    return name,client.post(PREFIX+'/register',json=payload)

def stored(sql,params=None):
    async def query():
        async with AsyncSessionLocal() as db:
            return (await db.execute(text(sql),params or {})).all()
    return asyncio.run(query())

def test_referral_requires_login_and_never_binds_existing_accounts():
    with TestClient(app) as client:
        assert client.get(PREFIX+'/me/referral').status_code==401
        assert client.post(PREFIX+'/me/referral').status_code==401
        name,response=signup(client);assert response.status_code==200
        assert client.put(PREFIX+'/me',json={'referralCode':'ABCDEF1234567890'}).status_code==422
        assert client.post(PREFIX+'/me/referral/bind',json={'referralCode':'ABCDEF1234567890'}).status_code in (404,405)
        assert client.get(PREFIX+'/me/referral').json()=={'code':None,'registeredCount':0,'rewardEnabled':True,'rewardDays':7}

def test_code_is_random_unique_persistent_and_summary_contains_no_invitee_identity():
    with TestClient(app) as inviter,TestClient(app) as invitee:
        owner,result=signup(inviter);assert result.status_code==200
        own=inviter.post(PREFIX+'/me/referral');assert own.status_code==200,own.text
        body=own.json();code=body['code'];assert len(code)==16 and owner not in code
        assert inviter.post(PREFIX+'/me/referral').json()['code']==code
        child,result=signup(invitee,code='  '+code.lower()+'  ');assert result.status_code==200,result.text
        result=inviter.get(PREFIX+'/me/referral?username='+child)
        assert result.json()=={'code':code,'registeredCount':1,'rewardEnabled':True,'rewardDays':7}
        assert child not in result.text
        assert invitee.get(PREFIX+'/me/referral').json()['registeredCount']==0
        child_code=invitee.post(PREFIX+'/me/referral').json()['code'];assert child_code!=code
        assert stored('SELECT inviter_username FROM referral_bindings WHERE invitee_username=:name',{'name':child})==[(owner,)]
        assert stored('SELECT count(*) FROM subscription_orders WHERE username=:name',{'name':owner})==[(0,)]
        assert stored('SELECT count(*) FROM subscriptions WHERE username=:name AND plan_id != :plan',{'name':owner,'plan':'free'})==[(1,)]
        inviter.post(PREFIX+'/logout')
        assert inviter.get(PREFIX+'/me/referral').status_code==401
        inviter.post(PREFIX+'/login',json={'username':owner,'password':'test-only-password'})
        assert inviter.get(PREFIX+'/me/referral').json()['code']==code

def test_invalid_code_rolls_back_new_user_and_binding_and_does_not_login():
    with TestClient(app) as client:
        for code in ['NOT-A-CODE','0123456789ABCDEF']:
            name,response=signup(client,code=code)
            assert response.status_code==400,response.text
            assert stored('SELECT username FROM users WHERE username=:name',{'name':name})==[]
            assert client.get(PREFIX+'/me').status_code==401

def test_duplicate_registration_cannot_reassign_attribution():
    with TestClient(app) as one,TestClient(app) as two,TestClient(app) as child:
        a,result=signup(one);assert result.status_code==200
        b,result=signup(two);assert result.status_code==200
        ca=one.post(PREFIX+'/me/referral').json()['code'];cb=two.post(PREFIX+'/me/referral').json()['code']
        name,result=signup(child,code=ca);assert result.status_code==200
        _,result=signup(child,username=name,code=cb);assert result.status_code==400
        assert stored('SELECT inviter_username FROM referral_bindings WHERE invitee_username=:name',{'name':name})==[(a,)]
        assert two.get(PREFIX+'/me/referral').json()['registeredCount']==0

def test_binding_failure_after_user_flush_rolls_back_whole_registration(monkeypatch):
    from app.services import referral_service
    original = referral_service.bind_registration
    async def fail_after_bind(db,user,code):
        await original(db,user,code)
        raise ValueError('绑定暂不可用，请重试')
    with TestClient(app) as inviter,TestClient(app) as client:
        owner,response=signup(inviter);assert response.status_code==200
        code=inviter.post(PREFIX+'/me/referral').json()['code']
        monkeypatch.setattr(referral_service,'bind_registration',fail_after_bind)
        name,response=signup(client,code=code)
        assert response.status_code==400
        assert stored('SELECT username FROM users WHERE username=:name',{'name':name})==[]
        assert stored('SELECT invitee_username FROM referral_bindings WHERE invitee_username=:name',{'name':name})==[]
        assert inviter.get(PREFIX+'/me/referral').json()['registeredCount']==0
        assert stored('SELECT count(*) FROM subscriptions WHERE username=:name',{'name':owner})==[(0,)]
        assert stored('SELECT count(*) FROM subscriptions WHERE username=:name',{'name':name})==[(0,)]
        assert client.get(PREFIX+'/me').status_code==401

def test_service_and_database_reject_self_referrals_and_repeat_bindings():
    from app.services import referral_service
    from app.models.user import User
    from sqlalchemy import select
    from sqlalchemy.exc import IntegrityError
    with TestClient(app) as owner,TestClient(app) as child:
        name,result=signup(owner);assert result.status_code==200
        code=owner.post(PREFIX+'/me/referral').json()['code']
        child_name,result=signup(child,code=code);assert result.status_code==200
        async def verify():
            async with AsyncSessionLocal() as db:
                user=(await db.execute(select(User).where(User.username==name))).scalar_one()
                import pytest
                with pytest.raises(ValueError,match='自己'):
                    await referral_service.bind_registration(db,user,code)
                user=(await db.execute(select(User).where(User.username==child_name))).scalar_one()
                with pytest.raises(ValueError,match='绑定'):
                    await referral_service.bind_registration(db,user,code)
                with pytest.raises(IntegrityError):
                    await db.execute(text('INSERT INTO referral_bindings(invitee_username,inviter_username) VALUES (:name,:name)'),{'name':name})
                await db.rollback()
        asyncio.run(verify())

def test_concurrent_code_requests_return_one_database_identity():
    with TestClient(app) as client:
        name,result=signup(client);assert result.status_code==200
        cookies=dict(client.cookies)
        def generate(_):
            with TestClient(app) as parallel:
                parallel.cookies.update(cookies)
                response=parallel.post(PREFIX+'/me/referral')
                assert response.status_code==200,response.text
                return response.json()['code']
        with ThreadPoolExecutor(max_workers=4) as pool:
            codes=list(pool.map(generate,range(4)))
        assert len(set(codes))==1
        assert stored('SELECT count(*) FROM referral_codes WHERE username=:name',{'name':name})==[(1,)]


def test_random_code_collision_retries_without_losing_transaction(monkeypatch):
    from app.services import referral_service
    with TestClient(app) as first,TestClient(app) as second:
        _,response=signup(first);assert response.status_code==200
        existing=first.post(PREFIX+'/me/referral').json()['code']
        _,response=signup(second);assert response.status_code==200
        candidates=iter([existing.lower(),'deadbeef01234567'])
        monkeypatch.setattr(referral_service.secrets,'token_hex',lambda _: next(candidates))
        response=second.post(PREFIX+'/me/referral')
        assert response.status_code==200,response.text
        assert response.json()['code']=='DEADBEEF01234567'


def test_paused_inviter_code_does_not_create_an_account():
    with TestClient(app) as inviter,TestClient(app) as child:
        owner,response=signup(inviter);assert response.status_code==200
        code=inviter.post(PREFIX+'/me/referral').json()['code']
        async def pause():
            async with AsyncSessionLocal() as db:
                await db.execute(text("UPDATE users SET status='paused' WHERE username=:name"),{'name':owner})
                await db.commit()
        asyncio.run(pause())
        name,response=signup(child,code=code)
        assert response.status_code==400
        assert stored('SELECT username FROM users WHERE username=:name',{'name':name})==[]


@pytest.mark.skipif(os.environ.get("KG_REFERRAL_BROWSER") != "1", reason="Browser runtime is opt-in: KG_REFERRAL_BROWSER=1")
def test_referral_source_dialogs_against_isolated_api():
    """Real browser + source modules + actual disposable DB, never active release."""
    import socket
    import subprocess
    import threading
    import time
    import uvicorn
    from pathlib import Path
    sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
    server=uvicorn.Server(uvicorn.Config(app,log_level='error',lifespan='off'))
    thread=threading.Thread(target=server.run,kwargs={'sockets':[sock]},daemon=True);thread.start()
    try:
        for _ in range(100):
            if server.started: break
            time.sleep(.02)
        assert server.started
        script=Path(__file__).resolve().parents[2]/'new-legacy/tests/referral-browser.py'
        result=subprocess.run(['python3',str(script),'--base-url',f'http://127.0.0.1:{port}'],capture_output=True,text=True,timeout=120)
        assert result.returncode==0,result.stdout+'\n'+result.stderr
    finally:
        server.should_exit=True;thread.join(timeout=10);sock.close()
