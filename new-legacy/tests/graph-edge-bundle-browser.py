#!/usr/bin/env python3
"""多线汇总自动重叠：端点收拢 + 派生折线通道对齐，真实图谱画布验收。

Run against the disposable canvas_ink_server:
  python3 new-legacy/tests/graph-edge-bundle-browser.py --base-url http://127.0.0.1:<port>
"""
import argparse
import json
import re
import uuid
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[2]

def run_full_ui(base, out, username):
    out.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
     b=p.chromium.launch(channel='chrome');ctx=b.new_context(viewport={'width':1680,'height':1050},record_video_dir=str(out/'video'))
     assert ctx.request.post(base+'/api/v1/auth/login',data={'username':username,'password':'ink-browser-test'}).ok
     graph={'nodes':[{'id':'a','title':'上游','geometry':{'x':320,'y':300,'width':200,'height':120}},{'id':'b','title':'下游','geometry':{'x':1000,'y':300,'width':200,'height':120}},{'id':'c','title':'替换端点','geometry':{'x':1000,'y':650,'width':200,'height':120}}],'links':[],'viewport':{'x':0,'y':0,'scale':1}}
     r=ctx.request.post(base+'/api/v1/files',data={'name':'连线完整UI-'+username+'-'+uuid.uuid4().hex[:6],'graphData':graph});assert r.ok;fid=r.json()['file']['id'];assert ctx.request.put(base+'/api/v1/files/current',data={'fileId':fid}).ok
     page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));ctx.tracing.start(screenshots=True,snapshots=True,sources=True)
     def ready():
      page.wait_for_function('!!window.KGGraphFileTabs && !KGGraphFileTabs.isSwitching()')
      for s in ['#learningEntryDismissBtn','.tour-skip','#hideHelpBtn']:
       if page.locator(s).is_visible():page.locator(s).click()
     def drag(loc,dx=None,dy=None,to=None):
      box=loc.bounding_box();assert box,loc;start=(box['x']+box['width']/2,box['y']+box['height']/2);end=to or (start[0]+dx,start[1]+dy)
      page.mouse.move(*start);page.mouse.down();page.mouse.move(*end,steps=18);page.wait_for_timeout(50);page.mouse.up();page.wait_for_timeout(180)
     def snap(name):
      result=page.evaluate('({links:JSON.parse(JSON.stringify(state.links)),nodes:JSON.parse(JSON.stringify(state.nodes)),geometry:Object.fromEntries([...edgeDomById].map(([id,d])=>[id,d.geometry]))})');(out/(name+'.json')).write_text(json.dumps(result,ensure_ascii=False,indent=2));page.screenshot(path=str(out/(name+'.png')));return result
     def link():return page.evaluate('JSON.parse(JSON.stringify(state.links[0]))')
     def panel(name):
      trigger=page.locator('[data-uc-edge-panel="'+name+'"]');trigger.click();expect(page.locator('[data-uc-edge-popover="'+name+'"]')).to_be_visible()
     def select_edge():
      path=page.locator('.edge-base-layer [data-link-id] .edge-hit').first
      point=path.evaluate('(e)=>{const m=e.getScreenCTM();for(const t of [.2,.4,.6,.8,.1,.9]){const p=e.getPointAtLength(e.getTotalLength()*t),q={x:m.a*p.x+m.c*p.y+m.e,y:m.b*p.x+m.d*p.y+m.f};if(document.elementFromPoint(q.x,q.y)===e)return q}return null}');assert point,'edge must have a clickable exposed path';page.mouse.click(point['x'],point['y']);expect(page.locator('#edgeQuickStylePanel')).to_be_visible()
     def save():
      page.locator('#graphSaveState').click();expect(page.locator('#graphSaveState .graph-save-state-text')).to_have_text('已保存',timeout=15000)
     try:
      page.goto(base+'/index.html',wait_until='networkidle');ready();page.locator('.graph-mode-trigger').click();page.locator('[data-graph-mode-option="professional"]').click()
      page.locator('#addBtn').click();expect(page.locator('#nodeModal')).to_have_class(re.compile('show'));page.locator('#nTitle').fill('真实新增知识点');page.locator('#saveNodeBtn').click();assert page.locator('.knowledge-card').count()==4
      # Manual connection via source card's directional connector, with real drag.
      page.locator('.knowledge-card[data-node-id="a"]').hover();handle=page.locator('.node-growth-handle[data-node-id="a"][data-growth-dir="right"]');expect(handle).to_be_visible();dest=page.locator('.knowledge-card[data-node-id="b"]').bounding_box();drag(handle,to=(dest['x']+30,dest['y']+50));assert page.evaluate('state.links.length')==1
      eid=link()['id'];select_edge();snap('01-created')
      # Every explicit port for both endpoints uses the visible select, and round trips.
      for side in ['from','to']:
       for port in ['top','right','bottom','left']:
        panel('ports');page.locator('[data-uc-edge-port="'+side+'"]').select_option(port);assert link()[side+'Port']==port;expected={'from':{'top':{'x':420,'y':300},'right':{'x':520,'y':360},'bottom':{'x':420,'y':420},'left':{'x':320,'y':360}},'to':{'top':{'x':1100,'y':300},'right':{'x':1200,'y':360},'bottom':{'x':1100,'y':420},'left':{'x':1000,'y':360}}};assert page.evaluate('(id)=>edgeDomById.get(id).geometry.endpoints',eid)[0 if side=='from' else 1]==expected[side][port]
      panel('ports');page.locator('[data-uc-edge-action="ports-reset"]').click();assert link()['fromPort']=='auto' and link()['toPort']=='auto'
      for kind in ['straight','elbow','curve']:
       panel('line');page.locator('[data-uc-edge-path="'+kind+'"]').click();assert link()['pathStyle']==kind
       if kind=='curve' and link().get('waypoints'):panel('line');page.locator('[data-uc-edge-path="curve"]').click()
       if kind=='elbow':
        before=page.evaluate('(id)=>edgeDomById.get(id).geometry.endpoints',eid);drag(page.locator('[data-edge-control-kind="segment"]').first,0,-45);assert len(link().get('waypoints',[]))>=2;assert page.evaluate('(id)=>edgeDomById.get(id).geometry.endpoints',eid)==before;snap('02-elbow-segment')
      panel('line');page.locator('[data-uc-edge-line="dashed"]').click();assert link()['lineStyle']=='dashed'
      panel('line');slider=page.locator('[data-uc-edge-width]');slider.focus();slider.press('End');slider.press('Tab');assert link()['strokeWidth']==8
      for arrow in ['end','both','none']:
       panel('line');page.locator('[data-uc-edge-arrow="'+arrow+'"]').click();assert link()['arrowStyle']==arrow
      panel('color');page.locator('[data-uc-edge-color="#2563eb"]').click();assert link()['color']=='#2563eb';page.keyboard.press('Escape')
      page.locator('[data-uc-edge-action="label"]').click();page.locator('#edgeInlineLabelInput').fill('上下平滑分支');page.locator('#edgeInlineLabelInput').press('Enter');assert link()['type']=='上下平滑分支';select_edge()
      # Midpoint is free on both axes; opposite drags restore the symmetric automatic cubic.
      original=snap('02-styled')['geometry'][eid];mid=page.locator('[data-edge-control-kind="curve-midpoint"]')
      for name,dx,dy in [('up',0,-120),('down',0,240),('restore',0,-120),('left',-90,0),('right',180,0),('center',-90,0)]:
       before=page.evaluate('(id)=>edgeDomById.get(id).geometry.controls.find(p=>p.kind==="curve-midpoint")',eid);drag(mid,dx,dy);after=page.evaluate('(id)=>edgeDomById.get(id).geometry.controls.find(p=>p.kind==="curve-midpoint")',eid);assert abs(after['x']-before['x']-dx)<2 and abs(after['y']-before['y']-dy)<2,(name,before,after);snap('03-midpoint-'+name)
      restored=page.evaluate('(id)=>edgeDomById.get(id).geometry',eid)
      for a,c in zip(original['curveControls'],restored['curveControls']):assert abs(a['x']-c['x'])<2 and abs(a['y']-c['y'])<2
      # One auxiliary grip also supports true free dragging.
      control=page.locator('[data-edge-control-kind="curve-control"]').first;before=link()['curveControls'];drag(control,25,-35);assert link()['curveControls']!=before
      # Rebind endpoint to another card, then detach into empty space and rebind.
      target=page.locator('.knowledge-card[data-node-id="c"]').bounding_box();drag(page.locator('[data-edge-endpoint-side="to"]'),to=(target['x']+100,target['y']+60));assert link()['to']=='c';snap('04-rebound')
      drag(page.locator('[data-edge-endpoint-side="to"]'),to=(1350,700));assert not link().get('to') and link().get('toPoint');drag(page.locator('[data-edge-endpoint-side="to"]'),to=(target['x']+100,target['y']+60));assert link()['to']=='c'
      drag(page.locator('[data-edge-control-kind="curve-midpoint"]'),0,-60);assert len(link()['curveControls'])==2
      before=page.evaluate('(id)=>edgeDomById.get(id).geometry.endpoints[1]',eid);card=page.locator('.knowledge-card[data-node-id="c"]');drag(card,80,40);after=page.evaluate('(id)=>edgeDomById.get(id).geometry.endpoints[1]',eid);assert abs(after['x']-before['x']-80)<2 and abs(after['y']-before['y']-40)<2
      # Keyboard undo/redo are actual user gestures.
      page.locator('#stage').focus();page.keyboard.press('ControlOrMeta+z');undo=page.evaluate('(id)=>edgeDomById.get(id).geometry.endpoints[1]',eid);assert abs(undo['x']-before['x'])<2;page.keyboard.press('ControlOrMeta+Shift+z');redo=page.evaluate('(id)=>edgeDomById.get(id).geometry.endpoints[1]',eid);assert abs(redo['x']-after['x'])<2
      # Real marquee covers both connected cards and the path; it selects the edge too.
      page.mouse.click(1400,850);page.mouse.move(280,280);page.mouse.down();page.mouse.move(1250,850,steps=18);page.mouse.up();assert page.evaluate('(id)=>selectedLinkIds.has(id)',eid);assert page.evaluate('selectedNodeIds.size')>=2
      page.mouse.click(1400,850);select_edge()
      # Layout UI must preserve hand-edited cubic controls.
      controls=link().get('curveControls');page.locator('#mindmapBtn').click();mm=page.locator('[data-formal-mindmap-panel]')
      for selector in ['[data-mm-menu="layout"]','.mm-advanced']:
       section=mm.locator(selector)
       if section.get_attribute('open') is None:section.locator(':scope > summary').click()
      mm.locator('[data-mm-root]').select_option('a');mm.locator('[data-mm-direction]').select_option('right');mm.locator('[data-mm-layout]').click();expect(mm.locator('[data-mm-status]')).to_have_text('已应用');assert len(link().get('curveControls',[]))==2 and not page.evaluate('(id)=>edgeDomById.get(id).geometry.derivedCurveControls',eid)
      mm.get_by_role('button',name='关闭布局与主题').click();page.locator('#stage').focus();page.keyboard.press('ControlOrMeta+z');assert link().get('curveControls')==controls
      select_edge();snap('05-follow-undo-redo');save();stored=ctx.request.get(base+'/api/v1/files/'+fid).json()['graphData'];normalize=lambda links:[{'hierarchy':False,**item} for item in links];assert normalize(stored['links'])==normalize(page.evaluate('JSON.parse(JSON.stringify(saveableState().links))'))
      page.reload(wait_until='networkidle');ready();page.wait_for_function('(id)=>state.links.some(l=>l.id===id)',arg=eid);assert normalize(page.evaluate('JSON.parse(JSON.stringify(saveableState().links))'))==normalize(stored['links']);snap('06-reloaded')
      # Switch away and back with visible tabs, retaining the saved route.
      page.locator('.graph-file-tab[data-file-id="role-graph-'+username+'"] .graph-file-tab-title').click();ready();page.wait_for_function('state.nodes.some(n=>n.id==="role-a")');assert page.evaluate('state.links.length')==0
      page.locator('.graph-file-tab[data-file-id="'+fid+'"] .graph-file-tab-title').click();ready();page.wait_for_function('(id)=>state.links.some(l=>l.id===id)',arg=eid);assert normalize(page.evaluate('JSON.parse(JSON.stringify(saveableState().links))'))==normalize(stored['links'])
      # Reading mode uses the same edge as a genuine read-only interaction boundary.
      page.locator('.graph-mode-trigger').click();page.locator('[data-graph-mode-option="reading"]').click();before=link();path=page.locator('.edge-hit').first;point=path.evaluate('(e)=>{const p=e.getPointAtLength(e.getTotalLength()*.5),m=e.getScreenCTM();return {x:m.a*p.x+m.c*p.y+m.e,y:m.b*p.x+m.d*p.y+m.f}}');page.mouse.move(point['x'],point['y']);page.mouse.down();page.mouse.move(point['x']+40,point['y']-30,steps=10);page.mouse.up();assert link()==before;expect(page.locator('.edge-endpoint-handle')).to_have_count(0)
      page.locator('.graph-mode-trigger').click();page.locator('[data-graph-mode-option="professional"]').click()
      # Failed persistence keeps the live edit and a retry button recovers it.
      select_edge()
      def offline(route):
       if route.request.method in ['PUT','PATCH','POST']:route.fulfill(status=503,content_type='application/json',body='{"detail":"edge retry probe"}')
       else:route.continue_()
      page.route('**/api/v1/files/**',offline);panel('line');page.locator('[data-uc-edge-arrow="both"]').click();page.locator('#graphSaveState').click();expect(page.locator('#graphSaveState .graph-save-state-text')).to_have_text('保存失败');snap('07-save-failed');assert link()['arrowStyle']=='both';assert ctx.request.get(base+'/api/v1/files/'+fid).json()['graphData']['links'][0]['arrowStyle']!='both'
      page.unroute('**/api/v1/files/**',offline);save();assert ctx.request.get(base+'/api/v1/files/'+fid).json()['graphData']['links'][0]['arrowStyle']=='both'
      select_edge();page.locator('#stage').focus();page.keyboard.press('Delete');assert page.evaluate('state.links.length')==0;page.keyboard.press('ControlOrMeta+z');assert page.evaluate('state.links.length')==1;save();snap('08-recovered-delete-undo')
      assert not errors,errors
      print('PASS full UI edge flow',fid)
     except Exception:
      snap('FAILURE');raise
     finally:
      (out/'errors.json').write_text(json.dumps(errors,ensure_ascii=False));ctx.tracing.stop(path=str(out/'trace.zip'));ctx.close();b.close()


