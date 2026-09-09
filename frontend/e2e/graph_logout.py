"""Graph logout against disposable PostgreSQL and the actual release, using agent-browser."""
import json,os,socket,subprocess,time
from pathlib import Path
from uuid import uuid4
from urllib.request import Request,urlopen
import wechat_account_link as browser
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/graph-logout'
browser.OUT=OUT;browser.SESSION='graph-logout'
ab,js,wait,click,fill,api=browser.ab,browser.js,browser.wait,browser.click,browser.fill,browser.api
PASSWORD='Graph-test-123'
def main():
 OUT.mkdir(parents=True,exist_ok=True)
 database='kg_graph_logout_'+uuid4().hex[:10];username='logout_'+uuid4().hex[:10]
 with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
 base=f'http://127.0.0.1:{port}'
 env=dict(os.environ,DATABASE_URL=f'postgresql+asyncpg://{os.environ.get("USER","menghao")}@/{database}?host=/tmp',GRAPH_FILES_API_CUTOVER_ENABLED='true',LEGAL_CONSENT_REQUIRED='false',NEW_LEGACY_RELEASE_ROOT=str(ROOT/'frontend/new-legacy-releases'))
 subprocess.run(['createdb','-h','/tmp',database],check=True)
 process=None
 def login(page):
  ab('open',base+'/'+page);wait("typeof authOpen==='function'");js('authOpen()')
  fill('#authUsername',username);fill('#authPassword',PASSWORD);ab('check','#authLegalConsent');click('#authDoLoginBtn')
  wait('!!KGAuthCore.currentUser()')
  if js("!!document.querySelector('#learningEntryModal.show')"):click('#learningEntryDismissBtn')
 def logout():
  click('[data-account-menu-trigger]');ab('snapshot','-i');click('[aria-label="退出登录"]');wait('!KGAuthCore.currentUser()')
 def graph():
  ab('open',base+'/index.html?mode=free');wait("!!window.KGHomepageGraphBootstrap && !!window.KGGraphFileAutosave")
  js('(async()=>{await KGHomepageGraphBootstrap;return true})()')
  if js("!!document.querySelector('.tour-skip')"):click('.tour-skip')
 try:
  subprocess.run([str(ROOT/'backend/.venv/bin/python'),'-m','alembic','upgrade','head'],cwd=ROOT/'backend',env=env,capture_output=True,check=True)
  process=subprocess.Popen([str(ROOT/'backend/.venv/bin/python'),'-m','uvicorn','app.main:app','--host','127.0.0.1','--port',str(port)],cwd=ROOT/'backend',env=env,stdout=(OUT/'server.log').open('w'),stderr=subprocess.STDOUT)
  for _ in range(200):
   try:urlopen(base+'/api/v1/health',timeout=1);break
   except OSError:time.sleep(.1)
  req=Request(base+'/api/v1/auth/register',data=json.dumps({'username':username,'password':PASSWORD}).encode(),headers={'Content-Type':'application/json'})
  urlopen(req).close()
  login('index.html');graph()
  assert js('KGGraphFileRemoteAdapter.getCurrentFileMeta()') is None
  assert not js('KGGraphFileAutosave.isDirty()')
  js('fitView(true)');wait('!KGGraphFileAutosave.isDirty()')
  assert api('/api/v1/files')['body']['total']==0
  logout();print('Unedited preview / fit / logout with no server file: PASS',flush=True)
  login('index.html');graph()
  # Edit through the existing node form, save, then leave using the actual account menu.
  click('.knowledge-card[data-node-id]:first-child');click('#detailActionsToggle');click('#editFromDetailBtn');wait("!!document.querySelector('#nodeModal.show')")
  fill('#nTitle','Durable logout graph');click('#saveNodeBtn')
  wait("!!KGGraphFileRemoteAdapter.getCurrentFileMeta() && !KGGraphFileAutosave.isDirty()")
  file_id=js('KGGraphFileRemoteAdapter.getCurrentFileMeta().id')
  wait("!!document.querySelector('.graph-file-tab.is-active')")
  assert api('/api/v1/files')['body']['total']==1
  assert api('/api/v1/files/'+file_id)['body']['graphData']['nodes'][0]['title']=='Durable logout graph'
  logout();login('index.html');graph()
  assert js('state.nodes[0].title')=='Durable logout graph'
  print('First content edit creates one durable file / logout / reopen: PASS',flush=True)
  # Only save requests fail; confirm the session and draft remain, then restore and retry.
  js("window.__graphFetch=fetch;window.fetch=(url,o={})=>o.method==='PUT'&&String(url).includes('/files/')?Promise.resolve(new Response(JSON.stringify({detail:'test offline'}),{status:503})):window.__graphFetch(url,o)")
  click('.knowledge-card[data-node-id]:first-child');click('#detailActionsToggle');click('#editFromDetailBtn');wait("!!document.querySelector('#nodeModal.show')");fill('#nTitle','Retained after offline');click('#saveNodeBtn')
  wait("!!KGGraphFileAutosave.status().lastError")
  click('[data-account-menu-trigger]');click('[aria-label="退出登录"]')
  wait("document.querySelector('#status').textContent.includes('取消退出')")
  assert js('!!KGAuthCore.currentUser()');assert js('KGGraphFileAutosave.isDirty()')
  js('window.fetch=window.__graphFetch');click('#graphSaveState');wait('!KGGraphFileAutosave.isDirty()')
  assert api('/api/v1/files/'+file_id)['body']['graphData']['nodes'][0]['title']=='Retained after offline'
  logout();print('Failed save blocks logout / retains draft / successful retry: PASS',flush=True)
  for page in ['index.html','practice-mode.html','knowledge-recall.html','question-workspace.html']:
   login(page);logout();print('Login and logout:',page,flush=True)
  print('GRAPH_LOGOUT_BROWSER_OK',flush=True)
 finally:
  ab('close')
  if process:process.terminate();process.wait(timeout=15)
  subprocess.run(['dropdb','-h','/tmp','--if-exists','--force',database],check=True)
if __name__=='__main__':main()
