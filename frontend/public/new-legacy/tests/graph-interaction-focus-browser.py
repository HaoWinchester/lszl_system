"""User-facing graph regressions against a disposable database, via real Chrome UI."""
import argparse, json, uuid
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/graph-interaction-focus-fixes'

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--base-url',required=True);parser.add_argument('--section',choices=['all','tabs','card','focus','edges'],default='all');args=parser.parse_args()
    base=args.base_url.rstrip('/');assert urlparse(base).hostname in ('localhost','127.0.0.1')
    OUT.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as pw:
        browser=pw.chromium.launch(channel='chrome');ctx=browser.new_context(viewport={'width':1440,'height':1000})
        assert ctx.request.post(base+'/api/v1/auth/login',data={'username':'ink-browser','password':'ink-browser-test'}).ok
        suffix=uuid.uuid4().hex[:7]
        nodes=[{'id':'a','title':'重点卡牌','level':'重点','color':'#db2777','cardStyle':'rounded','geometry':{'x':150,'y':200,'width':260,'height':100},'fontSize':24,'fontWeight':'bold','fillColor':'#fff1f2','borderColor':'#db2777','surfaceCustomized':True},
               {'id':'b','title':'普通卡牌','level':'基础','cardStyle':'standard','geometry':{'x':550,'y':300,'width':200,'height':150}},
               {'id':'c','title':'第二重点','level':'重点','cardStyle':'rectangle','geometry':{'x':240,'y':530,'width':260,'height':85}}]
        graph={'meta':{'title':'图谱回归'},'viewport':{'x':100,'y':30,'scale':1},'nodes':nodes,'links':[{'id':'ab','from':'a','to':'b'},{'id':'ac','from':'a','to':'c'}]}
        files=[]
        for i in range(3):
            r=ctx.request.post(base+'/api/v1/files',data={'name':f'交互回归{i}-{suffix}','graphData':graph});assert r.ok;files.append(r.json()['file'])
        fid=files[0]['id'];assert ctx.request.put(base+'/api/v1/files/current',data={'fileId':fid}).ok
        page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        def ready():
            page.wait_for_load_state('networkidle');page.wait_for_function('!!window.KGGraphFileTabs && !!window.KGGraphModel')
            for selector in ['#learningEntryDismissBtn','.tour-skip','#hideHelpBtn']:
                if page.locator(selector).is_visible():page.locator(selector).click()
            page.locator('.graph-mode-trigger').click();page.locator('[data-graph-mode-option="professional"]').click()
            page.wait_for_function('!KGGraphFileTabs.isSwitching()')
        def reload():page.reload(wait_until='networkidle');ready()
        def flush():assert page.evaluate('persistCurrentGraphNow()') is True
        def model(nid):return page.evaluate('(id)=>KGGraphModel.view(state.nodes.find(n=>n.id===id))',nid)
        def edit(nid):
            page.locator('.knowledge-card[data-node-id="'+nid+'"]').click()
            page.locator('#detailActionsToggle').click()
            page.locator('#editFromDetailBtn').click();expect(page.locator('#nodeModal')).to_be_visible()
        def styles():
            return page.evaluate('''()=>{const s=getComputedStyle(document.querySelector('#stage'));const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');ctx.fillStyle=s.backgroundColor;ctx.fillRect(0,0,1,1);return{background:s.backgroundColor,rgb:[...ctx.getImageData(0,0,1,1).data].slice(0,3),cards:[...document.querySelectorAll('.knowledge-card')].map(e=>{const c=getComputedStyle(e);return{id:e.dataset.nodeId,opacity:c.opacity,filter:c.filter,outline:c.outlineColor,outlineWidth:c.outlineWidth,shadow:c.boxShadow,focus:e.classList.contains('focus-card')}})}}''')
        page.goto(base+'/index.html',wait_until='networkidle');ready()
        if args.section in ('all','tabs'):
            for f in files:expect(page.locator('.graph-file-tab[data-file-id="'+f['id']+'"]')).to_be_visible()
            def order():return page.locator('.graph-file-tab').evaluate_all('els=>els.map(e=>e.dataset.fileId)')
            initial=order();source=files[2]['id'];target=files[0]['id']
            def drag():
                a=page.locator('.graph-file-tab[data-file-id="'+source+'"]');b=page.locator('.graph-file-tab[data-file-id="'+target+'"]')
                a.drag_to(b,target_position={'x':8,'y':15})
            drag();expected=initial.copy();expected.remove(source);expected.insert(expected.index(target),source)
            page.wait_for_function('(ids)=>JSON.stringify([...document.querySelectorAll(".graph-file-tab")].map(e=>e.dataset.fileId))===JSON.stringify(ids)',arg=expected)
            reload();assert order()==expected,'order lost on reload'
            # Failed writes preserve the last durable order, then a retry succeeds.
            source,target=files[0]['id'],files[2]['id']
            page.route('**/api/v1/files/order',lambda route:route.fulfill(status=503,content_type='application/json',body='{"detail":"temporary test failure"}'))
            drag();page.wait_for_timeout(300);assert order()==expected,'failed reorder changed durable order'
            page.unroute('**/api/v1/files/order');drag()
            retried=expected.copy();retried.remove(source);retried.insert(retried.index(target),source)
            page.wait_for_function('(ids)=>JSON.stringify([...document.querySelectorAll(".graph-file-tab")].map(e=>e.dataset.fileId))===JSON.stringify(ids)',arg=retried)
            reload();assert order()==retried
            print('PASS tabs: actual Chrome drag, durable refresh order, failed write preserves order and retry',flush=True)
        if args.section in ('all','card'):
            before=model('a');edit('a');page.locator('#nSummary').fill('仅修改内容，保留手动尺寸与样式');page.locator('#saveNodeBtn').click()
            after=model('a');assert after['geometry']==before['geometry'];assert after['appearance']==before['appearance']
            flush();saved=ctx.request.get(base+'/api/v1/files/'+fid).json()['graphData'];saved_a=next(n for n in saved['nodes'] if n['id']=='a');assert saved_a['geometry']==before['geometry']
            reload();assert model('a')['geometry']==before['geometry'] and model('a')['appearance']==before['appearance']
            edit('a');page.locator('#nTitle').fill('取消的标题');page.locator('#nodeModal').get_by_role('button',name='取消',exact=True).click();assert model('a')['content']['title']==before['content']['title']
            edit('a');page.locator('#nTitle').fill('改名保持尺寸');page.locator('#saveNodeBtn').click()
            page.keyboard.press('ControlOrMeta+z');assert model('a')['content']['title']==before['content']['title'];assert model('a')['geometry']==before['geometry']
            page.keyboard.press('ControlOrMeta+Shift+z');assert model('a')['content']['title']=='改名保持尺寸';assert model('a')['geometry']==before['geometry']
            page.screenshot(path=str(OUT/'card-edit-preserved.png'))
            print('PASS card: professional UI content edit, geometry/style preserved, API/reload, cancel and undo/redo',flush=True)
        if args.section in ('all','focus'):
            original=styles();page.locator('#focusBtn').click();expect(page.locator('#stage')).to_have_class(__import__('re').compile(r'focus-mode'))
            page.wait_for_function("""parseFloat(getComputedStyle(document.querySelector('.knowledge-card[data-node-id="b"]')).opacity)<.6""")
            focused=styles();assert focused['background']!=original['background'],focused
            assert max(focused['rgb'])<110,focused
            byid={x['id']:x for x in focused['cards']};assert byid['a']['opacity']=='1' and byid['c']['opacity']=='1',focused
            assert byid['a']['outlineWidth']!='0px' and byid['a']['shadow']!='none',focused
            assert float(byid['b']['opacity'])<1 and byid['b']['filter']!='none',focused
            edit('a');page.locator('#nLevel').select_option('中等');page.locator('#saveNodeBtn').click();assert not page.locator('.knowledge-card[data-node-id="a"]').evaluate('e=>e.classList.contains("focus-card")');assert float(styles()['cards'][0]['opacity'])<1
            edit('b');page.locator('#nLevel').select_option('重点');page.locator('#saveNodeBtn').click();assert page.locator('.knowledge-card[data-node-id="b"]').evaluate('e=>e.classList.contains("focus-card")')
            flush();reload();focused=styles();byid={x['id']:x for x in focused['cards']};assert not byid['a']['focus'] and byid['b']['focus'];assert byid['b']['opacity']=='1'
            page.wait_for_function('!document.querySelector("#stage").classList.contains("focus-visual-transition")')
            page.screenshot(path=str(OUT/'focus-on.png'));page.locator('#focusBtn').click();page.wait_for_function('(color)=>getComputedStyle(document.querySelector("#stage")).backgroundColor===color',arg=original['background']);assert styles()['background']==original['background']
            page.wait_for_function('!document.querySelector("#stage").classList.contains("focus-visual-transition")')
            assert all(c['shadow']=='none' for c in styles()['cards']);page.wait_for_timeout(2000);page.screenshot(path=str(OUT/'focus-off.png'))
            print('PASS focus: dark canvas, only level 重点 highlighted, live mark changes/API/reload and exit restoration',flush=True)
        if args.section in ('all','edges'):
            def check_edges():
                return page.evaluate('''()=>state.links.every(l=>{const p=linkRenderPoints(l),g=edgeDomById.get(l.id).geometry,dx=p.cb.x-p.ca.x,dy=p.cb.y-p.ca.y,h=Math.abs(dx)>=Math.abs(dy),na=nodeById(l.from),nb=nodeById(l.to),da=nodeDims(na),db=nodeDims(nb);const a=h?{x:p.ca.x+Math.sign(dx)*da.w/2,y:p.ca.y}:{x:p.ca.x,y:p.ca.y+Math.sign(dy)*da.h/2},b=h?{x:p.cb.x-Math.sign(dx)*db.w/2,y:p.cb.y}:{x:p.cb.x,y:p.cb.y-Math.sign(dy)*db.h/2};return JSON.stringify(g.endpoints)===JSON.stringify([a,b])})''')
            assert check_edges()
            card=page.locator('.knowledge-card[data-node-id="b"]');box=card.bounding_box();page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2);page.mouse.down();page.mouse.move(box['x']+box['width']/2-100,box['y']+box['height']/2+200,steps=12);page.mouse.up();assert check_edges()
            flush();reload();assert check_edges();page.screenshot(path=str(OUT/'edge-midpoints.png'))
            print('PASS edges: rendered midpoint paths follow actual card drag and durable geometry after reload',flush=True)
        assert not errors,errors
        browser.close()
if __name__=='__main__':main()
