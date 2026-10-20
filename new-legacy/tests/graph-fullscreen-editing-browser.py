"""Real Chrome input and fullscreen regressions against a disposable backend."""
import argparse,json,uuid
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright,expect
from helpers.dialog_actions import respond_dialog
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'artifacts/canvas-m0-m1';OUT.mkdir(parents=True,exist_ok=True)
a=argparse.ArgumentParser();a.add_argument('--base-url',required=True);a.add_argument('--baseline',action='store_true');args=a.parse_args();base=args.base_url.rstrip('/')
assert urlparse(base).hostname in ('127.0.0.1','localhost')
with sync_playwright() as pw:
 b=pw.chromium.launch(channel='chrome');c=b.new_context(viewport={'width':1440,'height':1000});assert c.request.post(base+'/api/v1/auth/login',data={'username':'ink-browser','password':'ink-browser-test'}).ok
 graph={'meta':{'title':'全屏与输入验证'},'viewport':{'x':100,'y':30,'scale':1},'nodes':[{'id':'focus-node','title':'删除文字不能删除卡片','geometry':{'x':200,'y':250,'width':260,'height':100}}],'links':[]}
 r=c.request.post(base+'/api/v1/files',data={'name':'M1-'+uuid.uuid4().hex[:8],'graphData':graph});assert r.ok;fid=r.json()['file']['id'];assert c.request.put(base+'/api/v1/files/current',data={'fileId':fid}).ok
 page=c.new_page();errors=[];dialogs=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(base+'/index.html',wait_until='networkidle')
 for sel in ['#learningEntryDismissBtn','.tour-skip','#hideHelpBtn']:
  if page.locator(sel).is_visible():page.locator(sel).click()
 page.locator('.graph-mode-trigger').click();page.locator('[data-graph-mode-option="professional"]').click()
 card=page.locator('.knowledge-card[data-node-id="focus-node"]');card.dblclick();editor=page.locator('[data-node-inline-editor]');expect(editor).to_be_visible();editor.press('End');editor.press('Backspace')
 result={'deleteTextDialogs':dialogs.copy(),'nodeCount':page.evaluate('state.nodes.length')};page.screenshot(path=str(OUT/('baseline-input.png' if args.baseline else 'input-fixed.png')))
 editor.press('Escape');page.locator('#canvasFullscreenBtn').click();page.wait_for_function('!!document.fullscreenElement');card.click();page.locator('#detailActionsToggle').click();page.locator('#editFromDetailBtn').click()
 page.wait_for_function('getComputedStyle(document.querySelector("#nodeModal .modal")).opacity==="1"');result['modalInFullscreen']=page.evaluate('document.fullscreenElement.contains(document.querySelector("#nodeModal"))');page.screenshot(path=str(OUT/('baseline-fullscreen.png' if args.baseline else 'fullscreen-fixed.png')))
 if args.baseline:
  (OUT/'graph-baseline.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(result)
 else:
  assert result['deleteTextDialogs']==[],result;assert result['nodeCount']==1;assert result['modalInFullscreen'],result
  before_zoom=page.evaluate('state.viewport.scale');page.locator('#nodeModal h2').hover();page.mouse.wheel(0,300);page.wait_for_timeout(200);assert page.evaluate('state.viewport.scale')==before_zoom
  expect(page.locator('#nSummary')).to_be_editable();page.locator('#nSummary').fill('全屏保存后保留详细内容');page.locator('#saveNodeBtn').click();expect(page.locator('#nodeModal')).not_to_be_visible()
  page.evaluate('persistCurrentGraphNow()');saved=c.request.get(base+'/api/v1/files/'+fid).json();assert '全屏保存后保留详细内容' in json.dumps(saved,ensure_ascii=False)
  card.click();page.locator('#detailActionsToggle').click();page.locator('#editFromDetailBtn').click();page.locator('#nSummary').fill('取消内容');page.locator('#nodeModal').get_by_role('button',name='取消',exact=True).click()
  page.evaluate("setRelatedScopeCenter('focus-node');openRelatedCanvasModal(false)")
  related=page.locator('.related-canvas-backdrop');expect(related).to_be_visible();assert related.evaluate('el=>document.fullscreenElement.contains(el)')
  related.get_by_role('button',name='退出临时画布').click();expect(related).to_have_count(0)
  # Fullscreen exit restores the original DOM position, not a duplicate.
  page.evaluate('document.exitFullscreen()');page.wait_for_function('!document.fullscreenElement');assert page.locator('#nodeModal').count()==1
  page.wait_for_function('!document.querySelector("#stage").contains(document.querySelector("#nodeModal"))')
  card.click();page.keyboard.press('Delete');dialogs.append(respond_dialog(page,'删除',accept=False));assert len(dialogs)==1 and '删除' in dialogs[0];assert page.evaluate('state.nodes.length')==1
  assert not errors,errors;print('PASS inline Backspace stays text, object delete still confirms; fullscreen edit/save/cancel and DOM restore')
 b.close()
