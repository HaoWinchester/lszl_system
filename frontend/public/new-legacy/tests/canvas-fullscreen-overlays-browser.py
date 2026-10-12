"""Shared overlay edit/IME/escape/restoration on all three real canvas pages."""
import argparse
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'artifacts/canvas-m0-m1';OUT.mkdir(parents=True,exist_ok=True)
a=argparse.ArgumentParser();a.add_argument('--base-url',required=True);args=a.parse_args();base=args.base_url.rstrip('/');assert urlparse(base).hostname in ('localhost','127.0.0.1')
with sync_playwright() as pw:
 b=pw.chromium.launch(channel='chrome');ctx=b.new_context(viewport={'width':1440,'height':1000});assert ctx.request.post(base+'/api/v1/auth/login',data={'username':'ink-browser','password':'ink-browser-test'}).ok
 for mode,path,trigger,view,full in [('graph','/index.html','#homeInkBtn','#stage','#canvasFullscreenBtn'),('workspace','/question-workspace.html?paperId=ink-paper&releaseId=ink-release','#qwInkBtn','#qwCanvasViewport','[data-uc-fullscreen]'),('recall','/knowledge-recall.html?questionId=ink-question-2&bankId=ink-bank&paperId=ink-paper&releaseId=ink-release','#krInkBtn','#krViewport','[data-uc-fullscreen]')]:
  page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto(base+path,wait_until='networkidle')
  for sel in ['#learningEntryDismissBtn','.tour-skip','#hideHelpBtn']:
   if page.locator(sel).is_visible():page.locator(sel).click()
  if mode=='graph':
   page.locator('.graph-mode-trigger').click();page.locator('[data-graph-mode-option="professional"]').click()
  expect(page.locator(trigger)).to_be_enabled();page.locator(full).click();page.wait_for_function('!!document.fullscreenElement')
  # The home surface is itself fullscreen; settings initially belongs to body.
  page.locator('[data-uc-canvas-settings]').click();settings=page.locator('.uc-settings-backdrop')
  expect(settings).to_be_visible();assert settings.evaluate('el=>document.fullscreenElement.contains(el)'),mode+': settings outside fullscreen surface'
  before=page.locator(view).evaluate("el=>getComputedStyle(el).getPropertyValue('--uc-canvas-bg')")
  settings.get_by_role('button',name='浅粉色',exact=True).click()
  page.evaluate('document.exitFullscreen()');page.wait_for_function('!document.fullscreenElement && document.querySelector(".uc-settings-backdrop")?.parentNode===document.body');expect(settings).to_be_visible();assert settings.evaluate('el=>el.parentNode===document.body')
  settings.get_by_role('button',name='取消',exact=True).click();expect(settings).to_be_hidden()
  assert page.locator(view).evaluate("el=>getComputedStyle(el).getPropertyValue('--uc-canvas-bg')")==before
  page.locator(full).click();page.wait_for_function('!!document.fullscreenElement')
  page.locator(trigger).click();toolbar=page.locator('.canvas-ink-toolbar');toolbar.locator('[data-ink-tool=eraser]').dblclick();toolbar.get_by_role('button',name='文字',exact=True).click()
  rect=page.locator(view).bounding_box();x=rect['x']+rect['width']*.72;y=rect['y']+rect['height']*.60;page.mouse.click(x,y)
  editor=page.get_by_role('textbox',name='画布文字内容');expect(editor).to_be_visible();assert editor.evaluate('el=>document.fullscreenElement.contains(el)');box=editor.bounding_box();assert abs(box['x']-x)<2 and abs(box['y']-y)<2
  editor.fill('全屏输入验证');editor.evaluate("el=>el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,isComposing:true,bubbles:true}))");expect(editor).to_have_value('全屏输入验证')
  editor.press('Control+Enter');expect(editor).to_have_count(0);expect(page.locator('.canvas-ink-layer text').filter(has_text='全屏输入验证').last).to_be_visible()
  page.mouse.click(x,y+100);editor.fill('保留到退出全屏');page.evaluate('document.exitFullscreen()');page.wait_for_function('!document.fullscreenElement && document.querySelector(".canvas-ink-text-editor")?.parentNode===document.body');expect(editor).to_have_value('保留到退出全屏');editor.press('Escape');expect(editor).to_have_count(0)
  # Re-entry uses one editor and real cancel, without accumulating DOM copies.
  page.locator(full).click();page.wait_for_function('!!document.fullscreenElement');page.mouse.click(x,y+160);expect(editor).to_have_count(1);editor.fill('取消');page.get_by_role('button',name='取消画布文字').click();expect(editor).to_have_count(0)
  page.screenshot(path=str(OUT/f'fullscreen-overlay-{mode}.png'));assert not errors,errors;print('PASS '+mode+': fullscreen overlay host/position, IME, save, exit restore, reopen/cancel',flush=True);page.close()
 b.close()
