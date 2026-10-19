#!/usr/bin/env python3
"""Source auth dialogs against an explicitly supplied disposable API server."""
from pathlib import Path
import argparse
import json
import re
from uuid import uuid4
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--base-url',required=True)
args=parser.parse_args()
assert args.base_url.startswith('http://127.0.0.1:'), 'run only against isolated local test server'
TARGETS=('index.html','practice-mode.html','question-workspace.html','knowledge-recall.html')


def install(page,target,code='0123456789ABCDEF'):
    html=(ROOT/target).read_text()
    attrs,body=re.search(r'<body([^>]*)>([\s\S]*)</body>',html,re.I).groups()
    body=re.sub(r'<script[\s\S]*?</script>','',body,flags=re.I)
    def route(request):
        path=request.request.url.split(args.base_url,1)[-1].split('?')[0]
        if path.startswith('/api/'): request.continue_();return
        if path=='/'+target:
            request.fulfill(content_type='text/html',body=f'<html><body{attrs}>{body}</body></html>');return
        request.fulfill(status=204,body='')
    page.route('**/*',route)
    page.goto(args.base_url+'/'+target+'?referralCode='+code)
    page.evaluate('''()=>{window.KG_AUTH_CONFIG={mode:'remote',credentials:'include',endpoints:{login:'/api/v1/auth/login',register:'/api/v1/auth/register',logout:'/api/v1/auth/logout',session:'/api/v1/auth/me',profile:'/api/v1/auth/me'}}}''')
    for file in ['styles/main.css','styles/auth-dialog.css','styles/user-center.css']:
        if (ROOT/file).exists(): page.add_style_tag(content=(ROOT/file).read_text())
    scripts=['src/29-auth-core.js','src/30-shared-auth-dialog.js' if target in TARGETS[:2] else 'src/30-standalone-auth-dialog.js','src/33-user-center.js']
    for file in scripts: page.add_script_tag(content=(ROOT/file).read_text())
    if target in TARGETS[:2]:
        page.add_script_tag(content=(ROOT.parent/'frontend/scripts/new-legacy-assets/direct-auth-adapter.js').read_text())
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
    page.evaluate('window.KGSharedAuthDialog?KGSharedAuthDialog.open():KGStandaloneAuthDialog.open()')


