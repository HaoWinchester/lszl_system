"""Source modules, real canvas and controls at desktop/mobile sizes."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/learning-feedback-three-groups/task-3'
OUT.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,channel='chrome')
 for width in (1440,559,390):
  page=browser.new_page(viewport={'width':width,'height':854 if width==559 else 900},reduced_motion='reduce')
  errors=[];page.on('pageerror',lambda e: errors.append(str(e)))
  page.set_content('<button id="open" data-knowledge-dashboard-open>知识星空</button>')
  page.add_style_tag(path=str(ROOT/'new-legacy/styles/knowledge-dashboard.css'))
  page.evaluate('''()=>{window.drawnLabels=[];const text=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(value,...args){drawnLabels.push(String(value));return text.call(this,value,...args)};window.starArcs=0;const clear=CanvasRenderingContext2D.prototype.clearRect;CanvasRenderingContext2D.prototype.clearRect=function(...args){starArcs=0;return clear.apply(this,args)};const arc=CanvasRenderingContext2D.prototype.arc;CanvasRenderingContext2D.prototype.arc=function(...args){starArcs++;return arc.apply(this,args)}}''')
  page.add_script_tag(path=str(ROOT/'new-legacy/src/practice/knowledge-space-scene.js'))
  page.evaluate('''()=>{const real=KGKnowledgeSpaceScene;window.scenes=[];window.KGKnowledgeSpaceScene={...real,mount:o=>{window.overlay=o.nodes;const s=real.mount(o);scenes.push(s);return s}};window.owner='a';window.calls=0;window.fail=false;KGAuthCore={currentUser:()=>owner?{username:owner}:null};KGDomainApi={request:async()=>{calls++;if(fail)throw Error('offline');return {topicCount:81,attemptCount:9,recentAttemptCount:2,nodes:Array.from({length:81},(_,i)=>({id:String(i),title:'考点'+i,subject:i<12?'数学':'英语',taxonomyId:i<12?'a':'b',path:i<12?['代数','方程','考点'+i]:['阅读','理解','考点'+i],brightness:.6}))}}}}''')
  page.add_script_tag(path=str(ROOT/'new-legacy/src/practice/knowledge-dashboard.js'))
  page.locator('#open').click();page.wait_for_function('scenes.at(-1).snapshot().settled')
  assert page.evaluate('scenes.at(-1).snapshot().mode')=='clusters'
  assert page.evaluate('starArcs')>81, 'overview must draw real catalog stars beneath clusters'
  assert page.evaluate('overlay.length===81 && overlay.every(n=>n.brightness===.12 && n.relatedAttemptCount===0)')
  box=page.locator('canvas').bounding_box();shell=page.locator('.kg-knowledge-body').bounding_box()
  dialog_box=page.locator('#kgKnowledgeDashboard').bounding_box()
  assert box['y']<=dialog_box['y']+2, 'scene should reach dialog top without a reserved close band'
  header=page.locator('.kg-knowledge-header').bounding_box()
  assert box['y']<=header['y'] and box['y']+box['height']>=header['y']+header['height'], 'scene must extend behind foreground header and summary'
  assert page.locator('h2').evaluate('(e)=>{const r=e.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2).tagName==="CANVAS"}'), 'noninteractive heading must let canvas gestures through'
  close_box=page.locator('[data-knowledge-close]').bounding_box();refresh_box=page.locator('[data-knowledge-refresh]').bounding_box()
  assert refresh_box['x']+refresh_box['width']<=close_box['x'] or refresh_box['y']>=close_box['y']+close_box['height'], 'refresh must not overlap floating close'
  assert close_box['width']>=44 and close_box['height']>=44
  assert page.locator('[data-knowledge-close]').evaluate('(e)=>{const r=e.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e}')
  assert page.locator('[data-knowledge-refresh]').evaluate('(e)=>{const r=e.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e}'), 'foreground refresh must physically receive clicks'
  assert box['width']>=shell['width']*.95
  assert box['height']>= (430 if width>600 else 340)
  assert not page.locator('.kg-knowledge-detail').evaluate('(e)=>e.open')
  cluster=page.evaluate('scenes.at(-1).snapshot().clusters[0]')
  page.mouse.click(box['x']+cluster['x'],box['y']+cluster['y'])
  assert page.evaluate('scenes.at(-1).snapshot().mode')=='points'
  assert page.evaluate('scenes.at(-1).snapshot().group')==cluster['key']
  for _ in range(8):page.locator('[data-knowledge-zoom-out]').click()
  assert page.evaluate('scenes.at(-1).snapshot().mode')=='clusters'
  page.locator('[data-knowledge-zoom-in]').click();page.locator('[data-knowledge-reset]').click()
  assert page.evaluate('scenes.at(-1).snapshot().mode')=='clusters'
  page.locator('[data-knowledge-details-open]').click()
  child=page.locator('.kg-knowledge-detail');expect(child).to_be_visible()
  assert child.bounding_box()['width']>=min(width-50,1000)
  page.keyboard.press('Tab');assert page.evaluate('document.activeElement.closest(".kg-knowledge-detail")!==null')
  page.locator('[data-knowledge-node="2"]').click();expect(page.locator('[data-knowledge-detail-title]')).to_have_text('考点2')
  page.locator('[data-knowledge-node-next]').click();expect(page.locator('[data-knowledge-detail-title]')).to_have_text('考点3')
  page.locator('[data-knowledge-details-close]').click()
  expect(page.locator('[data-knowledge-details-open]')).to_be_focused()
  page.locator('[data-knowledge-labels]').click();expect(page.locator('[data-knowledge-labels]')).to_have_attribute('aria-pressed','true')
  page.wait_for_function('scenes.at(-1).snapshot().labels.length>0')
  assert page.evaluate('drawnLabels.some(t=>t.includes("考点"))'), 'labels must reach real Canvas fillText'
  labels=page.evaluate('scenes.at(-1).snapshot().labels')
  assert len({i for label in labels for i in label['indices']})==sum(len(label['indices']) for label in labels)
  dock=page.locator('.kg-knowledge-camera').bounding_box()
  assert dock['y']+dock['height']>dialog_box['y']+dialog_box['height']-170
  assert page.locator('[data-knowledge-labels]').evaluate('(e)=>{const r=e.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e}')
  page.locator('[data-knowledge-labels]').click();expect(page.locator('[data-knowledge-labels]')).to_have_attribute('aria-pressed','false')
  assert page.evaluate('scenes.at(-1).snapshot().labels.length===0')
  for _ in range(12):page.locator('[data-knowledge-zoom-out]').click()
  assert page.evaluate('scenes.at(-1).snapshot().textHidden')
  page.locator('[data-knowledge-reset]').click()

  page.locator('[data-knowledge-details-open]').click();page.keyboard.press('Escape');expect(child).not_to_be_visible();expect(page.locator('#kgKnowledgeDashboard')).to_be_visible()
  page.locator('[data-knowledge-refresh]').click();page.wait_for_function('scenes.at(-1).snapshot().settled')
  expect(page.locator('[data-knowledge-summary]')).to_contain_text('9 次')
  expect(page.locator('[data-knowledge-list] button')).to_have_count(81)
  page.evaluate('fail=true');page.locator('[data-knowledge-refresh]').click();expect(page.locator('[data-knowledge-retry]')).to_be_visible()
  page.evaluate('fail=false');page.locator('[data-knowledge-retry]').click();expect(page.locator('canvas')).to_have_count(1)
  page.evaluate("owner='';dispatchEvent(new Event('kg-auth-session-change'))");expect(page.locator('canvas')).to_have_count(0)
  expect(page.locator('[data-knowledge-status]')).to_contain_text('登录后')
  page.evaluate("owner='a'");page.locator('[data-knowledge-close]').click();expect(page.locator('#open')).to_be_focused()
  page.locator('#open').click();expect(page.locator('canvas')).to_have_count(1)
  page.locator('[data-knowledge-close]').focus();page.keyboard.press('Escape');expect(page.locator('#open')).to_be_focused()
  assert not errors,errors
  page.locator('#open').click();page.wait_for_function('scenes.at(-1).snapshot().settled');page.screenshot(path=str(OUT/f'space-{width}.png'))
  page.evaluate('''()=>{KGDomainApi.request=async()=>({attemptCount:0,nodes:[{id:'r',parentId:null,subject:'PMP',taxonomyId:1,path:['PMP']},{id:'people',parentId:'r',subject:'PMP',taxonomyId:1,path:['PMP','人']},{id:'child',parentId:'people',subject:'PMP',taxonomyId:1,path:['PMP','人','团队']},{id:'process',parentId:'r',subject:'PMP',taxonomyId:1,path:['PMP','过程']}]})}''')
  page.locator('[data-knowledge-refresh]').click()
  expect(page.locator('[data-knowledge-groups]')).to_contain_text('PMP · 科目总览 / 1')
  expect(page.locator('[data-knowledge-groups]')).to_contain_text('PMP · 人 / 2')
  expect(page.locator('[data-knowledge-groups]')).to_contain_text('PMP · 过程 / 1')
  expect(page.locator('[data-knowledge-groups]')).not_to_contain_text('未分类')
  if width in (559,390):
   page.evaluate('''()=>{KGDomainApi.request=async()=>({attemptCount:51,unknownAttemptCount:23,unmappedAttemptCount:28,nodes:Array.from({length:317},(_,i)=>({id:String(i),parentId:null,title:'当前目录'+i,attemptCount:0}))})}''')
   page.locator('[data-knowledge-refresh]').click();page.wait_for_function('scenes.at(-1).snapshot().settled && !scenes.at(-1).snapshot().running')
   summary=page.locator('[data-knowledge-summary]');summary.scroll_into_view_if_needed()
   assert summary.evaluate('e=>e.scrollWidth>e.clientWidth'), 'long summary must remain scrollable'
   rect=summary.bounding_box();page.mouse.move(rect['x']+rect['width']/2,rect['y']+rect['height']/2);page.mouse.wheel(600,0);page.wait_for_timeout(150)
   assert summary.evaluate('e=>e.scrollLeft')>0
   page.locator('[data-knowledge-labels]').click();page.wait_for_function('scenes.at(-1).snapshot().labels.length>0')
   page.screenshot(path=str(OUT/f'labels-317-{width}.png'))
  page.evaluate('''()=>{KGDomainApi.request=async()=>({attemptCount:0,nodes:[{id:'a',parentId:null,title:'Node A',subject:'Test'},{id:'b',parentId:null,title:'Node B',subject:'Test'}]})}''')
  page.locator('[data-knowledge-refresh]').click();page.wait_for_function('scenes.at(-1).snapshot().settled && !scenes.at(-1).snapshot().running')
  if not page.evaluate('scenes.at(-1).snapshot().labelsVisible'):page.locator('[data-knowledge-labels]').click()
  page.wait_for_function('!scenes.at(-1).snapshot().running')
  page.evaluate('drawnLabels=[]');page.locator('[data-knowledge-labels]').click();page.wait_for_function('!scenes.at(-1).snapshot().running')
  assert page.evaluate('!drawnLabels.some(t=>t.includes("Node A")||t.includes("Node B"))'), page.evaluate('drawnLabels')
  print(f'{width}: semantic zoom, cluster click, full canvas, drawer/list, refresh/retry, full catalog, auth invalidation, close/reopen passed')
  page.close()
 browser.close()
