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
  page.evaluate('''nodes=>{const api=KGKnowledgeSpaceScene;KGKnowledgeSpaceScene={...api,mount:o=>{window.sceneNodes=o.nodes;return window.scene=api.mount(o)}};KGAuthCore={currentUser:()=>({username:'test'})};KGDomainApi={request:async()=>({nodes,attemptCount:26})};window.drawColors=[];window.pointRadii=[];const arc=CanvasRenderingContext2D.prototype.arc;CanvasRenderingContext2D.prototype.arc=function(x,y,r){this.lastRadius=r;return arc.apply(this,arguments)};const fill=CanvasRenderingContext2D.prototype.fill;CanvasRenderingContext2D.prototype.fill=function(){drawColors.push(this.fillStyle);if(typeof this.fillStyle==='string'&&this.fillStyle.startsWith('rgba(98, 108, 120'))pointRadii.push(this.lastRadius);return fill.apply(this,arguments)}}''',NODES)
  page.add_script_tag(path=str(ROOT/'new-legacy/src/practice/knowledge-dashboard.js'))
  page.click('#open');page.wait_for_function('scene.snapshot().settled')
  assert page.locator('[data-knowledge-focus-title]').is_visible(), 'selected information must inhabit the canvas foreground'
  assert page.locator('[data-knowledge-focus-title]').inner_text()==page.locator('[data-knowledge-detail-title]').inner_text()
  state=page.evaluate('scene.snapshot()');assert len(state['positions'])==316
  groups={json.loads(c['key'])[2]:c for c in state['clusters']};assert sorted(c['count'] for c in groups.values())==[19,62,235]
  assert groups['人']['x']<groups['过程']['x']<groups['环境']['x'];assert groups['过程']['y']<min(groups['人']['y'],groups['环境']['y'])
  assert max(p['depth'] for p in state['positions'])-min(p['depth'] for p in state['positions'])>150
  assert page.evaluate("drawColors.some(c=>typeof c==='string'&&c.startsWith('rgba(98, 108, 120'))"), 'unpracticed points use original neutral depth color'
  assert page.evaluate("['rgba(139, 220, 255','rgba(255, 213, 139','rgba(128, 240, 184'].every(prefix=>drawColors.some(c=>typeof c==='string'&&c.startsWith(prefix)))"), 'practice glow must respect all three original category colors'
  assert page.evaluate('Math.max(...pointRadii)/Math.min(...pointRadii)>1.5'), 'foreground and background dots must visibly differ in size'
  page.screenshot(path=str(OUT/f'task8-source-lit-{width}x{height}.png'))
  if height<600:
   ys=[p['y'] for p in state['positions']];assert max(ys)-min(ys)>230, 'short phone must retain a usable vertically scrollable plot'
   page.locator('[data-knowledge-reset]').scroll_into_view_if_needed()
   assert page.locator('[data-knowledge-reset]').evaluate('(e)=>{const r=e.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e}'), 'short phone dock must be reachable by native scroll'
   page.screenshot(path=str(OUT/f'task8-source-lit-{width}x{height}-dock.png'))
   page.locator('.kg-knowledge-shell').evaluate('e=>e.scrollTop=0')
  if width==1440:
   assert page.locator('#kgKnowledgeTitle').evaluate('e=>parseFloat(getComputedStyle(e).fontSize)')>=40
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
