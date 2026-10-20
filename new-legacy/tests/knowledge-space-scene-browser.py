"""Standalone scene: real Chromium mouse, touch, resizing and lifecycle checks."""
from pathlib import Path
import json
import time
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[2]
MODULE=ROOT/'new-legacy/src/practice/knowledge-space-scene.js'
OUT=ROOT/'artifacts/knowledge-universe-20261020/task-2'
OUT.mkdir(parents=True,exist_ok=True)
assert MODULE.exists(), 'knowledge-space-scene.js must exist before browser interactions can run'
NODES=[dict(id=f'topic-{i}',title=f'真实接口形状测试考点 {i}',subject='数学' if i<12 else '英语',taxonomyId='algebra' if i<12 else 'reading',brightness=.2+i/30) for i in range(24)]
metrics=[]
def assert_fit(page,label):
 state=page.evaluate('scene.snapshot()');box=page.locator('canvas').bounding_box()
 points=state['positions'];xs=[v['x'] for v in points];ys=[v['y'] for v in points]
 span_x=max(xs)-min(xs);span_y=max(ys)-min(ys)
 assert max(span_x/box['width'],span_y/box['height'])>=.60, f'{label}: default nodes too compact: {span_x:.1f}x{span_y:.1f} in {box}'
 assert min(xs)>=16 and max(xs)<=box['width']-16 and min(ys)>=16 and max(ys)<=box['height']-16,f'{label}: fit clips nodes'
 assert .45<=state['camera']['zoom']<=3, f'{label}: default fit must respect zoom bounds'
 print(f"fit {label}: {span_x:.1f}x{span_y:.1f}, zoom={state['camera']['zoom']:.3f}")
 return state['camera']

