"""AC03 isolated related canvas UI against a disposable helper database."""
import argparse,json,uuid
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[2]
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--base-url',required=True);base=parser.parse_args().base_url.rstrip('/');assert base.startswith('http://127.0.0.1:')
    out=ROOT/'artifacts/canvas-m2-m5/t08';out.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as pw:
        browser=pw.chromium.launch(channel='chrome');ctx=browser.new_context(viewport={'width':1440,'height':1000})
        assert ctx.request.post(base+'/api/v1/auth/login',data={'username':'ink-browser','password':'ink-browser-test'}).ok
        graph={'nodes':[{'id':i,'title':i,'x':x,'y':y,'cardStyle':'rounded'} for i,x,y in [('a',400,300),('b',20000,300),('c',22000,550),('d',25000,550),('isolated',350,650)]],'links':[{'id':'ab','from':'a','to':'b','type':'先决条件','arrowStyle':'both','lineStyle':'dashed','strokeWidth':6,'color':'#db2777','pathStyle':'curve','fromPort':'left','toPort':'top','curveControls':[{'x':300,'y':100},{'x':850,'y':120}]},{'id':'bc','from':'b','to':'c'},{'id':'cd','from':'c','to':'d'}]}
        graph['nodes'][0].update(category='知识领域', level='重点', keywords='章程,变更控制', summary='整合项目整体协调', notes='把它看成总控台')
        files=[]
        for data in [graph,{'nodes':[],'links':[]}]:
            r=ctx.request.post(base+'/api/v1/files',data={'name':'临时'+uuid.uuid4().hex[:6],'graphData':data});assert r.ok;files.append(r.json()['file'])
        assert ctx.request.put(base+'/api/v1/files/current',data={'fileId':files[0]['id']}).ok
        page=ctx.new_page();errors=[];writes=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:writes.append(r.url) if ('/api/v1/files' in r.url or '/api/v1/questions' in r.url or '/api/v1/training' in r.url) and r.method in ['POST','PUT','PATCH','DELETE'] else None)
        page.goto(base+'/index.html',wait_until='networkidle')
        for selector in ['#learningEntryDismissBtn','.tour-skip','#hideHelpBtn']:
            if page.locator(selector).is_visible():page.locator(selector).click()
        page.locator('.graph-mode-trigger').click();page.locator('[data-graph-mode-option="professional"]').click();page.wait_for_function('!KGGraphFileTabs.isSwitching()')
        before=page.evaluate('JSON.stringify(saveableState())');view=page.evaluate('JSON.stringify(state.viewport)');history=page.evaluate('ensureGraphHistoryController().getState().undoCount');file_id=page.evaluate('KGGraphFileEditorStoreBridge.fragmentSource().fileId')
        def open_selected(ids):
            page.evaluate('(ids)=>{selectedNodeIds=new Set(ids);state.selectedNodeId=ids[0];refreshSelectionUI()}',ids)
            assert page.evaluate('openRelatedCanvasModal(false)') is True
            expect(page.locator('.related-canvas-backdrop')).to_be_visible();page.wait_for_timeout(100);writes.clear()
        open_selected(['a','c']);assert page.locator('.related-canvas-card').count()==4
        expect(page.locator('.related-canvas-detail .detail-name')).to_have_text('a')
        expect(page.locator('.related-canvas-detail')).to_contain_text('章程,变更控制')
        expect(page.locator('.related-canvas-detail')).to_contain_text('把它看成总控台')
        assert page.locator('.related-canvas-backdrop [data-mindmap-controls]').count()==0
        page.screenshot(path=str(out/'temporary-details-gather-desktop.png'))
        assert page.evaluate('(()=>{const ns=relatedCanvasController.session.getState().nodes;return Math.max(...ns.map(n=>n.x))-Math.min(...ns.map(n=>n.x))})()')<2000
        assert page.evaluate('relatedCanvasController.session.getState().nodes[0].x')==400
        assert page.evaluate('JSON.stringify(state.viewport)')==view
        expect(page.locator('.related-canvas-edges text')).to_have_count(0)
        edge=page.locator('.related-canvas-edge[data-link-id="ab"]');assert edge.get_attribute('marker-end') and edge.get_attribute('marker-start');assert edge.get_attribute('stroke-dasharray')=='24 12'
        expected=page.evaluate('(()=>{const l=relatedCanvasController.session.getState().links[0],m=new Map(relatedCanvasController.session.getState().nodes.map(n=>[n.id,n])),p=linkRenderPoints(l,m,{ignoreGather:true});return linkPathGeometry(l,p.a,p.b,p).d})()');assert edge.get_attribute('d')==expected
        assert page.evaluate('relatedCanvasController.session.getState().links[0].curveControls.length')==2
        assert page.locator('.related-canvas-backdrop [data-question-id]').count()==0
        # 临时编辑表单已按需求移除；顶部画笔按钮开关局部画笔（笔迹不持久化，关闭即丢弃）。
        assert page.locator('.related-canvas-backdrop form').count()==0
        page.locator('[data-action="ink"]').click();expect(page.locator('.related-canvas-backdrop .canvas-ink-toolbar')).to_be_visible()
        # Drawing also works on viewport blanks outside the translated stage.
        vp=page.locator('.related-canvas-viewport');v=vp.bounding_box()
        blank=page.evaluate('''()=>{const vp=document.querySelector('.related-canvas-viewport'),r=vp.getBoundingClientRect();for(let y=r.top+2;y<r.bottom-2;y+=10)for(let x=r.left+2;x<r.right-2;x+=10)if(document.elementFromPoint(x,y)===vp)return {x,y};return null}''')
        assert blank,'test must exercise actual viewport blank space'
        page.mouse.move(blank['x'],blank['y']);page.mouse.down();page.mouse.move(blank['x']+35,blank['y']+15,steps=5);page.mouse.up()
        expect(page.locator('.related-canvas-backdrop .canvas-ink-layer path')).to_have_count(1)
        local=page.locator('.related-canvas-backdrop .canvas-ink-toolbar')
        # Local selection owns both deletion keys and keyboard history, even while a card stays selected.
        paths=page.locator('.related-canvas-backdrop .canvas-ink-layer path')
        original_path=paths.first.get_attribute('d');local_cards=page.locator('.related-canvas-card').count()
        local.get_by_role('button',name='选择',exact=True).click()
        for key in ['Delete','Backspace']:
            midpoint=paths.first.evaluate('(el)=>{const p=el.getPointAtLength(el.getTotalLength()/2),s=new DOMPoint(p.x,p.y).matrixTransform(el.getScreenCTM());return {x:s.x,y:s.y}}')
            page.mouse.click(midpoint['x'],midpoint['y']);page.keyboard.press(key)
            expect(paths).to_have_count(0);expect(page.locator('.related-canvas-card')).to_have_count(local_cards)
            page.keyboard.press('Control+z');expect(paths).to_have_count(1);assert paths.first.get_attribute('d')==original_path
            page.keyboard.press('Control+Shift+z');expect(paths).to_have_count(0)
            page.keyboard.press('Control+z');expect(paths).to_have_count(1)
            assert not writes,writes
        local.get_by_role('button',name='文字',exact=True).click();page.mouse.click(blank['x'],blank['y']+35)
        editor=page.get_by_role('textbox',name='画布文字内容');expect(editor).to_be_visible();editor.fill('临时空白文字');editor.press('Control+Enter');expect(editor).to_have_count(0)
        expect(page.locator('.related-canvas-backdrop .canvas-ink-layer text')).to_contain_text('临时空白文字')
        local.get_by_role('button',name='画笔',exact=True).click()
        page.mouse.click(blank['x'],blank['y'],button='right');page.wait_for_timeout(100);page.mouse.click(blank['x'],blank['y'],button='right')
        expect(local.locator('[data-ink-tool=select]')).to_have_attribute('aria-pressed','true')
        local.get_by_role('button',name='关闭画笔工具',exact=True).click();expect(local).to_be_hidden()
        page.locator('[data-action="ink"]').click();expect(local).to_be_visible()
        page.locator('[data-action="ink"]').click();expect(page.locator('.related-canvas-backdrop .canvas-ink-toolbar')).to_be_hidden()
        page.locator('[data-action="ink"]').click()
        page.keyboard.press('Escape')  # 画笔激活时 ESC 先退出绘画而不是关闭弹层
        expect(page.locator('.related-canvas-backdrop .canvas-ink-toolbar')).to_be_visible()
        expect(page.locator('.related-canvas-backdrop')).to_be_visible()
        page.keyboard.press('Escape')  # 再按一次退出绘画后关闭弹层
        expect(page.locator('.related-canvas-backdrop')).to_have_count(0)
        open_selected(['a','c']);assert page.locator('.related-canvas-card').count()==4
        page.locator('[data-action=ink]').click();expect(page.locator('.related-canvas-backdrop .canvas-ink-layer [data-stroke-id]')).to_have_count(0)
        page.locator('[data-action=ink]').click()
        card=page.locator('.related-canvas-card[data-node-id="a"]');r=card.bounding_box();page.mouse.move(r['x']+60,r['y']+40);page.mouse.down();page.mouse.move(r['x']+110,r['y']+70,steps=8);page.mouse.up()
        assert page.evaluate('relatedCanvasController.session.getState().nodes[0].x')!=400
        edge_point=page.locator('.related-canvas-edges path[data-link-id="ab"]').evaluate('(p)=>{const q=p.getPointAtLength(p.getTotalLength()/2),m=p.getScreenCTM();return {x:q.x*m.a+q.y*m.c+m.e,y:q.x*m.b+q.y*m.d+m.f}}')
        page.mouse.click(edge_point['x'],edge_point['y']);page.locator('[data-action="delete"]').click();assert page.evaluate('relatedCanvasController.session.getState().links.length')==2
        page.locator('[data-action="undo"]').click();assert page.evaluate('relatedCanvasController.session.getState().links.length')==3
        page.locator('[data-action="add"]').click();assert page.locator('.related-canvas-card').count()==5
        page.locator('[data-action="connect"]').click();page.locator('.related-canvas-card[data-node-id="b"]').click();assert page.evaluate('relatedCanvasController.session.getState().links.length')==4
        page.locator('[data-action="delete"]').click();assert page.evaluate('relatedCanvasController.session.getState().links.length')==3
        page.locator('[data-action="undo"]').click();assert page.evaluate('relatedCanvasController.session.getState().links.length')==4
        page.locator('[data-action="redo"]').click();assert page.evaluate('relatedCanvasController.session.getState().links.length')==3
        page.locator('.related-canvas-card[data-node-id="d"]').click();page.keyboard.press('Backspace');assert page.locator('.related-canvas-card').count()==4
        assert page.evaluate('JSON.stringify(saveableState())')==before
        assert page.evaluate('ensureGraphHistoryController().getState().undoCount')==history
        assert page.evaluate('JSON.stringify(state.viewport)')==view
        assert page.evaluate('KGGraphFileEditorStoreBridge.fragmentSource().fileId')==file_id
        assert not writes,writes
        saved=ctx.request.get(base+'/api/v1/files/'+files[0]['id']).json()['graphData'];assert len(saved['nodes'])==5 and saved['nodes'][0]['title']=='a'
        page.screenshot(path=str(out/'temporary.png'));page.locator('[data-action="close"]').click()
        open_selected(['b']);expect(page.locator('.related-canvas-detail .detail-name')).to_have_text('b');page.locator('.related-canvas-card[data-node-id="a"]').click();expect(page.locator('.related-canvas-detail .detail-name')).to_have_text('a');page.locator('[data-action="close"]').click()
        open_selected(['a']);assert page.locator('.related-canvas-card').count()==2;page.locator('[data-action="close"]').click()
        open_selected(['isolated']);assert page.locator('.related-canvas-card').count()==1;expect(page.locator('.related-canvas-empty')).to_contain_text('没有一跳关联')
        page.locator('[data-action="close"]').click()
        page.evaluate('KGHomeInteractionModes.setMode("reading")');open_selected(['a'])
        assert page.locator('.related-canvas-backdrop [data-action="ink"]').count()==0
        assert page.locator('.related-canvas-backdrop .canvas-ink-layer').count()==0
        assert not writes,writes
        page.locator('[data-action="close"]').click();page.evaluate('KGHomeInteractionModes.setMode("professional")')
        page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(200);page.evaluate('recoverMobileGraphViewport()');page.wait_for_function('!fitViewAnimationFrame&&!graphSmoothZoomFrame')
        mobile_before=page.evaluate('JSON.stringify(saveableState())')
        open_selected(['a']);expect(page.locator('.related-canvas-detail')).to_contain_text('把它看成总控台')
        page.locator('.related-canvas-card[data-node-id="b"]').click();expect(page.locator('.related-canvas-detail .detail-name')).to_have_text('b')
        page.screenshot(path=str(out/'temporary-details-mobile.png'));page.locator('[data-action="close"]').click()
        mobile_after=page.evaluate('JSON.stringify(saveableState())')
        assert mobile_after==mobile_before,[(k,json.loads(mobile_before).get(k),v) for k,v in json.loads(mobile_after).items() if json.loads(mobile_before).get(k)!=v]
        page.set_viewport_size({'width':1440,'height':1000});page.wait_for_timeout(200)
        before=page.evaluate('JSON.stringify(saveableState())');view=page.evaluate('JSON.stringify(state.viewport)')
        # While a save waits, a newly typed formal draft must remain visible, even on success.
        page.evaluate("()=>{window.savedPersist=persistCurrentGraphNow;window.persistCurrentGraphNow=()=>new Promise(resolve=>window.finishDelayedSave=resolve);window.openResult=null;selectedNodeIds=new Set(['a']);state.selectedNodeId='a';openRelatedCanvasModal(false).then(ok=>window.openResult=ok)}")
        page.wait_for_function('!!window.finishDelayedSave');page.evaluate("startNodeInlineEdit('a')");page.evaluate('()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
        page.locator('[data-node-inline-editor="true"]').fill('保存等待期间的新草稿')
        page.evaluate('finishDelayedSave(true)');page.wait_for_function('window.openResult!==null')
        assert page.evaluate('window.openResult') is False
        expect(page.locator('[data-node-inline-editor="true"]')).to_have_text('保存等待期间的新草稿')
        assert page.locator('.related-canvas-backdrop').count()==0
        assert page.evaluate('KGGraphFileEditorStoreBridge.fragmentSource().fileId')==file_id
        assert page.evaluate('JSON.stringify(state.viewport)')==view
        page.evaluate('nodeInlineTextEditorController.cancel()')
        # Failure must also preserve a newer draft typed while the request was pending.
        page.evaluate("()=>{window.finishDelayedSave=null;window.openResult=null;openRelatedCanvasModal(false).then(ok=>window.openResult=ok)}")
        page.wait_for_function('!!window.finishDelayedSave');page.evaluate("startNodeInlineEdit('a')");page.evaluate('()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
        page.locator('[data-node-inline-editor="true"]').fill('请求失败时的新草稿')
        page.evaluate('finishDelayedSave(false)');page.wait_for_function('window.openResult!==null')
        assert page.evaluate('window.openResult') is False
        expect(page.locator('[data-node-inline-editor="true"]')).to_have_text('请求失败时的新草稿')
        assert page.locator('.related-canvas-backdrop').count()==0
        assert page.evaluate('KGGraphFileEditorStoreBridge.fragmentSource().fileId')==file_id
        assert page.evaluate('JSON.stringify(state.viewport)')==view
        page.evaluate('nodeInlineTextEditorController.cancel()')
        # Failed save with an initial active draft restores the same editable input.
        page.evaluate("startNodeInlineEdit('a')");page.evaluate('()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');page.locator('[data-node-inline-editor="true"]').fill('失败时保留草稿')
        page.evaluate("()=>{window.finishDelayedSave=null;window.openResult=null;openRelatedCanvasModal(false).then(ok=>window.openResult=ok)}")
        page.wait_for_function('!!window.finishDelayedSave');page.evaluate('finishDelayedSave(false)');page.wait_for_function('window.openResult!==null')
        assert page.evaluate('window.openResult') is False
        expect(page.locator('[data-node-inline-editor="true"]')).to_have_text('失败时保留草稿')
        assert page.locator('.related-canvas-backdrop').count()==0
        assert page.evaluate('KGGraphFileEditorStoreBridge.fragmentSource().fileId')==file_id
        assert page.evaluate('JSON.stringify(state.viewport)')==view
        page.evaluate('nodeInlineTextEditorController.cancel()');page.evaluate('()=>{window.persistCurrentGraphNow=window.savedPersist}')
        # Failed formal flush refuses transition and preserves source context.
        page.evaluate('window.savedPersist=persistCurrentGraphNow;window.persistCurrentGraphNow=()=>false')
        assert page.evaluate('openRelatedCanvasModal(false)') is False;assert page.locator('.related-canvas-backdrop').count()==0
        page.evaluate('()=>{window.persistCurrentGraphNow=window.savedPersist}')
        open_selected(['a']);page.evaluate('(id)=>KGGraphFileTabs.openFile(id)',files[1]['id'])
        page.wait_for_function('state.nodes.length===0');assert page.locator('.related-canvas-backdrop').count()==0
        page.evaluate('(id)=>KGGraphFileTabs.openFile(id)',files[0]['id']);page.wait_for_function('state.nodes.length===5')
        open_selected(['a']);page.evaluate('authLogout()');page.wait_for_function('!relatedCanvasController');assert page.locator('.related-canvas-backdrop').count()==0
        assert not errors,errors
        browser.close();print('PASS: AC03 scope, edit/style/move/add/delete/connect/undo/redo; zero writes; discard/reopen/isolated/switch/logout/failed flush')
if __name__=='__main__':main()
