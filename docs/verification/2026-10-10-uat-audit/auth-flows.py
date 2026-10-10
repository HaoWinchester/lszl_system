exec(open('docs/verification/2026-10-10-uat-audit/sweep.py').read().split('routes=')[0])
from playwright.sync_api import expect
log=[]
def record(page,step,extra=None):
 log.append({'time':datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).isoformat(),'route':page.url,'step':step,'data':extra});(OUT/'auth-flows.json').write_text(json.dumps(log,ensure_ascii=False,indent=2));print(step,extra or '',flush=True)
with sync_playwright() as pw:
 b=pw.chromium.launch(headless=True)
 for route in ['/practice-mode.html','/knowledge-recall.html','/question-workspace.html']:
  c=b.new_context(viewport={'width':1440,'height':900});p=c.new_page();p.set_default_timeout(10000);name=route[1:-5]
  try:
   p.goto(BASE+route,wait_until='networkidle');p.wait_for_timeout(600)
   p.locator('#authStatus').click();p.locator('#accountMenuSessionBtn').click();expect(p.locator('#authModal')).to_be_visible();record(p,'open login')
   p.locator('#authUsername').fill('admin');p.locator('#authPassword').fill(password);p.locator('#authLegalConsent').check();p.screenshot(path=str(OUT/f'auth-{name}-before.png'));p.locator('#authDoLoginBtn').click();expect(p.locator('#authModal')).not_to_be_visible();p.wait_for_timeout(700)
   record(p,'login',{'label':p.locator('#authStatus').get_attribute('aria-label'),'text':p.locator('#authStatus').inner_text()});p.screenshot(path=str(OUT/f'auth-{name}-after.png'))
   p.locator('#authStatus').click();expect(p.locator('#accountMenuSessionBtn')).to_contain_text('退出');p.locator('#accountMenuSessionBtn').click();p.wait_for_timeout(700)
   p.locator('#authStatus').click();expect(p.locator('#accountMenuSessionBtn')).to_contain_text('登录');record(p,'logout success')
   p.screenshot(path=str(OUT/f'auth-{name}-logout.png'))
  except Exception as e:record(p,'FAIL',str(e)[:400]);p.screenshot(path=str(OUT/f'auth-{name}-failure.png'))
  c.close()
 b.close()
