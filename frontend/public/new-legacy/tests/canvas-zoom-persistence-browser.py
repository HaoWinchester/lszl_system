#!/usr/bin/env python3
"""Real 1% UI range keyboard / minus-button zoom, database/API save and reload on disposable backend."""
import argparse,json,math
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'artifacts/canvas-m0-m1/zoom-persistence';OUT.mkdir(parents=True,exist_ok=True)
a=argparse.ArgumentParser();a.add_argument('--base-url',default='http://127.0.0.1:5192');args=a.parse_args();BASE=args.base_url;rows=[]
with sync_playwright() as p:
 b=p.chromium.launch(channel='chrome');c=b.new_context(viewport={'width':1440,'height':1000})
 assert c.request.post(BASE+'/api/v1/auth/login',data={'username':'ink-browser','password':'ink-browser-test'}).ok
 r=c.request.post(BASE+'/api/v1/files',data={'name':'1%缩放验证','graphData':{'meta':{'title':'缩放验证'},'viewport':{'x':260,'y':170,'scale':1},'nodes':[],'links':[],'elements':[]}});assert r.ok,r.text();fid=r.json()['file']['id'];assert c.request.put(BASE+'/api/v1/files/current',data={'fileId':fid}).ok
 cases=[('home','/index.html','#canvasZoomPercentBtn','#canvasZoomSlider','.world'),('workspace','/question-workspace.html?paperId=ink-paper&releaseId=ink-release','#qwZoomLabel','#qwZoomSlider','.qw-world'),('recall','/knowledge-recall.html?questionId=ink-question-1&bankId=ink-bank&paperId=ink-paper&releaseId=ink-release','#krZoomLabel','#krZoomSlider','#krWorld')]
 for name,path,label,slider,world in cases:
  page=c.new_page();writes=[];page.on('response',lambda r:writes.append({'url':r.url,'status':r.status}) if r.request.method in ['PUT','POST'] and '/api/v1/' in r.url else None);page.goto(BASE+path,wait_until='networkidle');page.evaluate('document.fonts.ready');page.wait_for_timeout(800)
  
  if page.locator('#learningEntryModal.show').count():page.locator('#learningEntryDismissBtn').click()
  if page.locator('#guidedTourLayer.show').count():page.locator('.tour-skip').click()
  print('ready '+name,flush=True)
  if name=='recall':
   for _ in range(20):page.locator('#krZoomOutBtn').click()
  else:
   page.locator(label).hover();page.locator(slider).focus();page.locator(slider).press('Home')
  expect(page.locator(label)).to_have_text('1%');page.wait_for_timeout(1300)
  scale=page.locator(world).evaluate('e=>new DOMMatrix(getComputedStyle(e).transform).a');assert abs(scale-.01)<1e-6,(name,scale)
  if name=='home':
   page.evaluate('KGGraphFileRemoteAdapter.flush()');data=c.request.get(BASE+'/api/v1/files/'+fid).json();stored=data['graphData']['viewport']['scale']
  elif name=='workspace':
   page.evaluate('KGCanvasWorkspaceAdapter.flush()');data=c.request.get(BASE+'/api/v1/workspaces').json();payload=next(w['payload'] for w in data['workspaces'] if w['payload'].get('id')=='pmp-pattern-workspace');stored=payload['viewport']['zoom']
  else:
   page.evaluate("KGLearningProgress.flush('deep_recall')");data=c.request.get(BASE+'/api/v1/recall/session/ink-question-1?releaseId=ink-release').json();stored=data['progress']['transform']['scale']
  assert stored==.01,(name,stored,data)
  page.screenshot(path=str(OUT/f'{name}-saved1.png'));page.reload(wait_until='networkidle');page.wait_for_timeout(900);reloaded=page.locator(world).evaluate('e=>new DOMMatrix(getComputedStyle(e).transform).a');page.screenshot(path=str(OUT/f'{name}-reload.png'));rows.append(dict(page=name,uiScale=scale,stored=stored,reloaded=reloaded,writes=writes));(OUT/'results.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2));print(rows[-1],flush=True);page.close()
 b.close()
 assert all(abs(r['reloaded']-.01)<1e-6 for r in rows),rows
print('all three 1% persistence and reload passed')
