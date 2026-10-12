"""Formal graph native title/text editors retain pending input and resize fonts."""
import argparse,uuid,math
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
BASE=argparse.ArgumentParser();BASE.add_argument('--base-url',required=True);base=BASE.parse_args().base_url
out=Path(__file__).resolve().parents[2]/'artifacts/canvas-m2-m5/t09'
with sync_playwright() as pw:
 b=pw.chromium.launch(channel='chrome');c=b.new_context(viewport={'width':1440,'height':1000});assert c.request.post(base+'/api/v1/auth/login',data={'username':'ink-browser','password':'ink-browser-test'}).ok
 graph={'nodes':[{'id':'title','title':'原始标题','x':550,'y':550}],'links':[],'elements':[{'id':'text','elementType':'text','text':'原始文本','x':550,'y':220,'width':200,'height':100,'fontSize':20,'manualSize':True}],'viewport':{'x':0,'y':0,'scale':1}}
 r=c.request.post(base+'/api/v1/files',data={'name':'图谱文字'+uuid.uuid4().hex[:6],'graphData':graph});assert r.ok;fid=r.json()['file']['id'];assert c.request.put(base+'/api/v1/files/current',data={'fileId':fid}).ok
 page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto(base+'/index.html',wait_until='networkidle')
 for sel in ['#learningEntryDismissBtn','.tour-skip','#hideHelpBtn']:
  if page.locator(sel).is_visible():page.locator(sel).click()
 page.locator('.graph-mode-trigger').click();page.locator('[data-graph-mode-option="professional"]').click();page.evaluate('()=>{state.viewport={x:0,y:0,scale:1};applyTransform()}')
 assert page.evaluate("startTextElementInlineEdit('text')")
 page.wait_for_timeout(80);editor=page.locator('[data-node-inline-editor=true]');editor.fill('新的文本 mixed 中文换行');page.locator('[data-node-toolbar-panel=font-style]').click();page.locator('[data-node-toolbar-action=font-bold]').click();expect(editor).to_have_text('新的文本 mixed 中文换行');expect(editor).to_have_attribute('contenteditable','plaintext-only')
 def fail(route):
  if route.request.method in ('POST','PUT','PATCH','DELETE'):route.fulfill(status=503,content_type='application/json',body='{"detail":"offline"}')
  else:route.continue_()
 page.route('**/api/v1/files/**',fail);page.mouse.click(1050,400);expect(editor).to_have_attribute('data-save-state','failed');expect(editor).to_have_text('新的文本 mixed 中文换行');page.unroute('**/api/v1/files/**',fail);page.mouse.click(1050,400);expect(editor).to_have_count(0)
 data=c.request.get(base+'/api/v1/files/'+fid).json()['graphData'];assert data['elements'][0]['text']=='新的文本 mixed 中文换行'
 page.evaluate("()=>{state.selectedElementId='text';refreshSelectionUI()}");el=page.locator('.graph-text-element[data-text-element-id=text]');h=el.locator('[data-element-resize-handle=e]');box=h.bounding_box();before=page.evaluate('KGGraphKernel.history.getState().undoCount');page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2);page.mouse.down();page.mouse.move(box['x']+box['width']/2+200,box['y']+box['height']/2,steps=10);page.mouse.up();assert page.evaluate('KGGraphKernel.history.getState().undoCount')==before+1
 assert abs(page.evaluate('textElementById("text").fontSize')-20*math.sqrt(2))<.02
 # Cancel another drag restores geometry/font without another history item.
 original=page.evaluate('JSON.stringify(textElementById("text"))');box=h.bounding_box();page.mouse.move(box['x']+5,box['y']+5);page.mouse.down();page.mouse.move(box['x']+85,box['y']+5,steps=5);page.keyboard.press('Escape');page.mouse.up();assert page.evaluate('JSON.stringify(textElementById("text"))')==original
 assert page.evaluate("startNodeInlineEdit('title')");page.wait_for_timeout(80);editor.fill('');page.mouse.click(1050,400);expect(editor).to_have_count(0);assert page.evaluate('nodeById("title").title')=='未命名知识点'
 assert page.evaluate("startTextElementInlineEdit('text')");page.wait_for_timeout(80);editor.fill('');page.mouse.click(1050,400);expect(editor).to_have_count(0);assert page.evaluate('textElementById("text").text')=='', repr(page.evaluate('textElementById("text").text'))
 page.screenshot(path=str(out/'graph-text.png'));assert not errors,errors;b.close()
print('canvas-graph-text-browser: PASS formatting boundary, remote failure/retry, area resize/history/cancel, title fallback, empty text')
