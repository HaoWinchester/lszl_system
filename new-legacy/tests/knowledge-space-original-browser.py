"""Original visual direction: real published tree, real Canvas draws and selection."""
from pathlib import Path
import json
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/knowledge-space-full-tree-20261023';OUT.mkdir(parents=True,exist_ok=True)
NODES=json.loads((ROOT/'new-legacy/tests/fixtures/knowledge-space-published-catalog.json').read_text())['nodes']
parents={n.get('parentId') for n in NODES}
for category,count in [('人',1),('过程',5),('环境',20)]:
 next(n for n in NODES if len(n['path'])>2 and n['path'][1]==category and n['id'] not in parents)['attemptCount']=count
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,channel='chrome')
 for width,height in [(1440,960),(390,844),(1280,720),(559,854),(390,568)]:
  page=browser.new_page(viewport={'width':width,'height':height},reduced_motion='reduce')
  page.set_content('<button id="open" data-knowledge-dashboard-open>知识星空</button>')
  page.add_style_tag(path=str(ROOT/'new-legacy/styles/knowledge-dashboard.css'))
  page.add_script_tag(path=str(ROOT/'new-legacy/src/practice/knowledge-space-scene.js'))
  page.evaluate('''nodes=>{const api=KGKnowledgeSpaceScene;KGKnowledgeSpaceScene={...api,mount:o=>{window.sceneNodes=o.nodes;return window.scene=api.mount(o)}};KGAuthCore={currentUser:()=>({username:'test'})};KGDomainApi={request:async()=>({nodes,attemptCount:26})};window.drawColors=[];window.pointRadii=[];window.businessPointFills=[];window.decorRects=0;const clear=CanvasRenderingContext2D.prototype.clearRect;CanvasRenderingContext2D.prototype.clearRect=function(){businessPointFills=[];decorRects=0;return clear.apply(this,arguments)};const rect=CanvasRenderingContext2D.prototype.fillRect;CanvasRenderingContext2D.prototype.fillRect=function(x,y,w,h){if(w<=2&&h<=2)decorRects++;return rect.apply(this,arguments)};const arc=CanvasRenderingContext2D.prototype.arc;CanvasRenderingContext2D.prototype.arc=function(x,y,r){this.lastRadius=r;return arc.apply(this,arguments)};const fill=CanvasRenderingContext2D.prototype.fill;CanvasRenderingContext2D.prototype.fill=function(){drawColors.push(this.fillStyle);if(typeof this.fillStyle==='string'&&['rgba(98, 108, 120','rgba(139, 220, 255','rgba(255, 213, 139','rgba(128, 240, 184'].some(prefix=>this.fillStyle.startsWith(prefix)))businessPointFills.push(this.lastRadius);if(typeof this.fillStyle==='string'&&this.fillStyle.startsWith('rgba(98, 108, 120'))pointRadii.push(this.lastRadius);return fill.apply(this,arguments)}}''',NODES)
  page.add_script_tag(path=str(ROOT/'new-legacy/src/practice/knowledge-dashboard.js'))
  page.click('#open');page.wait_for_function('scene.snapshot().settled')
  assert page.locator('[data-knowledge-focus-title]').is_visible(), 'selected information must inhabit the canvas foreground'
  assert page.locator('[data-knowledge-focus-title]').inner_text()==page.locator('[data-knowledge-detail-title]').inner_text()
  state=page.evaluate('scene.snapshot()');assert len(state['positions'])==316
  page.wait_for_function('businessPointFills.length===316')
  assert page.evaluate('decorRects')==530, 'original 350 background stars and 180 dust must actually paint'
  assert page.evaluate('''()=>scene.snapshot().positions.slice().sort((a,b)=>b.depth-a.depth).every((p,i)=>Math.abs(businessPointFills[i]-Math.max(2.6,5.1*p.scale)*(p.index===scene.snapshot().selected?1.34:1))<.001)'''), 'every real node must use the original depth radius and selected multiplier'
  groups={json.loads(c['key'])[2]:c for c in state['clusters']};assert sorted(c['count'] for c in groups.values())==[19,62,235]
  assert groups['人']['x']<groups['过程']['x']<groups['环境']['x'];assert groups['过程']['y']<min(groups['人']['y'],groups['环境']['y'])
  assert max(p['depth'] for p in state['positions'])-min(p['depth'] for p in state['positions'])>150
  assert page.evaluate("drawColors.some(c=>typeof c==='string'&&c.startsWith('rgba(98, 108, 120'))"), 'unpracticed points use original neutral depth color'
  assert page.evaluate("['rgba(139, 220, 255','rgba(255, 213, 139','rgba(128, 240, 184'].every(prefix=>drawColors.some(c=>typeof c==='string'&&c.startsWith(prefix)))"), 'practice glow must respect all three original category colors'
  if width>960:assert page.evaluate('Math.max(...pointRadii)/Math.min(...pointRadii)>1.5'), 'desktop depth must visibly change the original dot radius'
  assert page.evaluate('Math.min(...pointRadii)>=2.6'), 'original minimum radius must keep distant/phone points visible'
  page.screenshot(path=str(OUT/f'task9-source-lit-{width}x{height}.png'))
  if height<600:
   ys=[p['y'] for p in state['positions']];assert max(ys)-min(ys)>230, 'short phone must retain a usable vertically scrollable plot'
   page.locator('[data-knowledge-reset]').scroll_into_view_if_needed()
   assert page.locator('[data-knowledge-reset]').evaluate('(e)=>{const r=e.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e}'), 'short phone dock must be reachable by native scroll'
   page.screenshot(path=str(OUT/f'task9-source-lit-{width}x{height}-dock.png'))
   page.locator('.kg-knowledge-shell').evaluate('e=>e.scrollTop=0')
  if width==1440:
   original=page.evaluate('''()=>{const style=s=>getComputedStyle(document.querySelector(s));return {padding:style('.ui').padding,columns:style('.ui').gridTemplateColumns,title:style('#kgKnowledgeTitle').fontSize,headlineLines:document.querySelector('#kgKnowledgeTitle').querySelectorAll('br').length,index:style('.big-index').fontSize,indexWeight:style('.big-index').fontWeight,topic:style('.topic').fontSize,module:style('.module-btn').padding,layers:['vignette','scanlines','noise'].every(c=>!!document.querySelector('.'+c)),origin:KGKnowledgeSpaceScene.projectPoint({x:0,y:0,z:0},{yaw:0,pitch:0,zoom:1},1440,960)}}''')
   assert original['padding']=='24px 28px 22px' and original['columns'].startswith('504px ')
   assert original['title']=='56.16px' and original['headlineLines']==1
   assert original['index']=='120.96px' and original['indexWeight']=='180' and original['topic']=='32.4px'
   assert original['module']=='9px 10px' and original['layers']
   assert original['origin']=={'x':993.5999999999999,'y':480,'scale':1.12,'depth':900}
   assert page.locator('.brand').bounding_box()['x']==28
   assert page.locator('.hud .progress-card').is_visible() and page.locator('.hud .level-card').is_visible()
   assert page.locator('[data-knowledge-attempt-total]').inner_text()=='26'
   page.evaluate('scene.zoomBy(1.5)')
   hit=page.evaluate('''()=>{const ps=scene.snapshot().positions.filter(p=>p.visible);const p=ps.find(p=>p.x>650&&p.x<1200&&p.y>260&&p.y<700);return {...p,index:ps.filter(q=>Math.hypot(q.x-p.x,q.y-p.y)<=Math.max(12,7*q.scale)).sort((a,b)=>a.depth-b.depth)[0].index}}''')
   box=page.locator('canvas').bounding_box();page.mouse.click(box['x']+hit['x'],box['y']+hit['y']);assert page.evaluate('scene.snapshot().selected')==hit['index']
   assert not page.locator('.kg-knowledge-detail').evaluate('e=>e.open')
   assert page.locator('[data-knowledge-focus-title]').inner_text()==page.evaluate('(i)=>sceneNodes[i].title',hit['index'])
   page.click('[data-knowledge-details-open]');assert page.locator('[data-knowledge-detail-title]').inner_text()==page.locator('[data-knowledge-focus-title]').inner_text()
  page.evaluate("()=>{const i=sceneNodes.reduce((best,n,i)=>n.title.length>sceneNodes[best].title.length?i:best,0);document.querySelector('[data-knowledge-node=\"'+i+'\"]').click()}")
  focus=page.locator('.kg-knowledge-focus').bounding_box();dock=page.locator('.kg-knowledge-footer').bounding_box()
  assert focus['y']+focus['height']<dock['y'], 'longest actual title must not collide with lower controls'
  assert page.locator('[data-knowledge-focus-title]').inner_text()==max((n['title'] for n in NODES),key=len)
  assert page.locator('[data-knowledge-focus-subject]').evaluate('e=>getComputedStyle(e).color')=='rgb(139, 220, 255)', 'selected Process kicker must reuse its category color'
  page.close()
 browser.close()
print('PASS original visual foreground, neutral point rendering, 316 genuine nodes, depth, anchors and selection at five viewports')
