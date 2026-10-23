"""Published source composition and opt-in motion lifecycle, real Chromium."""
from pathlib import Path
import json
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/knowledge-universe-20261023/task-6';OUT.mkdir(parents=True,exist_ok=True)
NODES=json.loads((ROOT/'new-legacy/tests/fixtures/knowledge-space-published-catalog.json').read_text())['nodes']
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,channel='chrome')
 for width,height in [(1440,900),(1280,800),(559,854),(390,844),(390,600)]:
  page=browser.new_page(viewport={'width':width,'height':height})
  page.set_content('<button id="open" data-knowledge-dashboard-open>知识星空</button>')
  page.add_style_tag(path=str(ROOT/'new-legacy/styles/knowledge-dashboard.css'))
  page.add_script_tag(path=str(ROOT/'new-legacy/src/practice/knowledge-space-scene.js'))
  page.evaluate('''nodes=>{const api=KGKnowledgeSpaceScene;KGKnowledgeSpaceScene={...api,mount:o=>{window.sceneNodes=o.nodes;return window.scene=api.mount(o)}};KGAuthCore={currentUser:()=>({username:'test'})};KGDomainApi={request:async()=>({nodes,attemptCount:0})}}''',NODES)
  page.add_script_tag(path=str(ROOT/'new-legacy/src/practice/knowledge-dashboard.js'))
  page.click('#open');page.wait_for_function('scene.snapshot().settled');page.wait_for_timeout(3200)
  state=page.evaluate('scene.snapshot()');assert len(state['positions'])==316;assert len(state['clusters'])==3
  by_name={json.loads(c['key'])[2]:c for c in state['clusters']}
  assert by_name['人']['x']<by_name['过程']['x']<by_name['环境']['x']
  assert by_name['过程']['y']<by_name['人']['y'] and by_name['过程']['y']<by_name['环境']['y']
  page.screenshot(path=str(OUT/f'source316-{width}-{height}.png'))
  before=state['phase'];page.wait_for_timeout(500);after=page.evaluate('scene.snapshot()');assert .003<after['phase']-before<.009
  assert [(c['x'],c['y']) for c in state['clusters']]==[(c['x'],c['y']) for c in after['clusters']]
  # Select a real rotating point through the same projected picking coordinates.
  page.evaluate("scene.focusGroup(scene.snapshot().clusters[0].key)");page.wait_for_timeout(3150)
  hit=page.evaluate('''()=>{const points=scene.snapshot().positions.filter(p=>p.visible),p=points.find(p=>p.x>30&&p.y>240&&p.x<innerWidth-30&&p.y<innerHeight-240)||points[0];const expected=points.filter(q=>Math.hypot(q.x-p.x,q.y-p.y)<=Math.max(12,7*q.scale)).sort((a,b)=>a.depth-b.depth)[0];return {x:p.x,y:p.y,index:expected.index}}''')
  canvas=page.locator('canvas').bounding_box();page.mouse.click(canvas['x']+hit['x'],canvas['y']+hit['y'])
  assert page.evaluate('scene.snapshot().selected')==hit['index']
  assert not page.locator('.kg-knowledge-detail').evaluate('e=>e.open'), 'star selection must not open the catalog'
  selected=page.evaluate('scene.snapshot()')
  assert selected['resumePending'] and not selected['rotationPaused'], 'star picking only temporarily suspends rotation'
  before=selected['phase'];page.wait_for_timeout(150);assert page.evaluate('scene.snapshot().phase')==before
  page.click('[data-knowledge-details-open]')
  assert page.locator('.kg-knowledge-detail').evaluate('e=>e.open')
  assert page.locator('[data-knowledge-detail-title]').inner_text()==page.evaluate('(index)=>sceneNodes[index].title',hit['index'])
  assert page.evaluate('scene.snapshot().rotationPaused')
  before=page.evaluate('scene.snapshot().phase');page.wait_for_timeout(150);assert page.evaluate('scene.snapshot().phase')==before
  page.click('[data-knowledge-details-close]');page.wait_for_timeout(3150)
  assert page.evaluate('scene.snapshot().phase')>before
  page.evaluate('scene.reset()');page.wait_for_timeout(3150)
  page.click('[data-knowledge-auto-rotate]');page.wait_for_timeout(100);state=page.evaluate('scene.snapshot()');assert not state['autoRotate'] and not state['running'] and not state['resumePending']
  page.click('[data-knowledge-auto-rotate]');page.click('[data-knowledge-details-open]');before=page.evaluate('scene.snapshot().phase');page.wait_for_timeout(150);assert page.evaluate('scene.snapshot().phase')==before
  page.click('[data-knowledge-details-close]');page.wait_for_timeout(150);assert page.evaluate('scene.snapshot().phase')>before
  page.locator('.kg-knowledge-shell').evaluate('e=>e.scrollTop=0');page.wait_for_timeout(50)
  box=page.locator('canvas').bounding_box();page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2);page.mouse.down();page.wait_for_timeout(100)
  state=page.evaluate('scene.snapshot()');assert not state['running'] and not state['resumePending'];page.mouse.up();assert page.evaluate('scene.snapshot().resumePending')
  page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))")
  assert page.evaluate('!scene.snapshot().running&&!scene.snapshot().resumePending')
  before=page.evaluate('scene.snapshot().phase');page.wait_for_timeout(150)
  page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'))")
  assert page.evaluate('scene.snapshot().phase')==before
  page.evaluate('scene.reset()');assert page.evaluate('scene.snapshot().phase')==0
  page.emulate_media(reduced_motion='reduce');page.wait_for_timeout(100);assert not page.evaluate('scene.snapshot().autoRotate');assert page.locator('[data-knowledge-auto-rotate]').inner_text()=='开始旋转'
  page.click('[data-knowledge-auto-rotate]');assert page.evaluate('scene.snapshot().autoRotate')
  page.evaluate('scene.destroy()');assert page.evaluate('!scene.snapshot().running&&!scene.snapshot().resumePending')
  page.close();print(f'composition and motion {width}x{height}: PASS',flush=True)
 browser.close()
