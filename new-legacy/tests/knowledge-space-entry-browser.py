"""Built homepage learning entries against an isolated real API (no successful request mocks)."""
import argparse
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
parser=argparse.ArgumentParser();parser.add_argument('--base-url',required=True);args=parser.parse_args()
BASE=args.base_url.rstrip('/');assert BASE.startswith('http://127.0.0.1:')
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'artifacts/learning-feedback-three-groups/task-3';OUT.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
 browser=p.chromium.launch(channel='chrome',headless=True)
 for width in (1440,390):
  context=browser.new_context(viewport={'width':width,'height':900},reduced_motion='reduce');page=context.new_page();errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  login=context.request.post(BASE+'/api/v1/auth/login',data={'username':'ink-browser','password':'ink-browser-test'});assert login.ok,login.status
  data=context.request.get(BASE+'/api/v1/learning/practice/knowledge-dashboard?page=1&pageSize=60').json()
  print(f'{width}: loading built index',flush=True)
  page.goto(BASE+'/index.html',wait_until='networkidle')
  print(f'{width}: index loaded',flush=True)
  page.wait_for_function('!!window.KGLearningEntryChooser && !!window.KGKnowledgeDashboard')
  # First-login auto chooser and manually reopened chooser use the same four entries.
  if not page.locator('#learningEntryModal').is_visible():page.locator('[data-learning-entry-manual]:visible').click()
  print(f'{width}: chooser opened',flush=True)
  chooser=page.locator('#learningEntryModal');expect(chooser).to_be_visible()
  assert chooser.locator('[data-learning-entry-choice]').count()==4
  assert chooser.locator('[data-learning-entry-choice]:visible').count()==4
  assert chooser.locator('.learning-entry-name').all_text_contents()==['知识图谱','深度回忆','多题归纳','知识星空']
  assert page.locator('[data-knowledge-dashboard-open]').count()==0
  with page.expect_response(lambda r:'/api/v1/learning/practice/knowledge-dashboard?' in r.url) as response:
   chooser.locator('[data-learning-entry-choice="知识星空"]').click()
  print(f'{width}: dashboard API returned',flush=True)
  assert response.value.ok
  expect(chooser).to_be_hidden();dialog=page.locator('#kgKnowledgeDashboard');expect(dialog).to_be_visible()
  expect(dialog.locator('[data-knowledge-summary]')).to_contain_text(f"累计 {data['attemptCount']} 次作答")
  if data['nodes']:expect(dialog.locator('canvas')).to_have_count(1)
  else:expect(dialog.locator('[data-knowledge-status]')).to_contain_text('保存')
  page.screenshot(path=str(OUT/f'built-entry-{width}.png'))
  page.keyboard.press('Escape');expect(dialog).to_be_hidden()
  if page.locator('[data-home-mobile-readonly-confirm]').is_visible():page.locator('[data-home-mobile-readonly-confirm]').click()
  page.locator('[data-learning-entry-manual]:visible').click();chooser.locator('[data-learning-entry-choice="知识图谱"]').click();expect(chooser).to_be_hidden()
  page.reload(wait_until='networkidle');page.locator('[data-learning-entry-manual]:visible').click();chooser.locator('[data-learning-entry-choice="知识星空"]').click();expect(dialog).to_be_visible()
  assert not errors,errors
  context.close()
 # A fresh guest can still open the shared chooser; knowledge space explains sign-in and shows no private data.
 context=browser.new_context();page=context.new_page();page.goto(BASE+'/index.html',wait_until='networkidle')
 page.locator('[data-learning-entry-manual]:visible').click();page.locator('[data-learning-entry-choice="知识星空"]').click()
 expect(page.locator('[data-knowledge-status]')).to_contain_text('登录后');expect(page.locator('canvas.kg-knowledge-space-canvas')).to_have_count(0)
 page.keyboard.press('Escape');context.close();browser.close()
print('built homepage: desktop/mobile four visible entries, real owner API totals, star open/close/reopen/reload, graph return, guest privacy passed')
