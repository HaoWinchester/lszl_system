"""Real isolated API/browser checks for summary paging, lazy features and stable first paint."""
import argparse,json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser();parser.add_argument('--base-url',default='http://127.0.0.1:5196');base=parser.parse_args().base_url.rstrip('/');assert base.startswith('http://127.0.0.1:')
OUT=ROOT/'artifacts/practice-lobby-demand';OUT.mkdir(exist_ok=True)
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='chrome');errors=[];metrics=[]
    for width in (1440,390):
        ctx=browser.new_context(viewport={'width':width,'height':900 if width==1440 else 844});p=ctx.new_page();p.on('pageerror',lambda e:errors.append(str(e)));requests=[]
        p.on('request',lambda r:requests.append(r.url))
        p.add_init_script("window.layoutShifts=[];new PerformanceObserver(l=>l.getEntries().forEach(e=>{if(!e.hadRecentInput)layoutShifts.push(e.value)})).observe({type:'layout-shift',buffered:true})")
        scripts=[];catalog=[]
        p.route('**/bundles/practice-lobby.js?*',lambda r:scripts.append(r))
        p.route('**/paper-releases/catalog?*',lambda r:catalog.append(r))
        p.goto(base+'/practice-mode.html',wait_until='commit');p.locator('#practicePaperLibrary').wait_for(state='visible')
        bounds=lambda:p.locator('.practice-mode-layout').evaluate('(e)=>({y:e.getBoundingClientRect().y,height:e.getBoundingClientRect().height})')
        expect(p.locator('.practice-mode-layout')).to_be_hidden()
        first=bounds();assert len(scripts)==1;scripts[0].continue_();p.wait_for_load_state('domcontentloaded');p.wait_for_timeout(80);pending=bounds()
        expect(p.locator('.practice-mode-layout')).to_be_hidden()
        assert len(catalog)==1,requests
        assert 'pageSize=12' in catalog[0].request.url and 'mode=practice_mode' in catalog[0].request.url
        catalog[0].continue_();p.unroute('**/paper-releases/catalog?*');p.wait_for_function('KGPaperReleaseApi.catalogStatus()==="ready"');expect(p.locator('#practicePaperLibrary [data-paper-id]')).to_have_count(12);p.wait_for_timeout(150)
        ready=bounds();expect(p.locator('.practice-mode-layout')).to_be_visible()
        assert p.locator('#practiceLobby').get_attribute('data-catalog-pending') is None
        initial=[u for u in requests if '/bundles/' in u and '.js?' in u];assert len(initial)==2,initial
        forbidden=['question-catalog/bootstrap','/questions?','/learning/practice/sessions','/subscriptions/plans','practice-answer.js','practice-account.js','practice-report.js','practice-community.js','practice-knowledge.js','practice-auth.js']
        assert not [u for u in requests if any(x in u for x in forbidden)],requests
        cls=p.evaluate('layoutShifts.reduce((a,b)=>a+b,0)');assert cls<.02,(width,cls)
        metrics.append({'width':width,'initialScripts':len(initial),'modeBounds':[first,pending,ready],'cls':cls})
        p.locator('#practiceLibraryMoreBtn').click();expect(p.locator('#practicePaperDrawerLibrary [data-paper-id]')).to_have_count(12)
        p.locator('#practicePaperLoadMore').click();expect(p.locator('#practicePaperDrawerLibrary [data-paper-id]')).to_have_count(16);expect(p.locator('#practicePaperLoadMore')).to_be_hidden();p.locator('#practicePaperDrawerClose').click()
        p.locator('#practiceLibrarySearch').fill('分页试卷 01');expect(p.locator('#practicePaperLibrary [data-paper-id]')).to_have_count(1);expect(p.locator('#practicePaperLibrary [data-paper-id] h2')).to_contain_text('01')
        p.locator('#practiceLibraryClear').click();expect(p.locator('#practicePaperLibrary [data-paper-id]')).to_have_count(12)
        expect(p.locator('#practiceLibrarySubject')).to_have_count(0)
        # Lazy login must still mount password, consent and WeChat controls after DOMContentLoaded.
        p.locator('#authStatus').click();p.locator('#accountMenuSessionBtn').click();expect(p.locator('#authModal')).to_have_class(__import__('re').compile('show'));expect(p.locator('.wechat-login-entry')).to_have_count(1)
        p.locator('#authUsername').fill('ink-browser');p.locator('#authPassword').fill('ink-browser-test');p.locator('#authLegalConsent').check();p.locator('#authDoLoginBtn').click();expect(p.locator('#authModal')).not_to_have_class(__import__('re').compile('show'))
        expect(p.locator('[data-practice-start="practice"]')).to_be_enabled()
        # Optional account failure remains retryable; no fallback prices shown on a failed load.
        p.route('**/bundles/practice-account.js?*',lambda r:r.abort());p.locator('#authStatus').click();p.locator('#accountMenuUserCenterBtn').click();expect(p.locator('#practiceFeatureStatus')).to_be_visible();p.unroute('**/bundles/practice-account.js?*');p.locator('#practiceFeatureStatus button').click();expect(p.locator('#userCenterModal')).to_have_class(__import__('re').compile('show'));p.locator('#userCenterCloseBtn').click()
        # Loading a failed answer group can be retried without losing the selected paper.
        p.route('**/bundles/practice-answer.js?*',lambda r:r.abort());p.locator('[data-practice-start="practice"]').click();expect(p.locator('#practiceToast')).to_be_visible();p.unroute('**/bundles/practice-answer.js?*');p.locator('[data-practice-start="practice"]').click();expect(p.locator('#practiceGame')).to_be_visible();assert p.evaluate('KGPracticeFeatures.state("report")')=='idle'
        p.locator('[data-option-id="A"]').click();p.locator('#practiceAnswerSheetMobileBtn').click();expect(p.locator('#practiceAnswerSheetDrawer .practice-answer-number')).to_have_count(2);p.locator('#practiceAnswerSheetDrawerClose').click();p.locator('#practiceNextBtn').click();p.locator('[data-option-id="A"]').click();expect(p.locator('#practiceResult')).to_be_visible();assert p.evaluate('KGPracticeFeatures.state("report")')=='ready'
        ctx.close()
    failure_ctx=browser.new_context();failure_page=failure_ctx.new_page()
    failure_page.route('**/paper-releases/catalog?*',lambda r:r.fulfill(status=503,json={'detail':'initial catalog unavailable'}),times=1)
    failure_page.goto(base+'/practice-mode.html',wait_until='networkidle')
    expect(failure_page.locator('[data-retry-paper-catalog]')).to_be_visible()
    expect(failure_page.locator('.practice-mode-layout')).to_be_visible()
    assert failure_page.locator('#practiceLobby').get_attribute('data-catalog-pending') is None
    failure_page.locator('[data-retry-paper-catalog]').click()
    expect(failure_page.locator('#practicePaperLibrary [data-paper-id]')).to_have_count(12)
    failure_ctx.close()
    ctx=browser.new_context(viewport={'width':1440,'height':900})
    assert ctx.request.post(base+'/api/v1/auth/login',data={'username':'ink-student','password':'ink-browser-test'}).ok
    started=ctx.request.post(base+'/api/v1/learning/practice/sessions/enter',data={'paperId':'lobby-paper-01','releaseId':'lobby-release-01','mode':'practice','count':2,'order':'paper'});assert started.ok,started.text()
    session=started.json()['session'];completed=ctx.request.post(base+'/api/v1/learning/practice/sessions/'+session['id']+'/complete',data={'revision':session['revision'],'answers':{}});assert completed.ok,completed.text()
    page=ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.goto(base+'/practice-mode.html',wait_until='networkidle');expect(page.locator('#practicePaperLibrary [data-paper-id="lobby-paper-01"]')).to_have_count(0)
    page.locator('#practiceHistoryOpenBtn').click();page.locator('.practice-history-group details summary').first.click();page.locator('[data-history-session="'+session['id']+'"]').click();expect(page.locator('#practiceResult')).to_be_visible()
    page.locator('[data-report-again]').click();expect(page.locator('#practiceGame')).to_be_visible();active=page.evaluate('KGPracticeMode.snapshot().sessionId');assert ctx.request.get(base+'/api/v1/learning/practice/sessions/'+active).json()['session']['paperId']=='lobby-paper-01'
    for query in ('paperId=lobby-paper-01&releaseId=lobby-release-01','releaseId=lobby-release-01'):
        page.goto(base+'/practice-mode.html?retiredMode=single_deep_study&'+query,wait_until='networkidle');expect(page.locator('#practiceSelectedPaperName')).to_have_text('分页试卷 01')
        assert page.evaluate('KGPracticeFeatures.state("answer")')=='idle'
    page.goto(base+'/practice-mode.html?retiredMode=single_deep_study&paperId=lobby-paper-15&releaseId=lobby-release-01',wait_until='networkidle');expect(page.locator('#practiceSelectedPaperName')).to_have_text('请选择试卷');expect(page.locator('[data-practice-start="practice"]')).to_be_disabled()
    page.locator('#practicePaperLibrary [data-paper-id="lobby-paper-15"]').click();expect(page.locator('[data-practice-start="practice"]')).to_be_enabled()
    page.route('**/paper-releases/catalog?*releaseId=lobby-release-01',lambda r:r.fulfill(status=503,json={'detail':'unavailable'}));page.goto(base+'/practice-mode.html?retiredMode=single_deep_study&releaseId=lobby-release-01',wait_until='networkidle');expect(page.locator('#practiceRetiredSelectionRetry')).to_be_visible();expect(page.locator('[data-practice-start="practice"]')).to_be_disabled();page.unroute('**/paper-releases/catalog?*releaseId=lobby-release-01');page.locator('#practiceRetiredSelectionRetry').click();expect(page.locator('#practiceSelectedPaperName')).to_have_text('分页试卷 01')
    # Late old-owner history responses must not repopulate the next session.
    page.goto(base+'/practice-mode.html',wait_until='networkidle');held=[]
    def hold_lookup(route):
        response=route.fetch();held.append((route,response))
    page.route('**/paper-releases/catalog?*paperId=lobby-paper-01',hold_lookup)
    page.locator('#practiceHistoryOpenBtn').click();page.locator('.practice-history-group details summary').first.click();page.locator('[data-history-session="'+session['id']+'"]').click()
    for _ in range(40):
        if held:break
        page.wait_for_timeout(50)
    assert held
    page.evaluate('KGAuthCore.logout()');held[0][0].fulfill(response=held[0][1]);page.wait_for_timeout(150)
    expect(page.locator('#practiceGame')).to_be_hidden();expect(page.locator('#practiceResult')).to_be_hidden();assert page.evaluate('KGPracticeMode.snapshot().sessionId')==''
    ctx.close()
    assert not errors,errors
    (OUT/'browser-metrics.json').write_text(json.dumps(metrics,ensure_ascii=False,indent=2));browser.close();print('PASS demand-only initial assets/data, first paint stability, API paging/filter/facets, lazy login/account/answer/report, failures and retry, desktop/mobile',json.dumps(metrics))
