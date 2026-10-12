"""AC06 base scenarios using explicit clipboard events and isolated file API fixtures."""
import argparse,json,uuid
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[2]
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--base-url',required=True);args=parser.parse_args();base=args.base_url.rstrip('/')
    assert base.startswith('http://127.0.0.1:')
    out=ROOT/'artifacts/canvas-m2-m5/t07';out.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as pw:
        browser=pw.chromium.launch(channel='chrome');ctx=browser.new_context(viewport={'width':1440,'height':1000})
        assert ctx.request.post(base+'/api/v1/auth/login',data={'username':'ink-browser','password':'ink-browser-test'}).ok
        graph={'nodes':[{'id':'a','title':'源正文','notes':'详细资料','geometry':{'x':150,'y':200,'width':260,'height':100},'cardStyle':'rounded','color':'#db2777'},{'id':'b','title':'第二卡片','geometry':{'x':550,'y':300,'width':200,'height':150}},{'id':'c','title':'未选中','geometry':{'x':300,'y':500,'width':200,'height':100}}],'links':[{'id':'ab','from':'a','to':'b','fromPort':'left','toPort':'top','pathStyle':'curve','curveControls':[{'x':50,'y':250},{'x':650,'y':220}]},{'id':'ac','from':'a','to':'c'}]}
        files=[]
        for name,data in [('A',graph),('B',{'nodes':[],'links':[]})]:
            r=ctx.request.post(base+'/api/v1/files',data={'name':'片段'+name+uuid.uuid4().hex[:6],'graphData':data});assert r.ok;files.append(r.json()['file'])
        assert ctx.request.put(base+'/api/v1/files/current',data={'fileId':files[0]['id']}).ok
        page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        def ready(p):
            p.wait_for_load_state('networkidle');p.wait_for_function('!!window.KGGraphFileTabs && !!window.KGGraphModel')
            for selector in ['#learningEntryDismissBtn','.tour-skip','#hideHelpBtn']:
                if p.locator(selector).is_visible():p.locator(selector).click()
            p.locator('.graph-mode-trigger').click();p.locator('[data-graph-mode-option="professional"]').click();p.wait_for_function('!KGGraphFileTabs.isSwitching()')
        page.goto(base+'/index.html',wait_until='networkidle');ready(page)
        before=page.evaluate('JSON.stringify(saveableState())')
        page.locator('.knowledge-card[data-node-id="a"]').click();page.locator('.knowledge-card[data-node-id="b"]').click(modifiers=['Control'])
        # Real keyboard dispatch triggers native copy; read the application session fragment afterward.
        page.keyboard.press('Meta+c')
        fragment=page.evaluate('KGGraphKernel.clipboard.readFragment()')
        assert len(fragment['nodes'])==2 and len(fragment['links'])==1,fragment
        page.locator('.graph-file-tab[data-file-id="'+files[1]['id']+'"]').click();page.wait_for_function('state.nodes.length===0 && !KGGraphFileTabs.isSwitching()')
        def paste(p,text):
            return p.evaluate("""(text)=>{const d=new DataTransfer();d.setData('text/plain',text);const e=new ClipboardEvent('paste',{clipboardData:d,bubbles:true,cancelable:true});document.dispatchEvent(e);return e.defaultPrevented}""",text)
        assert paste(page,json.dumps(fragment));assert paste(page,json.dumps(fragment))
        # T16: 跨文件粘贴走服务端受控端点（异步），等待串行粘贴完成后断言。
        page.wait_for_function('state.nodes.length===4')
        copied=page.evaluate('saveableState()');assert len(copied['nodes'])==4 and len(copied['links'])==2
        ids=[n['id'] for n in copied['nodes']];assert len(set(ids))==4 and not set(ids)&{'a','b','c'}
        assert all(l['from'] in ids and l['to'] in ids and l['fromPort']=='left' and l['toPort']=='top' for l in copied['links'])
        assert copied['nodes'][1]['x']-copied['nodes'][0]['x']==400
        assert copied['nodes'][0]['notes']=='详细资料' and copied['nodes'][0]['cardStyle']=='rounded'
        old=page.evaluate('JSON.stringify(saveableState())');assert not paste(page,'{"format":"kg-graph-fragment","version":99}')
        assert page.evaluate('JSON.stringify(saveableState())')==old
        page.evaluate("KGGraphModel.updateContent(state.nodes[0],{title:'目标修改'});render({persist:true})")
        assert page.evaluate('persistCurrentGraphNow()') is True
        page.reload(wait_until='networkidle');ready(page);assert page.evaluate('state.nodes.length')==4
        assert page.evaluate("state.nodes[0].title")=='目标修改'
        assert page.evaluate("state.nodes[2].title")=='源正文','repeated paste shares content'
        # Separate tab receives only the explicit serialized fragment, no background clipboard read.
        tab=ctx.new_page();tab.on('pageerror',lambda e:errors.append(str(e)));tab.goto(base+'/index.html',wait_until='networkidle');ready(tab)
        assert paste(tab,json.dumps(fragment));tab.wait_for_function('state.nodes.length===6')
        # Native textarea editing must leave application fragments and graph untouched.
        tab.evaluate("const t=document.createElement('textarea');t.id='native-copy-test';t.value='文本优先';document.body.append(t);t.focus();t.select()")
        count=tab.evaluate('state.nodes.length');tab.keyboard.press('Meta+c');tab.keyboard.press('Meta+v');assert tab.evaluate('state.nodes.length')==count
        expect(tab.locator('#native-copy-test')).to_have_value('文本优先')
        assert tab.evaluate('KGGraphKernel.clipboard.hasData()')
        tab.evaluate("window.dispatchEvent(new Event('kg-auth-session-change'))")
        # Same account refresh retains clipboard; real logout clears it.
        assert tab.evaluate('KGGraphKernel.clipboard.hasData()')
        page.locator('.graph-file-tab[data-file-id="'+files[0]['id']+'"]').click();page.wait_for_function('state.nodes.some(n=>n.id===\"c\")')
        assert page.evaluate('JSON.stringify(saveableState())')==before,'source changed'
        tab.evaluate('authLogout()');tab.wait_for_function('!KGGraphKernel.clipboard.hasData()')
        assert not errors,errors
        page.screenshot(path=str(out/'cross-file-copy.png'));browser.close();print('PASS: AC06 base copy/paste, independent links/ports, reload, cross-tab events, native text, logout')
if __name__=='__main__':main()
