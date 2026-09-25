#!/usr/bin/env python3
"""Real-page ink acceptance checks against disposable PostgreSQL/FastAPI.

Sync first: node frontend/scripts/sync-new-legacy.js
Run: python3 new-legacy/tests/canvas-ink-browser.py --backend-python /path/to/backend/.venv/bin/python
The optional --base-url must point at helpers/canvas_ink_server.py, never production.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import socket
import subprocess
import time
from urllib.parse import urlparse
from urllib.request import urlopen
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[2]
ARTIFACTS=ROOT/'artifacts/canvas-ink'
RECALL='/knowledge-recall.html?questionId=ink-question-1&bankId=ink-bank&paperId=ink-paper&releaseId=ink-release'
WORKSPACE='/question-workspace.html?paperId=ink-paper&releaseId=ink-release'
RESULTS=[]

def record(name):
    RESULTS.append(name)
    print('PASS '+name,flush=True)

def stroke_count(page,n):
    try:
        expect(page.locator('.canvas-ink-layer path')).to_have_count(n)
    except AssertionError:
        page.screenshot(path=str(ARTIFACTS/'failure.png'))
        print(page.evaluate('({url:location.href,tool:document.querySelector("[data-ink-tool][aria-pressed=true]")?.dataset.inkTool})'),flush=True)
        raise

def draw(page,card,dy=0):
    page.wait_for_timeout(500)  # Card entry/focus transitions must settle before coordinates are sampled.
    box=page.locator(card).bounding_box()
    assert box,card
    x=box['x']+min(55,box['width']/5)
    y=box['y']+min(100,box['height']/2)+dy
    page.mouse.move(x,y)
    page.mouse.down()
    page.mouse.move(x+40,y-15,steps=6)
    page.mouse.move(x+120,y+10,steps=10)
    page.mouse.up()

def flush(page,kind):
    if kind=='workspace':
        page.evaluate('window.KGCanvasWorkspaceAdapter.flush()')
    else:
        assert page.evaluate("window.KGLearningProgress.flush('deep_recall')") is True
        page.wait_for_function("document.querySelector('#krSaveStatus')?.dataset.state === 'saved'",timeout=15000)

def persisted(context,base,kind):
    if kind=='recall':
        response=context.request.get(base+'/api/v1/recall/session/ink-question-1?releaseId=ink-release')
        assert response.ok,response.text()
        return response.json()['progress']['strokes']
    response=context.request.get(base+'/api/v1/workspaces')
    assert response.ok,response.text()
    return next(w['payload']['strokes'] for w in response.json()['workspaces'] if w['payload'].get('id')=='pmp-pattern-workspace')

def check_page(context,base,kind):
    page=context.new_page()
    errors=[]
    page.on('pageerror',lambda error: errors.append(str(error)))
    page.goto(base+(RECALL if kind=='recall' else WORKSPACE),wait_until='networkidle')
    page.wait_for_function('!!window.'+('KGRecallInk' if kind=='recall' else 'KGWorkspaceInk'))
    if kind=='workspace':
        for name in ('pen','highlighter','select'):
            page.locator('.canvas-ink-toolbar [data-ink-tool='+name+']').click(timeout=5000)
        record('workspace: empty-state ink controls are unobstructed')
        page.locator('#qwQuestionDockBtn').click()
        page.locator('[data-add-index]').first.click()
        page.keyboard.press('Escape')
        page.evaluate('window.KGMultiQuestionWorkspace.closeQuestionDrawer()')
        card='.qw-question-card'
        expect(page.locator(card)).to_have_count(1)
    else:
        card='#krQuestionCard'
    page.wait_for_timeout(500)
    tool=page.locator('.canvas-ink-toolbar')
    stroke_count(page,0)
    before=page.locator(card).bounding_box()
    tool.locator('[data-ink-tool=pen]').click()
    tool.locator('[data-ink-color="#ef4444"]').click()
    tool.get_by_label('笔迹粗细',exact=True).fill('7')
    draw(page,card)
    stroke_count(page,1)
    first=page.locator('.canvas-ink-layer path').first
    expect(first).to_have_attribute('stroke','#ef4444')
    expect(first).to_have_attribute('stroke-width','7')
    expect(first).to_have_attribute('opacity','1')
    after=page.locator(card).bounding_box()
    assert abs(before['x']-after['x'])<1 and abs(before['y']-after['y'])<1,'Drawing moved card'
    tool.locator('[data-ink-tool=highlighter]').click()
    tool.locator('[data-ink-color="#22c55e"]').click()
    tool.get_by_label('笔迹粗细',exact=True).fill('24')
    draw(page,card,30)
    stroke_count(page,2)
    expect(page.locator('.canvas-ink-layer path').nth(1)).to_have_attribute('opacity','0.3')
    expect(page.locator('.canvas-ink-layer path').nth(1)).to_have_attribute('stroke-width','24')
    tool.locator('[data-ink-tool=pen]').click()
    expect(tool.get_by_label('笔迹粗细',exact=True)).to_have_value('7')
    expect(tool.locator('[data-ink-color="#ef4444"]')).to_have_attribute('aria-pressed','true')
    record(kind+': pen/highlighter, independent color/width, draw over card without dragging')

    # Native touch events exercise the same pointer lifecycle (fixed width).
    box=page.locator(card).bounding_box()
    cdp=context.new_cdp_session(page)
    touch={'x':box['x']+75,'y':box['y']+50}
    cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[touch]})
    cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':touch['x']+80,'y':touch['y']+25}]})
    cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
    stroke_count(page,3)
    # Cancel rather than complete a captured pointer.
    page.mouse.move(box['x']+90,box['y']+60)
    page.mouse.down()
    page.mouse.move(box['x']+100,box['y']+80)
    page.evaluate("window.dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,bubbles:true}))")
    page.mouse.up()
    stroke_count(page,3)
    page.keyboard.press('Escape')
    expect(tool.locator('[data-ink-tool=select]')).to_have_attribute('aria-pressed','true')
    record(kind+': touch stroke, pointercancel, Escape')

    undo=page.locator('#qwUndoBtn') if kind=='workspace' else tool.locator('[data-ink-action=undo]')
    redo=page.locator('#qwRedoBtn') if kind=='workspace' else tool.locator('[data-ink-action=redo]')
    undo.click();stroke_count(page,2)
    redo.click();stroke_count(page,3)
    page.once('dialog',lambda d:d.dismiss())
    tool.locator('[data-ink-action=clear]').click();stroke_count(page,3)
    page.once('dialog',lambda d:d.accept())
    tool.locator('[data-ink-action=clear]').click();stroke_count(page,0)
    undo.click();stroke_count(page,3)
    expect(page.locator(card)).to_have_count(1)
    record(kind+': undo/redo and clear cancel/confirm/undo preserve cards')

    paths=page.locator('.canvas-ink-layer path').evaluate_all('(els)=>els.map(e=>e.getAttribute("d"))')
    zoom=page.locator('#qwZoomInBtn' if kind=='workspace' else '#krZoomInBtn')
    old=page.locator('.canvas-ink-layer path').first.bounding_box()
    zoom.click()
    page.wait_for_timeout(200)
    new=page.locator('.canvas-ink-layer path').first.bounding_box()
    assert new['width']>old['width'],'Zoom did not scale path'
    assert paths==page.locator('.canvas-ink-layer path').evaluate_all('(els)=>els.map(e=>e.getAttribute("d"))'),'Zoom changed world coordinates'
    # Right-button pan must move card and stroke together.
    old_card=page.locator(card).bounding_box();old_path=page.locator('.canvas-ink-layer path').first.bounding_box()
    viewport=page.locator('#qwCanvasViewport' if kind=='workspace' else '#krViewport').bounding_box()
    px=viewport['x']+viewport['width']*.7;py=viewport['y']+viewport['height']*.7
    page.mouse.move(px,py);page.mouse.down(button='right');page.mouse.move(px+75,py+45,steps=8);page.mouse.up(button='right')
    page.wait_for_timeout(150)
    new_card=page.locator(card).bounding_box();new_path=page.locator('.canvas-ink-layer path').first.bounding_box()
    assert abs((new_path['x']-old_path['x'])-(new_card['x']-old_card['x']))<1
    assert abs(new_path['x']-old_path['x'])>20,'Pan did not move canvas'
    record(kind+': zoom/pan retain world-coordinate anchoring')
    page.screenshot(path=str(ARTIFACTS/(kind+'-drawn.png')))
    flush(page,kind)
    saved=persisted(context,base,kind)
    assert len(saved)==3,saved
    page.reload(wait_until='networkidle')
    stroke_count(page,3)
    assert paths==page.locator('.canvas-ink-layer path').evaluate_all('(els)=>els.map(e=>e.getAttribute("d"))')
    record(kind+': API reads persisted strokes; reload restores exact world paths')

    if kind=='recall':
        with page.expect_response(lambda response:'/api/v1/recall/session/ink-question-2' in response.url):
            page.locator('#krNextQuestionBtn').click()
        page.wait_for_url('**questionId=ink-question-2*')
        page.wait_for_load_state('networkidle')
        stroke_count(page,0)
        expect(tool.locator('[data-ink-action=undo]')).to_be_disabled()
        with page.expect_response(lambda response:'/api/v1/recall/session/ink-question-1' in response.url):
            page.locator('#krPrevQuestionBtn').click()
        page.wait_for_url('**questionId=ink-question-1*')
        page.wait_for_load_state('networkidle')
        stroke_count(page,3)
    else:
        old_id=page.evaluate('KGMultiQuestionWorkspace.activeWorkspaceId()')
        page.once('dialog',lambda d:d.accept('第二笔迹画布'))
        page.evaluate('KGMultiQuestionWorkspace.createWorkspace()')
        stroke_count(page,0)
        expect(page.locator('#qwUndoBtn')).to_be_disabled()
        page.evaluate('(id)=>KGMultiQuestionWorkspace.loadWorkspace(id)',old_id)
        stroke_count(page,3)
    record(kind+': switch isolation and fresh history')

    if kind=='recall':
        def fail_save(route):
            if route.request.method=='PUT': route.fulfill(status=503,json={'detail':'Simulated browser test save failure'})
            else: route.continue_()
        page.route('**/api/v1/recall/progress/**',fail_save)
        tool.locator('[data-ink-tool=pen]').click()
        draw(page,card,10)
        stroke_count(page,4)
        expect(page.locator('#krSaveRetryBtn')).to_be_visible(timeout=15000)
        assert len(persisted(context,base,kind))==3
        page.unroute('**/api/v1/recall/progress/**',fail_save)
        page.locator('#krSaveRetryBtn').click()
        flush(page,kind)
        assert len(persisted(context,base,kind))==4
        record(kind+': failed save visible, retry restores database persistence')
    else:
        def fail_workspace(route):
            if route.request.method in ('PUT','POST'): route.fulfill(status=503,json={'detail':'Simulated browser test save failure'})
            else: route.continue_()
        page.route('**/api/v1/workspaces**',fail_workspace)
        tool.locator('[data-ink-tool=pen]').click()
        draw(page,card,10)
        stroke_count(page,4)
        expect(page.locator('#qwWorkspaceSaveState')).to_have_class(__import__('re').compile(r'.*is-error.*'),timeout=15000)
        assert len(persisted(context,base,kind))==3
        page.unroute('**/api/v1/workspaces**',fail_workspace)
        page.locator('#qwWorkspaceSaveState').click()
        expect(page.locator('#qwWorkspaceSaveState')).not_to_have_class(__import__('re').compile(r'.*is-error.*'),timeout=15000)
        flush(page,kind)
        assert len(persisted(context,base,kind))==4
        record(kind+': failed save visible, manual retry restores database persistence')
    page.keyboard.press('Escape')
    page.wait_for_timeout(450)
    answer=page.locator(card+' [data-qw-option-key="A"]')
    answer.click()
    expect(answer).to_have_attribute('aria-pressed','true')
    record(kind+': choosing an answer works again after exiting pen mode')
    flush(page,kind)
    assert not errors,errors
    page.close()

def check_viewer(browser,base):
    context=browser.new_context(viewport={'width':1440,'height':1000})
    assert context.request.post(base+'/api/v1/auth/login',data={'username':'ink-viewer','password':'ink-browser-test'}).ok
    for kind,url in [('workspace',WORKSPACE+'&workspace=viewer-workspace'),('recall',RECALL)]:
        page=context.new_page()
        errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(base+url,wait_until='networkidle')
        if kind=='recall':
            expect(page.get_by_text('暂无访问权限')).to_be_visible()
            assert not errors,errors
            record('recall: existing viewer restriction denies non-demo question')
            page.close()
            continue
        stroke_count(page,1)
        tool=page.locator('.canvas-ink-toolbar')
        for selector in ('[data-ink-tool=pen]','[data-ink-tool=highlighter]','[data-ink-action=clear]'):
            expect(tool.locator(selector)).to_be_disabled()
        page.mouse.move(650,430);page.mouse.down();page.mouse.move(750,460,steps=8);page.mouse.up()
        stroke_count(page,1)
        page.screenshot(path=str(ARTIFACTS/(kind+'-readonly.png')))
        if kind=='workspace':
            response=context.request.put(base+'/api/v1/workspaces/viewer-workspace',data={'payload':{'strokes':[]}})
            assert response.status==403,response.text()
        assert not errors,errors
        record(kind+': actual viewer sees saved stroke but cannot draw/clear')
        page.close()
    context.close()

def check_recall_readonly(context,base):
    # The existing viewer policy permits only a built-in demo. Exercise the
    # page's readonly-session branch while keeping real DB ink/read requests.
    page=context.new_page()
    errors=[]
    writes=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.on('request',lambda request:writes.append(request.url) if request.method=='PUT' and '/recall/progress/' in request.url else None)
    def readonly_session(route):
        response=route.fetch()
        payload=response.json()
        payload['permissions'].update(canWrite=False,canReset=False,readOnly=True)
        route.fulfill(response=response,json=payload)
    page.route('**/api/v1/recall/session/**',readonly_session)
    page.goto(base+RECALL,wait_until='networkidle')
    stroke_count(page,4)
    for selector in ('[data-ink-tool=pen]','[data-ink-tool=highlighter]','[data-ink-action=clear]'):
        expect(page.locator('.canvas-ink-toolbar '+selector)).to_be_disabled()
    draw(page,'#krQuestionCard')
    stroke_count(page,4)
    assert not writes,writes
    assert not errors,errors
    page.screenshot(path=str(ARTIFACTS/'recall-readonly.png'))
    record('recall: readonly session preserves saved ink, disables editing, sends no writes')
    page.close()

def check_recall_reset(context,base):
    page=context.new_page()
    page.goto(base+RECALL,wait_until='networkidle')
    stroke_count(page,4)
    page.once('dialog',lambda dialog:dialog.dismiss())
    page.locator('#krResetBtn').click();stroke_count(page,4)
    page.once('dialog',lambda dialog:dialog.accept())
    page.locator('#krResetBtn').click();stroke_count(page,0)
    assert persisted(context,base,'recall')==[]
    expect(page.locator('#krQuestionCard')).to_have_count(1)
    record('recall: reset cancel/confirm clears persisted ink for current release')
    page.close()

def check_switch_save_barriers(context,base,kind):
    page=context.new_page()
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    if kind=='workspace':
        payload={'id':'ink-switch-target','title':'切换保存测试','schemaVersion':10,'nodes':{},'edges':[],'groups':[],'strokes':[]}
        response=context.request.post(base+'/api/v1/workspaces',data={'id':'ink-switch-target','title':payload['title'],'schemaVersion':10,'payload':payload})
        assert response.ok,response.text()
    page.goto(base+(RECALL if kind=='recall' else WORKSPACE+'&workspace=pmp-pattern-workspace'),wait_until='networkidle')
    card='#krQuestionCard' if kind=='recall' else '.qw-question-card'
    tool=page.locator('.canvas-ink-toolbar')
    old_id='ink-question-1' if kind=='recall' else page.evaluate('KGMultiQuestionWorkspace.activeWorkspaceId()')
    initial=page.locator('.canvas-ink-layer path').count()
    pattern='**/api/v1/recall/progress/**' if kind=='recall' else '**/api/v1/workspaces**'
    def fail(route):
        if route.request.method=='PUT': route.fulfill(status=503,json={'detail':'Failed switch save'})
        else: route.continue_()
    page.route(pattern,fail)
    tool.locator('[data-ink-tool=pen]').click();draw(page,card)
    stroke_count(page,initial+1)
    if kind=='recall':
        page.locator('#krNextQuestionBtn').click()
        expect(page.locator('#krSaveRetryBtn')).to_be_visible(timeout=15000)
        assert 'questionId='+old_id in page.url
    else:
        result=page.evaluate("KGMultiQuestionWorkspace.loadWorkspace('ink-switch-target')")
        assert result is False,result
        assert page.evaluate('KGMultiQuestionWorkspace.activeWorkspaceId()')==old_id
    stroke_count(page,initial+1)
    expect(tool.locator('[data-ink-tool=pen]')).to_be_enabled()
    page.unroute(pattern,fail)
    flush(page,kind)

    held=[]
    release_pending=False
    def delay(route):
        if route.request.method=='PUT' and not release_pending: held.append(route)
        else: route.continue_()
    page.route(pattern,delay)
    tool.locator('[data-ink-tool=pen]').click();draw(page,card,15)
    stroke_count(page,initial+2)
    if kind=='recall': page.locator('#krNextQuestionBtn').click()
    else: page.evaluate("void KGMultiQuestionWorkspace.loadWorkspace('ink-switch-target')")
    for _ in range(100):
        if held: break
        page.wait_for_timeout(50)
    assert held,'Switch did not await a PUT'
    expect(tool.locator('[data-ink-tool=pen]')).to_be_disabled()
    draw(page,card,20)
    stroke_count(page,initial+2)
    # Resume the genuine server write after verifying the frozen UI.
    release_pending=True
    for route in list(held): route.continue_()
    page.unroute(pattern,delay)
    if kind=='recall':
        page.wait_for_url('**questionId=ink-question-2*')
    else:
        page.wait_for_function("KGMultiQuestionWorkspace.activeWorkspaceId()==='ink-switch-target'")
    page.wait_for_load_state('networkidle')
    stroke_count(page,0)
    assert len(persisted(context,base,kind))==initial+2
    assert not errors,errors
    record(kind+': failed save blocks switching; pending save freezes drawing until durable switch')
    page.close()

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url')
    parser.add_argument('--kind',choices=['workspace','recall','all'],default='all')
    parser.add_argument('--backend-python',default=str(ROOT/'backend/.venv/bin/python'))
    parser.add_argument('--chrome',default='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    args=parser.parse_args()
    ARTIFACTS.mkdir(parents=True,exist_ok=True)
    server=None;log=None
    try:
        if args.base_url:
            base=args.base_url.rstrip('/')
            assert urlparse(base).hostname in ('127.0.0.1','localhost'),'Disposable local server only'
        else:
            with socket.socket() as sock:
                sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
            base=f'http://127.0.0.1:{port}'
            log=open(ARTIFACTS/'server.log','w')
            server=subprocess.Popen([args.backend_python,str(ROOT/'new-legacy/tests/helpers/canvas_ink_server.py'),'--port',str(port)],cwd=ROOT,stdout=log,stderr=subprocess.STDOUT)
            for _ in range(240):
                if server.poll() is not None: raise RuntimeError('Disposable server failed; see artifacts/canvas-ink/server.log')
                try:
                    with urlopen(base+'/api/v1/health',timeout=1): break
                except Exception: time.sleep(.25)
            else: raise RuntimeError('Disposable server did not become ready')
        with sync_playwright() as playwright:
            browser=playwright.chromium.launch(executable_path=args.chrome,headless=True)
            context=browser.new_context(viewport={'width':1440,'height':1000},has_touch=True)
            login=context.request.post(base+'/api/v1/auth/login',data={'username':'ink-browser','password':'ink-browser-test'})
            assert login.ok,login.text()
            for kind in (('workspace','recall') if args.kind=='all' else (args.kind,)): check_page(context,base,kind)
            check_viewer(browser,base)
            if args.kind in ('all','recall'):
                check_recall_readonly(context,base)
                check_recall_reset(context,base)
            for kind in (('workspace','recall') if args.kind=='all' else (args.kind,)):
                check_switch_save_barriers(context,base,kind)
            browser.close()
        (ARTIFACTS/'results.json').write_text(json.dumps({'passed':RESULTS},ensure_ascii=False,indent=2))
        print(f'{len(RESULTS)} browser checks passed; screenshots: {ARTIFACTS}',flush=True)
    finally:
        if server:
            server.terminate()
            try: server.wait(timeout=15)
            except subprocess.TimeoutExpired: server.kill();server.wait()
        if log: log.close()

if __name__=='__main__': main()
