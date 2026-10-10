#!/usr/bin/env python3
"""Real-page text edit/drag/style/history persists via disposable backend APIs."""
import argparse,json
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'artifacts/uat-canvas-text-fixes';OUT.mkdir(parents=True,exist_ok=True)
a=argparse.ArgumentParser();a.add_argument('--base-url',required=True);args=a.parse_args();BASE=args.base_url.rstrip('/')
assert urlparse(BASE).hostname in ('localhost','127.0.0.1'), 'Requires disposable canvas_ink_server.py'
with sync_playwright() as p:
    b=p.chromium.launch();c=b.new_context(viewport={'width':1440,'height':1000})
    assert c.request.post(BASE+'/api/v1/auth/login',data={'username':'ink-browser','password':'ink-browser-test'}).ok
    for mode,path,trigger in [('recall','/knowledge-recall.html?questionId=ink-question-1&bankId=ink-bank&paperId=ink-paper&releaseId=ink-release','#krInkBtn'),('workspace','/question-workspace.html?paperId=ink-paper&releaseId=ink-release','#qwInkBtn')]:
        page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto(BASE+path,wait_until='networkidle');expect(page.locator(trigger)).to_be_enabled();page.wait_for_timeout(600)
        page.locator(trigger).click();toolbar=page.locator('.canvas-ink-toolbar');toolbar.get_by_role('button',name='文字',exact=True).click();expect(toolbar.locator('.canvas-ink-options')).to_be_visible()
        page.mouse.click(230,280);editor=page.get_by_role('textbox',name='画布文字内容');expect(editor).to_be_visible();editor.fill('画布文字回归');editor.press('End');editor.press('Enter');editor.type('第二行')
        expect(editor).to_have_value('画布文字回归\n第二行')
        toolbar.get_by_role('button',name='红色',exact=True).click();toolbar.get_by_role('button',name='文字加粗',exact=True).click();toolbar.get_by_role('slider',name='文字字号').fill('28');expect(editor).to_have_value('画布文字回归\n第二行');page.get_by_role('button',name='保存画布文字').click();expect(editor).to_have_count(0)
        text=page.locator('.canvas-ink-layer text').filter(has_text='画布文字回归');expect(text).to_be_visible();expect(text).to_have_attribute('font-weight','700');expect(text).to_have_attribute('fill','#ef4444');expect(text.locator('tspan')).to_have_count(2)
        box=text.bounding_box();page.mouse.move(box['x']+8,box['y']+8);page.mouse.down();page.mouse.move(box['x']+78,box['y']+48,steps=10);page.mouse.up();moved=text.bounding_box();assert abs(moved['x']-box['x']-70)<2 and abs(moved['y']-box['y']-40)<2,(box,moved)
        toolbar.locator('[data-ink-action=undo]').click();undo=text.bounding_box();assert abs(undo['x']-box['x'])<2 and abs(undo['y']-box['y'])<2
        toolbar.locator('[data-ink-action=redo]').click();moved=text.bounding_box();assert abs(moved['x']-box['x']-70)<2
        if mode=='recall':
            page.evaluate("KGLearningProgress.flush('deep_recall')");page.wait_for_function("document.querySelector('#krSaveStatus')?.dataset.state==='saved'")
            response=c.request.get(BASE+'/api/v1/recall/session/ink-question-1?releaseId=ink-release');strokes=response.json()['progress']['strokes']
        else:
            page.evaluate('KGCanvasWorkspaceAdapter.flush()');data=c.request.get(BASE+'/api/v1/workspaces').json();strokes=next(w['payload']['strokes'] for w in data['workspaces'] if w['payload'].get('id')=='pmp-pattern-workspace')
        stroke=next(s for s in strokes if s.get('text')=='画布文字回归\n第二行');assert stroke['bold'] is True and stroke['color']=='#ef4444' and stroke['width']==28,stroke
        page.reload(wait_until='networkidle');text=page.locator('.canvas-ink-layer text[data-stroke-id="'+stroke['id']+'"]');expect(text).to_be_visible();expect(text).to_have_attribute('font-weight','700');expect(text).to_have_attribute('fill','#ef4444');expect(text.locator('tspan')).to_have_count(2)
        assert float(text.get_attribute('x'))==stroke['points'][0][0] and float(text.get_attribute('y'))==stroke['points'][0][1]
        # Edit existing text, cancel, then save a real change and ensure history can undo it.
        page.locator(trigger).click();toolbar.get_by_role('button',name='文字',exact=True).click();box=text.bounding_box();page.mouse.dblclick(box['x']+8,box['y']+8);expect(editor).to_be_visible();editor.fill('取消内容');editor.press('Escape');expect(text.locator('tspan').first).to_have_text('画布文字回归')
        page.mouse.dblclick(box['x']+8,box['y']+8);editor.fill('已编辑\n保留换行');editor.press('Control+Enter');expect(text.locator('tspan').first).to_have_text('已编辑');toolbar.locator('[data-ink-action=undo]').click();expect(text.locator('tspan').first).to_have_text('画布文字回归')
        page.screenshot(path=str(OUT/f'text-persisted-{mode}.png'));assert not errors,errors;print('PASS '+mode+': multiline, drag, formatting, UI undo/redo, DB persistence, reload, edit/cancel',flush=True);page.close()
    b.close()
