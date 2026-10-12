"""Held network responses verify immutable submissions and collapsed search lifecycle."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect,Error
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'artifacts/canvas-m2-m5/t14';BASE='http://127.0.0.1:5194'
f=json.loads((OUT/'fixture.json').read_text())
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='chrome');errors=[]
    def session(role):
        ctx=browser.new_context(viewport={'width':1440,'height':900});assert ctx.request.post(BASE+'/api/v1/auth/login',data={'username':f['users'][role],'password':f['password']}).ok
        ctx.request.put(BASE+'/api/v1/files/current',data={'fileId':f['files'][role]});page=ctx.new_page();page.on('pageerror',lambda error:errors.append(str(error)));page.goto(BASE+'/index.html',wait_until='networkidle');page.wait_for_function('!KGGraphFileTabs.isSwitching()')
        for selector in ('#learningEntryDismissBtn','.tour-skip','#hideHelpBtn'):
            if page.locator(selector).is_visible():page.locator(selector).click()
        page.evaluate("window.raceRejections=[];window.addEventListener('unhandledrejection',event=>raceRejections.push(String(event.reason)))")
        for selector in ('.knowledge-card[data-node-id=n]','#graphPracticeBtn'):
            page.locator(selector).wait_for();r=page.locator(selector).bounding_box();page.mouse.click(r['x']+r['width']/2,r['y']+r['height']/2)
        expect(page.locator('.gqd-question')).to_have_count(3);return ctx,page
    for index in (0,2):
        ctx,page=session('student');card=page.locator('.gqd-question').nth(index);held=[];bodies=[]
        def hold(route):
            bodies.append(route.request.post_data_json);response=route.fetch();held.append((route,response))
        page.route('**/graph-questions/files/*/nodes/*/bindings/*/attempts',hold)
        if index==0:card.locator('input[value=A]').check()
        else:
            for left,right in (('l1','r1'),('l2','r2')):card.locator('[data-qm-left='+left+']').click();card.locator('[data-qm-right='+right+']').click()
        card.locator('[data-submit]').click();page.wait_for_function("document.querySelectorAll('.gqd-question [data-submit]')[%d].disabled"%index);page.wait_for_timeout(150)
        assert len(held)==1;original=bodies[0]
        if index==0:
            expect(card.locator('input[value=A]')).to_be_disabled();expect(card.locator('input[value=B]')).to_be_disabled();card.locator('input[value=B]').click(force=True);expect(card.locator('input[value=A]')).to_be_checked();expect(card.locator('input[value=B]')).not_to_be_checked()
        else:
            expect(card.locator('[data-qm-left=l1]')).to_be_disabled();card.locator('[data-qm-left=l1]').click(force=True);expect(card.locator('[data-qm-right]')).to_have_count(0);expect(card.locator('[data-qm-clear]')).to_have_count(0);expect(card.locator('[data-qm-left=l1] span')).to_have_text('一')
        # Backend already committed; losing the response must retry same requestId and answer.
        held[0][0].fulfill(status=503,json={'detail':'lost response'});expect(card.locator('[data-feedback]')).to_contain_text('提交失败');card.locator('[data-submit]').click();page.wait_for_timeout(150);assert len(held)==2;assert bodies[1]==original,(bodies,original)
        held[1][0].fulfill(response=held[1][1]);expect(card.locator('.gqd-analysis')).to_be_visible();expect(card.locator('[data-feedback]')).to_contain_text('回答正确');actual=held[1][1].json()['attempt']
        if index==0:assert actual['selection']['selectedOptionIds']==['A'];expect(card.locator('input[value=A]')).to_be_checked();expect(card.locator('input[value=B]')).not_to_be_checked()
        else:assert actual['selection']['selectedPairs']=={'l1':'r1','l2':'r2'};expect(card.locator('[data-qm-left=l1] span')).to_have_text('一');expect(card.locator('[data-qm-left=l2] span')).to_have_text('二')
        assert held[0][1].json()['attempt']['id']==actual['id'];assert page.evaluate('raceRejections')==[];ctx.close()
    ctx,page=session('teacher');held=[]
    page.locator('[data-add]').click();page.route('**/graph-questions/search?*',lambda route:held.append((route,route.fetch())));page.locator('[data-search] form button').click();expect(page.locator('[data-search-status]')).to_have_text('正在搜索…');page.wait_for_timeout(150);assert len(held)==1
    page.locator('[data-add]').click();expect(page.locator('[data-search-status]')).to_have_count(0)
    try:held[0][0].fulfill(response=held[0][1])
    except Error:pass # Fetch abort legitimately cancels the browser request.
    page.wait_for_timeout(150);expect(page.locator('[data-search-status]')).to_have_count(0);page.locator('[data-add]').click();expect(page.locator('[data-results] label')).to_have_count(0);expect(page.locator('[data-search-status]')).to_have_text('');assert page.evaluate('raceRejections')==[]
    page.unroute('**/graph-questions/search?*');page.locator('[data-search] form button').click();expect(page.locator('[data-results] label')).to_have_count(20);assert not errors,errors;assert page.evaluate('raceRejections')==[];ctx.close();browser.close()
print('PASS held choice/matching submissions, ambiguous-failure exact idempotent retries, collapsed search abort/reopen, no unhandled rejections')
