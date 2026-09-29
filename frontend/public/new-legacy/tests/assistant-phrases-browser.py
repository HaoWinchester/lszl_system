"""Local Chrome + API/PG regression. Run from repo root with preview on 5179.
Only creates random test accounts in kg_experience_20260928; archives them on exit.
Requires the current migration and synchronized preview assets. Never calls a model.
"""
import asyncio,os,sys,secrets,json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
os.environ['DATABASE_URL']='postgresql+asyncpg://menghao@/kg_experience_20260928?host=/tmp'
sys.path.insert(0,str(Path.cwd()/'backend'))
from app.db.session import AsyncSessionLocal
from app.models.user import User
from app.core.security import hash_password
names=['phrase-test-'+secrets.token_hex(4) for _ in range(2)];password=secrets.token_urlsafe(24)
async def account(archive=False):
    async with AsyncSessionLocal() as db:
        for name in names:
            if archive:
                user=await db.get(User,name);user.status='archived'
            else:db.add(User(username=name,password_hash=hash_password(password),role='admin',status='active',source='phrase-local-test'))
        await db.commit()
asyncio.run(account())
Path('artifacts/learning-experience/phrases').mkdir(parents=True,exist_ok=True)
results=[]
try:
 with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    context=browser.new_context(viewport={'width':1440,'height':1000});page=context.new_page();errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto('http://127.0.0.1:5179/practice-mode.html')
    page.locator('[data-practice-start="practice"]').click()
    page.locator('#authUsername').fill(names[0]);page.locator('#authPassword').fill(password)
    page.locator('#authLegalConsent').check();page.locator('#authDoLoginBtn').click()
    page.wait_for_function("window.KGAuthCore?.currentUser()?.role === 'admin'")
    assert page.locator('[data-kg-icon="history"]').get_attribute('data-kg-icon-hydrated')=='history'
    assert page.locator('[data-kg-icon="rotate-ccw"]').get_attribute('data-kg-icon-hydrated')=='rotate-ccw'
    results.append('practice icons registered and rendered')
    page.goto('http://127.0.0.1:5179/paper-management.html');page.wait_for_load_state('networkidle')
    assert page.evaluate("window.KGDifficultyService.stars('medium')")=='★★☆'
    assert 'undefined 中等' not in page.locator('body').inner_text()
    results.append('paper management shared difficulty dependency and no undefined text')
    page.goto('http://127.0.0.1:5179/teacher-assistant.html')
    expect(page.locator('#send-message')).to_be_enabled();expect(page.locator('#phrase-chips button')).to_have_count(4)
    sent=[];page.on('request',lambda r:sent.append(r.url) if r.url.endswith('/messages') else None)
    page.locator('#assistant-message').fill('已有输入')
    page.locator('#phrase-chips button').first.click()
    assert page.locator('#assistant-message').input_value().startswith('已有输入\n\n')
    assert len(sent)==0
    results.append('defaults append to draft, never auto-send')
    page.locator('#manage-phrases').click();expect(page.locator('#phrase-dialog')).to_be_visible()
    page.locator('#phrase-title').fill('我的检查');page.locator('#phrase-content').fill('请对照原文检查答案。')
    page.locator('#phrase-save').click();expect(page.locator('#phrase-error')).to_have_text('已保存到当前账号。')
    expect(page.locator('#phrase-list')).to_contain_text('我的检查')
    page.locator('#phrase-close').click();page.reload()
    expect(page.locator('#phrase-chips button')).to_have_count(5)
    page.get_by_role('button',name='我的检查',exact=True).click();expect(page.locator('#assistant-message')).to_have_value('请对照原文检查答案。')
    results.append('create persists after reload and fills exact custom text')
    page.locator('#manage-phrases').click();page.locator('#phrase-list').get_by_role('button',name='编辑').click()
    page.locator('#phrase-title').fill('修改后的话语');page.locator('#phrase-content').fill('<img src=x onerror=alert(1)> 请先检查')
    page.route('**/api/v1/teacher-assistant/quick-phrases',lambda route:route.fulfill(status=503,content_type='application/json',body='{"detail":"测试保存失败"}') if route.request.method=='PUT' else route.continue_())
    page.locator('#phrase-save').click();expect(page.locator('#phrase-error')).to_have_text('测试保存失败')
    expect(page.locator('#phrase-title')).to_have_value('修改后的话语');expect(page.locator('#phrase-save')).to_be_enabled()
    page.unroute('**/api/v1/teacher-assistant/quick-phrases');page.locator('#phrase-save').click();expect(page.locator('#phrase-error')).to_have_text('已保存到当前账号。')
    results.append('failed update retains draft and retries successfully')
    page.locator('#phrase-close').click();page.locator('#assistant-message').fill('');page.get_by_role('button',name='修改后的话语',exact=True).click()
    expect(page.locator('#assistant-message')).to_have_value('<img src=x onerror=alert(1)> 请先检查');assert page.locator('#phrase-chips img').count()==0
    page.screenshot(path='artifacts/learning-experience/phrases/desktop.png')
    page.set_viewport_size({'width':390,'height':844});page.locator('#manage-phrases').click()
    assert page.evaluate('document.documentElement.scrollWidth')==390
    page.screenshot(path='artifacts/learning-experience/phrases/mobile-dialog.png')
    # A different account sees no custom entries; backend also independently covers this.
    other=browser.new_context();r=other.request.post('http://127.0.0.1:5179/api/v1/auth/login',data={'username':names[1],'password':password,'acceptedTermsVersion':'2026-08-13-v1'})
    assert r.status==200,r.text()
    if r.status==200:
        assert other.request.get('http://127.0.0.1:5179/api/v1/teacher-assistant/quick-phrases').json()['custom']==[]
        results.append('second account isolated')
    page.once('dialog',lambda d:d.dismiss());page.get_by_role('button',name='删除 修改后的话语',exact=True).click();expect(page.locator('#phrase-list')).to_contain_text('修改后的话语')
    page.once('dialog',lambda d:d.accept());page.get_by_role('button',name='删除 修改后的话语',exact=True).click();expect(page.locator('#phrase-empty')).to_be_visible()
    page.locator('#phrase-close').click();page.reload();expect(page.locator('#phrase-chips button')).to_have_count(4)
    results.append('delete cancellation, confirmed delete, reload, mobile layout')
    assert not errors,errors
    Path('artifacts/learning-experience/phrases/browser-result.json').write_text(json.dumps({'passed':results,'pageErrors':errors},ensure_ascii=False,indent=2))
    browser.close()
 print('PASS',len(results),'browser groups')
finally:asyncio.run(account(True))
