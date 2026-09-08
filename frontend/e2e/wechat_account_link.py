"""Real API/database + agent-browser matrix; only external WeChat code exchange is stubbed.
Run: python3 frontend/e2e/wechat_account_link.py
All fixtures and browser output stay inside the workspace; DB is disposable.
"""
import asyncio
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
from urllib.request import urlopen
from uuid import uuid4

ROOT=Path(__file__).resolve().parents[2]
BACKEND=ROOT/'backend'
OUT=ROOT/'artifacts/wechat-link'
PAGES=['index.html','practice-mode.html','knowledge-recall.html','question-workspace.html']
SESSION='wechat-account-link'
PASSWORD='Browser-link-123'


def serve():
    sys.path.insert(0,str(BACKEND))
    from app.main import app
    from app.services import wechat_service
    import uvicorn
    async def exchange(_cfg, code):
        assert code.startswith('e2e_')
        return {'openid':code, 'unionid':'union_'+code, 'access_token':'mock'}
    async def info(_cfg, _token, _openid):
        return {'nickname':'浏览器测试微信'}
    wechat_service.exchange_code=exchange
    wechat_service.fetch_userinfo=info
    uvicorn.run(app,host='127.0.0.1',port=int(os.environ['WX_E2E_PORT']),log_level='warning')


def ab(*args):
    r=subprocess.run(['agent-browser','--session',SESSION,*args],cwd=ROOT,text=True,capture_output=True,timeout=45)
    if r.returncode:
        subprocess.run(['agent-browser','--session',SESSION,'screenshot',str(OUT/'failure.png')],capture_output=True)
        state=subprocess.run(['agent-browser','--session',SESSION,'eval',"JSON.stringify({dialogs:[...document.querySelectorAll('dialog[open],.modal-backdrop.show')].map(x=>({id:x.id,cls:x.className,text:x.textContent.slice(0,120)})),button:document.querySelector('#authDoLoginBtn')?.outerHTML,url:location.href})"],text=True,capture_output=True)
        raise AssertionError((r.stderr or r.stdout)+'\n'+state.stdout)
    return r.stdout.strip()


def js(code):
    raw=ab('eval',code)
    try: return json.loads(raw)
    except json.JSONDecodeError: return raw


def wait(code):
    ab('wait','--fn',code)


def click(selector):
    ab('click',selector)


def fill(selector,value):
    ab('fill',selector,value)


def api(path,method='GET',body=None):
    options={'method':method, 'headers':{'Content-Type':'application/json'}}
    if body is not None: options['body']=json.dumps(body)
    return js('(async()=>{const r=await fetch('+json.dumps(path)+','+json.dumps(options)+');return {status:r.status,body:await r.json()}})()')


def oauth(code,intent='login'):
    r=api('/api/v1/auth/wechat/auth-url?intent='+intent+'&return_path=/index.html&accepted_terms_version=2026-08-13-v1')
    assert r['status']==200,r
    ab('open',BASE+'/api/v1/auth/wechat/callback?code='+code+'&state='+r['body']['state'])


def dismiss_chooser():
    if not js("!!window.KGLearningEntryChooser"):
        return
    wait("!!document.querySelector('#learningEntryModal.show')")
    click('#learningEntryDismissBtn')
    wait("!document.querySelector('#learningEntryModal.show')")
    # Entering the graph starts its existing first-use tour; dismiss through its UI.
    if not globals().get('TOUR_DISMISSED') and js("location.pathname.endsWith('/index.html')"):
        wait("!!document.querySelector('.tour-skip')")
        click('.tour-skip')
        globals()['TOUR_DISMISSED']=True


