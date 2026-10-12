"""Actual file inputs, zero-write preview, selection, PNG/notes/styles and edit/reopen."""
import argparse,json
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[2]
FIX=ROOT/'backend/tests/fixtures/xmind'

def main():
    p=argparse.ArgumentParser();p.add_argument('--base-url',required=True);base=p.parse_args().base_url.rstrip('/');assert base.startswith('http://127.0.0.1:')
    expected=json.loads((FIX/'expected.json').read_text())
    with sync_playwright() as pw:
        browser=pw.chromium.launch(channel='chrome');ctx=browser.new_context(viewport={'width':1440,'height':1000})
        assert ctx.request.post(base+'/api/v1/auth/login',data={'username':'ink-browser','password':'ink-browser-test'}).ok
        baseline=ctx.request.get(base+'/api/v1/files').json()['total']
        original=ctx.request.post(base+'/api/v1/files',data={'name':'Original keep','graphData':{'nodes':[],'links':[]}}).json()['file']['id']
        assert ctx.request.put(base+'/api/v1/files/current',data={'fileId':original}).ok
        page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto(base+'/index.html',wait_until='networkidle');page.wait_for_function('!KGGraphFileTabs.isSwitching()')
        for _ in range(8):
            if page.locator('.tour-skip').is_visible():page.locator('.tour-skip').click()
            if page.locator('#learningEntryDismissBtn').is_visible():page.locator('#learningEntryDismissBtn').click()
            page.wait_for_timeout(250)
        if page.locator('#flowModeBtn').evaluate("el=>el.classList.contains('active-toggle')"):page.locator('#flowModeBtn').click()
        if page.locator('#hideHelpBtn').is_visible():page.locator('#hideHelpBtn').click()
        page.locator('#importFile').set_input_files(str(FIX/'xmind-24.04-desktop-rich.xmind'))
        page.locator('[data-xmind-sheet]').nth(1).wait_for();assert page.locator('[data-xmind-sheet]:checked').count()==2
        assert ctx.request.get(base+'/api/v1/files').json()['total']==baseline+1
        assert page.locator('#xmindConfirm').is_disabled();page.locator('[data-xmind-sheet]').nth(1).uncheck();assert page.locator('[data-xmind-sheet]:checked').count()==1
        page.screenshot(path=str(ROOT/'artifacts/canvas-m2-m5/t12/native-preview.png'))
        page.locator('#xmindAcceptWarnings').check();page.locator('#xmindConfirm').click();page.locator('[data-xmind-result]').wait_for();assert page.locator('[data-xmind-result]').count()==1
        first=page.locator('[data-xmind-result]').get_attribute('data-xmind-result');assert ctx.request.get(base+'/api/v1/files').json()['total']==baseline+2
        assert ctx.request.get(base+'/api/v1/files/current').json()['fileId']==original
        page.locator('[data-xmind-result]').click();page.wait_for_function('!KGGraphFileTabs.isSwitching() && state.nodes.length===9')
        page.wait_for_function("document.querySelector('.graph-card-image')?.naturalWidth>0")
        assert page.evaluate("(()=>{const img=document.querySelector('.graph-card-image'),i=img.getBoundingClientRect(),c=img.closest('.knowledge-card').getBoundingClientRect();return i.height>0 && i.top>=c.top && i.bottom<=c.bottom+1})()"),'card image must visibly fit inside card'
        nodes=page.evaluate('state.nodes');links=page.evaluate('state.links');byid={n['id']:n for n in nodes}
        for n in expected['sheets'][0]['nodes']:
            assert byid[n['id']]['content']['title']==n['title'];assert byid[n['id']]['content']['notes']==n['notes']
            if n['parentId']:assert any(l['from']==n['parentId'] and l['to']==n['id'] and l['hierarchy'] for l in links)
        page.evaluate("state.viewport={x:220,y:160-state.nodes[0].y,scale:1};state.selectedNodeId=state.nodes[0].id;render();renderDetails()")
        if page.locator('[data-graph-mode-exit]').is_visible():page.locator('[data-graph-mode-exit]').click()
        page.wait_for_timeout(650)
        page.screenshot(path=str(ROOT/'artifacts/canvas-m2-m5/t12/native-imported.png'))
        page.locator('#detailActionsToggle').click();page.locator('#editFromDetailBtn').click();page.locator('#nTitle').fill('编辑后的中文主题');page.locator('#saveNodeBtn').click()
        assert page.evaluate('state.nodes[0].title')=='编辑后的中文主题'
        assert page.evaluate('save({force:true})')
        saved=page.evaluate('saveableState()');page.reload(wait_until='networkidle');page.wait_for_function('!KGGraphFileTabs.isSwitching() && state.nodes.length===9');assert page.evaluate('saveableState()')==saved
        page.wait_for_function("document.querySelector('.graph-card-image')?.naturalWidth>0")
        # Import the real native second sheet separately through selection; explicit root 26pt/700.
        page.locator('#importFile').set_input_files(str(FIX/'xmind-24.04-desktop-rich.xmind'));page.locator('[data-xmind-sheet]').nth(1).wait_for();page.locator('[data-xmind-sheet]').nth(0).uncheck();page.locator('#xmindAcceptWarnings').check();page.locator('#xmindConfirm').click();page.locator('[data-xmind-result]').click();page.wait_for_function('!KGGraphFileTabs.isSwitching() && state.nodes.length===5')
        root=page.evaluate('state.nodes[0]');assert root['appearance']['fontSize']==34.67;assert root['appearance']['fontWeight']=='bold'
        assert root['content']['title']==expected['sheets'][1]['rootTitle']
        assert page.evaluate('save({force:true})');saved=page.evaluate('saveableState()');page.reload(wait_until='networkidle');page.wait_for_function('!KGGraphFileTabs.isSwitching() && state.nodes.length===5');assert page.evaluate('saveableState()')==saved
        # Same shared controller from the independent file library UI; XML all sheets.
        page.goto(base+'/file-manager.html',wait_until='networkidle');page.locator('#fmFileInput').set_input_files(str(FIX/'xml-only-synthetic.xmind'));page.locator('[data-xmind-sheet]').nth(1).wait_for();assert page.locator('[data-xmind-sheet]:checked').count()==2
        page.locator('#xmindAcceptWarnings').check();page.locator('#xmindConfirm').click();page.locator('[data-xmind-result]').nth(1).wait_for();assert page.locator('[data-xmind-result]').count()==2
        xml=page.locator('[data-xmind-result]').nth(0).get_attribute('data-xmind-result');page.get_by_role('button',name='关闭',exact=True).click()
        page.locator('[data-file-id="'+xml+'"]').wait_for()
        assert ctx.request.put(base+'/api/v1/files/current',data={'fileId':xml}).ok
        page.goto(base+'/index.html',wait_until='networkidle');page.wait_for_function('!KGGraphFileTabs.isSwitching() && state.nodes.length===3');page.wait_for_function("document.querySelector('.graph-card-image')?.naturalWidth>0")
        root=page.evaluate('state.nodes[0]');assert root['content']['notes']=='XML 中文备注\n完整保留。';assert root['appearance']['fillColor']=='#ffeecc';assert root['appearance']['fontSize']==26.67;assert root['appearance']['textColor']=='#112233';assert root['appearance']['fontWeight']=='bold';assert root['appearance']['cardStyle']=='rounded'
        assert page.evaluate("state.links.every(l=>l.hierarchy && l.lineStyle==='dashed' && l.strokeWidth===2.67)")
        page.evaluate("state.selectedNodeId='xml-root';renderDetails()");assert page.locator('.graph-detail-image').count()==1
        page.evaluate("KGGraphModel.updateContent(state.nodes[0],{notes:'XML 编辑备注'});render();save({force:true})");saved=page.evaluate('saveableState()');page.reload(wait_until='networkidle');page.wait_for_function('!KGGraphFileTabs.isSwitching() && state.nodes.length===3');assert page.evaluate('saveableState()')==saved
        assert ctx.request.get(base+'/api/v1/files/'+original).json()['graphData']['nodes']==[]
        assert not errors,errors
        if page.locator('#hideHelpBtn').is_visible():
            page.locator('#stage').click(position={'x':1000,'y':700});page.locator('#hideHelpBtn').click()
        page.evaluate("state.viewport={x:220,y:160-state.nodes[0].y,scale:1};state.selectedNodeId='xml-root';render();renderDetails()")
        if page.locator('.tour-skip').is_visible():page.locator('.tour-skip').click()
        if page.locator('[data-graph-mode-exit]').is_visible():page.locator('[data-graph-mode-exit]').click()
        page.wait_for_timeout(650)
        page.screenshot(path=str(ROOT/'artifacts/canvas-m2-m5/t12/xml-import-reopened.png'));browser.close();print('PASS native JSON + synthetic desktop-checked XML preview/selection/atomic import/notes/styles/PNG/edit/save/reopen from both real file inputs')
if __name__=='__main__':main()
