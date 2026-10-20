"""Actual recall compact toolbar, shared picker and persisted ink regression."""
import argparse,json,re
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
p=argparse.ArgumentParser();p.add_argument('--base-url',required=True);p.add_argument('--output-dir',type=Path,required=True);a=p.parse_args();a.output_dir.mkdir(parents=True,exist_ok=True)
assert a.base_url.startswith('http://127.0.0.1:')
with sync_playwright() as pw:
 browser=pw.chromium.launch(channel='chrome');ctx=browser.new_context(viewport={'width':1440,'height':900})
 assert ctx.request.post(a.base_url+'/api/v1/auth/login',data={'username':'ink-browser','password':'ink-browser-test'}).ok
 page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 url=a.base_url+'/knowledge-recall.html?questionId=ink-question-1&bankId=ink-bank&paperId=ink-paper&releaseId=ink-release'
 page.goto(url,wait_until='networkidle');page.wait_for_function('!!window.KGRecallInk');page.locator('#krInkBtn').click();bar=page.locator('.canvas-ink-toolbar')
 expect(bar).to_have_class(re.compile(r'\bcanvas-ink-compact\b'))
 assert bar.locator('.canvas-tool-group,.canvas-tool-label').count()==0
 assert bar.locator('.canvas-ink-tools').evaluate('e=>[...e.children].indexOf(e.querySelector(".canvas-ink-colors"))<[...e.children].indexOf(e.querySelector("[data-ink-action=undo]"))')
 sizes=[]
 for width in [1840,1440,1024,390,320]:
  page.set_viewport_size({'width':width,'height':900});box=bar.bounding_box();assert box['x']>=0 and box['x']+box['width']<=width+1;assert box['height']<=80 and (width<700 or box['height']<=52),box;sizes.append({'width':width,'toolbar':box});page.screenshot(path=str(a.output_dir/('recall-'+str(width)+'.png')))
 page.set_viewport_size({'width':1440,'height':900})
 for tool in ['select','pen','highlighter','text','eraser','pen']:
  b=bar.locator('[data-ink-tool='+tool+']');b.click();expect(b).to_have_attribute('aria-pressed','true');assert b.get_attribute('title')
 custom=bar.locator('input[type=color]');custom.click();floating=page.locator('.graph-floating-color-window.show');expect(floating).to_be_visible();expect(floating.locator('[data-color-window-title]')).to_have_text('画笔自定义颜色');assert floating.locator('[data-color-picker-eyedropper] svg').count()==1
 floating.locator('[data-color-picker-hex]').fill('2468AC');floating.locator('[data-color-picker-hex]').press('Enter');floating.locator('[data-color-window-close]').click()
 page.mouse.move(180,410);page.mouse.down();page.mouse.move(270,440,steps=9);page.mouse.up();stroke=page.locator('.canvas-ink-layer path[data-stroke-id]').last;expect(stroke).to_have_attribute('stroke','#2468ac');sid=stroke.get_attribute('data-stroke-id')
 bar.locator('[data-ink-action=undo]').click();assert page.locator('[data-stroke-id="'+sid+'"]').count()==0;bar.locator('[data-ink-action=redo]').click();expect(page.locator('path[data-stroke-id="'+sid+'"]').first).to_have_attribute('stroke','#2468ac')
 page.evaluate('KGLearningProgress.flush("deep_recall",{throwOnError:true})')
 saved=ctx.request.get(a.base_url+'/api/v1/recall/session/ink-question-1?releaseId=ink-release');assert saved.ok,saved.text();data=saved.json();(a.output_dir/'saved.json').write_text(json.dumps(data));assert any(s.get('id')==sid and s.get('color')=='#2468ac' for s in data['progress']['strokes']),data
 page.reload(wait_until='networkidle');expect(page.locator('path[data-stroke-id="'+sid+'"]').first).to_have_attribute('stroke','#2468ac')
 page.locator('#krInkBtn').click();custom=page.locator('.canvas-ink-toolbar input[type=color]');custom.focus();custom.press('Enter');expect(floating).to_be_visible();floating.locator('[data-color-window-close]').click();custom.focus();custom.press('Space');expect(floating).to_be_visible()
 page.locator('.canvas-ink-toolbar [data-ink-tool=text]').click();expect(floating).to_have_count(0)
 # A lease from the shared ink provider cannot close a new singleton owner.
 assert page.evaluate('''()=>{const anchor=document.querySelector('.canvas-ink-toolbar input[type=color]');const lease=KGColorPickerV2.openInk({anchor,value:{color:'#123456'}});KGColorPickerV2.open({anchor,kind:'card-test',title:'接管色板'});const valid=!lease.isOpen();lease.close();const staysOpen=KGColorPickerV2.isOpen();KGColorPickerV2.close({force:true});return valid&&staysOpen}''')
 page.screenshot(path=str(a.output_dir/'recall-final.png'));assert not errors,errors
 (a.output_dir/'result.json').write_text(json.dumps({'status':'PASS','sizes':sizes,'strokeId':sid,'pageErrors':errors},indent=2));ctx.close();browser.close()
print('PASS recall compact geometry/icons/palette/shared picker/keyboard/history/API save/reload/singleton takeover')
