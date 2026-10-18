"""User-facing graph regressions against a disposable database, via real Chrome UI."""
import argparse, json, uuid
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/graph-interaction-focus-fixes'

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--output-dir',type=Path);parser.add_argument('--base-url',required=True);parser.add_argument('--section',choices=['all','tabs','card','focus','edges','curves','elbow','cancel-history','ports','lock'],default='all');args=parser.parse_args()
    base=args.base_url.rstrip('/');assert urlparse(base).hostname in ('localhost','127.0.0.1')
    out=args.output_dir or OUT;out.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as pw:
        browser=pw.chromium.launch(channel='chrome');ctx=browser.new_context(viewport={'width':1440,'height':1000})
        assert ctx.request.post(base+'/api/v1/auth/login',data={'username':'ink-browser','password':'ink-browser-test'}).ok
        suffix=uuid.uuid4().hex[:7]
        nodes=[{'id':'a','title':'重点卡牌','level':'重点','color':'#db2777','cardStyle':'rounded','geometry':{'x':150,'y':200,'width':260,'height':100},'fontSize':24,'fontWeight':'bold','fillColor':'#fff1f2','borderColor':'#db2777','surfaceCustomized':True},
               {'id':'b','title':'普通卡牌','level':'基础','cardStyle':'standard','geometry':{'x':550,'y':300,'width':200,'height':150}},
               {'id':'c','title':'第二重点','level':'重点','cardStyle':'rectangle','geometry':{'x':240,'y':530,'width':260,'height':85}}]
        graph={'meta':{'title':'图谱回归'},'viewport':{'x':100,'y':30,'scale':1},'nodes':nodes,'links':[{'id':'ab','from':'a','to':'b','pathStyle':'curve','curveControls':[{'x':455,'y':185},{'x':510,'y':490}]},{'id':'ac','from':'a','to':'c'}]}
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
            page.screenshot(path=str(out/'card-edit-preserved.png'))
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
            page.screenshot(path=str(out/'focus-on.png'));page.locator('#focusBtn').click();page.wait_for_function('(color)=>getComputedStyle(document.querySelector("#stage")).backgroundColor===color',arg=original['background']);assert styles()['background']==original['background']
            page.wait_for_function('!document.querySelector("#stage").classList.contains("focus-visual-transition")')
            assert all(c['shadow']=='none' for c in styles()['cards']);page.wait_for_timeout(2000);page.screenshot(path=str(out/'focus-off.png'))
            print('PASS focus: dark canvas, only level 重点 highlighted, live mark changes/API/reload and exit restoration',flush=True)
        if args.section in ('all','edges'):
            def check_edges():
                return page.evaluate('''()=>state.links.every(l=>{const p=linkRenderPoints(l),g=edgeDomById.get(l.id).geometry,dx=p.cb.x-p.ca.x,dy=p.cb.y-p.ca.y,h=Math.abs(dx)>=Math.abs(dy),na=nodeById(l.from),nb=nodeById(l.to),da=nodeDims(na),db=nodeDims(nb);const a=h?{x:p.ca.x+Math.sign(dx)*da.w/2,y:p.ca.y}:{x:p.ca.x,y:p.ca.y+Math.sign(dy)*da.h/2},b=h?{x:p.cb.x-Math.sign(dx)*db.w/2,y:p.cb.y}:{x:p.cb.x,y:p.cb.y-Math.sign(dy)*db.h/2};return JSON.stringify(g.endpoints)===JSON.stringify([a,b])})''')
            assert check_edges()
            card=page.locator('.knowledge-card[data-node-id="b"]');box=card.bounding_box();page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2);page.mouse.down();page.mouse.move(box['x']+box['width']/2-100,box['y']+box['height']/2+200,steps=12);page.mouse.up();assert check_edges()
            flush();reload();assert check_edges();page.screenshot(path=str(out/'edge-midpoints.png'))
            print('PASS edges: rendered midpoint paths follow actual card drag and durable geometry after reload',flush=True)
        if args.section in ('all','ports'):
            native_scroll=[]
            def trace_scroll(step):native_scroll.append({'step':step,**page.evaluate('({left:stage.scrollLeft,top:stage.scrollTop})')})
            trace_scroll('before port UI')
            def select_ab():page.evaluate("clearMultiSelection();state.selectedLinkId='ab';state.selectedNodeId=null;refreshSelectionUI()")
            def port_values():return page.evaluate("[linkById('ab').fromPort,linkById('ab').toPort]")
            def click_visible(selector):
                box=page.locator(selector).bounding_box();assert box
                x=box['x']+box['width']/2;y=box['y']+box['height']/2
                assert 0<x<1440 and 38<y<1000,box
                page.mouse.click(x,y)
            def port_menu():
                panel=page.locator('#edgeQuickStylePanel [data-uc-edge-popover="ports"]')
                if not panel.is_visible():click_visible('#edgeQuickStylePanel [data-uc-edge-panel="ports"]')
            def check_ports(source='a'):
                assert port_values()==['right','top']
                # Compare the actual painted SVG endpoints with the card's DOM
                # rectangle, independent of the geometry algorithm under test.
                value=page.evaluate("""(source)=>{const path=edgeDomById.get('ab').vis,transform=path.getScreenCTM(),toScreen=p=>new DOMPoint(p.x,p.y).matrixTransform(transform),start=toScreen(path.getPointAtLength(0)),end=toScreen(path.getPointAtLength(path.getTotalLength())),a=cardElementByNodeId(source).getBoundingClientRect(),b=cardElementByNodeId('b').getBoundingClientRect();return{actual:[{x:start.x,y:start.y},{x:end.x,y:end.y}],expected:[{x:a.right,y:a.top+a.height/2},{x:b.left+b.width/2,y:b.top}]}}""",source)
                for actual,expected in zip(value['actual'],value['expected']):
                    assert abs(actual['x']-expected['x'])<1 and abs(actual['y']-expected['y'])<1,value
            select_ab();port_menu()
            expect(page.locator('#edgeQuickStylePanel [data-uc-edge-port="from"]')).to_be_visible(timeout=2500)
            page.locator('#edgeQuickStylePanel [data-uc-edge-port="from"]').select_option('right');trace_scroll('visible from port selection');assert page.evaluate('[stage.scrollLeft,stage.scrollTop]')==[0,0];port_menu()
            page.locator('#edgeQuickStylePanel [data-uc-edge-port="to"]').select_option('top');trace_scroll('visible to port selection');assert page.evaluate('[stage.scrollLeft,stage.scrollTop]')==[0,0],native_scroll;check_ports()
            page.keyboard.press('ControlOrMeta+z');assert port_values()==['right','auto']
            page.keyboard.press('ControlOrMeta+Shift+z');check_ports()
            for nid,dx,dy in [('a',70,-35),('b',-80,60),('a',-40,50),('b',70,-30)]:
                card=page.locator('.knowledge-card[data-node-id="'+nid+'"]');box=card.bounding_box();x=box['x']+box['width']/2;y=box['y']+box['height']/2
                old=model(nid)['geometry'];page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+dx,y+dy,steps=8);page.mouse.up()
                assert model(nid)['geometry']!=old;check_ports()
            trace_scroll('after repeated card drags')
            before=model('a')['geometry'];page.evaluate("enterNodeFreeResizeMode('a')")
            handle=page.locator('.knowledge-card[data-node-id="a"] [data-node-resize-handle="se"]');box=handle.bounding_box();assert box
            x=box['x']+box['width']/2;y=box['y']+box['height']/2;page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+65,y+80,steps=10);page.mouse.up()
            resized=model('a')['geometry'];assert resized['width']>before['width'] and resized['height']>before['height'];check_ports();page.keyboard.press('Escape')
            trace_scroll('after card resize')
            edit('a');page.locator('#nTitle').fill('长文本验证固定端点：'+('内容变化仍跟随卡片右侧边界。'*5));page.locator('#saveNodeBtn').click()
            assert model('a')['geometry']==resized;check_ports()
            trace_scroll('after modal title edit')
            old_scale=page.evaluate('state.viewport.scale');page.locator('#zoomOutBtn').click();page.wait_for_function('(old)=>state.viewport.scale<old',arg=old_scale);page.wait_for_timeout(300);check_ports()
            trace_scroll('after zoom button')
            select_ab();port_menu();click_visible('#edgeQuickStylePanel [data-uc-edge-action="ports-reset"]');assert port_values()==['auto','auto']
            page.keyboard.press('ControlOrMeta+z');check_ports()
            trace_scroll('after reset button undo');assert page.evaluate('[stage.scrollLeft,stage.scrollTop]')==[0,0],native_scroll
            # Actual endpoint drag and cancelled pointer restore the saved ports.
            page.locator('#canvasFitBtn').click();page.wait_for_timeout(500)
            trace_scroll('after fit button');print('ports native-scroll evidence',native_scroll,flush=True)
            select_ab();hit=page.locator('[data-edge-endpoint-side="from"] .edge-endpoint-hit');box=hit.bounding_box();x=box['x']+box['width']-3;y=box['y']+box['height']/2
            page.mouse.move(x,y);page.mouse.down();assert page.evaluate('!!edgeEndpointDrag'),{'hit':box,'viewport':page.evaluate('({viewport:state.viewport,scrollY:window.scrollY,stageTop:stage.getBoundingClientRect().top})'),'target':page.evaluate('(p)=>document.elementFromPoint(p.x,p.y)?.outerHTML',{ 'x':x,'y':y })};page.mouse.move(x+32,y-25,steps=5);assert page.evaluate("linkById('ab').from===''")
            page.evaluate("""()=>{const drag=edgeEndpointDrag;finishEdgeEndpointDrag({pointerId:drag.pointerId,preventDefault(){},stopPropagation(){}},true)}""");page.mouse.up();check_ports()
            # Rebind the same selected side to a different card, then undo/redo.
            select_ab();box=page.locator('[data-edge-endpoint-side="from"] .edge-endpoint-hit').bounding_box();target=page.locator('.knowledge-card[data-node-id="c"]').bounding_box()
            page.mouse.move(box['x']+box['width']-3,box['y']+box['height']/2);page.mouse.down();assert page.evaluate('!!edgeEndpointDrag');page.mouse.move(target['x']+target['width']/2,target['y']+target['height']/2,steps=10);page.mouse.up()
            assert page.evaluate("linkById('ab').from")=='c';check_ports('c')
            page.keyboard.press('ControlOrMeta+z');assert page.evaluate("linkById('ab').from")=='a';check_ports()
            page.keyboard.press('ControlOrMeta+Shift+z');assert page.evaluate("linkById('ab').from")=='c';check_ports('c')
            page.keyboard.press('ControlOrMeta+z');check_ports()
            flush();saved=ctx.request.get(base+'/api/v1/files/'+fid).json()['graphData'];saved_ab=next(l for l in saved['links'] if l['id']=='ab');assert [saved_ab['fromPort'],saved_ab['toPort']]==['right','top']
            reload();check_ports();assert model('a')['geometry']==resized
            old=page.evaluate("linkById('ac')");assert old['fromPort']=='auto' and old['toPort']=='auto','old links remain automatic and editable'
            page.screenshot(path=str(out/'fixed-ports.png'))
            print('PASS ports: separate choices, repeated card drags, actual resize, long title edit, zoom, automatic reset/undo, endpoint cancel, rebind/undo/redo, API save/reload, old link compatibility',flush=True)
        if args.section in ('all','curves'):
            def curve_state():
                return page.evaluate('''()=>{const link=state.links.find(l=>l.id==='ab'),g=edgeDomById.get('ab').geometry;return{nodes:Object.fromEntries(['a','b'].map(id=>{const n=nodeById(id);return[id,{x:n.x,y:n.y}]})),from:link.from,to:link.to,endpoints:g.endpoints.map(p=>({...p})),controls:link.curveControls.map(p=>({...p})),handles:g.controls.map(p=>({x:p.x,y:p.y})),samples:[g.samples[8],g.samples[16]],viewport:{...state.viewport}}}''')
            def aligned(value):
                for handle,sample in zip(value['handles'],value['samples']):
                    assert abs(handle['x']-sample['x'])<1e-6 and abs(handle['y']-sample['y'])<1e-6,value
            # ports 段改变了卡尺寸/标题/端点并保存；曲线段切回未改动的第二份 fixture，
            # 在干净图上验证纯曲线把手交互（与单独运行 curves 段等价）。
            assert ctx.request.put(base+'/api/v1/files/current',data={'fileId':files[1]['id']}).ok
            reload()
            page.evaluate("state.selectedLinkId='ab';state.selectedNodeId=null;selectedNodeIds.clear();refreshSelectionUI()");page.wait_for_timeout(200)
            before=curve_state();aligned(before)
            indices=page.locator('.edge-control-handle').evaluate_all('els=>els.map(e=>e.dataset.edgeControlIndex)');assert len(indices)==len(set(indices))==3,indices
            hit=page.locator('.edge-control-handle[data-edge-control-index="0"] .edge-control-hit');box=hit.bounding_box();assert box, 'curve handle visible'
            x=box['x']+box['width']/2;y=box['y']+box['height']/2
            page.mouse.move(x,y);page.mouse.down();assert page.evaluate('!!edgeControlDrag'),page.evaluate('''({x,y})=>({at:document.elementFromPoint(x,y)?.outerHTML.slice(0,300),mode:state.graphMode,readonly:document.body.classList.contains('auth-readonly')})''',{'x':x,'y':y});page.mouse.move(x+45,y-32,steps=8);page.mouse.up()
            edited=curve_state();aligned(edited)
            assert edited['controls']!=before['controls'],(before,edited)
            assert abs(edited['handles'][1]['x']-before['handles'][1]['x'])<1e-6 and abs(edited['handles'][1]['y']-before['handles'][1]['y'])<1e-6
            page.evaluate("selectedNodeIds=new Set(['a','b']);state.selectedLinkId=null;state.selectedNodeId='a';refreshSelectionUI()")
            card=page.locator('.knowledge-card[data-node-id="a"]');box=card.bounding_box();x=box['x']+box['width']/2;y=box['y']+box['height']/2
            page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+76,y+44,steps=10);page.mouse.up()
            grouped=curve_state();aligned(grouped)
            delta={axis:grouped['nodes']['a'][axis]-edited['nodes']['a'][axis] for axis in ('x','y')}
            assert delta=={axis:grouped['nodes']['b'][axis]-edited['nodes']['b'][axis] for axis in ('x','y')},(edited,grouped)
            assert grouped['from']=='a' and grouped['to']=='b' and any(delta.values())
            for old,new in zip(edited['controls'],grouped['controls']):
                assert abs(new['x']-old['x']-delta['x'])<1e-6 and abs(new['y']-old['y']-delta['y'])<1e-6,(edited,grouped)
            page.evaluate('restoreGraphUndoSnapshot()');undone=curve_state();aligned(undone)
            assert undone['controls']==edited['controls'] and undone['nodes']==edited['nodes'] and undone['from']=='a' and undone['to']=='b'
            page.evaluate('restoreGraphRedoSnapshot()');redone=curve_state();aligned(redone)
            assert redone['controls']==grouped['controls'] and redone['nodes']==grouped['nodes']
            page.evaluate('state.viewport.x+=61;state.viewport.y-=39;state.viewport.scale=1.25;applyTransform()')
            viewed=curve_state();aligned(viewed);assert viewed['controls']==redone['controls'] and viewed['handles']==redone['handles']
            flush();reload();reopened=curve_state();aligned(reopened)
            assert reopened['controls']==redone['controls'] and reopened['from']=='a' and reopened['to']=='b'
            card=page.locator('.knowledge-card[data-node-id="b"]');box=card.bounding_box();x=box['x']+box['width']/2;y=box['y']+box['height']/2
            page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+52,y+19,steps=8);page.mouse.up()
            single=curve_state();aligned(single)
            assert single['nodes']['a']==reopened['nodes']['a'] and single['from']=='a' and single['to']=='b'
            start_delta={axis:single['endpoints'][0][axis]-reopened['endpoints'][0][axis] for axis in ('x','y')}
            end_delta={axis:single['endpoints'][1][axis]-reopened['endpoints'][1][axis] for axis in ('x','y')}
            axis={coord:reopened['endpoints'][1][coord]-reopened['endpoints'][0][coord] for coord in ('x','y')};length2=axis['x']**2+axis['y']**2
            for old,new in zip(reopened['controls'],single['controls']):
                weight=max(0,min(1,((old['x']-reopened['endpoints'][0]['x'])*axis['x']+(old['y']-reopened['endpoints'][0]['y'])*axis['y'])/length2))
                for coord in ('x','y'):
                    expected=old[coord]+start_delta[coord]*(1-weight)+end_delta[coord]*weight
                    assert abs(new[coord]-expected)<1e-6,(reopened,single)
            page.evaluate('restoreGraphUndoSnapshot()');undone_single=curve_state();aligned(undone_single)
            assert undone_single['controls']==reopened['controls'] and undone_single['nodes']==reopened['nodes']
            page.evaluate("selectedNodeIds=new Set(['a','b']);state.selectedNodeId='a';refreshSelectionUI()")
            card=page.locator('.knowledge-card[data-node-id="a"]');box=card.bounding_box();x=box['x']+box['width']/2;y=box['y']+box['height']/2
            page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+65,y+34,steps=6)
            assert curve_state()['controls']!=undone_single['controls']
            page.evaluate('resetGraphPointerInteractions()');page.mouse.up()
            cancelled=curve_state();aligned(cancelled)
            assert cancelled['controls']==undone_single['controls'] and cancelled['nodes']==undone_single['nodes'] and cancelled['from']=='a' and cancelled['to']=='b'
            page.evaluate("selectedNodeIds.clear();state.selectedNodeId=null;state.selectedLinkId='ab';refreshSelectionUI()")
            page.locator('[data-uc-edge-panel="line"]').click();page.locator('[data-uc-edge-path="curve"]').click()
            auto=page.evaluate('''()=>{const link=state.links.find(l=>l.id==='ab'),g=edgeDomById.get('ab').geometry;return{controls:link.curveControls,waypoints:link.waypoints,handles:g.controls.map(p=>({x:p.x,y:p.y})),samples:[g.samples[8],g.samples[16]]}}''')
            assert not auto['controls'] and not auto['waypoints'];aligned(auto)
            page.evaluate('restoreGraphUndoSnapshot()');restored=curve_state();aligned(restored)
            assert restored['controls']==cancelled['controls']
            print('PASS curves: real handle drag, dual-card and single-card drags, cancel, undo/redo, viewport transform, saved reload and auto reset',flush=True)
        if args.section in ('all','elbow'):
            # 博思白板式折线方向锁定：中间段路径点只允许沿水平/纵向单轴滑动，且随保存持久化。
            assert ctx.request.put(base+'/api/v1/files/current',data={'fileId':files[1]['id']}).ok
            reload()
            page.evaluate("state.selectedLinkId='ab';state.selectedNodeId=null;selectedNodeIds.clear();refreshSelectionUI()");page.wait_for_timeout(200)
            # 与快速面板 onPathStyle 同一入口；避免浮动面板点击引发祖先滚动干扰坐标。
            page.evaluate('applyPathStyle("elbow")')
            def elbow_waypoints():
                return page.evaluate('''()=>{const link=state.links.find(l=>l.id==='ab');const geometry=edgeDomById.get('ab').geometry;return{stored:(link.waypoints||[]).map(p=>({...p})),waypoints:geometry.waypoints.map(p=>({...p})),controls:geometry.controls.map(p=>({x:p.x,y:p.y,index:p.index,kind:p.kind})),samples:geometry.samples.map(p=>({...p})),style:link.pathStyle}}''')
            seeded=elbow_waypoints();assert seeded['style']=='elbow' and len(seeded['controls'])==3,seeded
            assert all(p['kind']=='segment' for p in seeded['controls']),seeded
            assert [p['index'] for p in seeded['controls']]==[0,1,2],seeded
            # 前序曲线测试保留 125% 缩放，屏幕像素需换算为画布坐标。
            drag_scale=page.evaluate('state.viewport.scale')
            handle=page.locator('.edge-control-handle[data-edge-control-kind="segment"][data-edge-control-index="1"] .edge-control-hit');box=handle.bounding_box();assert box,'elbow segment midpoint visible'
            x=box['x']+box['width']/2;y=box['y']+box['height']/2
            page.mouse.move(x,y);page.mouse.down();assert page.evaluate('!!edgeControlDrag')
            page.mouse.move(x+36,y-44,steps=6);page.mouse.up()
            dragged=elbow_waypoints()
            origin=seeded['waypoints'][0]
            # a→b 整体水平主导 → 默认折线中间段垂直 → 只允许水平拖动（y 锁定）。
            assert abs(dragged['stored'][0]['x']-(origin['x']+36/drag_scale))<1e-6,(drag_scale,origin,dragged)
            assert abs(dragged['stored'][0]['y']-origin['y'])<1e-6,dragged
            assert abs(dragged['stored'][1]['x']-(seeded['waypoints'][1]['x']+36/drag_scale))<1e-6,dragged
            assert abs(dragged['stored'][1]['y']-seeded['waypoints'][1]['y'])<1e-6,dragged
            assert all(a['x']==b['x'] or a['y']==b['y'] for a,b in zip(dragged['samples'],dragged['samples'][1:])),dragged
            flush();reload()
            assert elbow_waypoints()['stored']==dragged['stored']
            print('PASS elbow: segment midpoint drag moves both bends on one axis and survives reload',flush=True)
        if args.section in ('all','cancel-history'):
            # 前段留下组选/边选状态；本段在干净 fixture 上自成体系验证取消与历史。
            assert ctx.request.put(base+'/api/v1/files/current',data={'fileId':files[2]['id']}).ok
            reload()
            def snapshot():
                return page.evaluate('''()=>{const history=ensureGraphHistoryController().getState();return{nodes:Object.fromEntries(['a','b','c'].map(id=>{const n=nodeById(id);return[id,{x:n.x,y:n.y}]})),controls:state.links.find(l=>l.id==='ab').curveControls.map(p=>({...p})),binding:state.links.find(l=>l.id==='ab').from+':'+state.links.find(l=>l.id==='ab').to,history:{undoCount:history.undoCount,redoCount:history.redoCount,undoLabel:history.undoLabel,redoLabel:history.redoLabel,transaction:history.transaction}}}''')
            def seed_redo():
                page.evaluate('''()=>{resetGraphHistory();pushGraphUndoSnapshot('先前操作 A');let node=nodeById('c');KGGraphModel.updateGeometry(node,{x:node.x+17});render();pushGraphUndoSnapshot('先前操作 B');node=nodeById('c');KGGraphModel.updateGeometry(node,{x:node.x+23});render();restoreGraphUndoSnapshot()}''')
                value=snapshot();assert value['history']=={'undoCount':1,'redoCount':1,'undoLabel':'先前操作 A','redoLabel':'先前操作 B','transaction':''},value
                return value
            def check_cancelled(before):
                after=snapshot();assert after==before,(before,after)
                page.evaluate('restoreGraphRedoSnapshot()');redone=snapshot()
                assert redone['nodes']['c']['x']==before['nodes']['c']['x']+23,(before,redone)
                page.evaluate('restoreGraphUndoSnapshot()');assert snapshot()['nodes']['c']==before['nodes']['c']
                page.evaluate('restoreGraphUndoSnapshot()');assert snapshot()['nodes']['c']['x']==before['nodes']['c']['x']-17
            before=seed_redo()
            card=page.locator('.knowledge-card[data-node-id="a"]');box=card.bounding_box();x=box['x']+box['width']/2;y=box['y']+box['height']/2
            page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+65,y+31,steps=7)
            assert snapshot()['nodes']['a']!=before['nodes']['a']
            page.evaluate('resetGraphPointerInteractions()');page.mouse.up();check_cancelled(before)
            before=seed_redo()
            page.evaluate('''()=>KGHomeCanvasRuntime.selectionFilter.setSnapshot([{id:'a',type:'node'},{id:'b',type:'node'}],{anchorRect:homeSelectionAnchorRect(),reason:'cancel-history-test'})''')
            before=snapshot();bounds=page.locator('.uc-selection-bounds:not([hidden])');assert bounds.is_visible()
            box=bounds.bounding_box();x=box['x']+box['width']/2;y=box['y']+box['height']/2
            page.mouse.move(x,y);page.mouse.down();assert page.evaluate('!!homeSelectionBoundsDrag')
            page.mouse.move(x+69,y+34,steps=7);assert snapshot()['nodes']['a']!=before['nodes']['a']
            page.evaluate('''()=>{const drag=homeSelectionBoundsDrag;finishHomeSelectionBoundsDrag({pointerId:drag.pointerId,preventDefault(){},stopPropagation(){},stopImmediatePropagation(){}},true)}''');page.mouse.up()
            check_cancelled(before)
            before=seed_redo()
            page.evaluate("state.selectedLinkId='ab';state.selectedNodeId=null;selectedNodeIds.clear();refreshSelectionUI()")
            before=snapshot();hit=page.locator('.edge-control-handle[data-edge-control-index="0"] .edge-control-hit');box=hit.bounding_box();x=box['x']+box['width']/2;y=box['y']+box['height']/2
            page.mouse.move(x,y);page.mouse.down();assert page.evaluate('!!edgeControlDrag')
            page.mouse.move(x+42,y-26,steps=6);assert snapshot()['controls']!=before['controls']
            page.evaluate('''()=>{const id=edgeControlDrag.pointerId;finishEdgeControlDrag({pointerId:id,preventDefault(){},stopPropagation(){}},true)}''');page.mouse.up();check_cancelled(before)
            before=seed_redo()
            page.evaluate('''()=>{const g=edgeDomById.get('ab').geometry,p=g.samples[3],rect=stage.getBoundingClientRect(),clientX=rect.left+state.viewport.x+p.x*state.viewport.scale,clientY=rect.top+state.viewport.y+p.y*state.viewport.scale,handle={setPointerCapture(){},releasePointerCapture(){}};beginEdgeMoveDrag({pointerId:771,button:0,clientX,clientY,currentTarget:handle,stopPropagation(){}},'ab');applyEdgeMoveDragPoint({x:p.x+37,y:p.y+24})}''')
            assert snapshot()['binding']=='a:b'
            assert snapshot()['controls']!=before['controls'],'bound body drag must adjust the route'
            page.evaluate('''()=>finishEdgeMoveDrag({pointerId:771,preventDefault(){},stopPropagation(){}},true)''');check_cancelled(before)
            before=seed_redo()
            page.evaluate('''()=>{const p=edgeDomById.get('ab').geometry.endpoints[0],rect=stage.getBoundingClientRect(),clientX=rect.left+state.viewport.x+p.x*state.viewport.scale,clientY=rect.top+state.viewport.y+p.y*state.viewport.scale,handle={setPointerCapture(){},releasePointerCapture(){}};beginEdgeEndpointDrag({pointerId:772,button:0,clientX,clientY,currentTarget:handle,preventDefault(){},stopPropagation(){}},'ab','from');applyEdgeEndpointDragPoint({world:{x:p.x+31,y:p.y+19},clientX:clientX+31,clientY:clientY+19})}''')
            assert snapshot()['binding']==':b'
            page.evaluate('''()=>finishEdgeEndpointDrag({pointerId:772,preventDefault(){},stopPropagation(){}},true)''');check_cancelled(before)
            print('PASS cancel history: card, selection-bounds, curve-handle, whole-edge and endpoint cancellation retain prior redo and next undo',flush=True)
        if args.section in ('all','lock'):
            # 用户反馈：专业模式锁定卡牌后切高效模式，解锁图标必须保留且可点。
            assert ctx.request.put(base+'/api/v1/files/current',data={'fileId':files[1]['id']}).ok
            reload()
            card=page.locator('.knowledge-card[data-node-id="a"]');box=card.bounding_box()
            def select_a():
                page.mouse.click(box['x']+box['width']/2,box['y']+box['height']/2);page.wait_for_timeout(300)
            def switch_mode(mode):
                page.locator('.graph-mode-trigger').click();page.locator('[data-graph-mode-option="'+mode+'"]').click();page.wait_for_function('!KGGraphFileTabs.isSwitching()');page.wait_for_timeout(200)
            toolbar=page.locator('.node-style-toolbar');lock=toolbar.locator('[data-node-toolbar-action="lock"]')
            select_a();expect(toolbar).to_be_visible();expect(lock).to_be_visible()
            lock.click();page.wait_for_timeout(200)
            expect(lock).to_have_attribute('aria-pressed','true')
            switch_mode('professional');switch_mode('efficient')
            # 高效模式（历史上 CSS 隐藏 lock 按钮）重新选中锁定卡牌：解锁图标保留且可解锁。
            select_a();expect(lock).to_be_visible()
            expect(lock).to_have_attribute('aria-pressed','true')
            expect(lock).to_have_attribute('aria-label','解锁节点')
            lock.click();page.wait_for_timeout(300)
            expect(lock).to_have_attribute('aria-pressed','false')
            flush()
            print('PASS lock: unlock icon persists across professional→efficient switch and unlock works',flush=True)
        assert not errors,errors
        browser.close()
if __name__=='__main__':main()
