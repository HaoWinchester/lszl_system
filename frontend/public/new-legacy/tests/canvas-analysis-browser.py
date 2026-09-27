"""Regression of both canvas explanation toggles, actual reset API and original charts."""
import argparse,json,socket,subprocess,time
from pathlib import Path
from urllib.request import urlopen
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'artifacts/canvas-bugs-20260927';OUT.mkdir(exist_ok=True,parents=True)
parser=argparse.ArgumentParser();parser.add_argument('--backend-python',required=True);args=parser.parse_args()
with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
base=f'http://127.0.0.1:{port}';results=[]
log=(OUT/'browser-server.log').open('w')
server=subprocess.Popen([args.backend_python,str(ROOT/'new-legacy/tests/helpers/canvas_analysis_server.py'),str(port)],stdout=log,stderr=log,cwd=ROOT)
try:
 for _ in range(120):
  if server.poll() is not None:raise RuntimeError('Test server failed; see browser-server.log')
  try:
   if urlopen(base+'/api/v1/health',timeout=1).status==200:break
  except Exception:time.sleep(.5)
 with sync_playwright() as p:
  browser=p.chromium.launch();context=browser.new_context(viewport={'width':1440,'height':1000})
  assert context.request.post(base+'/api/v1/auth/login',data={'username':'ink-browser','password':'ink-browser-test'}).ok
  for kind in ['workspace','recall']:
   page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   path='/question-workspace.html?paperId=ink-paper&releaseId=ink-release' if kind=='workspace' else '/knowledge-recall.html?questionId=ink-question-1&paperId=ink-paper&releaseId=ink-release'
   page.goto(base+path,wait_until='networkidle')
   print('Testing '+kind,flush=True)
   if kind=='workspace':
    page.locator('#qwQuestionDockBtn').click();page.locator('[data-add-index]').first.click();page.evaluate('KGMultiQuestionWorkspace.closeQuestionDrawer()');card='.qw-question-card'
   else:card='#krQuestionCard'
   page.locator(card+' [data-qw-action="analysis"]').click()
   panel=page.locator('.qw-analysis-panel');expect(panel).to_be_visible()
   panel.locator('summary').click()
   for key,text in [('concepts','预算估算'),('clues','分析影响'),('traps','未经分析不能立即变更')]:
    toggle=panel.locator('[data-qw-analysis-section="'+key+'"]');toggle.set_checked(True)
    try:expect(panel.locator('[data-analysis-section="'+key+'"]')).to_contain_text(text)
    except AssertionError:
     page.screenshot(path=str(OUT/'failure.png'),full_page=True)
     print(context.request.get(base+'/api/v1/recall/session/ink-question-1?releaseId=ink-release').text(),flush=True)
     raise
    toggle.set_checked(False);expect(panel.locator('[data-analysis-section="'+key+'"]')).to_have_count(0)
    toggle.set_checked(True)
   results.append(kind+': three toggles show and hide real/empty content')
   image=page.locator(card+' .qm-image img');expect(image).to_have_count(1)
   image.evaluate('(img)=>img.decode()');assert image.evaluate('img=>img.naturalWidth')>500
   page.screenshot(path=str(OUT/(kind+'-analysis.png')),full_page=True)
   panel.locator('[data-qw-analysis-close]').click()
   page.locator(card+' [data-qm-zoom]').click();expect(page.locator('.qm-image-dialog')).to_be_visible();page.locator('.qm-image-dialog button').click()
   results.append(kind+': original chart renders and zooms')
   if kind=='recall':
    page.on('dialog',lambda d:d.accept())
    with page.expect_response(lambda r:'/reset?' in r.url and r.request.method=='POST') as response:page.locator('#krResetBtn').click()
    assert response.value.status==200,response.value.text()
    assert '/reset?releaseId=ink-release' in response.value.url
    page.reload();expect(page.locator('#krQuestionCard')).to_be_visible();results.append('recall: published reset returns 200 and reload works')
    page.locator('#krNextQuestionBtn').click();page.wait_for_url('**questionId=ink-question-2*')
    page.locator('#krQuestionCard .qm-image img').evaluate('(img)=>img.decode()')
    page.screenshot(path=str(OUT/'recall-second-chart.png'),full_page=True);results.append('recall: second original chart renders')
    page.locator('#krQuestionCard [data-qw-action=analysis]').click()
    expect(page.locator('[data-analysis-section=traps]')).to_contain_text('本题尚未录入选项提示')
    results.append('recall: missing option hints are explicit, not invented')
   assert not errors,errors;page.close()
  browser.close()
 print(json.dumps({'passed':results},ensure_ascii=False),flush=True)
 (OUT/'browser-results.json').write_text(json.dumps({'passed':results},ensure_ascii=False,indent=2))
finally:
 server.terminate()
 try:server.wait(timeout=20)
 except subprocess.TimeoutExpired:server.kill();server.wait()
 log.close()
