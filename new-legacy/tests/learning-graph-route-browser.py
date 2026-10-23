"""Approved fixed-port/trunk and trigger placement contract against disposable real API/DB."""
import argparse, uuid
from playwright.sync_api import sync_playwright, expect
parser=argparse.ArgumentParser();parser.add_argument('--base-url',required=True);base=parser.parse_args().base_url
with sync_playwright() as pw:
 browser=pw.chromium.launch(channel='chrome');ctx=browser.new_context(viewport={'width':1440,'height':1000})
 assert ctx.request.post(base+'/api/v1/auth/login',data={'username':'ink-browser','password':'ink-browser-test'}).ok
 graph={'nodes':[{'id':'a','title':'起点','geometry':{'x':300,'y':180,'width':180,'height':100}},{'id':'b','title':'终点','geometry':{'x':750,'y':580,'width':180,'height':100}}], 'links':[{'id':'one','from':'a','to':'b','fromPort':'bottom','toPort':'top','pathStyle':'elbow','arrowStyle':'both','waypoints':[{'x':390,'y':430},{'x':840,'y':430}]},{'id':'two','from':'a','to':'b','fromPort':'bottom','toPort':'top','pathStyle':'elbow','arrowStyle':'end','waypoints':[{'x':390,'y':442},{'x':840,'y':442}]}],'viewport':{'x':0,'y':0,'scale':1}}
 r=ctx.request.post(base+'/api/v1/files',data={'name':'route-contract-'+uuid.uuid4().hex[:8],'graphData':graph});assert r.ok;fid=r.json()['file']['id'];assert ctx.request.put(base+'/api/v1/files/current',data={'fileId':fid}).ok
 page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 def ready():
  page.wait_for_function('!!window.KGGraphFileTabs&&!KGGraphFileTabs.isSwitching()')
  for s in ['#learningEntryDismissBtn','.tour-skip','#hideHelpBtn']:
   if page.locator(s).is_visible():page.locator(s).click()
 def verify():
  result=page.evaluate('''()=>state.links.map(l=>{const g=edgeDomById.get(l.id).geometry,s=g.samples;return {id:l.id,ports:[l.fromPort,l.toPort],arrows:l.arrowStyle,samples:s,orthogonal:s.every((p,i)=>!i||s[i-1].x===p.x||s[i-1].y===p.y)}})''')
  assert len(result)==2,result
  for item in result:
   s=item['samples'];assert item['orthogonal'] and item['ports']==['bottom','top'],item
   assert s[0]['x']==s[1]['x'] and s[1]['y']>s[0]['y'],item
   assert s[-1]['x']==s[-2]['x'] and s[-2]['y']<s[-1]['y'],item
  first,second=[item['samples'] for item in result]
  assert any(a['y']==b['y']==c['y']==d['y'] and min(max(a['x'],b['x']),max(c['x'],d['x']))>max(min(a['x'],b['x']),min(c['x'],d['x'])) for a,b in zip(first,first[1:]) for c,d in zip(second,second[1:])),result
  return result
 page.goto(base+'/index.html',wait_until='networkidle');ready();before=verify()
 page.locator('.graph-mode-trigger').click();page.locator('[data-graph-mode-option=professional]').click()
 page.evaluate('()=>{clearSelection();selectLink("one")}')
 trigger=page.locator('#edgeQuickStylePanel [data-uc-edge-panel=line]');trigger.click();panel=page.locator('#edgeQuickStylePanel [data-uc-edge-popover=line]');expect(panel).to_be_visible();page.wait_for_timeout(180)
 t=trigger.bounding_box();p=panel.bounding_box();assert abs(p['y']-(t['y']+t['height']+8))<2,(p,t)
 page.keyboard.press('Escape')
 # Move the source card with a real pointer drag; both relations must survive save/reload.
 card=page.locator('.knowledge-card[data-node-id="a"]');box=card.bounding_box();page.mouse.move(box['x']+50,box['y']+35);page.mouse.down();page.mouse.move(box['x']+110,box['y']+65,steps=10);page.mouse.up()
 after=verify();assert after!=before,'card movement must update both routes'
 page.locator('#graphSaveState').click();expect(page.locator('#graphSaveState .graph-save-state-text')).to_have_text('已保存',timeout=15000)
 page.reload(wait_until='networkidle');ready();reloaded=verify();assert reloaded==after,(after,reloaded)
 stored=ctx.request.get(base+'/api/v1/files/'+fid).json()['graphData'];assert stored['links'][0]['waypoints']!=stored['links'][1]['waypoints'],'render-only overlap must not alter stored guides'
 assert [l['arrowStyle'] for l in stored['links']]==['both','end'];assert not errors,errors
 browser.close()
print('PASS real API/DB: fixed ports, manual shared trunks, independent ids/arrows, refresh, original saved guides, submenu below trigger')
