#!/usr/bin/env python3
"""Learning scenes and return navigation against a disposable FastAPI fixture."""
import argparse,json,re
from pathlib import Path
from uuid import uuid4
from urllib.parse import urlparse,parse_qs
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--base-url',required=True);parser.add_argument('--source',action='store_true');parser.add_argument('--case',choices=['themes','entry','background','navigation','settings','draft-navigation','duplicate-refresh','historical-refresh']);parser.add_argument('--historical-workspaces');parser.add_argument('--out-dir');args=parser.parse_args()
assert urlparse(args.base_url).hostname in ['127.0.0.1','localhost'],'Use only disposable local accounts'
OUT=Path(args.out_dir) if args.out_dir else ROOT.parent/'artifacts/learning-state-regression';OUT.mkdir(parents=True,exist_ok=True)
FILES=['src/28-device-preferences.js','src/00-dialogs.js','src/canvas/toolbar.js','styles/canvas-toolbar.css','styles/learning-theme.css','src/canvas/97-learning-theme.js','src/86-knowledge-recall.js','src/77-multi-question-workspace.js','src/39-global-shortcuts.js','src/59b-learning-route-context.js','src/62a-learning-progress.js','src/canvas/94-canvas-ink.js','styles/unified-canvas-runtime.css','styles/knowledge-recall-patch-1.css','styles/focus-vega-learning.css','knowledge-recall.html','question-workspace.html']
report=[]
with sync_playwright() as pw:
 browser=pw.chromium.launch(channel='chrome')
 def setup():
  c=browser.new_context(viewport={'width':1440,'height':900});assert c.request.post(args.base_url+'/api/v1/auth/login',data={'username':'ink-browser','password':'ink-browser-test'}).ok
  if args.source:
   def override(route):
    rel=urlparse(route.request.url).path.lstrip('/')
    if rel in ['knowledge-recall.html','question-workspace.html']:
     response=route.fetch();body=response.text().replace('<head>','<head><link rel="stylesheet" href="styles/canvas-toolbar.css"><script src="src/00-dialogs.js"></script>');body=re.sub(r'(<script[^>]*src="src/canvas/94-canvas-ink.js[^>]*>)',r'<script defer src="src/canvas/toolbar.js"></script>\1',body)
     if rel=='knowledge-recall.html':body=re.sub(r'(<details[^>]*id="krSceneMenu"[\s\S]*?</svg>)(\s*</summary>)',r'\1<span>主题</span>\2',body,count=1)
     else:body=body.replace('画布主题（与深度回忆同步）','当前多题归纳主题（独立保存）')
     route.fulfill(response=response,body=body)
    elif rel=='canvas-workspace-adapter.js':route.fulfill(path=str(ROOT.parent/'frontend/scripts/new-legacy-assets/canvas-workspace-adapter.js'))
    elif rel in FILES:route.fulfill(path=str(ROOT/rel))
    else:route.continue_()
   c.route('**/*',override)
  return c
 def recall(c):
  p=c.new_page();p.set_default_timeout(6000);p.goto(args.base_url+'/knowledge-recall.html?paperId=ink-paper&releaseId=ink-release&questionId=ink-question-2&bankId=ink-bank',wait_until='networkidle');expect(p.locator('#krQuestionCount')).to_have_text('2/2');return p
 def workspace(c,question='ink-question-2',page=None):
  wid='learning-return-'+uuid4().hex[:12];node={'id':'return-card','questionId':question,'bankId':'ink-bank','paperId':'ink-paper','releaseId':'ink-release','title':'往返验证','x':120,'y':120,'width':580,'height':500,'color':'#ffffff'}
  payload={'id':wid,'userId':'ink-browser','title':'独立往返画布','schemaVersion':10,'nodes':{'return-card':node},'edges':[],'groups':[],'strokes':[],'tables':[]}
  r=c.request.post(args.base_url+'/api/v1/workspaces',data={'id':wid,'title':payload['title'],'schemaVersion':10,'payload':payload});assert r.ok,r.text()
  p=page or c.new_page();p.set_default_timeout(6000);p.goto(args.base_url+'/question-workspace.html?paperId=ink-paper&releaseId=ink-release&questionId='+question+'&bankId=ink-bank&workspace='+wid,wait_until='networkidle');p.wait_for_function('(id)=>KGMultiQuestionWorkspace?.activeWorkspaceId()===id&&KGMultiQuestionWorkspace.getState().questionCount===2',arg=wid);return p,wid
 def scene(p,value):
  p.locator('[data-learning-theme-menu]>summary').click();p.locator('.kr-scene-option[data-kr-theme='+value+']').click();p.locator('[data-theme-save]').click();expect(p.locator('#qwThemeSelect,#krThemeSelect')).to_have_value(value)
 def themes(c):
  r=recall(c);w,_=workspace(c);scene(r,'sakura');scene(w,'ocean');expect(r.locator('#krThemeSelect')).to_have_value('sakura');scene(r,'latte');expect(w.locator('#qwThemeSelect')).to_have_value('ocean');r.reload(wait_until='networkidle');w.reload(wait_until='networkidle');expect(r.locator('#krThemeSelect')).to_have_value('latte');expect(w.locator('#qwThemeSelect')).to_have_value('ocean')
  r.evaluate("sessionStorage.setItem('kg_multi_question_theme_v1','neon')");expect(w.locator('#qwThemeSelect')).to_have_value('ocean')
  for value in ['platform','parchment','aurora','neon','sakura','ocean','latte']:
   scene(w,value);expect(r.locator('#krThemeSelect')).to_have_value('latte')
  scene(r,'neon');expect(w.locator('#qwThemeSelect')).to_have_value('latte')
 def entry(c):
  r=recall(c)
  for width in [1440,1024,800,525,390]:
   r.set_viewport_size({'width':width,'height':844});summary=r.locator('#krSceneMenu>summary');assert '主题' in summary.inner_text(),'Theme entry needs a visible text label';summary.click();button=r.locator('.kr-scene-option[data-kr-theme=ocean]');assert button.evaluate('e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}');button.click();r.locator('[data-theme-save]').click();expect(r.locator('#krThemeSelect')).to_have_value('ocean')
  r.set_viewport_size({'width':1440,'height':900});r.mouse.move(500,400);r.keyboard.press('Escape');summary=r.locator('#krSceneMenu>summary');summary.focus();summary.press('Enter');expect(r.locator('#krSceneMenu')).to_have_attribute('open','');r.keyboard.press('Escape');assert not r.locator('#krSceneMenu').evaluate('e=>e.open');summary.press('Space');expect(r.locator('#krSceneMenu')).to_have_attribute('open','');r.keyboard.press('Escape')
  r.screenshot(path=str(OUT/'entry-after.png'))
 def background(c):
  w,_=workspace(c);layer=w.locator('.qw-background');assert layer.evaluate('e=>+getComputedStyle(e).opacity')==1,'The saved gradient is invisible';assert 'linear-gradient' in layer.evaluate('e=>getComputedStyle(e).backgroundImage')
  before=w.evaluate('KGMultiQuestionWorkspace.activeWorkspace().background');scene(w,'neon');assert w.evaluate('KGMultiQuestionWorkspace.activeWorkspace().background')==before,'Scene controls must preserve a saved document background';w.reload(wait_until='networkidle');assert layer.evaluate('e=>+getComputedStyle(e).opacity')==1;w.screenshot(path=str(OUT/'background-after.png'))
 def navigation(c):
  r=recall(c);w,wid=workspace(c,page=r);before=w.evaluate('KGMultiQuestionWorkspace.activeWorkspace()');w.evaluate('KGCanvasWorkspaceAdapter.flush({throwOnError:true})')
  other,other_id=workspace(c,question='ink-question-1');other.evaluate('KGCanvasWorkspaceAdapter.flush({throwOnError:true})');other.close();assert w.evaluate('KGMultiQuestionWorkspace.activeWorkspaceId()')==wid
  counts=[];observations=[]
  for attempt in range(3):
   w.locator('[data-global-shortcut=recall]').click();w.wait_for_url('**/knowledge-recall.html?**');w.wait_for_load_state('networkidle');counts.append(w.locator('#krQuestionCount').inner_text());w.locator('[data-global-shortcut=workspace]').click();w.wait_for_url('**/question-workspace.html?**');w.wait_for_load_state('networkidle');w.wait_for_function('!!KGMultiQuestionWorkspace?.activeWorkspace()');current=w.evaluate('KGMultiQuestionWorkspace.activeWorkspace()');observations.append({'expected':wid,'actual':current['id'],'expectedCards':list(before['nodes']),'actualCards':list(current['nodes']),'expectedQuestions':[n['questionId'] for n in before['nodes'].values()],'actualQuestions':[n['questionId'] for n in current['nodes'].values()]});(OUT/('navigation-source.json' if args.source else 'navigation-before.json')).write_text(json.dumps(observations,indent=2));assert current['id']==wid,observations[-1];assert current['nodes']==before['nodes'];q=parse_qs(urlparse(w.url).query);assert q.get('questionId')==['ink-question-2'],q;assert q.get('workspace')==[wid],q
  assert counts==['2/2']*3,counts
  w.reload(wait_until='networkidle');w.wait_for_function('(id)=>KGMultiQuestionWorkspace?.activeWorkspaceId()===id',arg=wid);assert w.evaluate('KGMultiQuestionWorkspace.activeWorkspace().nodes')==before['nodes']
 def draft_navigation(c):
  w=c.new_page();w.set_default_timeout(6000)
  # Register a real recall context before beginning the workspace route.
  w.goto(args.base_url+'/knowledge-recall.html?paperId=ink-paper&releaseId=ink-release&questionId=ink-question-2&bankId=ink-bank',wait_until='networkidle');expect(w.locator('#krQuestionCount')).to_have_text('2/2')
  wid='pending-nav-'+uuid4().hex[:10];payload={'id':wid,'userId':'ink-browser','title':'切换保存测试','schemaVersion':10,'nodes':{},'edges':[],'groups':[],'strokes':[],'tables':[]}
  assert c.request.post(args.base_url+'/api/v1/workspaces',data={'id':wid,'title':payload['title'],'schemaVersion':10,'payload':payload}).ok
  url=args.base_url+'/question-workspace.html?paperId=ink-paper&releaseId=ink-release&questionId=ink-question-2&bankId=ink-bank&workspace='+wid
  w.goto(url,wait_until='networkidle');w.wait_for_function('(id)=>KGMultiQuestionWorkspace.activeWorkspaceId()===id',arg=wid)
  w.get_by_role('button',name='画笔与文字工具',exact=True).click();w.get_by_role('button',name='文字',exact=True).click();expect(w.get_by_role('button',name='文字',exact=True)).to_have_attribute('aria-pressed','true');w.mouse.click(1000,400);editor=w.locator('.canvas-ink-text-editor');editor.fill('待保存切换不得丢失')
  failures=[]
  def fail(route):
   if route.request.method in ['POST','PUT']:
    failures.append(route.request.url);route.fulfill(status=503,content_type='application/json',body='{"detail":"测试：网络暂时不可用"}')
   else:route.continue_()
  pattern=re.compile(r'/api/v1/workspaces(?:/.*)?(?:\?.*)?$');c.route(pattern,fail)
  w.locator('[data-global-shortcut=recall]').click();w.wait_for_timeout(1300)
  observed={'url':w.url,'draftVisible':editor.count()>0,'failedRequests':len(failures)};(OUT/'draft-navigation.json').write_text(json.dumps(observed,ensure_ascii=False,indent=2));w.screenshot(path=str(OUT/'draft-navigation.png'))
  assert '/question-workspace.html' in w.url, '保存失败却直接离开画布，活动文字草稿丢失：'+str(observed)
  expect(editor).to_have_value('待保存切换不得丢失');c.unroute(pattern,fail)
  w.locator('[data-global-shortcut=recall]').click();w.wait_for_url('**/knowledge-recall.html?**');w.wait_for_load_state('networkidle');expect(w.locator('#krQuestionCount')).to_have_text('2/2')
  w.locator('[data-global-shortcut=workspace]').click();w.wait_for_url('**/question-workspace.html?**');w.wait_for_load_state('networkidle');w.wait_for_function("KGMultiQuestionWorkspace.activeWorkspace().strokes.some(s=>s.text==='待保存切换不得丢失')");w.reload(wait_until='networkidle');w.wait_for_function("KGMultiQuestionWorkspace.activeWorkspace().strokes.some(s=>s.text==='待保存切换不得丢失')")
  saved=c.request.get(args.base_url+'/api/v1/workspaces/'+wid);assert saved.ok;assert any(item.get('text')=='待保存切换不得丢失' for item in saved.json()['workspace']['payload']['strokes'])
 def duplicate_refresh(c):
  assert urlparse(args.base_url).port==5297,'Duplicate fixture setup is restricted to the disposable 5297 server'
  legacy='pmp-pattern-workspace';h=2166136261
  for char in 'ink-browser':h=((h^ord(char))*16777619)&0xffffffff
  digits='0123456789abcdefghijklmnopqrstuvwxyz';suffix=''
  while h:suffix=digits[h%36]+suffix;h//=36
  canonical=legacy+'-'+suffix;other=legacy+'-legacy-record'
  for row in c.request.get(args.base_url+'/api/v1/workspaces').json()['workspaces']:assert c.request.delete(args.base_url+'/api/v1/workspaces/'+row['id']).ok
  for row,qid,title in [(canonical,'ink-question-1','应稳定恢复的画布A'),(other,'ink-question-2','另一份历史画布B')]:
   node={'id':'ref-'+qid,'nodeType':'question-reference','questionId':qid,'paperId':'ink-paper','releaseId':'ink-release','bankId':'ink-bank','x':220,'y':180,'width':580,'height':550,'color':'#ffffff'}
   payload={'id':legacy,'userId':'ink-browser','title':title,'schemaVersion':10,'nodes':{node['id']:node},'edges':[],'groups':[],'strokes':[],'tables':[],'viewport':{'x':0,'y':0,'zoom':1}}
   response=c.request.post(args.base_url+'/api/v1/workspaces',data={'id':row,'title':title,'schemaVersion':10,'payload':payload});assert response.ok,response.text()
  base=args.base_url+'/question-workspace.html?paperId=ink-paper&releaseId=ink-release&questionId=ink-question-1&bankId=ink-bank&workspace='
  p=c.new_page();p.set_default_timeout(10000);errors=[];writes=[];observations=[]
  p.on('pageerror',lambda error:errors.append(str(error)));p.on('request',lambda request:writes.append(request.url) if request.method=='PUT' and '/workspaces/' in request.url else None)
  for turn in range(8):
   if turn==0 or turn>=4:p.goto(base+legacy,wait_until='networkidle')
   else:p.reload(wait_until='networkidle')
   p.wait_for_function('window.KGMultiQuestionWorkspace?.getState().questionCount===2');p.wait_for_timeout(650)
   current=p.evaluate('KGMultiQuestionWorkspace.activeWorkspace()');ids=[node.get('questionId') for node in current['nodes'].values()]
   expect(p.locator('.qw-question-card')).to_have_count(1);expect(p.locator('.qw-question-card')).to_have_attribute('aria-label',re.compile('笔迹验证题 1'));expect(p.locator('.qw-question-card')).to_contain_text('题1/2')
   assert current['id']==canonical and ids==['ink-question-1'],(p.url,current)
   assert parse_qs(urlparse(p.url).query)['workspace']==[canonical]
   observations.append({'turn':turn,'url':p.url,'id':current['id'],'questions':ids,'catalog':p.evaluate('KGCanvasWorkspaceStore.listWorkspaces().map(w=>w.id)')})
  assert all(url.endswith('/'+canonical) for url in writes),writes
  rows=c.request.get(args.base_url+'/api/v1/workspaces').json()['workspaces'];assert len(rows)==2
  assert {row['id']:list(row['payload']['nodes'].values())[0]['questionId'] for row in rows}=={canonical:'ink-question-1',other:'ink-question-2'}
  p.goto(base+other,wait_until='networkidle');p.wait_for_function('(id)=>KGMultiQuestionWorkspace.activeWorkspaceId()===id',arg=other);expect(p.locator('.qw-question-card')).to_have_attribute('aria-label',re.compile('笔迹验证题 2'));expect(p.locator('.qw-question-card')).to_contain_text('题2/2')
  p.reload(wait_until='networkidle');p.wait_for_function('(id)=>KGMultiQuestionWorkspace.activeWorkspaceId()===id',arg=other);expect(p.locator('.qw-question-card')).to_have_attribute('aria-label',re.compile('笔迹验证题 2'));expect(p.locator('.qw-question-card')).to_contain_text('题2/2')
  p.goto(base+legacy,wait_until='networkidle');p.wait_for_function('(id)=>KGMultiQuestionWorkspace.activeWorkspaceId()===id',arg=canonical);expect(p.locator('.qw-question-card')).to_have_attribute('aria-label',re.compile('笔迹验证题 1'));expect(p.locator('.qw-question-card')).to_contain_text('题1/2')
  assert not errors,errors;p.screenshot(path=str(OUT/'duplicate-refresh-final.png'))
  (OUT/'duplicate-refresh.json').write_text(json.dumps({'canonical':canonical,'observations':observations,'writes':writes,'retainedRows':len(rows),'pageErrors':errors,'explicitOtherRowAndReturn':True},ensure_ascii=False,indent=2))
 def historical_refresh(c):
  assert urlparse(args.base_url).port==5297,'Historical copies must use the disposable 5297 server'
  assert args.historical_workspaces,'Supply the read-only historical export; do not replace it with newly generated examples'
  originals=json.loads(Path(args.historical_workspaces).read_text());assert originals
  imported=[];observations=[];errors=[]
  for row in c.request.get(args.base_url+'/api/v1/workspaces').json()['workspaces']:
   if re.fullmatch(r'historical-copy-\d+',row['id']):assert c.request.delete(args.base_url+'/api/v1/workspaces/'+row['id']).ok
  for i,row in enumerate(originals):
   payload=json.loads(json.dumps(row['payload']));wid='historical-copy-'+str(i)
   # Keep historical shape, timestamps, layout, styles and alias relationships.
   # Only anonymize ownership, visible text and references to the fixture catalog.
   payload['userId']='ink-browser';payload['title']='历史画布副本 '+str(i)
   for j,node in enumerate(payload.get('nodes',{}).values()):
    if node.get('questionId'):
     node['questionId']='ink-question-'+str(j%2+1)
     for key,value in [('bankId','ink-bank'),('paperId','ink-paper'),('releaseId','ink-release')]:
      if node.get(key):node[key]=value
    for key in ['title','stemSummary','content']:
     if node.get(key):node[key]='历史内容 '+str(j)
   for stroke in payload.get('strokes',[]):
    if stroke.get('text'):stroke['text']='历史文字'
   body={'id':wid,'title':payload['title'],'schemaVersion':row['schema_version'],'payload':payload}
   response=c.request.post(args.base_url+'/api/v1/workspaces',data=body);assert response.ok,response.text()
   imported.append((wid,payload))
  p=c.new_page();p.set_default_timeout(10000);p.on('pageerror',lambda error:errors.append(str(error)))
  base=args.base_url+'/question-workspace.html?paperId=ink-paper&releaseId=ink-release&questionId=ink-question-1&bankId=ink-bank&workspace='
  def business(value):
   return {key:value.get(key) for key in ['nodes','edges','groups','strokes','tables','background']}
  def open_copy(wid):
   p.goto(base+wid,wait_until='networkidle');p.wait_for_function('(id)=>KGMultiQuestionWorkspace?.activeWorkspaceId()===id&&KGMultiQuestionWorkspace.getState().questionCount===2',arg=wid)
   p.wait_for_timeout(650)
   return p.evaluate('KGMultiQuestionWorkspace.activeWorkspace()')
  saved_copies={}
  for wid,original in imported:
   first=open_copy(wid)
   assert set(first['nodes'])==set(original.get('nodes',{})),'Loading changed historical card membership'
   expect(p.locator('.qw-question-card')).to_have_count(len(original.get('nodes',{})))
   assert len(first['strokes'])==len(original.get('strokes',[])),'Loading lost historical handwriting'
   p.locator('#qwWorkspaceSaveState').click();p.wait_for_function('(id)=>KGCanvasWorkspaceAdapter.getState(id).status==="saved"',arg=wid)
   settled=p.evaluate('KGMultiQuestionWorkspace.activeWorkspace()')
   for turn in range(3):
    p.reload(wait_until='networkidle');p.wait_for_function('(id)=>KGMultiQuestionWorkspace?.activeWorkspaceId()===id',arg=wid);p.wait_for_timeout(650)
    restored=p.evaluate('KGMultiQuestionWorkspace.activeWorkspace()')
    assert business(restored)==business(settled),f'Historical business data drifted on reload: {wid}, {turn}'
   # Make a real browser edit to the old document, then save and refresh it.
   p.locator('#qwInkBtn').click();p.locator('[data-ink-tool=text]').click()
   blank=p.evaluate('''()=>{const rects=[...document.querySelectorAll('.qw-question-card,.qw-synthesis-card,.canvas-ink-layer text')].map(e=>e.getBoundingClientRect());for(const y of [170,200,550,650])for(const x of [1100,1200,1000,350])if(rects.every(r=>x<r.left-20||x>r.right+20||y<r.top-20||y>r.bottom+20))return {x,y};throw Error('No blank point for the text edit')}''')
   p.mouse.click(blank['x'],blank['y'])
   editor=p.locator('.canvas-ink-text-editor');expect(editor).to_be_visible();editor.fill('历史副本保存验证 '+wid);editor.press('Control+Enter');expect(editor).to_have_count(0)
   p.locator('#qwWorkspaceSaveState').click();p.wait_for_function('(id)=>KGCanvasWorkspaceAdapter.getState(id).status==="saved"',arg=wid)
   edited=p.evaluate('KGMultiQuestionWorkspace.activeWorkspace()');assert len(edited['strokes'])==len(first['strokes'])+1
   restored=open_copy(wid);assert business(restored)==business(edited)
   remote=c.request.get(args.base_url+'/api/v1/workspaces/'+wid);assert remote.ok
   assert business(remote.json()['workspace']['payload'])==business(restored)
   saved_copies[wid]=business(restored)
   observations.append({'copy':wid,'createdAt':original.get('createdAt'),'nodes':len(restored['nodes']),'originalStrokes':len(first['strokes']),'savedStrokes':len(restored['strokes']),'reloads':3})
  # Reopen the old copies in reverse order in one tab, rather than testing each
  # only in a fresh browser context. No copied sibling may overwrite another.
  for wid,_ in reversed(imported):
   assert business(open_copy(wid))==saved_copies[wid]
  p.screenshot(path=str(OUT/'historical-refresh-final.png'));assert not errors,errors
  (OUT/'historical-refresh.json').write_text(json.dumps({'historicalRows':len(originals),'observations':observations,'reverseReopen':True,'pageErrors':errors},ensure_ascii=False,indent=2))
 def settings(c):
  r=recall(c);w,_=workspace(c);old=r.evaluate('KGCanvasAppearanceController.read()');before=w.evaluate('KGMultiQuestionWorkspace.activeWorkspace().background');w.locator('[data-uc-canvas-settings]').click();w.locator('[data-uc-color="#fff1f5"]').click();w.locator('[data-uc-cancel]').click();assert w.evaluate('KGMultiQuestionWorkspace.activeWorkspace().background')==before;w.locator('[data-uc-canvas-settings]').click();w.locator('[data-uc-pattern=solid]').click();w.locator('[data-uc-color="#fff1f5"]').click();w.locator('[data-uc-confirm]').click();r.reload(wait_until='networkidle');assert r.evaluate('KGCanvasAppearanceController.read()')==old;w.reload(wait_until='networkidle');w.wait_for_function("KGMultiQuestionWorkspace?.activeWorkspace()?.background?.appearance.backgroundColor==='#fff1f5'");assert w.locator('.qw-background').evaluate('e=>getComputedStyle(e).backgroundImage')=='none','Saved scene layer must not cover an explicitly chosen solid background'
 for name,fn in [('themes',themes),('entry',entry),('background',background),('navigation',navigation),('settings',settings),('draft-navigation',draft_navigation)]+([('duplicate-refresh',duplicate_refresh)] if args.case=='duplicate-refresh' else [])+([('historical-refresh',historical_refresh)] if args.case=='historical-refresh' else []):
  if args.case and args.case!=name:continue
  c=setup()
  try:fn(c);report.append({'case':name,'passed':True});print('PASS',name,flush=True)
  except Exception as e:
   report.append({'case':name,'passed':False,'error':str(e)});print('FAIL',name,str(e),flush=True)
   for i,p in enumerate(c.pages):p.screenshot(path=str(OUT/(name+'-failure-'+str(i)+'.png')))
  finally:c.close()
 browser.close()
(OUT/('source-results.json' if args.source else 'browser-results.json')).write_text(json.dumps(report,indent=2,ensure_ascii=False));assert all(r['passed'] for r in report),report