with sync_playwright() as playwright:
    browser=playwright.chromium.launch(headless=True)
    errors=[]
    for target in TARGETS:
        context=browser.new_context(viewport={'width':390,'height':844} if target==TARGETS[0] else {'width':1280,'height':1000})
        page=context.new_page();page.set_default_timeout(10000)
        page.on('pageerror',lambda error:errors.append(str(error)))
        install(page,target)
        referral=page.locator('#authReferralCode')
        assert referral.is_visible(),target+': optional referral input must be visible'
        bounds=referral.bounding_box();assert bounds['x']>=0 and bounds['x']+bounds['width']<=page.viewport_size['width']
        assert referral.input_value()=='0123456789ABCDEF',target+': link must prefill'
        name='browser_'+uuid4().hex[:16]
        page.locator('#authUsername').fill(name);page.locator('#authPassword').fill('test-only-password')
        page.locator('#authLegalConsent').check()
        page.locator('#authRegisterBtn').click()
        page.wait_for_function("document.getElementById('authMsg').textContent.includes('推荐码无效')")
        assert referral.input_value()=='0123456789ABCDEF'
        assert page.locator('#authUsername').input_value()==name
        assert page.locator('#authPassword').input_value()=='test-only-password'
        assert page.evaluate('KGAuthCore.currentUser()') is None
        # Explicitly clearing a URL-prefilled code must allow normal registration.
        referral.fill('');page.locator('#authRegisterBtn').click()
        page.wait_for_function('!!KGAuthCore.currentUser()')
        # Inject transport failures only; every successful request reaches API/DB.
        failures={'verb':'GET' if target==TARGETS[0] else None}
        def transient(route):
            if route.request.method==failures['verb']:
                failures['verb']=None;route.fulfill(status=503,content_type='application/json',body='{"detail":"temporary unavailable"}')
            else:route.continue_()
        page.route('**/api/v1/auth/me/referral',transient)
        page.evaluate('KGUserCenter.open()')
        if target==TARGETS[0]:
            page.locator('#ucReferralRetry').click()
            page.locator('#ucReferralGenerate').wait_for()
            failures['verb']='POST'
            page.locator('#ucReferralGenerate').click()
            page.locator('#ucReferralRetry').click()
        else:page.locator('#ucReferralGenerate').click()
        page.wait_for_function("!!document.getElementById('ucReferralCode')?.value")
        code=page.locator('#ucReferralCode').input_value()
        assert re.fullmatch('[A-F0-9]{16}',code)
        link=page.locator('#ucReferralLink').input_value()
        assert link==args.base_url+'/practice-mode.html?referralCode='+code
        assert '已注册 0 人' in page.locator('#ucReferralBox').inner_text()
        assert '当前不提供会员奖励或返佣' in page.locator('#ucReferralBox').inner_text()
        # A real visitor follows the generated link and registers, then the
        # inviter sees only an aggregate from the actual binding table.
        visitor_context=browser.new_context(viewport={'width':1280,'height':1000})
        visitor=visitor_context.new_page();visitor.set_default_timeout(10000)
        visitor.on('pageerror',lambda error:errors.append(str(error)))
        install(visitor,target,code=code)
        child='browser_child_'+uuid4().hex[:12]
        visitor.locator('#authUsername').fill(child);visitor.locator('#authPassword').fill('test-only-password')
        visitor.locator('#authLegalConsent').check();visitor.locator('#authRegisterBtn').click()
        visitor.wait_for_function('!!KGAuthCore.currentUser()')
        page.evaluate('KGUserCenter.open()')
        page.wait_for_function("document.getElementById('ucReferralBox').textContent.includes('已注册 1 人')")
        assert child not in page.locator('#ucReferralBox').inner_text()
        visitor_context.close()
        page.locator('#userCenterCloseBtn').click()
        # Same browser session, fresh source DOM + server /me restores same code.
        page.reload();install(page,target)
        assert page.evaluate('KGAuthCore.refreshSession()')['ok'] is True
        page.evaluate('window.KGSharedAuthDialog?KGSharedAuthDialog.close():KGStandaloneAuthDialog.close()')
        page.evaluate('KGUserCenter.open()')
        page.wait_for_function("!!document.getElementById('ucReferralCode')?.value")
        assert page.locator('#ucReferralCode').input_value()==code
        if target==TARGETS[0]:
            page.evaluate("""()=>{window.__referralSettled=0;const read=KGAuthCore.referralSummary;KGAuthCore.referralSummary=async(...args)=>{try{return await read(...args)}finally{window.__referralSettled++}}}""")
            held=[]
            def delay_first(route):
                if not held:
                    held.append((route,route.fetch()))
                else:route.continue_()
            page.route('**/api/v1/auth/me/referral',delay_first)
            with page.expect_request('**/api/v1/auth/me/referral'):
                page.evaluate('KGUserCenter.open()')
            page.wait_for_timeout(30)
            assert len(held)==1
            other='browser_other_'+uuid4().hex[:12]
            assert page.evaluate("name=>KGAuthCore.register(name,'test-only-password',{referralCode:''})",other)['ok'] is True
            page.locator('#ucReferralGenerate').wait_for()
            assert page.evaluate('window.__referralSettled')==1
            held[0][0].fulfill(response=held[0][1])
            page.wait_for_function('window.__referralSettled===2')
            assert page.locator('#ucUsername').input_value()==other
            assert page.locator('#ucReferralCode').count()==0, 'late previous-owner response must be discarded'
        page.evaluate('KGAuthCore.logout()')
        page.wait_for_function('!KGAuthCore.currentUser()')
        assert not page.locator('#userCenterModal').evaluate("node=>node.classList.contains('show')")
        assert code not in page.locator('#ucReferralBox').inner_html(), 'logout must remove previous owner data'
        page.evaluate('window.KGSharedAuthDialog?KGSharedAuthDialog.open():KGStandaloneAuthDialog.open()')
        page.locator('#authUsername').fill(name);page.locator('#authPassword').fill('test-only-password')
        page.locator('#authLegalConsent').check()
        with page.expect_response('**/api/v1/auth/login') as login_response:
            page.locator('#authDoLoginBtn').click()
        assert login_response.value.status==200,(target,login_response.value.status,login_response.value.text())
        page.wait_for_function('!!KGAuthCore.currentUser()')
        page.evaluate('window.KGSharedAuthDialog?KGSharedAuthDialog.logout():KGStandaloneAuthDialog.logout()')
        page.wait_for_function('!KGAuthCore.currentUser()')
        context.close()
    assert not errors,errors
    browser.close()
print('referral browser: all 4 auth pages optional input/link, invalid input retention/clear, valid attribution/count, own code/stats, refresh, login/logout, retry and delayed owner switch passed')
