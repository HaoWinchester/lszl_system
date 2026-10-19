"""Real isolated API + authoritative source gallery/deep-link/controller UI."""
import argparse,json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/remaining-learning-requirements/templates-browser';OUT.mkdir(parents=True,exist_ok=True)
parser=argparse.ArgumentParser();parser.add_argument('--base-url',default='http://127.0.0.1:5275');args=parser.parse_args();BASE=args.base_url
assert BASE=='http://127.0.0.1:5275','requires the designated disposable browser fixture'
checks=[]
with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,channel='chrome')
    context=browser.new_context(viewport={'width':1440,'height':1000},reduced_motion='reduce')
    page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.route(BASE+'/',lambda route:route.fulfill(path=ROOT/'new-legacy/landing.html'))
    page.route('**/styles/template-discovery.css',lambda route:route.fulfill(path=ROOT/'new-legacy/styles/template-discovery.css'))
    page.goto(BASE+'/',wait_until='networkidle')
    gallery=page.locator('#learning-templates');expect(gallery.locator('article')).to_have_count(4)
    expect(gallery).to_contain_text('原创')
    gallery.scroll_into_view_if_needed();page.screenshot(path=str(OUT/'landing-desktop.png'))
    page.set_viewport_size({'width':390,'height':844});gallery.scroll_into_view_if_needed()
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.screenshot(path=str(OUT/'landing-mobile.png'));page.set_viewport_size({'width':1440,'height':1000})
    page.get_by_role('link',name='查看成人管理与协作模板').click();page.wait_for_load_state('networkidle')
    assert 'templateId=builtin-adult-management-v1' in page.url
    # The server's active immutable release is intentionally left untouched.
    # Inject only authoritative edited modules after its normal bootstrap.
    page.add_style_tag(path=ROOT/'new-legacy/styles/template-discovery.css')
    page.add_script_tag(path=ROOT/'new-legacy/src/graph/template-center-controller.js')
    page.add_script_tag(path=ROOT/'new-legacy/src/graph/template-deep-link.js')
    expect(page.locator('.graph-template-entry-prompt')).to_be_visible()
    assert page.locator('#graphTemplateCenter').count()==0
    checks.append('real homepage navigation preserves templateId; guest sees login before any template API load')
    page.locator('.graph-template-entry-prompt').get_by_role('button',name='登录并查看模板').click()
    expect(page.locator('#authModal')).to_be_visible()
    # Use the real dialog's input labels, not an injected authentication stub.
    page.locator('#authUsername').fill('ink-student');page.locator('#authPassword').fill('ink-browser-test')
    page.locator('#authLegalConsent').check();page.locator('#authDoLoginBtn').click()
    center=page.locator('#graphTemplateCenter');expect(center).to_be_visible(timeout=15000)
    row=center.locator('[data-template-id="builtin-adult-management-v1"]');expect(row).to_be_visible()
    expect(center.locator('article')).to_have_count(1)
    before=context.request.get(BASE+'/api/v1/files/current').json()['fileId']
    assert before=='role-graph-ink-student'
    before_graph=context.request.get(BASE+'/api/v1/files/'+before).json()['graphData']
    # Preview leaves the current file untouched and uses frozen projection.
    row.get_by_role('button',name='预览',exact=True).click()
    preview=page.locator('.template-preview-window');expect(preview).to_be_visible()
    expect(preview.locator('.template-preview-viewport')).not_to_contain_text('正在加载图谱…')
    page.screenshot(path=str(OUT/'preview-desktop.png'))
    preview.get_by_role('button',name='关闭模板预览').click()
    assert context.request.get(BASE+'/api/v1/files/current').json()['fileId']==before
    row.locator('[data-template-load]').click();result=row.locator('[data-template-result]');expect(result).to_be_visible(timeout=15000)
    copied=result.get_attribute('data-template-result')
    assert copied!=before
    assert context.request.get(BASE+'/api/v1/files/current').json()['fileId']==before
    assert context.request.get(BASE+'/api/v1/files/'+before).json()['graphData']==before_graph
    graph=context.request.get(BASE+'/api/v1/files/'+copied).json()['graphData']
    assert len(graph['nodes'])==13 and len(graph['links'])==12
    assert graph['nodes'][0]['content']['notes']
    row.locator('[data-template-load]').click();expect(result).to_have_attribute('data-template-result',copied)
    checks.append('real login restores target; frozen preview; explicit load independent 13-card copy and idempotent retry without changing current file')
    page.set_viewport_size({'width':390,'height':844});expect(center).to_be_visible()
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.screenshot(path=str(OUT/'center-mobile.png'))
    # Real logout invalidates the open center before any old response can paint.
    assert context.request.post(BASE+'/api/v1/auth/logout').ok
    page.evaluate("KGAuthCore.logout()")
    expect(center).to_have_count(0)
    checks.append('390px center remains usable and auth change disposes prior template UI')
    assert not errors,errors
    context.close();browser.close()
(OUT/'results.json').write_text(json.dumps({'checks':checks,'errors':errors},ensure_ascii=False,indent=2))
print(json.dumps({'passed':len(checks),'checks':checks},ensure_ascii=False))
