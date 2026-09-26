#!/usr/bin/env python3
"""Read-only real UAT session with source UI overrides; no API mocks or imports."""
import json,os
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT.parent/'artifacts'/'teacher-assistant';BASE=os.environ.get('ASSISTANT_LAYOUT_BASE','https://uat.aihuanpu.com')
SESSION=os.environ.get('ASSISTANT_LAYOUT_SESSION','tas_6c86519375df4de39547fa78d5bc1f5d')
accounts=json.loads((OUT/'uat-test-accounts.json').read_text())
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True);context=browser.new_context()
    response=context.request.post(BASE+'/api/v1/auth/login',data={**accounts['teacher'],'acceptedTermsVersion':'2026-08-13-v1'})
    assert response.ok,'测试教师登录失败'
    def html(route):
        response=route.fetch();route.fulfill(response=response,body=response.text().replace('class="teacher-admin-shell"','class="teacher-admin-shell ta-page"'))
    context.route('**/teacher-assistant.html?*',html)
    for filename in ('styles/teacher-assistant.css','src/teacher/teacher-assistant.js'):
        def override(route,request=None,filename=filename):route.fulfill(status=200,content_type='text/css' if filename.endswith('.css') else 'application/javascript',body=(ROOT/filename).read_text())
        context.route('**/'+filename+'*',override)
    page=context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)));results=[]
    for width,height in ((1440,1000),(390,844)):
        page.set_viewport_size({'width':width,'height':height});page.goto(BASE+'/teacher-assistant.html?session='+SESSION)
        expect(page.locator('#execution-receipt .ta-receipt-item')).to_have_count(3,timeout=30000)
        if width<760:page.locator('#tab-preview').click()
        metrics=page.evaluate('''() => {const title=document.querySelector('.ta-toolbar h1').getBoundingClientRect(),header=document.querySelector('.tw-topbar').getBoundingClientRect();return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,titleWidth:title.width,titleHeight:title.height,titleTop:title.top,headerBottom:header.bottom,receiptHeight:document.querySelector('#execution-receipt').getBoundingClientRect().height,detailsOpen:document.querySelector('.ta-receipt-details').open}}''')
        assert metrics['scrollWidth']<=width+1,metrics
        assert metrics['titleWidth']>width*.6,metrics
        assert metrics['titleHeight']<70,metrics
        assert metrics['titleTop']>=metrics['headerBottom'],metrics
        assert not metrics['detailsOpen'],metrics
        assert metrics['receiptHeight']<1000,metrics
        assert page.locator('#execution-receipt .ta-receipt-item a').count()>=3
        assert page.locator('#execution-receipt > pre').count()==0
        page.screenshot(path=str(OUT/f'uat-assistant-layout-{width}.png'),full_page=True)
        if width>760:
            page.locator('#execution-receipt').scroll_into_view_if_needed()
            page.screenshot(path=str(OUT/'uat-assistant-layout-desktop-receipt.png'),full_page=True)
        if width<760:
            page.locator('#tab-conversation').click()
            assert page.evaluate('document.documentElement.scrollWidth')<=width+1
            page.screenshot(path=str(OUT/'uat-assistant-layout-mobile-conversation.png'),full_page=True)
        results.append(metrics)
    assert not errors,errors
    (OUT/'uat-assistant-layout-result.json').write_text(json.dumps({'metrics':results,'errors':errors,'sourceOverrides':True,'apiMocks':False},indent=2))
    print(json.dumps(results));context.close();browser.close()
