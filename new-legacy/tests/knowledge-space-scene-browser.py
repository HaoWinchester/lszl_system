"""Standalone scene: real Chromium mouse, touch, resizing and lifecycle checks."""
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[2]
MODULE=ROOT/'new-legacy/src/practice/knowledge-space-scene.js'
OUT=ROOT/'.superpowers/sdd/2026-10-20-learning-entry-3d-knowledge-space/artifacts/task-2'
OUT.mkdir(parents=True,exist_ok=True)
assert MODULE.exists(), 'knowledge-space-scene.js must exist before browser interactions can run'
NODES=[dict(id=f'topic-{i}',title=f'真实接口形状测试考点 {i}',subject='数学' if i<12 else '英语',taxonomyId='algebra' if i<12 else 'reading',brightness=.2+i/30) for i in range(24)]
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 for width in (1440,390):
  context=browser.new_context(viewport={'width':width,'height':900},has_touch=True,device_scale_factor=3)
  page=context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
  page.set_content('''<style>body{margin:0;background:#050914;color:#eef;font:14px sans-serif}#host{margin:40px 16px;width:calc(100% - 32px);height:560px;overflow:hidden;border:1px solid #234}</style><div id="host"></div><div style="height:1200px">场景外滚动区域</div>''')
  page.wait_for_load_state('networkidle');page.add_script_tag(content=MODULE.read_text())
  page.evaluate('''nodes=>{window.chosen=[];window.scene=KGKnowledgeSpaceScene.mount({host:document.querySelector('#host'),nodes,onSelect:(node,index)=>chosen.push({id:node.id,index})})}''',NODES)
  page.evaluate("document.querySelector('#host').style.visibility='hidden'")
  page.wait_for_timeout(120);assert not page.evaluate('scene.snapshot().running')
  page.evaluate("document.querySelector('#host').style.visibility='visible'")
  page.wait_for_function('scene.snapshot().settled && !scene.snapshot().running',timeout=4000)
  snap=lambda:page.evaluate('scene.snapshot()')
  initial=snap();assert len(initial['positions'])==24;assert initial['selected'] is None
  assert page.locator('canvas').evaluate('(c)=>c.width')<=2*(width-30)
  box=page.locator('#host').bounding_box();cx=box['x']+box['width']/2;cy=box['y']+box['height']/2
  page.mouse.move(cx,cy);page.mouse.down();page.mouse.move(cx+80,cy+35,steps=8);page.mouse.up()
  assert snap()['camera']['yaw']!=initial['camera']['yaw'];assert page.evaluate('chosen')==[], 'drag cannot select'
  page.wait_for_function('!scene.snapshot().running')
  before=snap()['camera']['zoom'];page.mouse.move(cx,cy);page.mouse.wheel(0,-150);page.wait_for_timeout(60)
  assert snap()['camera']['zoom']>before;assert page.evaluate('scrollY')==0
  page.mouse.move(5,650);page.mouse.wheel(0,100);page.wait_for_timeout(100);assert page.evaluate('scrollY')>0
  page.evaluate('scrollTo(0,0);scene.reset()');page.wait_for_function('!scene.snapshot().running')
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
  touch('touchStart',[(1,cx-30,cy)]);touch('touchMove',[(1,cx+30,cy+25)]);touch('touchEnd',[])
  assert snap()['camera']['yaw']!=before['yaw'];assert page.evaluate('chosen.length')==count
  page.evaluate('scene.reset()');before=snap()['camera']['zoom']
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
  assert snap()['selected']==front['index'];count+=1;assert page.evaluate('chosen.length')==count
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
  page.evaluate("window.draws=0;const ctx=document.querySelector('canvas').getContext('2d');const fn=ctx.clearRect;ctx.clearRect=function(...a){draws++;return fn.apply(this,a)};scene.rotate(12,3);scene.destroy();window.atDestroy=draws;scene.rotate(20,10);scene.zoomBy(2);scene.select(0);scene.reset()")
  dead=snap();assert dead['destroyed'] and not dead['running'];assert page.locator('canvas').count()==0
  page.evaluate("document.querySelector('#host').style.height='200px';document.dispatchEvent(new Event('visibilitychange'))")
  page.wait_for_timeout(150);assert page.evaluate('draws===atDestroy');assert snap()==dead;assert page.evaluate('chosen.length')==count
  assert errors==[],errors
  # Canvas unavailable must return fallback without leaving a canvas behind.
  page.evaluate("HTMLCanvasElement.prototype.getContext=()=>null;window.fallback=KGKnowledgeSpaceScene.mount({host:document.querySelector('#host'),nodes:[]})")
  assert page.evaluate('fallback===null');assert page.locator('canvas').count()==0
  context.close()
 browser.close()
print('knowledge-space-scene-browser: 1440/390 mouse, wheel, touch rotation/pinch/cancel, selection, grouping, reset, resize, reduced motion, visibility, destroy and Canvas fallback passed')
