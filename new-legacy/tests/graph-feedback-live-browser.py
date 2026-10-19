"""Graph feedback gestures and compact controls against an isolated local API."""
import argparse,json,uuid
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'artifacts/learning-tool-feedback/graph';OUT.mkdir(parents=True,exist_ok=True)
p=argparse.ArgumentParser();p.add_argument('--base-url',required=True);base=p.parse_args().base_url.rstrip('/');assert base.startswith('http://127.0.0.1:')
with sync_playwright() as pw:
 browser=pw.chromium.launch(channel='chrome');ctx=browser.new_context(viewport={'width':1440,'height':1000});assert ctx.request.post(base+'/api/v1/auth/login',data={'username':'ink-browser','password':'ink-browser-test'}).ok
 graph={'nodes':[{'id':id,'title':title,'notes':'保留备注','x':x,'y':y,'geometry':{'x':x,'y':y,'width':200,'height':120}} for id,title,x,y in [('a','学习计划',300,340),('b','理解知识',760,170),('c','主动回忆',760,510)]],'links':[{'id':'ab','from':'a','to':'b','pathStyle':'curve','hierarchy':True},{'id':'ac','from':'a','to':'c','pathStyle':'curve','hierarchy':True}],'viewport':{'x':0,'y':0,'scale':1}}
 r=ctx.request.post(base+'/api/v1/files',data={'name':'图谱交互回归'+uuid.uuid4().hex[:8],'graphData':graph});assert r.ok;r=r.json();fid=r['file']['id'];assert ctx.request.put(base+'/api/v1/files/current',data={'fileId':fid}).ok
 page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto(base+'/index.html',wait_until='networkidle')
 for selector in ['#learningEntryDismissBtn','.tour-skip','#hideHelpBtn']:
  if page.locator(selector).is_visible():page.locator(selector).click()
 page.locator('.graph-mode-trigger').click();page.locator('[data-graph-mode-option="professional"]').click();page.wait_for_function('!KGGraphFileTabs.isSwitching()');page.evaluate('()=>{state.viewport={x:0,y:0,scale:1};applyTransform()}')
 def count():return page.evaluate('KGGraphKernel.history.getState().undoCount')
 def route():return page.evaluate('edgeRouteSnapshot(linkById("ab"))')
 def coord(point):return page.evaluate('(p)=>{const r=stage.getBoundingClientRect();return {x:r.left+state.viewport.x+p.x*state.viewport.scale,y:r.top+state.viewport.y+p.y*state.viewport.scale}}',point)
 def drag_to(start,dx,dy,cancel=False):
  page.mouse.move(start['x'],start['y']);page.mouse.down();page.mouse.move(start['x']+dx,start['y']+dy,steps=6)
  if cancel:page.keyboard.press('Escape')
  page.mouse.up();page.wait_for_timeout(80)
 def handle_drag(selector,dx,dy,cancel=False):
  box=page.locator(selector).bounding_box();assert box,selector;drag_to({'x':box['x']+box['width']/2,'y':box['y']+box['height']/2},dx,dy,cancel)
 # Symmetric automatic branches have a shared root side and mirrored samples.
 shapes=page.evaluate('["ab","ac"].map(id=>edgeDomById.get(id).geometry)')
 for first,second in zip(shapes[0]['samples'],shapes[1]['samples']):assert abs(first['x']-second['x'])<.001 and abs(first['y']+second['y']-800)<.001
 page.screenshot(path=str(OUT/'symmetric-branches.png'))
 # Stored upper controls must not bend a newly rebound lower branch upward.
 original=route();history=count();select_point=coord(shapes[0]['samples'][12]);page.mouse.click(select_point['x'],select_point['y']);assert page.evaluate('state.selectedLinkId')=='ab'
 handle_drag('[data-link-id="ab"][data-edge-control-kind="curve-midpoint"]',0,-32)
 manual=route();assert manual['from']=='a' and manual['to']=='b' and len(manual['curveControls'])==2 and count()==history+1
 assert page.evaluate('edgeDomById.get("ab").geometry.samples[12].y')<shapes[0]['samples'][12]['y']-30
 endpoint_selector='[data-link-id="ab"][data-edge-endpoint-side="to"]';endpoint_box=page.locator(endpoint_selector).bounding_box();assert endpoint_box
 target=coord({'x':860,'y':570});rebind_history=count();handle_drag(endpoint_selector,target['x']-endpoint_box['x']-endpoint_box['width']/2,target['y']-endpoint_box['y']-endpoint_box['height']/2)
 rebound=route();assert rebound['from']=='a' and rebound['to']=='c' and rebound['curveControls'] is None and count()==rebind_history+1,(rebound,count(),rebind_history)
 expect(page.locator('#detailPanel .detail-title')).to_have_text('学习计划 ↔ 主动回忆')
 rebound_shape=page.evaluate('edgeDomById.get("ab").geometry');assert rebound_shape['derivedCurveControls'] is True
 assert rebound_shape['endpoints']==[{'x':500,'y':400},{'x':760,'y':570}],rebound_shape['endpoints']
 assert all(400<=point['y']<=570 for point in rebound_shape['samples']),rebound_shape['samples']
 assert all(a['y']<=b['y'] for a,b in zip(rebound_shape['samples'],rebound_shape['samples'][1:])),rebound_shape['samples']
 assert page.evaluate('KGGraphFileAutosave.saveAcknowledged({force:true})') is True
 saved_response=ctx.request.get(base+'/api/v1/files/'+fid);assert saved_response.ok
 saved_link=next(link for link in saved_response.json()['graphData']['links'] if link['id']=='ab');assert saved_link['from']=='a' and saved_link['to']=='c' and not saved_link.get('curveControls'),saved_link
 page.screenshot(path=str(OUT/'rebound-down-curve.png'))
 page.evaluate('restoreGraphUndoSnapshot()');assert route()==manual and count()==rebind_history
 page.evaluate('restoreGraphUndoSnapshot()');assert route()==original and count()==history
 # A short middle-body drag used to detach both endpoints.
 page.evaluate('clearSelection()');original=route();history=count();middle=coord(shapes[0]['samples'][12]);drag_to(middle,7,4)
 assert route()['from']=='a' and route()['to']=='b';assert count()==history+1;assert route()!=original
 page.evaluate('restoreGraphUndoSnapshot()');assert route()==original
 page.evaluate('selectLink("ab")');history=count();handle_drag('[data-link-id="ab"][data-edge-control-kind="curve-midpoint"]',6,-5)
 assert route()['from']=='a' and route()['to']=='b' and count()==history+1
 stable=route();history=count();handle_drag('[data-link-id="ab"][data-edge-control-kind="curve-midpoint"]',8,7,True);assert route()==stable and count()==history
 # Four-pixel adjustments remain usable in each direction and undo as one gesture.
 for dx,dy in [(0,-4),(0,4),(-4,0),(4,0)]:
  before_point=page.evaluate('edgeDomById.get("ab").geometry.samples[12]');history=count();handle_drag('[data-link-id="ab"][data-edge-control-kind="curve-midpoint"]',dx,dy)
  after_point=page.evaluate('edgeDomById.get("ab").geometry.samples[12]');assert abs(after_point['x']-before_point['x']-dx)<.001 and abs(after_point['y']-before_point['y']-dy)<.001,(dx,dy,before_point,after_point)
  assert route()['from']=='a' and route()['to']=='b' and count()==history+1
  page.evaluate('restoreGraphUndoSnapshot()');assert route()==stable and count()==history
 # Elbow segment midpoint preserves a horizontal/vertical route and exact undo.
 page.evaluate('applyPathStyle("elbow")');history=count();before=route();unchanged_path=page.evaluate('edgeDomById.get("ab").geometry.d')
 handle_drag('[data-link-id="ab"][data-edge-control-kind="segment"][data-edge-control-index="1"]',0,9)
 assert page.evaluate('edgeDomById.get("ab").geometry.d')==unchanged_path
 assert route()==before and count()==history,'dragging along a locked elbow axis must not create route data or an undo entry'
 page.evaluate('clearSelection()');trunk_point=coord(page.evaluate('()=>{const p=edgeDomById.get("ab").geometry.waypoints;return{x:p[0].x,y:p[0].y*.25+p[1].y*.75}}'))
 drag_to(trunk_point,0,9);assert route()==before and count()==history and page.evaluate('edgeDomById.get("ab").geometry.d')==unchanged_path,'body dragging along a locked elbow axis must also remain a no-op'
 page.evaluate('selectLink("ab")')
 handle_drag('[data-link-id="ab"][data-edge-control-kind="segment"][data-edge-control-index="1"]',9,5)
 after=route();assert after['from']=='a' and after['to']=='b' and count()==history+1
 samples=page.evaluate('edgeDomById.get("ab").geometry.samples')
 assert all(a['x']==b['x'] or a['y']==b['y'] for a,b in zip(samples,samples[1:])),samples
 page.evaluate('restoreGraphUndoSnapshot()');assert route()==before
 # Explicit endpoint handle remains the intentional way to unbind.
 history=count();handle_drag('[data-link-id="ab"][data-edge-endpoint-side="to"]',-70,-90);assert route()['from']=='a' and route()['to']=='' and count()==history+1,(route(),count(),history)
 page.evaluate('restoreGraphUndoSnapshot()');assert route()==before
 # Coincident lines can be selected individually with Alt + click.
 page.evaluate('()=>{const duplicate=JSON.parse(JSON.stringify(linkById("ab")));duplicate.id="ab-copy";state.links.push(duplicate);invalidateGraphIndexCache();renderEdges();selectLink("ab")}')
 point=coord(page.evaluate('edgeDomById.get("ab").geometry.samples[1]'));page.keyboard.down('Alt');page.mouse.click(point['x'],point['y']);page.keyboard.up('Alt');assert page.evaluate('state.selectedLinkId')=='ab-copy'
 page.evaluate('()=>{state.links=state.links.filter(l=>l.id!=="ab-copy");invalidateGraphIndexCache();renderEdges();clearSelection()}')
 # Panel occupies a short row at rest; theme is visible immediately, one undo restores it.
 page.locator('#mindmapBtn').click();panel=page.locator('[data-formal-mindmap-panel]');expect(panel).to_be_visible();assert panel.bounding_box()['height']<70
 panel.locator('[data-mm-menu="theme"] > summary').click();history=count();panel.locator('[data-mm-theme="blue"]').click();assert count()==history+1
 assert page.evaluate('KGGraphModel.appearanceOf(nodeById("a")).fillColor')=='#dbeafe'
 expect(panel.locator('[data-mm-theme="blue"]')).to_have_attribute('aria-pressed','true');panel.locator('[data-mm-undo]').click();assert page.evaluate('KGGraphModel.appearanceOf(nodeById("a")).fillColor')!='#dbeafe'
 panel.locator('[data-mm-menu="layout"] > summary').click();panel.locator('.mm-advanced > summary').click();panel.locator('[data-mm-root]').select_option('a')
 for direction in ['right','left','bilateral','down']:
  panel.locator('[data-mm-direction]').select_option(direction);assert page.evaluate('state.mindmap.direction')==direction
 panel.locator('[data-mm-direction]').select_option('right')
 page.screenshot(path=str(OUT/'compact-layout.png'))
 panel.locator('[data-mm-menu="theme"] > summary').click();panel.locator('[data-mm-theme="capsule"]').click();page.screenshot(path=str(OUT/'compact-theme.png'))
 panel.get_by_role('button',name='关闭布局与主题').click()
 # A locked group bounds overlay deliberately overlaps the node toolbar.
 page.evaluate('()=>{selectedNodeIds=new Set(["a","b"]);state.selectedNodeId="a";refreshSelectionUI();const t=nodeStyleToolbarController.getRoot(),r=t.getBoundingClientRect(),s=stage.getBoundingClientRect();const b=stage.querySelector(".uc-selection-bounds");b.hidden=false;b.style.cssText=`left:${r.left-s.left-10}px;top:${r.top-s.top-10}px;width:${r.width+20}px;height:${r.height+20}px`;stage.classList.add("home-selection-interaction-locked")}')
 trigger=page.locator('[data-node-toolbar-panel="fill"]');assert trigger.evaluate('(e)=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}');trigger.click();expect(trigger).to_have_attribute('aria-expanded','true')
 # Fullscreen and 50/200% must preserve real toolbar hit testing.
 for scale in [.5,2]:
  page.evaluate('(scale)=>{state.viewport.scale=scale;applyTransform()}',scale);assert trigger.evaluate('(e)=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}')
 page.evaluate('()=>{const b=document.createElement("button");b.id="graph-fullscreen-test";b.style.cssText="position:fixed;top:100px;right:30px;z-index:99999";b.textContent="fullscreen";b.onclick=()=>stage.requestFullscreen();document.body.append(b)}');page.locator('#graph-fullscreen-test').click();page.wait_for_function('!!document.fullscreenElement');assert trigger.evaluate('(e)=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}');page.screenshot(path=str(OUT/'fullscreen-selection-toolbar.png'));page.evaluate('document.exitFullscreen()');page.wait_for_function('!document.fullscreenElement')
 # Smooth zoom uses no full/card DOM render; wait for native world reraster at rest.
 counts=page.evaluate('KGGraphKernel.diagnostics().renderer');page.evaluate('animateGraphViewportSmooth({x:0,y:0,scale:1},{persist:false,duration:180})');page.wait_for_function('!stage.classList.contains("viewport-smooth-zooming")');assert page.evaluate('KGGraphKernel.diagnostics().renderer')==counts
 assert page.locator('#world').evaluate('(e)=>getComputedStyle(e).willChange')=='auto'
 assert page.locator('#cardsLayer').evaluate('(e)=>getComputedStyle(e).willChange')=='auto'
 assert not errors,errors
 (OUT/'live-results.json').write_text(json.dumps({'base':base,'scenarios':'symmetry, stored curve endpoint rebind/durable save/undo, body/midpoint/segment drag, endpoint unbind, undo, Esc cancel, coincident selection, compact layout/themes, group toolbar hit, fullscreen, zoom','errors':errors},ensure_ascii=False,indent=2));ctx.request.delete(base+'/api/v1/files/'+fid);browser.close()
print('PASS graph feedback live gestures, compact themes, undo, selection hit, fullscreen and zoom')
