#!/usr/bin/env python3
"""Three actual pages: blur text saves, failure retains input, resize and reload."""
import argparse,uuid,math
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'artifacts/canvas-m2-m5/t09';OUT.mkdir(parents=True,exist_ok=True)
a=argparse.ArgumentParser();a.add_argument('--base-url',required=True);BASE=a.parse_args().base_url.rstrip('/')
assert urlparse(BASE).hostname in ('localhost','127.0.0.1')
with sync_playwright() as p:
    b=p.chromium.launch(channel='chrome');c=b.new_context(viewport={'width':1440,'height':1000})
    assert c.request.post(BASE+'/api/v1/auth/login',data={'username':'ink-browser','password':'ink-browser-test'}).ok
    r=c.request.post(BASE+'/api/v1/files',data={'name':'文本'+uuid.uuid4().hex[:8],'graphData':{'nodes':[],'links':[],'strokes':[]}});assert r.ok;file_id=r.json()['file']['id']
    assert c.request.put(BASE+'/api/v1/files/current',data={'fileId':file_id}).ok
    modes=[('home','/index.html','#homeInkBtn'),('recall','/knowledge-recall.html?questionId=ink-question-1&bankId=ink-bank&paperId=ink-paper&releaseId=ink-release','#krInkBtn'),('workspace','/question-workspace.html?paperId=ink-paper&releaseId=ink-release','#qwInkBtn')]
    for mode,path,trigger in modes:
        page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto(BASE+path,wait_until='networkidle')
        if mode=='home':
            for sel in ['#learningEntryDismissBtn','.tour-skip','#hideHelpBtn']:
                if page.locator(sel).is_visible():page.locator(sel).click()
            page.locator('.graph-mode-trigger').click();page.locator('[data-graph-mode-option="professional"]').click()
        expect(page.locator(trigger)).to_be_enabled();page.wait_for_timeout(600)
        # Pointer traversal while drawing must not animate red outlines or card shadows.
        if mode!='home':
            controller='KGRecallInk' if mode=='recall' else 'KGWorkspaceInk'
            card=page.locator('#krQuestionCard' if mode=='recall' else '.qw-question-card').first
            if mode=='workspace' and not card.count():
                page.locator('#qwQuestionDockBtn').click();page.locator('[data-add-index]').first.click();page.keyboard.press('Escape');page.evaluate('KGMultiQuestionWorkspace.closeQuestionDrawer()')
            page.evaluate(controller+'.setTool("pen")');page.mouse.move(1400,950);page.wait_for_timeout(250)
            decoration='el=>({shadow:getComputedStyle(el).boxShadow,outline:getComputedStyle(el).outline})'
            before_hover=card.evaluate(decoration);card.hover();page.wait_for_timeout(250)
            assert card.evaluate(decoration)==before_hover,(mode,before_hover,card.evaluate(decoration))
            page.evaluate(controller+'.setTool("select")')
        page.locator(trigger).click();toolbar=page.locator('.canvas-ink-toolbar');toolbar.get_by_role('button',name='橡皮擦',exact=True).dblclick();toolbar.get_by_role('button',name='文字',exact=True).click()
        expect(toolbar.get_by_role('slider',name='文字字号')).to_have_count(0);expect(page.get_by_role('button',name='保存画布文字')).to_have_count(0)
        page.mouse.click(230,280);editor=page.get_by_role('textbox',name='画布文字内容');expect(editor).to_be_visible()
        editor.fill('短文字');short=editor.bounding_box()['height'];editor.fill('一\n二\n三\n四\n');assert editor.bounding_box()['height']>short*2
        editor.fill('短文字');assert abs(editor.bounding_box()['height']-short)<1
        editor.evaluate('el=>el.setSelectionRange(1,2)');border=page.locator('[data-ink-edit-drag=top]');edge=border.bounding_box();origin=editor.bounding_box()
        page.mouse.move(edge['x']+20,edge['y']+3);page.mouse.down();page.mouse.move(edge['x']+50,edge['y']+23,steps=5);page.mouse.up()
        expect(editor).to_be_focused();assert editor.evaluate('el=>[el.selectionStart,el.selectionEnd]')==[1,2]
        assert abs(editor.bounding_box()['x']-origin['x']-30)<1
        editor.fill('画布文字回归\n第二行')
        toolbar.get_by_role('button',name='红色',exact=True).click();toolbar.get_by_role('button',name='文字加粗',exact=True).click();expect(editor).to_have_value('画布文字回归\n第二行')
        # Native deletion and IME remain inside editor, including outside clicks while composing.
        editor.press('End');editor.press('Backspace');editor.type('行');expect(editor).to_have_value('画布文字回归\n第二行')
        editor.evaluate("el=>el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}))");page.mouse.click(1050,350);expect(editor).to_be_visible()
        editor.evaluate("el=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}))");expect(editor).to_have_count(0)
        text=page.locator('.canvas-ink-layer text').filter(has_text='画布文字回归');expect(text).to_be_visible();expect(text).to_have_attribute('font-weight','700');expect(text).to_have_attribute('fill','#ef4444')
        text.click(position={'x':8,'y':8},force=True);handle=page.locator('[data-ink-resize-handle=e]');expect(handle).to_be_visible()
        # Read authoritative frame/scale; real drag, one undo, redo restores dimensions/font.
        before_font=float(text.get_attribute('font-size'));start=handle.bounding_box();left=page.locator('[data-ink-resize-handle=w]').bounding_box();width_screen=start['x']-left['x'];delta=width_screen*.5
        page.mouse.move(start['x']+start['width']/2,start['y']+start['height']/2);page.mouse.down();page.mouse.move(start['x']+start['width']/2+delta,start['y']+start['height']/2,steps=8);page.mouse.up()
        after_font=float(text.get_attribute('font-size'));assert abs(after_font-before_font*math.sqrt(1.5))<.2,(before_font,after_font)
        toolbar.locator('[data-ink-action=undo]').click();assert abs(float(text.get_attribute('font-size'))-before_font)<.05
        toolbar.locator('[data-ink-action=redo]').click();assert abs(float(text.get_attribute('font-size'))-after_font)<.05
        # Outside commit fails at the actual server boundary, retains textarea, then retries.
        box=text.bounding_box();page.mouse.dblclick(box['x']+8,box['y']+8);expect(editor).to_be_visible();editor.fill('保留失败草稿 mixed 中文长句自动换行\n第二行')
        def fail_write(route):
            if route.request.method in ('POST','PUT','PATCH','DELETE'):route.fulfill(status=503,content_type='application/json',body='{"detail":"offline"}')
            else:route.continue_()
        page.route('**/api/v1/**',fail_write);page.mouse.click(1050,350);expect(editor).to_have_attribute('data-save-state','failed');expect(editor).to_have_value('保留失败草稿 mixed 中文长句自动换行\n第二行')
        page.unroute('**/api/v1/**',fail_write);page.mouse.click(1050,350);expect(editor).to_have_count(0)
        if mode=='home':strokes=c.request.get(BASE+'/api/v1/files/'+file_id).json()['graphData']['strokes']
        elif mode=='recall':strokes=c.request.get(BASE+'/api/v1/recall/session/ink-question-1?releaseId=ink-release').json()['progress']['strokes']
        else:
            data=c.request.get(BASE+'/api/v1/workspaces').json();strokes=next(w['payload']['strokes'] for w in data['workspaces'] if w['payload'].get('id')=='pmp-pattern-workspace')
        stroke=next(s for s in strokes if s.get('text','').startswith('保留失败草稿'));assert stroke['bold'] and stroke['color']=='#ef4444';assert stroke['boxWidth']>=40 and stroke['boxHeight']>=24 and abs(stroke['width']-after_font)<.05
        line_count=page.locator('.canvas-ink-layer text[data-stroke-id="'+stroke['id']+'"] tspan').count();assert line_count>2
        page.reload(wait_until='networkidle');
        if mode=='home':
            for sel in ['#learningEntryDismissBtn','.tour-skip','#hideHelpBtn']:
                if page.locator(sel).is_visible():page.locator(sel).click()
        text=page.locator('.canvas-ink-layer text[data-stroke-id="'+stroke['id']+'"]');expect(text).to_be_visible();assert abs(float(text.get_attribute('font-size'))-stroke['width'])<.05;expect(text.locator('tspan')).to_have_count(line_count)
        page.wait_for_timeout(700)
        # Existing empty text stays as an undoable object and survives persistence.
        page.locator(trigger).click();toolbar.get_by_role('button',name='文字',exact=True).click();box=text.bounding_box();page.mouse.dblclick(box['x']+8,box['y']+8);expect(editor).to_be_visible();editor.fill('');page.mouse.click(1050,350);expect(editor).to_have_count(0);expect(text).to_have_count(1)
        toolbar.locator('[data-ink-action=undo]').click();expect(text).to_contain_text('保留失败草稿')
        assert text.evaluate('el=>getComputedStyle(el).filter')=='none';page.screenshot(path=str(OUT/f'text-persisted-{mode}.png'))
        controller={'home':'KGHomeInk','recall':'KGRecallInk','workspace':'KGWorkspaceInk'}[mode];page.evaluate(controller+".setTool('select')");page.mouse.click(1050,450);page.screenshot(path=str(OUT/f'text-unselected-{mode}.png'))
        box=text.bounding_box();page.mouse.dblclick(box['x']+8,box['y']+8);expect(editor).to_be_visible();page.screenshot(path=str(OUT/f'text-editing-{mode}.png'));editor.press('Escape')
        assert not errors,errors;print('PASS '+mode+': external/IME commit, formatting/native delete, area resize, one-step undo/redo, failed remote retention/retry, DB/reload/wrapping, empty undo',flush=True);page.close()
    b.close()
