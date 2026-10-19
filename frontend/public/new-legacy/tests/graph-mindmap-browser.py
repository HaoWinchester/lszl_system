"""AC07 graph layout/theme and isolated D02 commands against disposable DB."""
import argparse,json,uuid
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[2]
def layout_controls(panel):
    menu=panel.locator('[data-mm-menu="layout"]')
    if menu.get_attribute('open') is None:menu.locator(':scope > summary').click()
    advanced=panel.locator('.mm-advanced')
    if advanced.get_attribute('open') is None:advanced.locator(':scope > summary').click()
def theme_controls(panel):
    menu=panel.locator('[data-mm-menu="theme"]')
    if menu.get_attribute('open') is None:menu.locator(':scope > summary').click()
def main():
    p=argparse.ArgumentParser();p.add_argument('--base-url',required=True);base=p.parse_args().base_url.rstrip('/');assert base.startswith('http://127.0.0.1:')
    out=ROOT/'artifacts/canvas-m2-m5/t10';out.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as pw:
        browser=pw.chromium.launch(channel='chrome');ctx=browser.new_context(viewport={'width':1440,'height':1000})
        assert ctx.request.post(base+'/api/v1/auth/login',data={'username':'ink-browser','password':'ink-browser-test'}).ok
        graph={'nodes':[{'id':i,'title':i,'notes':'备注','imageData':'keep-image','questionIds':['q1'],'x':x,'y':y} for i,x,y in [('a',400,300),('b',650,300),('c',650,550),('d',900,550),('e',1000,750)]],'links':[{'id':'ab','from':'a','to':'b','hierarchy':True,'fromPort':'left','toPort':'top','pathStyle':'curve','curveControls':[{'x':300,'y':100},{'x':850,'y':120}]},{'id':'ac','from':'a','to':'c'},{'id':'bd','from':'b','to':'d','hierarchy':True},{'id':'cd','from':'c','to':'d'},{'id':'da','from':'d','to':'a'}]}
        r=ctx.request.post(base+'/api/v1/files',data={'name':'布局'+uuid.uuid4().hex[:6],'graphData':graph});assert r.ok;file=r.json()['file'];assert ctx.request.put(base+'/api/v1/files/current',data={'fileId':file['id']}).ok
        page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto(base+'/index.html',wait_until='networkidle')
        for selector in ['#learningEntryDismissBtn','.tour-skip','#hideHelpBtn']:
            if page.locator(selector).is_visible():page.locator(selector).click()
        page.locator('.graph-mode-trigger').click();page.locator('[data-graph-mode-option="professional"]').click();page.wait_for_function('!KGGraphFileTabs.isSwitching()')
        page.evaluate("selectedNodeIds=new Set(['a']);state.selectedNodeId='a';refreshSelectionUI()")
        # Replacing a panel must dispose its marker/listeners; fullscreen must not resurrect it.
        markers=page.evaluate("()=>{const w=document.createTreeWalker(document,NodeFilter.SHOW_COMMENT);let n=0;while(w.nextNode())if(w.currentNode.data==='canvas-overlay-home')n++;return n}")
        page.locator('#mindmapBtn').click();page.locator('#mindmapBtn').click()
        page.evaluate("()=>{const b=document.createElement('button');b.id='mm-fullscreen-probe';b.textContent='fullscreen probe';b.style.cssText='position:fixed;top:80px;right:100px;z-index:99999';b.onclick=()=>document.querySelector('#stage').requestFullscreen();document.body.append(b)}")
        page.locator('#mm-fullscreen-probe').click();page.wait_for_function('!!document.fullscreenElement')
        assert page.locator('[data-formal-mindmap-panel]').count()==1
        page.locator('[data-formal-mindmap-panel]').get_by_role('button',name='关闭布局与主题').click();page.evaluate('document.exitFullscreen()');page.wait_for_function('!document.fullscreenElement');assert page.locator('[data-formal-mindmap-panel]').count()==0
        assert page.evaluate("()=>{const w=document.createTreeWalker(document,NodeFilter.SHOW_COMMENT);let n=0;while(w.nextNode())if(w.currentNode.data==='canvas-overlay-home')n++;return n}")==markers
        page.locator('#mm-fullscreen-probe').evaluate('(b)=>b.remove()')
        before=page.evaluate('JSON.stringify(graphUndoSnapshot())');page.locator('#mindmapBtn').click();assert page.evaluate('JSON.stringify(graphUndoSnapshot())')==before;panel=page.locator('[data-formal-mindmap-panel]');expect(panel).to_be_visible();layout_controls(panel);panel.locator('[data-mm-root]').select_option('a');assert not panel.locator('[data-mm-override]').is_checked()
        for direction in ['left','right','bilateral','down']:
            panel.locator('[data-mm-direction]').select_option(direction);expect(panel.locator('[data-mm-status]')).to_have_text('已应用')
            assert page.evaluate('state.nodes.length')==5 and page.evaluate('state.links.length')==5
            pos=page.evaluate('Object.fromEntries(state.nodes.map(n=>[n.id,{x:n.x,y:n.y}]))')
            if direction=='right':assert pos['b']['x']>pos['a']['x']
            if direction=='left':assert pos['b']['x']<pos['a']['x']
            if direction=='down':assert pos['b']['y']>pos['a']['y']
            if direction=='bilateral':assert (pos['b']['x']-pos['a']['x'])*(pos['c']['x']-pos['a']['x'])<0
            saved=page.evaluate('JSON.stringify(graphUndoSnapshot())');panel.locator('[data-mm-direction]').select_option(direction);assert page.evaluate('JSON.stringify(graphUndoSnapshot())')==saved
        assert panel.get_by_role('button',name='应用布局',exact=True).count()==0
        page.evaluate("KGGraphKernel.style.updateAppearance(['b'],{fillColor:'#123456',fontSize:36})")
        theme_controls(panel)
        for theme in ['wire','blue','branches','mono','paper','capsule']:
            # dataset.mmTheme renders data-mm-theme.
            panel.locator('[data-mm-theme="'+theme+'"]').click()
            assert page.evaluate("KGGraphModel.appearanceOf(state.nodes[1]).fillColor")=='#123456'
            assert page.evaluate("KGGraphModel.appearanceOf(state.nodes[1]).fontSize")==36
        assert page.locator('.mindmap-capsule').count()>0
        snapshot=page.evaluate('JSON.stringify(graphUndoSnapshot())');page.evaluate('restoreGraphUndoSnapshot()')
        assert page.evaluate('JSON.stringify(graphUndoSnapshot())')!=snapshot
        page.evaluate('restoreGraphRedoSnapshot()');assert page.evaluate('JSON.stringify(graphUndoSnapshot())')==snapshot
        layout_controls(panel);panel.locator('[data-mm-override]').check();theme_controls(panel);panel.locator('[data-mm-theme="blue"]').click();assert page.evaluate('KGGraphModel.appearanceOf(state.nodes[1]).fillColor')=='#dbeafe'
        panel.get_by_role('button',name='关闭布局与主题').click();assert page.evaluate('save({force:true})')
        saved=page.evaluate('saveableState()');page.reload(wait_until='networkidle');page.wait_for_function('!KGGraphFileTabs.isSwitching()');reopened=page.evaluate('saveableState()');(out/'saved.json').write_text(json.dumps(saved,ensure_ascii=False));(out/'reopened.json').write_text(json.dumps(reopened,ensure_ascii=False));assert reopened==saved
        assert page.evaluate("state.nodes.every(n=>n.notes==='备注'&&n.imageData==='keep-image'&&n.questionIds[0]==='q1')")
        assert page.evaluate("state.links.filter(l=>l.hierarchy).map(l=>l.id).join(',')==='ab,bd'")
        assert page.evaluate("state.links[0].fromPort==='left'&&state.links[0].toPort==='top'&&state.links[0].curveControls.length===2")
        # Explicit selection scope must not move any other node.
        page.evaluate("selectedNodeIds=new Set(['b','d']);state.selectedNodeId='b';refreshSelectionUI()")
        unselected=page.evaluate("JSON.stringify(state.nodes.filter(n=>!['b','d'].includes(n.id)))")
        page.locator('#mindmapBtn').click();panel=page.locator('[data-formal-mindmap-panel]');layout_controls(panel);panel.locator('[data-mm-scope]').select_option('selected');panel.locator('[data-mm-root]').select_option('b');panel.locator('[data-mm-direction]').select_option('left');expect(panel.locator('[data-mm-status]')).to_have_text('已应用')
        assert page.evaluate("JSON.stringify(state.nodes.filter(n=>!['b','d'].includes(n.id)))")==unselected
        page.evaluate('restoreGraphUndoSnapshot()');panel.get_by_role('button',name='关闭布局与主题').click()
        page.evaluate("selectedNodeIds=new Set(['a','c']);state.selectedNodeId='a';refreshSelectionUI()")
        formal=page.evaluate('JSON.stringify(saveableState())');history=page.evaluate('KGGraphKernel.history.getState().undoCount');assert page.evaluate('openRelatedCanvasModal(false)')
        temporary=page.locator('.related-canvas-backdrop')
        # The current temporary viewer auto-arranges right on open; its old theme
        # form was removed. Keep isolation coverage against the current interface.
        assert page.evaluate("relatedCanvasController.session.getState().mindmap.direction")=='right'
        assert page.evaluate('JSON.stringify(saveableState())')==formal and page.evaluate('KGGraphKernel.history.getState().undoCount')==history
        temporary.locator('[data-action="close"]').click()
        page.locator('#mindmapBtn').click();panel=page.locator('[data-formal-mindmap-panel]');theme_controls(panel)
        for width in [1440,900,390]:
            page.set_viewport_size({'width':width,'height':1000})
            for theme in ['wire','blue','branches','mono','paper','capsule']:
                button=panel.locator('[data-mm-theme="'+theme+'"]');expect(button).to_be_visible();rect=button.bounding_box();assert rect['x']>=0 and rect['x']+rect['width']<=width,rect
            page.screenshot(path=str(out/('mindmap-'+str(width)+'.png')))
        panel.get_by_role('button',name='关闭布局与主题').click();assert not errors,errors
        ctx.request.delete(base+'/api/v1/files/'+file['id']);browser.close()
    print('PASS AC07 four layouts, six previews/themes, manual protection, routes/ports, undo/redo, save/reopen and D02 isolation')
if __name__=='__main__':main()