def run_readonly_ui(base, out):
    out.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
     b=p.chromium.launch(channel='chrome');ctx=b.new_context(viewport={'width':1680,'height':1050});assert ctx.request.post(base+'/api/v1/auth/login',data={'username':'ink-viewer','password':'ink-browser-test'}).ok
     before=ctx.request.get(base+'/api/v1/files/role-graph-ink-viewer').json()['graphData'];assert len(before['links'])==1
     page=ctx.new_page();errs=[];page.on('pageerror',lambda e:errs.append(str(e)));page.goto(base+'/index.html',wait_until='networkidle');page.wait_for_function('!!window.KGGraphFileTabs&&!KGGraphFileTabs.isSwitching()')
     for s in ['#learningEntryDismissBtn','.tour-skip','#hideHelpBtn']:
      if page.locator(s).is_visible():page.locator(s).click()
     page.wait_for_function('window.KGRolePermissions?.currentRole?.()==="viewer" && state.nodes.some(n=>n.id==="ro-a")');initial=page.evaluate('({body:document.body.className,role:KGRolePermissions.currentRole(),canEdit:KGRolePermissions.can("editGraph"),links:state.links,bootstrapReadOnly:window.__KG_DIRECT_BOOTSTRAP__?.readOnly})');print(initial,flush=True);page.screenshot(path=str(out/'readonly-probe.png'));assert page.locator('#addBtn').count()==0 or not page.locator('#addBtn').is_visible()
     for mode in ['efficient','professional']:
      page.locator('.graph-mode-trigger').click();page.locator('[data-graph-mode-option="'+mode+'"]').click()
      path=page.locator('.edge-hit').first
      point=path.evaluate('(e)=>{const p=e.getPointAtLength(e.getTotalLength()*.5),m=e.getScreenCTM();return {x:m.a*p.x+m.c*p.y+m.e,y:m.b*p.x+m.d*p.y+m.f}}')
      page.mouse.click(point['x'],point['y']);assert page.evaluate('state.selectedLinkId')=='ro-ab';page.mouse.move(point['x'],point['y']);page.mouse.down();page.mouse.move(point['x']+60,point['y']-60,steps=20);page.mouse.up();page.keyboard.press('Delete');page.keyboard.press('Backspace');page.keyboard.press('n');page.keyboard.press('ControlOrMeta+z');page.mouse.click(320,398);page.mouse.move(520,398);page.mouse.down();page.mouse.move(1000,398,steps=20);page.mouse.up()
     after_ui=page.evaluate('({links:state.links,nodes:state.nodes})');after_api=ctx.request.get(base+'/api/v1/files/role-graph-ink-viewer').json()['graphData'];status=ctx.request.put(base+'/api/v1/files/role-graph-ink-viewer',data={'graphData':{'nodes':[],'links':[]}}).status;(out/'viewer-evidence.json').write_text(json.dumps({'initial':initial,'afterUi':after_ui,'beforeApi':before,'afterApi':after_api,'writeStatus':status},ensure_ascii=False,indent=2));page.screenshot(path=str(out/'viewer-after-actions.png'));assert page.evaluate('state.links.length')==1;assert page.locator('.edge-endpoint-handle').count()==0;assert page.locator('.node-growth-handle').count()==0
     assert not page.locator('#edgeQuickStylePanel').is_visible();assert page.evaluate('JSON.parse(JSON.stringify(state.links))')==initial['links']
     assert ctx.request.put(base+'/api/v1/files/role-graph-ink-viewer',data={'graphData':{'nodes':[],'links':[]}}).status==403
     after=ctx.request.get(base+'/api/v1/files/role-graph-ink-viewer').json()['graphData'];assert after==before
     page.screenshot(path=str(out/'09-viewer-readonly.png'));(out/'viewer-result.json').write_text(json.dumps({'before':before,'after':after,'errors':errs},ensure_ascii=False,indent=2));assert not errs,errs
     page.reload(wait_until='networkidle');page.wait_for_function('window.KGRolePermissions?.currentRole?.()==="viewer" && state.nodes.some(n=>n.id==="ro-a")');assert page.evaluate('state.links.length')==1
     print('PASS viewer readonly real edge click/drag/delete/add/undo and API403, persisted graph unchanged');ctx.close();b.close()


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--base-url',required=True)
    parser.add_argument('--full-ui', action='store_true', help='Real mouse/keyboard edge flow; role-matrix disposable server only')
    parser.add_argument('--readonly-ui', action='store_true', help='Viewer edge fixture must be prepared with two cards and ro-ab')
    parser.add_argument('--username', choices=['ink-browser','ink-student'], default='ink-browser')
    parser.add_argument('--output-dir', type=Path, default=ROOT/'artifacts/full-graph-flow/edges/candidate')
    args=parser.parse_args()
    base=args.base_url.rstrip('/')
    assert urlparse(base).hostname in ('localhost','127.0.0.1')
    if args.full_ui:
        return run_full_ui(base, args.output_dir, args.username)
    if args.readonly_ui:
        return run_readonly_ui(base, args.output_dir)
    with sync_playwright() as pw:
        browser=pw.chromium.launch(channel='chrome')
        ctx=browser.new_context(viewport={'width':1680,'height':1050})
        assert ctx.request.post(base+'/api/v1/auth/login',data={'username':'ink-browser','password':'ink-browser-test'}).ok
        suffix=uuid.uuid4().hex[:7]
        # 场景 A：两条不同角度的边汇入同一圆形卡（圆的附着点随方向连续变化）→ 端点收拢。
        # 场景 B：两条不同宽度的左侧卡汇入同一矩形卡，派生折线 trunk 相差 20px → 通道对齐。
        nodes=[
            {'id':'a1','title':'汇入甲','level':'基础','geometry':{'x':0,'y':250,'width':200,'height':100}},
            {'id':'a2','title':'汇入乙','level':'基础','geometry':{'x':0,'y':380,'width':200,'height':100}},
            {'id':'b','title':'圆形汇总','level':'基础','cardStyle':'circle','geometry':{'x':700,'y':240,'width':200,'height':220}},
            {'id':'c1','title':'宽卡','level':'基础','geometry':{'x':0,'y':700,'width':200,'height':100}},
            {'id':'c2','title':'窄卡','level':'基础','geometry':{'x':0,'y':710,'width':160,'height':60}},
            {'id':'d','title':'矩形汇总','level':'基础','geometry':{'x':700,'y':640,'width':200,'height':220}},
        ]
        graph={'meta':{'title':'多线汇总'},'viewport':{'x':60,'y':20,'scale':1},'nodes':nodes,
               'links':[{'id':'e1','from':'a1','to':'b','pathStyle':'elbow'},
                        {'id':'e2','from':'a2','to':'b','pathStyle':'elbow'},
                        {'id':'f1','from':'c1','to':'d','pathStyle':'elbow'},
                        {'id':'f2','from':'c2','to':'d','pathStyle':'elbow'}]}
        r=ctx.request.post(base+'/api/v1/files',data={'name':f'edge-bundle-{suffix}','graphData':graph})
        assert r.ok,r.text()
        fid=r.json()['file']['id']
        assert ctx.request.put(base+'/api/v1/files/current',data={'fileId':fid}).ok
        page=ctx.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(base+'/index.html',wait_until='networkidle')
        page.wait_for_function('!!window.KGGraphFileTabs && !!window.KGGraphModel')
        for selector in ['#learningEntryDismissBtn','.tour-skip','#hideHelpBtn']:
            if page.locator(selector).is_visible():page.locator(selector).click()
        page.wait_for_timeout(300)

        def snapshot():
            return page.evaluate('''()=>{const read=id=>{const dom=edgeDomById.get(id);if(!dom?.geometry)return null;return{endpoints:dom.geometry.endpoints.map(p=>({x:p.x,y:p.y})),controls:dom.geometry.controls.map(p=>({x:p.x,y:p.y})),d:dom.geometry.d}};return{e1:read('e1'),e2:read('e2'),f1:read('f1'),f2:read('f2'),stored:state.links.map(l=>({id:l.id,waypoints:l.waypoints,curveControls:l.curveControls}))}}''')

        snap=snapshot()
        assert all(snap[key] for key in ('e1','e2','f1','f2')),snap
        # 场景 A：端点收拢——两条边汇入圆形卡的附着点完全重合。
        assert snap['e1']['endpoints'][1]==snap['e2']['endpoints'][1],snap
        # 场景 B：通道对齐——原本相差 20px 的派生折线主干 x 完全一致。
        f1x=snap['f1']['controls'][0]['x'];f2x=snap['f2']['controls'][0]['x']
        assert f1x==f2x,snap
        # render-only：持久数据不得被写入 waypoints/curveControls。
        assert all(link['waypoints'] is None and link['curveControls'] is None for link in snap['stored']),snap
        # 刷新后（重新规划）几何保持一致。
        page.reload(wait_until='networkidle')
        page.wait_for_function('!!window.KGGraphFileTabs && !!window.KGGraphModel')
        page.wait_for_timeout(300)
        reloaded=snapshot()
        for key in ('e1','e2','f1','f2'):assert reloaded[key]['d']==snap[key]['d'],(key,snap[key],reloaded[key])
        assert not errors,errors
        print('PASS edge bundle: converging endpoints merged, parallel elbow trunks aligned, persisted data untouched',flush=True)
        browser.close()

if __name__=='__main__':
    main()
