#!/usr/bin/env python3
"""Real API/disposable DB regression: reading entry, ephemeral drag, readonly boundaries."""
import argparse
import json
import uuid
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
STATE = 'relatedCanvasController.session.getState()'
MODAL = '.related-canvas-backdrop'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', required=True)
    parser.add_argument('--output-dir', type=Path, default=ROOT/'artifacts/knowledge-universe-20261020/task-7')
    args = parser.parse_args()
    base = args.base_url.rstrip('/')
    assert urlparse(base).hostname in ('localhost', '127.0.0.1')
    out = args.output_dir.resolve(); out.mkdir(parents=True, exist_ok=True)
    evidence = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel='chrome')
        ctx = browser.new_context(viewport={'width': 1440, 'height': 1000})
        assert ctx.request.post(base+'/api/v1/auth/login', data={'username':'ink-browser', 'password':'ink-browser-test'}).ok
        graph = {'meta':{'title':'阅读相关画布'}, 'viewport':{'x':0,'y':0,'scale':1},
                 'nodes':[{'id':i,'title':i,'x':x,'y':y} for i,x,y in [('a',400,300),('b',750,300),('c',750,550)]],
                 'links':[{'id':'ab','from':'a','to':'b'}, {'id':'bc','from':'b','to':'c'}]}
        graph['nodes'][1]['locked'] = True
        response = ctx.request.post(base+'/api/v1/files', data={'name':'reading-'+uuid.uuid4().hex[:8], 'graphData':graph})
        assert response.ok, response.text()
        fid = response.json()['file']['id']
        assert ctx.request.put(base+'/api/v1/files/current', data={'fileId':fid}).ok
        page = ctx.new_page(); errors = []; writes = []; phase = 'load'
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('request', lambda req: writes.append({'url':req.url,'method':req.method,'phase':phase}) if '/api/v1/files' in req.url and req.method in ('POST','PUT','PATCH','DELETE') else None)

        def ready():
            page.wait_for_function('!!window.KGHomeInk && !KGGraphFileTabs.isSwitching()')
            for selector in ['#learningEntryDismissBtn','.tour-skip','#hideHelpBtn']:
                if page.locator(selector).is_visible(): page.locator(selector).click()

        def mode(value):
            page.locator('.graph-mode-trigger').click()
            page.locator('[data-graph-mode-option="'+value+'"]').click()
            assert page.evaluate('KGHomeInteractionModes.getMode()') == value

        def card(node_id='a'):
            return page.locator('.knowledge-card[data-node-id="'+node_id+'"]:not(.related-canvas-card)')

        def open_reading(node_id='a'):
            card(node_id).dblclick(position={'x':50,'y':25})
            expect(page.locator(MODAL)).to_have_count(1)
            expect(page.locator(MODAL)).to_be_visible()
            assert page.evaluate('!!relatedCanvasController.session && relatedCanvasController.session.kind==="temporary"')
            return page.locator(MODAL)

        def position(node_id):
            return page.evaluate('(id)=>{const n='+STATE+'.nodes.find(n=>n.id===id);return {x:n.x,y:n.y}}', node_id)

        def drag(node_id='a', cancel=False, edge=True):
            target = page.locator(MODAL+' .related-canvas-card[data-node-id="'+node_id+'"]')
            box = target.bounding_box(); before = position(node_id)
            stage_scale = page.locator(MODAL+' .related-canvas-stage').evaluate('e=>new DOMMatrix(getComputedStyle(e).transform).a')
            edge_before = page.locator(MODAL+' .related-canvas-edge').first.get_attribute('d') if edge else None
            x,y = box['x']+50,box['y']+25
            page.mouse.move(x,y); page.mouse.down(); page.mouse.move(x+80,y+40,steps=8)
            after = position(node_id)
            assert abs(after['x']-before['x']-80/stage_scale)<.6, (before,after,stage_scale)
            assert abs(after['y']-before['y']-40/stage_scale)<.6, (before,after,stage_scale)
            if edge: assert page.locator(MODAL+' .related-canvas-edge').first.get_attribute('d') != edge_before
            if cancel:
                page.locator(MODAL+' .related-canvas-body').dispatch_event('pointercancel', {'pointerId':1,'pointerType':'mouse'})
            page.mouse.up()
            ended = position(node_id)
            page.mouse.move(x+100,y+60)
            assert position(node_id) == ended, 'pointerup/cancel must stop dragging'
            assert not page.locator(MODAL+' .related-canvas-body').evaluate('e=>e.hasPointerCapture(1)')
            assert page.evaluate('relatedCanvasController.session.history.getState().transaction') == ''
            if cancel: assert ended == before, 'cancel rolls back only the active temporary drag'
            evidence.append({'drag':node_id,'cancel':cancel,'scale':stage_scale,'before':before,'after':after,'ended':ended})
            return before

        try:
            page.goto(base+'/index.html', wait_until='networkidle'); ready(); mode('reading')
            # Hover and single click preserve details without a mini-toolbar.
            card().hover(); page.wait_for_timeout(350)
            expect(page.locator('.node-style-toolbar')).to_be_hidden()
            card().click(position={'x':50,'y':25}); page.wait_for_timeout(180)
            page.screenshot(path=str(out/'reading-single-click.png'))
            expect(page.locator('.node-style-toolbar')).to_be_hidden()
            assert page.evaluate('state.selectedNodeId') == 'a'
            expect(page.locator('#detailPanel')).to_be_visible()
            # Interactive content consumes its own actions, not the card double-click.
            for tag, attrs in [('a',{'href':'#'}), ('button',{}), ('input',{}), ('textarea',{}), ('select',{}), ('div',{'contenteditable':'plaintext-only'})]:
                card().evaluate('(root,args)=>{const e=document.createElement(args.tag);e.id="reading-interactive";for(const [k,v] of Object.entries(args.attrs))e.setAttribute(k,v);e.textContent="交互内容";window.task7InteractiveEvents=0;e.addEventListener("dblclick",()=>window.task7InteractiveEvents++);e.style.cssText="display:block;width:100px;height:24px";root.append(e)}', {'tag':tag,'attrs':attrs})
                page.locator('#reading-interactive').dblclick(force=True)
                expect(page.locator(MODAL)).to_have_count(0)
                assert page.evaluate('task7InteractiveEvents') == 1, tag
                page.locator('#reading-interactive').evaluate('e=>e.remove()')
            formal = page.evaluate('JSON.stringify({nodes:state.nodes,links:state.links})')
            api_before = json.dumps(ctx.request.get(base+'/api/v1/files/'+fid).json()['graphData'], sort_keys=True, ensure_ascii=False)
            backdrop = open_reading(); writes.clear()
            for action in ['add','connect','delete','undo','redo','ink']:
                assert backdrop.locator('[data-action="'+action+'"]').count() == 0
            assert backdrop.locator('form').count() == 0
            expect(backdrop.locator('.related-canvas-header > div > span').first).to_contain_text('可拖动临时排列，关闭即丢弃')
            assert backdrop.locator('.related-canvas-card').count() == 2
            initial = position('a'); drag(); drag('b')
            page.screenshot(path=str(out/'reading-drag.png'))
            # Content commands remain blocked, including shortcuts.
            count = page.evaluate(STATE+'.nodes.length')
            page.keyboard.press('Delete')
            assert page.evaluate(STATE+'.nodes.length') == count
            # Browser-driven zoom, fullscreen and cancel retain coordinate conversion.
            box = backdrop.locator('.related-canvas-body').bounding_box()
            page.mouse.move(box['x']+box['width']*.7,box['y']+box['height']*.5)
            page.mouse.wheel(0,240); drag(cancel=True)
            backdrop.locator('[data-action="fullscreen"]').click()
            expect(backdrop).to_have_class('related-canvas-backdrop related-canvas-fullscreen')
            drag()
            backdrop.locator('[data-action="fullscreen"]').click()
            backdrop.locator('[data-action="close"]').click(); expect(page.locator(MODAL)).to_have_count(0)
            assert not writes, writes
            assert page.evaluate('JSON.stringify({nodes:state.nodes,links:state.links})') == formal
            open_reading(); assert position('a') == initial
            # Repeated double-clicks from the source still leave exactly one modal.
            page.evaluate('()=>{const e=document.querySelector(".knowledge-card:not(.related-canvas-card)");e.dispatchEvent(new MouseEvent("dblclick",{bubbles:true}));e.dispatchEvent(new MouseEvent("dblclick",{bubbles:true}))}')
            expect(page.locator(MODAL)).to_have_count(1)
            page.keyboard.press('Escape'); expect(page.locator(MODAL)).to_have_count(0)
            assert not writes, writes
            page.reload(wait_until='networkidle'); ready()
            assert json.dumps(ctx.request.get(base+'/api/v1/files/'+fid).json()['graphData'], sort_keys=True, ensure_ascii=False) == api_before
            assert [(n['id'],n['x'],n['y']) for n in page.evaluate('state.nodes')] == [('a',400,300),('b',750,300),('c',750,550)]
            evidence.append({'readingToolbar':False,'modalWrites':0,'formalAndApiUnchanged':True,'reopenRestored':True})
            # Other modes keep their toolbar and original inline edit double-click.
            for value in ['efficient','professional']:
                mode(value); card().click(position={'x':50,'y':25})
                expect(page.locator('.node-style-toolbar')).to_be_visible()
                expect(page.locator('.node-style-toolbar [data-node-toolbar-action="related-canvas"]')).to_be_visible()
                card().dblclick(position={'x':50,'y':25})
                expect(page.locator('[data-node-inline-editor="true"]')).to_have_count(1)
                expect(page.locator(MODAL)).to_have_count(0)
                page.keyboard.press('Escape')
                # Finish the formal edit setup's existing 400ms server debounce first.
                # Opening's original force-save remains a distinct, permitted boundary.
                page.wait_for_timeout(500)
                page.wait_for_function('!KGGraphFileAutosave.status().saving && !KGGraphFileAutosave.isDirty()')
                formal_mode = page.evaluate('JSON.stringify({nodes:state.nodes,links:state.links})')
                page.locator('.node-style-toolbar [data-node-toolbar-action="related-canvas"]').click()
                expect(page.locator(MODAL)).to_have_count(1)
                backdrop = page.locator(MODAL); expect(backdrop.locator('[data-action="add"]')).to_be_visible()
                api_mode = json.dumps(ctx.request.get(base+'/api/v1/files/'+fid).json()['graphData'], sort_keys=True)
                writes.clear(); phase = 'drag'; drag(); assert not writes,writes
                phase = 'undo'; backdrop.locator('[data-action="undo"]').click(); assert not writes,writes
                phase = 'redo'; backdrop.locator('[data-action="redo"]').click(); assert not writes,writes
                phase = 'add'; backdrop.locator('[data-action="add"]').click(); assert not writes,writes
                assert page.evaluate(STATE+'.nodes.length') == 3
                phase = 'ink'; backdrop.locator('[data-action="ink"]').click(); assert not writes,writes
                expect(backdrop.locator('.canvas-ink-toolbar')).to_be_visible()
                # Shared local ink/history remain functional; draw on free viewport.
                ink_tool = backdrop.locator('button[data-ink-tool="pen"]'); ink_tool.click()
                body = backdrop.locator('.related-canvas-body').bounding_box()
                page.mouse.move(body['x']+body['width']*.6,body['y']+body['height']*.8)
                page.mouse.down(); page.mouse.move(body['x']+body['width']*.7,body['y']+body['height']*.85,steps=8); page.mouse.up()
                assert page.evaluate(STATE+'.strokes.length') == 1; assert not writes,writes
                page.keyboard.press('Escape'); expect(backdrop).to_be_visible()
                page.keyboard.press('Escape'); expect(page.locator(MODAL)).to_have_count(0)
                assert not writes, writes
                assert page.evaluate('JSON.stringify({nodes:state.nodes,links:state.links})') == formal_mode
                assert json.dumps(ctx.request.get(base+'/api/v1/files/'+fid).json()['graphData'], sort_keys=True) == api_mode
                evidence.append({'mode':value,'toolbarAndInlineEditPreserved':True,'temporaryAddInkHistory':True})
            mode('reading'); expect(page.locator('.node-style-toolbar')).to_be_hidden()
            assert not errors, errors
            ctx.close()
            # Legal authenticated readonly viewer with a genuinely owned persisted graph.
            ctx = browser.new_context(viewport={'width':1440,'height':1000})
            assert ctx.request.post(base+'/api/v1/auth/login', data={'username':'ink-viewer','password':'ink-browser-test'}).ok
            viewer_id = 'role-graph-ink-viewer'
            before = json.dumps(ctx.request.get(base+'/api/v1/files/'+viewer_id).json()['graphData'], sort_keys=True)
            assert ctx.request.put(base+'/api/v1/files/current', data={'fileId':viewer_id}).ok
            page = ctx.new_page(); writes.clear(); errors.clear()
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('request', lambda req: writes.append(req.url) if '/api/v1/files' in req.url and req.method in ('POST','PUT','PATCH','DELETE') else None)
            page.goto(base+'/index.html', wait_until='networkidle'); ready(); mode('reading')
            assert page.evaluate('KGRolePermissions.currentRole()') == 'viewer'
            assert not page.evaluate('canWriteGraph()')
            card('role-a').click(position={'x':50,'y':25})
            expect(page.locator('.node-style-toolbar')).to_be_hidden()
            open_reading('role-a'); writes.clear(); initial = position('role-a'); drag('role-a',edge=False)
            for action in ['add','delete','connect','ink','undo','redo']:
                assert page.locator(MODAL+' [data-action="'+action+'"]').count() == 0
            page.screenshot(path=str(out/'viewer-drag.png'))
            page.keyboard.press('Delete'); assert page.evaluate(STATE+'.nodes.length') == 1
            page.keyboard.press('Escape'); open_reading('role-a'); assert position('role-a') == initial
            page.keyboard.press('Escape'); assert not writes, writes
            denied = ctx.request.put(base+'/api/v1/files/'+viewer_id, data={'graphData':{'nodes':[],'links':[]}})
            assert denied.status == 403, (denied.status,denied.text())
            page.reload(wait_until='networkidle'); ready()
            after = json.dumps(ctx.request.get(base+'/api/v1/files/'+viewer_id).json()['graphData'], sort_keys=True)
            assert before == after
            assert not page.evaluate('canWriteGraph()')
            assert not errors, errors
            for alias in ['index.html','workbench.html']:
                page.goto(base+'/'+alias, wait_until='networkidle'); ready(); mode('reading')
                writes.clear(); open_reading('role-a'); drag('role-a',edge=False); page.keyboard.press('Escape')
                assert not writes, writes
                for value in ['efficient','professional']:
                    mode(value); card('role-a').dblclick(position={'x':50,'y':25})
                    expect(page.locator(MODAL)).to_have_count(0)
                    expect(page.locator('[data-node-inline-editor="true"]')).to_have_count(0)
                    assert not page.evaluate('canWriteGraph()')
                page.locator('[data-account-menu-trigger]').click()
                page.locator('[aria-label="退出登录"]').click()
                page.wait_for_function('!KGAuthCore.currentUser()')
                page.locator('[data-account-menu-trigger]').click()
                page.locator('#accountMenuSessionBtn').click()
                expect(page.locator('#authModal')).to_be_visible()
                page.locator('#authCloseBtn').click()
                # Real API session authentication on disposable DB, no legal checkbox acceptance.
                assert ctx.request.post(base+'/api/v1/auth/login',data={'username':'ink-viewer','password':'ink-browser-test'}).ok
                page.goto(base+'/'+alias,wait_until='networkidle'); ready()
                assert page.evaluate('KGAuthCore.currentUser().username') == 'ink-viewer'
                assert json.dumps(ctx.request.get(base+'/api/v1/files/'+viewer_id).json()['graphData'],sort_keys=True) == before
                evidence.append({'alias':alias,'viewerDoubleClickAndDrag':True,'otherModeEditBlocked':True,'uiLogoutAndLoginDialog':True,'apiLogin':True,'modalWrites':0})
            assert not errors, errors
            evidence.append({'actualViewerOwnedFile':viewer_id,'editForbiddenStatus':denied.status,'modalWrites':0,'apiUnchanged':True,'formalPermissionUnchanged':True})
            (out/'result.json').write_text(json.dumps({'status':'PASS','checks':evidence}, ensure_ascii=False, indent=2))
            print('PASS reading double click, ephemeral drag/zoom/cancel, API isolation, other modes, viewer 403', flush=True)
        except Exception as error:
            page.screenshot(path=str(out/'failure.png'))
            (out/'result.json').write_text(json.dumps({'status':'FAIL','error':str(error),'saveTraces':page.evaluate('window.task7Saves||[]'),'checks':evidence}, ensure_ascii=False, indent=2))
            raise
        finally:
            browser.close()

if __name__ == '__main__':
    main()