with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 for width in (1440,390):
  context=browser.new_context(viewport={'width':width,'height':900},has_touch=True,device_scale_factor=3)
  page=context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
  page.set_content('''<style>body{margin:0;background:#050914;color:#eef;font:14px sans-serif}#modal{height:760px;overflow-y:auto;overscroll-behavior:contain}#host{margin:40px 16px;width:calc(100% - 32px);height:560px;overflow:hidden;border:1px solid #234}</style><div id="modal"><div id="host"></div><div style="height:1200px">场景外滚动区域</div></div>''')
  page.wait_for_load_state('networkidle');page.add_script_tag(content=MODULE.read_text())
  # Instrument actual Canvas operations and RAF callbacks without replacing rendering.
  page.evaluate('''()=>{
   const nativeRAF=window.requestAnimationFrame;
   window.frameCosts=[];
   window.requestAnimationFrame=callback=>nativeRAF.call(window,time=>{
    const started=performance.now();callback(time);frameCosts.push(performance.now()-started);
   });
   window.observeDrawing=()=>{
    const ctx=document.querySelector('canvas').getContext('2d');
    const clear=ctx.clearRect,arc=ctx.arc,fill=ctx.fill;let radius=0;
    window.dotStyles=[];window.arcs=0;
    ctx.clearRect=function(...args){dotStyles=[];arcs=0;return clear.apply(this,args)};
    ctx.arc=function(...args){radius=args[2];arcs++;return arc.apply(this,args)};
    ctx.fill=function(...args){if(radius<=9)dotStyles.push(this.fillStyle);return fill.apply(this,args)};
   };
  }''')
  page.evaluate("()=>{window.scene=KGKnowledgeSpaceScene.mount({host:document.querySelector('#host'),nodes:[.12,.4,.7,1].map((brightness,i)=>({id:String(i),parentId:null,brightness}))});observeDrawing()}")
  page.wait_for_function('scene.snapshot().settled && !scene.snapshot().running')
  styles=page.evaluate('dotStyles')
  assert 'rgba(190, 224, 255, 0.384)' in styles,f'unpractised .12 must remain distinct from .2: {styles}'
  assert len(set(styles))==4,'incoming practice brightness must remain continuous'
  page.evaluate('scene.destroy()')
  for size in (320,1000):
   fixture=[dict(id=f'full-{i}',parentId=f'full-{i-1}' if i%40 else None,title=f'完整考点 {i}',subject=f'科目 {i//40}',taxonomyId=f'tree-{i//40}',brightness=(.12,.4,.7,1)[i%4]) for i in range(size)]
   started=time.perf_counter()
   page.evaluate("nodes=>{frameCosts=[];window.scene=KGKnowledgeSpaceScene.mount({host:document.querySelector('#host'),nodes});observeDrawing()}",fixture)
   page.wait_for_function('scene.snapshot().settled && !scene.snapshot().running',timeout=10000)
   elapsed=(time.perf_counter()-started)*1000
   state=page.evaluate('scene.snapshot()')
   assert len(state['positions'])==size and all(v['visible'] for v in state['positions'])
   assert page.evaluate('dotStyles.length')==size and page.evaluate('arcs')==size*2,'every business point must be drawn, without LOD dropping nodes'
   assert_fit(page,f'{width}/{size}-node-catalog')
   costs=sorted(page.evaluate('frameCosts'))
   metrics.append(dict(width=width,nodes=size,settlementMs=round(elapsed,1),frames=len(costs),callbackP95Ms=round(costs[int((len(costs)-1)*.95)],1),callbackMaxMs=round(max(costs),1),drawnNodes=page.evaluate('dotStyles.length')))
   page.screenshot(path=str(OUT/f'catalog-{size}-{width}.png'))
   box=page.locator('canvas').bounding_box();cx=box['x']+box['width']/2;cy=box['y']+box['height']/2
   before=state['camera'];page.mouse.move(cx,cy);page.mouse.down();page.mouse.move(cx+40,cy+10,steps=3);page.mouse.up()
   assert page.evaluate('scene.snapshot().camera.yaw')!=before['yaw']
   page.wait_for_function('!scene.snapshot().running')
   assert page.evaluate('dotStyles.length')==size,'rotation cannot hide points as a performance shortcut'
   page.evaluate('scene.destroy()')
  for kind in ('single-group','multi-group'):
   fixture=[dict(id=f'fit-{i}',title=f'布局测试考点 {i}',subject='数学' if kind=='single-group' else f'科目 {i//10}',taxonomyId='classification',brightness=.7) for i in range(60)]
   page.evaluate("nodes=>{window.scene=KGKnowledgeSpaceScene.mount({host:document.querySelector('#host'),nodes})}",fixture)
   page.wait_for_function('scene.snapshot().settled && !scene.snapshot().running')
   fitted=assert_fit(page,f'{width}/{kind}/initial')
   page.screenshot(path=str(OUT/f'fit-{kind}-{width}.png'))
   page.evaluate('scene.rotate(80,30);scene.zoomBy(.6)');page.wait_for_function('!scene.snapshot().running')
   manual=page.evaluate('scene.snapshot().camera')
   page.evaluate("document.querySelector('#host').style.height='500px'");page.wait_for_timeout(100)
   assert page.evaluate('scene.snapshot().camera')==manual,'resize cannot overwrite manual camera'
   page.evaluate("document.querySelector('#host').style.height='560px'");page.wait_for_timeout(100)
   page.evaluate('scene.reset()');page.wait_for_function('!scene.snapshot().running')
   assert assert_fit(page,f'{width}/{kind}/reset')==fitted
   page.evaluate('scene.destroy()')
  # An early user adjustment must survive later physical settlement.
  page.evaluate("nodes=>{window.scene=KGKnowledgeSpaceScene.mount({host:document.querySelector('#host'),nodes});scene.rotate(20,10);scene.zoomBy(.8)}",NODES)
  early=page.evaluate('scene.snapshot().camera');page.wait_for_function('scene.snapshot().settled && !scene.snapshot().running')
  assert page.evaluate('scene.snapshot().camera')==early,'settlement cannot overwrite manual camera'
  page.evaluate('scene.destroy()')
  page.evaluate('''nodes=>{window.chosen=[];window.scene=KGKnowledgeSpaceScene.mount({host:document.querySelector('#host'),nodes,onSelect:(node,index)=>chosen.push({id:node.id,index})})}''',NODES)
  page.evaluate("document.querySelector('#host').style.visibility='hidden'")
  page.wait_for_timeout(120);assert not page.evaluate('scene.snapshot().running')
  page.evaluate("document.querySelector('#host').style.visibility='visible'")
  page.wait_for_function('scene.snapshot().settled && !scene.snapshot().running',timeout=4000)
  snap=lambda:page.evaluate('scene.snapshot()')
  initial=snap();assert len(initial['positions'])==24;assert initial['selected'] is None
  assert_fit(page,f'{width}/24-node-initial')
  assert page.locator('canvas').evaluate('(c)=>c.width')<=2*(width-30)
  box=page.locator('canvas').bounding_box();cx=box['x']+box['width']/2;cy=box['y']+box['height']/2
  page.mouse.move(cx,cy);page.mouse.down();page.mouse.move(cx+80,cy+35,steps=8)
  held=snap()['camera'];page.wait_for_timeout(400)
  assert snap()['camera']==held,'holding still must not move camera'
  assert not snap()['running'],'settled scene must stop RAF while a dragged pointer is held still'
  page.mouse.up()
  assert snap()['camera']['yaw']!=initial['camera']['yaw'];assert page.evaluate('chosen')==[], 'drag cannot select'
  page.wait_for_function('!scene.snapshot().running')
  assert snap()['camera']!=held,'released pointer should resume its bounded inertia'
  # Ordinary wheel belongs to the scrollable modal; only modified wheel zooms.
  before=snap()['camera'];page.mouse.move(cx,cy);page.mouse.wheel(0,150);page.wait_for_timeout(160)
  assert page.locator('#modal').evaluate('(e)=>e.scrollTop')>0,'ordinary wheel over Canvas must scroll modal'
  assert snap()['camera']==before,'ordinary wheel cannot change camera'
  page.mouse.wheel(0,-150);page.wait_for_timeout(160)
  assert page.locator('#modal').evaluate('(e)=>e.scrollTop')==0
  for modifier in ('Control','Meta'):
   before=snap()['camera']['zoom'];page.keyboard.down(modifier);page.mouse.wheel(0,150);page.keyboard.up(modifier);page.wait_for_timeout(80)
   assert snap()['camera']['zoom']<before
   before=snap()['camera']['zoom'];page.keyboard.down(modifier);page.mouse.wheel(0,-150);page.keyboard.up(modifier);page.wait_for_timeout(80)
   assert snap()['camera']['zoom']>before
   assert page.locator('#modal').evaluate('(e)=>e.scrollTop')==0,'modified wheel must not scroll modal'
  page.mouse.move(5,650);page.mouse.wheel(0,100);page.wait_for_timeout(100)
  assert page.locator('#modal').evaluate('(e)=>e.scrollTop')>0
  page.evaluate("document.querySelector('#modal').scrollTop=0;scene.reset()");page.wait_for_function('!scene.snapshot().running')
  # Select the nearest visible projected node, using actual mouse dispatch and a host offset.
  point=max([v for v in snap()['positions'] if v['visible']],key=lambda v:v['scale'])
  page.mouse.click(box['x']+point['x'],box['y']+point['y']);assert page.evaluate('chosen.length')==1
  assert page.evaluate('chosen[0].index')==point['index'];assert snap()['selected']==point['index']
  page.evaluate('scene.select(7)');assert snap()['selected']==7;assert page.evaluate('chosen.length')==1,'programmatic sync cannot echo selection callback'
  page.evaluate('scene.select(-1);scene.select(999)');assert snap()['selected']==7
  key='["英语","reading"]';page.evaluate('(key)=>scene.focusGroup(key)',key)
  assert all(v['visible']==(v['group']==key) for v in snap()['positions'])
  page.evaluate("scene.focusGroup('missing')");assert not any(v['visible'] for v in snap()['positions'])
  page.evaluate('scene.reset()');assert all(v['visible'] for v in snap()['positions']);assert snap()['camera']==initial['camera'];assert snap()['group']==''
  # Real browser touch events produce PointerEvents. A pinch must not emit node selection.
  session=context.new_cdp_session(page)
  def touch(kind,points):session.send('Input.dispatchTouchEvent',{'type':kind,'touchPoints':[dict(x=x,y=y,id=i) for i,x,y in points]})
  before=snap()['camera'];count=page.evaluate('chosen.length')
  touch('touchStart',[(1,cx,cy+70)])
  for delta in (3,12,30,55,90,130):
   touch('touchMove',[(1,cx+2,cy+70-delta)]);page.wait_for_timeout(20)
  # Let Chromium's native scroll momentum finish before the next independent gesture.
  touch('touchEnd',[]);page.wait_for_timeout(1200)
  assert page.locator('#modal').evaluate('(e)=>e.scrollTop')>0,'vertical touch over Canvas must scroll modal'
  assert snap()['camera']==before,'vertical touch cannot rotate or zoom'
  assert page.evaluate('chosen.length')==count,'scroll cannot select'
  page.evaluate("document.querySelector('#modal').scrollTop=0");page.wait_for_timeout(100)
  touch('touchStart',[(1,cx-30,cy)]);touch('touchMove',[(1,cx+30,cy)]);touch('touchEnd',[])
  assert snap()['camera']['yaw']!=before['yaw'];assert snap()['camera']['pitch']==before['pitch'];assert page.evaluate('chosen.length')==count
  assert page.locator('#modal').evaluate('(e)=>e.scrollTop')==0,'horizontal touch cannot scroll modal'
  page.evaluate('scene.reset();scene.zoomBy(.6)');before=snap()['camera']['zoom']
  touch('touchStart',[(1,cx-25,cy),(2,cx+25,cy)]);touch('touchMove',[(1,cx-60,cy),(2,cx+60,cy)]);touch('touchEnd',[])
  assert snap()['camera']['zoom']>before;assert page.evaluate('chosen.length')==count
  touch('touchStart',[(1,cx,cy)]);touch('touchCancel',[]);assert page.evaluate('chosen.length')==count
  page.evaluate('scene.zoomBy(1e9)');upper=snap()['camera']['zoom'];assert upper<100
  page.evaluate('scene.zoomBy(1e-12)');assert 0<snap()['camera']['zoom']<upper
  # At minimum zoom, overlapping hit targets must pick the frontmost node.
  points=[v for v in snap()['positions'] if v['visible']]
  overlap=None
  for target in points:
   candidates=[v for v in points if ((v['x']-target['x'])**2+(v['y']-target['y'])**2)**.5<=12]
   if len(candidates)>1:
    overlap=(target,min(candidates,key=lambda v:v['depth']));break
  assert overlap is not None,'fixture must exercise overlapping hit targets'
  target,front=overlap
  page.mouse.click(box['x']+target['x'],box['y']+target['y'])
  assert snap()['selected']==front['index'],dict(selected=snap()['selected'],expected=front['index'],scroll=page.locator('#modal').evaluate('(e)=>e.scrollTop'),box=page.locator('canvas').bounding_box(),target=target);count+=1;assert page.evaluate('chosen.length')==count
  page.evaluate("document.querySelector('#host').style.height='380px'");page.wait_for_timeout(100)
  assert page.locator('canvas').evaluate('(c)=>c.height')==760
  page.emulate_media(reduced_motion='reduce');page.evaluate('scene.reset()');page.wait_for_function('!scene.snapshot().running')
  page.mouse.move(cx,cy);page.mouse.down();page.mouse.move(cx+45,cy+20,steps=3);page.mouse.up();page.wait_for_timeout(50)
  still=snap()['camera'];page.wait_for_timeout(100);assert snap()['camera']==still;assert not snap()['running']
  # Real display:none exercises visibility observer, including a camera update while hidden.
  page.evaluate("document.querySelector('#host').style.display='none';scene.rotate(20,10)");page.wait_for_timeout(100);assert not snap()['running']
  page.evaluate("document.querySelector('#host').style.display='block'");page.wait_for_timeout(120);assert not snap()['running']
  # Document visibility event path uses a controlled browser visibility getter.
  page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));scene.rotate(4,2)")
  assert not snap()['running']
  page.evaluate("delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))");page.wait_for_timeout(100)
  page.evaluate('scene.reset()');page.wait_for_function('!scene.snapshot().running')
  page.screenshot(path=str(OUT/f'scene-{width}.png'))
  # Track actual draw calls; no callback may draw after destruction or public no-op calls.
  touch('touchStart',[(1,cx,cy)])
  page.evaluate("window.draws=0;const ctx=document.querySelector('canvas').getContext('2d');const fn=ctx.clearRect;ctx.clearRect=function(...a){draws++;return fn.apply(this,a)};scene.rotate(12,3);scene.destroy();window.atDestroy=draws;scene.rotate(20,10);scene.zoomBy(2);scene.select(0);scene.reset()")
  touch('touchMove',[(1,cx+20,cy)]);touch('touchEnd',[])
  dead=snap();assert dead['destroyed'] and not dead['running'];assert page.locator('canvas').count()==0
  page.evaluate("document.querySelector('#host').style.height='200px';document.dispatchEvent(new Event('visibilitychange'))")
  page.wait_for_timeout(150);assert page.evaluate('draws===atDestroy');assert snap()==dead;assert page.evaluate('chosen.length')==count
  assert errors==[],errors
  # Canvas unavailable must return fallback without leaving a canvas behind.
  page.evaluate("HTMLCanvasElement.prototype.getContext=()=>null;window.fallback=KGKnowledgeSpaceScene.mount({host:document.querySelector('#host'),nodes:[]})")
  assert page.evaluate('fallback===null');assert page.locator('canvas').count()==0
  context.close()
 browser.close()
 (OUT/'performance.json').write_text(json.dumps(metrics,ensure_ascii=False,indent=2))
 print(json.dumps(metrics,ensure_ascii=False))
print('knowledge-space-scene-browser: 1440/390 full 320/1000 rendering, continuous brightness, initial/reset fit, manual camera preservation, held-pointer RAF stop, native wheel/vertical touch scroll, modified wheel/pinch zoom, horizontal touch/mouse rotation, selection, grouping, resize, reduced motion, visibility, active-touch destroy and Canvas fallback passed')
