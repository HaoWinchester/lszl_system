#!/usr/bin/env python3
"""Disposable localhost: first graph text save and clean viewer logout."""
import argparse,json,uuid
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser();parser.add_argument('--base-url',required=True);BASE=parser.parse_args().base_url.rstrip('/')
parsed=urlparse(BASE);assert parsed.hostname in ('localhost','127.0.0.1') and parsed.port
OUT=ROOT/'artifacts/home-auth-recovery';OUT.mkdir(parents=True,exist_ok=True)
PASSWORD='ink-browser-test'
def dismiss(page):
    for selector in ['#learningEntryDismissBtn','.tour-skip','#hideHelpBtn']:
        if page.locator(selector).is_visible():page.locator(selector).click()
def login(context,username):
    result=context.request.post(BASE+'/api/v1/auth/login',data={'username':username,'password':PASSWORD})
    assert result.ok,(result.status,result.text())
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='chrome')
    admin=browser.new_context();login(admin,'ink-admin')
    username='first-graph-'+uuid.uuid4().hex[:12]
    created=admin.request.post(BASE+'/api/v1/users',data={'username':username,'password':PASSWORD,'role':'teacher','subject':'PMP'})
    assert created.ok,(created.status,created.text())
    context=browser.new_context(viewport={'width':1440,'height':1000});login(context,username)
    assert context.request.get(BASE+'/api/v1/files').json()['files']==[]
    page=context.new_page();page.set_default_timeout(10000);errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    creates=[];page.on('request',lambda request:creates.append(request.url) if request.method=='POST' and urlparse(request.url).path=='/api/v1/files' else None)
    page.goto(BASE+'/index.html?mode=free',wait_until='networkidle');dismiss(page)
    page.wait_for_function('window.KGHomeInk && window.KGGraphFileRemoteAdapter?.isInitialized() && !KGGraphFileTabs.isSwitching()')
    assert page.evaluate('KGGraphFileRemoteAdapter.getCurrentFileMeta()') is None
    page.locator('#homeInkBtn').click();toolbar=page.locator('.canvas-ink-toolbar')
    toolbar.get_by_role('button',name='文字',exact=True).click();page.mouse.click(230,280)
    editor=page.get_by_role('textbox',name='画布文字内容');message='首次图谱文字-'+uuid.uuid4().hex[:8];editor.fill(message);editor.press('Control+Enter')
    try:expect(editor).to_have_count(0)
    except AssertionError:
        print(page.evaluate('({status:document.querySelector(".canvas-ink-text-status")?.textContent,saveState:document.querySelector(".canvas-ink-text-editor")?.dataset.saveState,autosave:KGGraphFileAutosave.status(),fileId:KGGraphFileRemoteAdapter.getCurrentFileMeta()?.id,errors:document.querySelector("#status")?.textContent})'));raise
    assert not page.evaluate('KGHomeInk.hasTextDraft()')
    page.wait_for_function('!KGGraphFileAutosave.isDirty()')
    files=context.request.get(BASE+'/api/v1/files').json()['files'];assert len(files)==1,files
    file_id=files[0]['id'];saved=context.request.get(BASE+'/api/v1/files/'+file_id).json()['graphData']['strokes']
    assert len([s for s in saved if s.get('text')==message])==1
    assert len(creates)==1,creates
    # A failed draft remains retryable after same-file history undo.
    text=page.locator('.canvas-ink-layer text').filter(has_text=message);text.dblclick(position={'x':8,'y':8},force=True)
    editor.fill(message+'-更新')
    def offline(route):
        if route.request.method in ('POST','PUT','PATCH','DELETE'):route.fulfill(status=503,content_type='application/json',body='{"detail":"offline"}')
        else:route.continue_()
    page.route('**/api/v1/files/**',offline)
    toolbar.get_by_role('button',name='画笔',exact=True).click();expect(editor).to_have_attribute('data-save-state','failed')
    toolbar.get_by_role('button',name='撤销笔迹',exact=True).click()
    toolbar.get_by_role('button',name='文字',exact=True).click();expect(editor).to_have_value(message+'-更新')
    page.unroute('**/api/v1/files/**',offline)
    assert page.evaluate('KGHomeInk.commitText()') is True
    expect(editor).to_have_count(0)
    saved=context.request.get(BASE+'/api/v1/files/'+file_id).json()['graphData']['strokes']
    assert any(s.get('text')==message+'-更新' for s in saved)
    page.reload(wait_until='networkidle');dismiss(page)
    expect(page.locator('.canvas-ink-layer text').filter(has_text=message+'-更新')).to_be_visible()
    assert len(creates)==1
    page.screenshot(path=str(OUT/'first-file-text-reload.png'));assert not errors,errors
    print('PASS first graph: one file creation, draft acknowledged/closed, failed-edit undo/retry, exact DB/reload text',flush=True)
    context.close()
    viewer=browser.new_context(viewport={'width':1440,'height':1000});login(viewer,'ink-viewer');page=viewer.new_page();writes=[]
    page.on('request',lambda request:writes.append(request.url) if request.method in ('POST','PUT','PATCH','DELETE') and urlparse(request.url).path.startswith('/api/v1/files') else None)
    page.goto(BASE+'/index.html?mode=free',wait_until='networkidle');dismiss(page)
    page.wait_for_function('window.KGHomeInk && window.KGGraphFileTabs && !KGGraphFileTabs.isSwitching()')
    assert page.evaluate('KGRolePermissions.can("editGraph")') is False
    assert page.evaluate('KGAuthRecovery.hasUnsavedChanges()') is False
    page.locator('#authStatus').click();page.locator('#accountMenuSessionBtn').click()
    page.wait_for_function('!KGAuthCore.currentUser()')
    assert viewer.request.get(BASE+'/api/v1/auth/me').status==401
    assert writes==[],writes
    page.screenshot(path=str(OUT/'viewer-logged-out.png'))
    (OUT/'results.json').write_text(json.dumps({'username':username,'fileId':file_id,'firstFileCreates':len(creates),'viewerGraphWrites':writes,'checks':['first-text-ack','failed-undo-retry','DB-reload','clean-viewer-UI-logout']},ensure_ascii=False,indent=2))
    print('PASS viewer: clean readonly logout through account-menu UI, no forbidden graph write',flush=True)
    viewer.close();admin.close();browser.close()