def main():
    global BASE
    OUT.mkdir(parents=True,exist_ok=True)
    database='kg_wx_browser_'+uuid4().hex[:12]
    env=dict(os.environ,DATABASE_URL=f'postgresql+asyncpg://{os.environ.get("USER","menghao")}@/{database}?host=/tmp',
        WECHAT_ENABLE_OFFICIAL='true',WECHAT_APP_ID='e2e',WECHAT_APP_SECRET='mock',WECHAT_ENABLE_DEMO='false',
        NEW_LEGACY_RELEASE_ROOT=str(ROOT/'frontend/new-legacy-releases'))
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
    env['WX_E2E_PORT']=str(port);BASE=f'http://127.0.0.1:{port}'
    process=None
    subprocess.run(['createdb','-h','/tmp',database],check=True)
    try:
        subprocess.run([str(BACKEND/'.venv/bin/python'),'-m','alembic','upgrade','head'],cwd=BACKEND,env=env,check=True,capture_output=True)
        log=(OUT/'browser-server.log').open('w')
        process=subprocess.Popen([str(BACKEND/'.venv/bin/python'),str(Path(__file__).resolve()),'--serve'],cwd=BACKEND,env=env,stdout=log,stderr=log)
        for _ in range(300):
            try:
                if urlopen(BASE+'/api/v1/health',timeout=1).status==200:break
            except OSError:time.sleep(.1)
        else: raise AssertionError('server failed')
        print('isolated browser server ready',flush=True)
        for i,page in enumerate(PAGES):
            ab('open',BASE+'/'+page)
            api('/api/v1/auth/logout','POST')
            ab('open',BASE+'/'+page)
            wait("typeof window.authOpen==='function'")
            js("window.authOpen()")
            wait("document.querySelector('#authModal.show')!==null")
            fill('#authUsername','b_'+database[-12:]+'_'+str(i));fill('#authPassword',PASSWORD)
            ab('check','#authLegalConsent')
            click('#authRegisterBtn')
            wait("!!document.querySelector('.wechat-account-dialog[open] [data-bind]')")
            assert not js("!!document.querySelector('#learningEntryModal.show')")
            if i==0:
                ab('screenshot',str(OUT/'registration-binding.png'))
                # Real bind authorization URL failure is recoverable without losing registration.
                js("window.__wxFetch=window.fetch;window.fetch=(url,...args)=>String(url).includes('/wechat/auth-url')?Promise.resolve(new Response(JSON.stringify({detail:'测试网络失败'}),{status:503})):window.__wxFetch(url,...args)")
                click('[data-bind]')
                wait("document.querySelector('.wechat-account-error')?.textContent.includes('测试网络失败')")
                js('window.fetch=window.__wxFetch')
            click('[data-later]')
            wait("!document.querySelector('.wechat-account-dialog[open]')")
            dismiss_chooser()
            # Click the account menu's logout command, then login using visible credentials.
            js("window.KGAccountMenu?.refresh?.()")
            snapshot=ab('snapshot','-i')
            (OUT/f'page-{i}-snapshot.txt').write_text(snapshot)
            click('[data-account-menu-trigger]')
            ab('snapshot','-i')
            click('[aria-label="退出登录"]')
            wait("!window.KGAuthCore.currentUser()")
            js('window.authOpen()');fill('#authUsername','b_'+database[-12:]+'_'+str(i));fill('#authPassword',PASSWORD)
            ab('check','#authLegalConsent');click('#authDoLoginBtn')
            wait("!!window.KGAuthCore.currentUser()")
            assert not js("!!document.querySelector('.wechat-account-dialog[open]')")
            dismiss_chooser()
            print('register / skip / logout / password-login:',page,flush=True)
        # First-time WeChat must expose choice before creating a user.
        api('/api/v1/auth/logout','POST')
        code='e2e_'+database
        oauth(code)
        wait("!!document.querySelector('.wechat-account-dialog[open] form')")
        assert api('/api/v1/auth/me')['status']==401
        ab('screenshot',str(OUT/'first-wechat-choice.png'))
        fill('.wechat-account-dialog [name=username]','b_'+database[-12:]+'_0')
        fill('.wechat-account-dialog [name=password]','wrong-password')
        click('.wechat-account-dialog button[type=submit]')
        wait("document.querySelector('.wechat-account-error')?.textContent.includes('密码错误')")
        fill('.wechat-account-dialog [name=password]',PASSWORD)
        click('.wechat-account-dialog button[type=submit]')
        wait("!!window.KGAuthCore?.currentUser?.() && !document.querySelector('.wechat-account-dialog[open]')")
        assert api('/api/v1/auth/me')['body']['user']['username']=='b_'+database[-12:]+'_0'
        api('/api/v1/auth/logout','POST');oauth(code)
        wait("!!window.KGAuthCore?.currentUser?.()")
        assert not js("!!document.querySelector('.wechat-account-dialog[open]')")
        print('first WeChat / wrong password / bind existing / direct repeat login: passed',flush=True)
        # Explicit new account does not produce a password-registration binding reminder.
        api('/api/v1/auth/logout','POST');oauth(code+'_new')
        wait("!!document.querySelector('[data-create]')");click('[data-create]')
        wait("!!window.KGAuthCore?.currentUser?.()")
        assert not js("!!document.querySelector('[data-bind]')")
        assert api('/api/v1/auth/me')['body']['user']['username'].startswith('wx_')
        dismiss_chooser()
        click('[data-account-menu-trigger]')
        ab('snapshot','-i')
        click('#accountMenuUserCenterBtn')
        wait("!!document.querySelector('#ucWechatRecoverBtn')")
        # External provider round trip is replaced by the verified-code stub.
        oauth(code+'_new','recover')
        wait("!!document.querySelector('.wechat-account-dialog form')")
        assert not js("!!document.querySelector('[data-create]')")
        fill('.wechat-account-dialog [name=username]','b_'+database[-12:]+'_1');fill('.wechat-account-dialog [name=password]',PASSWORD)
        click('.wechat-account-dialog button[type=submit]')
        wait("window.KGAuthCore?.currentUsername?.()==='b_"+database[-12:]+"_1'")
        print('explicit new WeChat / no registration reminder / recover existing: passed',flush=True)
        print('BROWSER_MATRIX_OK',flush=True)
    finally:
        try: ab('close')
        except Exception: pass
        if process:
            process.terminate();process.wait(timeout=15)
        subprocess.run(['dropdb','-h','/tmp','--if-exists','--force',database],check=True)

if __name__=='__main__':
    if '--serve' in sys.argv:serve()
    else:main()
