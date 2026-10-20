#!/usr/bin/env python3
"""Verify visible workspace tools with real drawing and shared history on desktop.
Run against the disposable canvas_ink_server.py; --source-overrides tests source without syncing.
"""
import argparse
import re
import json
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/uat-canvas-text-fixes'
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--base-url',required=True)
parser.add_argument('--source-overrides',action='store_true')
parser.add_argument('--output-dir',type=Path,default=OUT)
args=parser.parse_args()
assert urlparse(args.base_url).hostname in ('127.0.0.1','localhost')
OUT=args.output_dir.resolve()
OUT.mkdir(parents=True,exist_ok=True)

def override(route):
    relative=urlparse(route.request.url).path.lstrip('/')
    source=ROOT/'new-legacy'/relative
    if relative.startswith('bundles/'):
        name,ext=relative.rsplit('/',1)[1].rsplit('.',1)
        groups={g['name']:g for g in json.loads((ROOT/'frontend/scripts/homepage-bundles.json').read_text())['groups']}
        if name in groups:
            files=groups[name]['scripts' if ext=='js' else 'styles']
            bodies=[]
            for file in files:
                candidates=[ROOT/'new-legacy'/file,ROOT/'frontend/scripts/new-legacy-assets'/file,ROOT/'frontend/public/new-legacy'/file]
                bodies.append(next(path for path in candidates if path.is_file()).read_text())
            route.fulfill(body='\n;\n'.join(bodies),content_type='text/javascript' if ext=='js' else 'text/css')
        else:route.continue_()
    elif relative=='question-workspace.html':
        body=route.fetch().text()
        source_html=source.read_text()
        for id in ('qwUndoBtn','qwRedoBtn','qwInkBtn'):
            pattern=r'<button\b[^>]*\bid="'+id+r'"[^>]*>.*?</button>'
            button=re.search(pattern,source_html,re.S).group()
            body=re.sub(pattern,lambda _:button,body,flags=re.S)
        route.fulfill(body=body,content_type='text/html')
    elif source.is_file() and relative.endswith(('.js','.css')):
        route.fulfill(path=str(source))
    else:
        route.continue_()

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless=True)
    measurements=[]
    layout_failures=[]
    # Full real page: shared KGCanvasToolbar and every page stylesheet must load.
    # Mobile presentation is inspected programmatically because mobile editing is
    # intentionally readonly; its disabled launcher is checked below as well.
    for width in (1840,1440,1024,390,320):
        context=browser.new_context(viewport={'width':width,'height':900},has_touch=width<700)
        assert context.request.post(args.base_url+'/api/v1/auth/login',data={'username':'ink-browser','password':'ink-browser-test'}).ok
        if args.source_overrides:context.route('**/*',override)
        page=context.new_page()
        page.goto(args.base_url+'/question-workspace.html?paperId=ink-paper&releaseId=ink-release',wait_until='networkidle')
        page.wait_for_function('!!window.KGWorkspaceInk && !!window.KGCanvasToolbar')
        if width>700:page.locator('#qwInkBtn').click()
        else:
            expect(page.locator('#qwInkBtn')).to_be_disabled()
            page.evaluate('KGWorkspaceInk.setOpen(true)')
        toolbar=page.locator('.canvas-ink-toolbar')
        expect(toolbar).to_be_visible()
        measurement=toolbar.evaluate("""t=>{const tools=t.querySelector('.canvas-ink-tools'),palette=t.querySelector('.canvas-ink-colors');const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};return {viewport:innerWidth,toolbar:box(t),tools:box(tools),palette:box(palette),order:[...tools.children].map(e=>e.dataset.inkTool||e.dataset.inkAction||(e.hasAttribute('data-ink-settings')?'settings':e.hasAttribute('data-ink-close')?'close':e.className)),labels:[...tools.querySelectorAll('.canvas-tool-label')].filter(e=>getComputedStyle(e).display!=='none').map(e=>e.textContent),titles:[...tools.querySelectorAll('button')].map(e=>({title:e.title,ariaLabel:e.getAttribute('aria-label')}))}}""")
        measurement['topTools']=page.locator('#qwPointerModeBtn,#qwInkBtn,#qwCaptureBtn,#qwFontScaleBtn,#qwResetViewBtn,#qwUndoBtn,#qwRedoBtn').evaluate_all("es=>es.map(e=>({id:e.id,title:e.title,tooltip:e.dataset.tooltip,ariaLabel:e.getAttribute('aria-label'),visibleLabels:[...e.querySelectorAll('.canvas-tool-label')].filter(l=>getComputedStyle(l).display!=='none').map(l=>l.textContent)}))")
        measurement['themeOptions']=page.locator('#qwThemeSelect option').evaluate_all('es=>es.map(e=>({value:e.value,label:e.textContent}))')
        measurements.append(measurement)
        (OUT/'workspace-layout.json').write_text(json.dumps(measurements,ensure_ascii=False,indent=2))
        page.screenshot(path=str(OUT/f'workspace-layout-{width}.png'))
        toolbar.screenshot(path=str(OUT/f'workspace-toolbar-{width}.png'))
        failures_before=len(layout_failures)
        try:
            assert not measurement['labels'], 'Workspace drawing toolbar must hide labels: '+str(measurement)
            order=measurement['order']
            assert order.index('eraser')<order.index('canvas-ink-colors')<order.index('undo')<order.index('redo')<order.index('settings'),order
            assert measurement['toolbar']['x']>=0 and measurement['toolbar']['x']+measurement['toolbar']['width']<=width,measurement
            if width>700:
                assert measurement['toolbar']['height']==50,measurement
                assert measurement['toolbar']['width']==596,measurement
                assert abs(measurement['palette']['y']+measurement['palette']['height']/2-measurement['tools']['y']-measurement['tools']['height']/2)<1,measurement
            else:
                assert measurement['toolbar']['height']<=79,measurement
                expect(toolbar.locator('[data-ink-tool=pen]')).to_be_disabled()
            # Existing top toolbar structure/theme is preserved, icon labels alone disappear.
            for id in ('qwPointerModeBtn','qwInkBtn','qwCaptureBtn','qwFontScaleBtn','qwResetViewBtn','qwUndoBtn','qwRedoBtn'):
                button=page.locator('#'+id)
                assert button.get_attribute('title') or button.get_attribute('data-tooltip'),id
                assert button.get_attribute('aria-label'),id
                assert button.locator('.canvas-tool-label').evaluate_all("es=>es.every(e=>getComputedStyle(e).display==='none')"),id
            assert measurement['themeOptions']==[
                {'value':'platform','label':'平台默认'},{'value':'parchment','label':'羊皮纸'},
                {'value':'aurora','label':'极光绿'},{'value':'neon','label':'暗夜霓虹'},
                {'value':'sakura','label':'樱花粉'},{'value':'ocean','label':'海盐蓝'},{'value':'latte','label':'奶油拿铁'}]
            assert '智能整理' in page.locator('#qwSmartArrangeSelect').inner_text()
        except AssertionError as error:
            layout_failures.append(str(error))
        if width==1440:
            # Check the missing provider independently so RED records both requirements.
            color=toolbar.locator('input[type=color]')
            color.click()
            try:
                expect(page.locator('.graph-floating-color-window.show')).to_be_visible(timeout=1500)
                expect(page.locator('[data-color-window-title]')).to_have_text('画笔自定义颜色')
            except AssertionError as error:
                layout_failures.append(str(error))
            page.screenshot(path=str(OUT/'workspace-custom-color-open.png'))
        context.close()
        print(('FAIL' if len(layout_failures)>failures_before else 'PASS')+' layout '+str(width),flush=True)
    assert not layout_failures, '\n'.join(layout_failures)
    for name,width,touch in [('desktop',1440,False),('compact-desktop',1024,False)]:
        context=browser.new_context(viewport={'width':width,'height':1000},has_touch=touch,is_mobile=touch)
        login=context.request.post(args.base_url+'/api/v1/auth/login',data={'username':'ink-browser','password':'ink-browser-test'})
        assert login.ok
        if args.source_overrides:context.route('**/*',override)
        page=context.new_page()
        page.goto(args.base_url+'/question-workspace.html?paperId=ink-paper&releaseId=ink-release',wait_until='networkidle')
        page.wait_for_function('!!window.KGWorkspaceInk && !!window.KGMultiQuestionWorkspace')
        ink=page.locator('#qwInkBtn');undo=page.locator('#qwUndoBtn');redo=page.locator('#qwRedoBtn')
        expect(ink).to_be_visible();expect(undo).to_be_visible();expect(redo).to_be_visible()
        expect(ink).to_have_attribute('aria-label','画笔与文字工具')
        assert '画笔' in (ink.get_attribute('title') or ink.get_attribute('data-tooltip') or '')
        expect(ink.locator('svg')).to_have_count(1)
        assert page.evaluate('getComputedStyle(document.querySelector("#qwInkBtn"),"::after").content') in ('none','normal','""')
        page.locator('#qwQuestionDockBtn').click()
        page.locator('[data-add-index]').first.click()
        page.keyboard.press('Escape')
        page.evaluate('window.KGMultiQuestionWorkspace.closeQuestionDrawer()')
        expect(page.locator('.qw-question-card').first).to_be_visible()
        page.wait_for_timeout(500)
        # Pointer-mode re-presentation must keep labels hidden and preserve the
        # existing theme entry/option values and business-action text.
        theme_before=page.locator('.learning-theme-menu').evaluate('e=>({parent:e.parentElement.className,index:[...e.parentElement.children].indexOf(e),html:e.outerHTML})')
        for _ in range(2):
            page.locator('#qwPointerModeBtn').click()
            assert page.locator('#qwPointerModeBtn .canvas-tool-label').evaluate("e=>getComputedStyle(e).display==='none'")
        for _ in range(2):
            page.keyboard.press('v')
            assert page.locator('#qwPointerModeBtn .canvas-tool-label').evaluate("e=>getComputedStyle(e).display==='none'")
        assert page.locator('.learning-theme-menu').evaluate('e=>({parent:e.parentElement.className,index:[...e.parentElement.children].indexOf(e),html:e.outerHTML})')==theme_before
        assert '归纳卡' in page.locator('#qwNewSynthesisBtn').inner_text()
        page.locator('.learning-theme-menu>summary').click()
        expect(page.locator('[data-learning-theme-panel]')).to_be_visible()
        page.keyboard.press('Escape')
        expect(page.locator('[data-learning-theme-panel]')).to_be_hidden()
        ink.click()
        toolbar=page.locator('.canvas-ink-toolbar')
        for tool in ('pen','highlighter','eraser','text'):
            toolbar.locator('[data-ink-tool='+tool+']').click()
            expect(toolbar.locator('[data-ink-tool='+tool+']')).to_have_attribute('aria-pressed','true')
        for tool in ('select','pen','highlighter','text','eraser'):
            button=toolbar.locator('[data-ink-tool='+tool+']')
            button.focus();page.keyboard.press('Enter')
            expect(button).to_have_attribute('aria-pressed','true')
        toolbar.locator('[data-ink-tool=pen]').click()
        custom=toolbar.locator('input[type=color]')
        floating=page.locator('.graph-floating-color-window.show')
        custom.click()
        expect(floating).to_be_visible()
        expect(floating.locator('[data-color-window-title]')).to_have_text('画笔自定义颜色')
        expect(page.locator('.graph-floating-color-window')).to_have_count(1)
        for selector in ('[data-color-picker-sv]','[data-color-picker-hue]','[data-color-picker-hex]','[data-color-picker-presets]'):
            expect(floating.locator(selector)).to_be_visible()
        expect(floating.locator('[data-color-picker-alpha]')).to_have_count(0)
        pipette=floating.locator('[data-color-picker-eyedropper]')
        expect(pipette).to_have_attribute('title','吸取屏幕颜色')
        expect(pipette).to_have_attribute('aria-label','吸取屏幕颜色')
        expect(pipette.locator('svg path')).to_have_count(1)
        assert pipette.evaluate('e=>e.hidden')==page.evaluate('!window.EyeDropper')
        floating.locator('[data-color-picker-presets] [data-picker-swatch="#ef4444"]').click()
        expect(custom).to_have_value('#ef4444')
        floating.hover();expect(floating).to_be_visible()
        hex=floating.locator('[data-color-picker-hex]')
        hex.fill('123456');hex.press('Enter');expect(custom).to_have_value('#123456')
        hex.fill('oops');hex.press('Enter');expect(custom).to_have_value('#123456')
        expect(hex).to_have_value('123456')
        # Finish HEX's browser blur/change before starting a separate uncommitted preview.
        custom.focus()
        # A preview without the range change/commit event is discarded on close.
        floating.locator('[data-color-picker-hue]').evaluate("e=>{e.value='120';e.dispatchEvent(new Event('input',{bubbles:true}))}")
        floating.locator('[data-color-window-close]').click();expect(floating).to_have_count(0)
        expect(custom).to_have_value('#123456')
        for key in ('Enter','Space'):
            custom.focus();page.keyboard.press(key);expect(floating).to_be_visible()
            expect(floating.locator('[data-color-picker-hex]')).to_have_value('123456')
            expect(floating.locator('[data-color-picker-recent] [data-picker-swatch="#123456"]')).to_be_visible()
            floating.locator('[data-color-window-close]').click()
        custom.click()
        header=floating.locator('[data-color-window-drag]')
        rect=header.bounding_box();page.mouse.move(rect['x']+80,rect['y']+15);page.mouse.down();page.mouse.move(220,100,steps=8);page.mouse.up()
        expect(floating).to_have_class(re.compile('manual-close'))
        # SV keyboard operation commits through the existing controller.
        sv=floating.locator('[data-color-picker-sv]');sv.focus();page.keyboard.press('ArrowRight')
        assert custom.input_value()!='#123456'
        committed=custom.input_value()
        rect=sv.bounding_box();page.mouse.move(rect['x']+30,rect['y']+30);page.mouse.down()
        sv.evaluate("e=>e.dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,bubbles:true}))")
        page.mouse.up();expect(custom).to_have_value(committed)
        floating.locator('[data-color-picker-hex]').fill('123456');floating.locator('[data-color-picker-hex]').press('Enter')
        page.screenshot(path=str(OUT/f'workspace-picker-{name}.png'))
        floating.locator('[data-color-window-close]').click()
        # Fullscreen uses the common overlay mount; the same singleton must move inside it.
        page.locator('#qwCanvasShell').evaluate('e=>e.requestFullscreen()')
        custom.click();expect(floating).to_be_visible()
        assert floating.evaluate('e=>document.fullscreenElement.contains(e)')
        floating.locator('[data-color-window-close]').click();page.evaluate('document.exitFullscreen()')
        # Fine-pointer narrow viewport remains desktop policy; coarse mobile is
        # separately verified readonly in the layout loop above.
        for narrow in (390,320):
            page.set_viewport_size({'width':narrow,'height':1000});custom.click();expect(floating).to_be_visible()
            page.wait_for_function("()=>{const r=document.querySelector('.graph-floating-color-window.show').getBoundingClientRect();return r.x>=0&&r.right<=innerWidth&&r.y>=0&&r.bottom<=innerHeight}")
            bounds=floating.bounding_box()
            assert bounds['x']>=0 and bounds['x']+bounds['width']<=narrow and bounds['y']>=0 and bounds['y']+bounds['height']<=1000,bounds
            page.screenshot(path=str(OUT/f'workspace-picker-fine-pointer-{name}-{narrow}.png'))
            floating.locator('[data-color-window-close]').click()
        page.set_viewport_size({'width':width,'height':1000})
        expect(toolbar.locator('[data-ink-tool=pen] svg')).to_have_css('color','rgb(18, 52, 86)')
        assert page.evaluate("[...document.head.querySelectorAll('style')].some(e=>e.textContent.includes('%23123456'))")
        settings=toolbar.locator('[data-ink-settings]')
        settings.focus();page.keyboard.press('Enter')
        expect(toolbar.locator('.canvas-ink-options')).to_be_visible()
        settings.click();expect(toolbar.locator('.canvas-ink-options')).to_be_hidden()
        toolbar.locator('[data-ink-close]').focus();page.keyboard.press('Enter')
        expect(toolbar).to_be_hidden();ink.click();expect(toolbar).to_be_visible()
        expect(toolbar.locator('[data-ink-action=undo]')).to_be_visible()
        expect(toolbar.locator('[data-ink-action=redo]')).to_be_visible()
        n=page.locator('.canvas-ink-layer path').count()
        existing_text_count=page.locator('.canvas-ink-layer text').count()
        box=page.locator('.qw-question-card').first.bounding_box()
        x=box['x']+min(55,box['width']/5);y=box['y']+min(100,box['height']/2)
        page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+50,y+30,steps=10);page.mouse.up()
        expect(page.locator('.canvas-ink-layer path')).to_have_count(n+1)
        expect(page.locator('.canvas-ink-layer path').last).to_have_attribute('stroke','#123456')
        expect(undo).to_be_enabled();undo.click();expect(page.locator('.canvas-ink-layer path')).to_have_count(n)
        expect(redo).to_be_enabled();redo.click();expect(page.locator('.canvas-ink-layer path')).to_have_count(n+1)
        toolbar.locator('[data-ink-action=undo]').click();expect(page.locator('.canvas-ink-layer path')).to_have_count(n)
        toolbar.locator('[data-ink-action=redo]').click();expect(page.locator('.canvas-ink-layer path')).to_have_count(n+1)
        toolbar.locator('[data-ink-tool=highlighter]').click()
        custom.click();floating.locator('[data-color-picker-hex]').fill('654321');floating.locator('[data-color-picker-hex]').press('Enter');floating.locator('[data-color-window-close]').click()
        page.mouse.move(x,y+40);page.mouse.down();page.mouse.move(x+50,y+60,steps=10);page.mouse.up()
        expect(page.locator('.canvas-ink-layer path')).to_have_count(n+2)
        expect(page.locator('.canvas-ink-layer path').last).to_have_attribute('opacity','0.3')
        expect(page.locator('.canvas-ink-layer path').last).to_have_attribute('stroke','#654321')
        toolbar.locator('[data-ink-tool=eraser]').dblclick()
        expect(page.locator('.canvas-ink-layer path')).to_have_count(0)
        toolbar.locator('[data-ink-action=undo]').click()
        expect(page.locator('.canvas-ink-layer path')).to_have_count(n+2)
        page.keyboard.press('Control+Shift+z');expect(page.locator('.canvas-ink-layer path')).to_have_count(0)
        page.keyboard.press('Control+z');expect(page.locator('.canvas-ink-layer path')).to_have_count(n+2)
        toolbar.locator('[data-ink-tool=pen]').click()
        page.evaluate('KGCanvasWorkspaceAdapter.flush({throwOnError:true})')
        active=page.evaluate('KGMultiQuestionWorkspace.activeWorkspaceId()')
        saved=context.request.get(args.base_url+'/api/v1/workspaces/'+active)
        assert saved.ok,saved.text()
        expected_strokes=saved.json()['workspace']['payload']['strokes']
        assert len(expected_strokes)==n+2+existing_text_count
        page.reload(wait_until='networkidle')
        expect(page.locator('.canvas-ink-layer path')).to_have_count(n+2)
        assert page.evaluate('KGMultiQuestionWorkspace.activeWorkspace().strokes')==expected_strokes
        page.locator('#qwInkBtn').click()
        toolbar=page.locator('.canvas-ink-toolbar');custom=toolbar.locator('input[type=color]')
        # Reformat the selected existing pen, preserving the shared selection semantics.
        toolbar.locator('[data-ink-tool=select]').click()
        stroke=page.locator('.canvas-ink-layer path').first
        rect=stroke.bounding_box();page.mouse.click(rect['x']+rect['width']/2,rect['y']+rect['height']/2)
        expect(custom).to_be_enabled()
        stroke_id=stroke.get_attribute('data-stroke-id')
        custom.click();floating.locator('[data-color-picker-hex]').fill('2468ac');floating.locator('[data-color-picker-hex]').press('Enter');floating.locator('[data-color-window-close]').click()
        expect(page.locator('[data-stroke-id="'+stroke_id+'"]')).to_have_attribute('stroke','#2468ac')
        # Text draft stays editable while interacting with this same shared overlay.
        toolbar.locator('[data-ink-tool=text]').click()
        blank=page.evaluate("""()=>{const view=document.querySelector('#qwCanvasViewport'),r=view.getBoundingClientRect();for(let y=r.top+100;y<r.bottom-150;y+=65)for(let x=r.left+100;x<r.right-100;x+=65){const el=document.elementFromPoint(x,y);if(el===view||el?.classList.contains('qw-background')||el?.classList.contains('qw-world'))return {x,y}}throw Error('No blank canvas point')}""")
        page.mouse.click(blank['x'],blank['y'])
        editor=page.locator('.canvas-ink-text-editor');expect(editor).to_be_visible();editor.fill('共享色板文字')
        custom.click();floating.locator('[data-color-picker-hex]').fill('8844cc');floating.locator('[data-color-picker-hex]').press('Enter')
        expect(editor).to_have_css('color','rgb(136, 68, 204)')
        floating.locator('[data-color-window-close]').click()
        expect(editor).to_be_visible();editor.focus();editor.press('Control+Enter');expect(editor).to_have_count(0)
        text=page.locator('.canvas-ink-layer text').last
        expect(text).to_have_attribute('fill','#8844cc')
        # Selected text formatting uses the exact same existing updateTextStyle path.
        rect=text.bounding_box();page.mouse.click(rect['x']+5,rect['y']+5)
        custom.click();floating.locator('[data-color-picker-presets] [data-picker-swatch="#22c55e"]').click();floating.locator('[data-color-window-close]').click()
        expect(text).to_have_attribute('fill','#22c55e')
        page.evaluate('KGCanvasWorkspaceAdapter.flush({throwOnError:true})')
        persisted=context.request.get(args.base_url+'/api/v1/workspaces/'+active).json()['workspace']['payload']['strokes']
        assert next(s for s in persisted if s['id']==stroke_id)['color']=='#2468ac'
        assert persisted[-1]['tool']=='text' and persisted[-1]['color']=='#22c55e'
        assert all(s.get('color')!='#8844cc' for s in persisted)
        page.reload(wait_until='networkidle')
        assert page.evaluate('KGMultiQuestionWorkspace.activeWorkspace().strokes')==persisted
        expect(page.locator('.canvas-ink-layer text').last).to_have_attribute('fill','#22c55e')
        # Existing card entry still uses the singleton, with its own target.
        page.locator('#qwQuestionDockBtn').click()
        page.locator('[data-add-index]').last.click()
        page.keyboard.press('Escape');page.evaluate('KGMultiQuestionWorkspace.closeQuestionDrawer()')
        # Existing color toolbar is intentionally visible only for multi-card selection.
        page.evaluate('KGMultiQuestionWorkspace.selectNodes(Object.keys(KGMultiQuestionWorkspace.activeWorkspace().nodes))')
        card_color=page.locator('[data-qw-selection-action=color]')
        card_color.click();expect(floating.locator('[data-color-window-title]')).to_have_text('卡牌或分组颜色')
        floating.locator('[data-color-picker-presets] [data-picker-swatch="#f97316"]').click()
        floating.locator('[data-color-window-close]').click()
        assert page.evaluate("Object.values(KGMultiQuestionWorkspace.activeWorkspace().nodes).some(n=>n.color==='#f97316')")
        assert page.evaluate('KGMultiQuestionWorkspace.activeWorkspace().strokes')==persisted
        page.locator('#qwInkBtn').click()
        page.locator('.canvas-ink-toolbar [data-ink-tool=pen]').hover()
        page.screenshot(path=str(OUT/f'workspace-tools-{name}.png'))
        print('PASS '+name+': mouse/Enter/Space shared picker, HEX/presets/recent/SV/cancel/drag/fullscreen/narrow fine-pointer, pen/highlighter and selected pen/text, real API save/reload, card color, history/theme/layout',flush=True)
        context.close()
    # Actual viewer context and authoritative API, without permission-response mocks.
    viewer=browser.new_context(viewport={'width':1440,'height':900})
    assert viewer.request.post(args.base_url+'/api/v1/auth/login',data={'username':'ink-viewer','password':'ink-browser-test'}).ok
    if args.source_overrides:viewer.route('**/*',override)
    page=viewer.new_page()
    page.goto(args.base_url+'/question-workspace.html?paperId=ink-paper&releaseId=ink-release&workspace=viewer-workspace',wait_until='networkidle')
    expect(page.locator('.canvas-ink-layer path')).to_have_count(1)
    expect(page.locator('#qwInkBtn')).to_be_disabled()
    page.evaluate('KGWorkspaceInk.setOpen(true)')
    for selector in ('[data-ink-tool=pen]','[data-ink-tool=highlighter]','[data-ink-tool=text]','[data-ink-tool=eraser]','[data-ink-action=undo]','[data-ink-action=redo]'):
        expect(page.locator('.canvas-ink-toolbar '+selector)).to_be_disabled()
    page.locator('.canvas-ink-toolbar input[type=color]').evaluate("e=>e.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}))")
    expect(page.locator('.graph-floating-color-window.show')).to_have_count(0)
    page.mouse.move(650,430);page.mouse.down();page.mouse.move(750,460,steps=8);page.mouse.up()
    expect(page.locator('.canvas-ink-layer path')).to_have_count(1)
    assert viewer.request.put(args.base_url+'/api/v1/workspaces/viewer-workspace',data={'payload':{'strokes':[]}}).status==403
    page.screenshot(path=str(OUT/'workspace-viewer-readonly.png'))
    viewer.close();print('PASS viewer: existing ink retained, edit/history disabled, API403',flush=True)

    context=browser.new_context(viewport={'width':1440,'height':1000})
    assert context.request.post(args.base_url+'/api/v1/auth/login',data={'username':'ink-browser','password':'ink-browser-test'}).ok
    if args.source_overrides:context.route('**/*',override)
    page=context.new_page()
    page.goto(args.base_url+'/knowledge-recall.html?questionId=ink-question-1&bankId=ink-bank&paperId=ink-paper&releaseId=ink-release',wait_until='networkidle')
    page.wait_for_function('!!KGRecallInk')
    page.locator('#krInkBtn').click()
    def default_tools(toolbar,name):
        expect(toolbar).to_be_visible()
        assert toolbar.locator('.canvas-tool-group').count()==4
        assert toolbar.locator('.canvas-tool-label').evaluate_all("es=>es.length===9&&es.every(e=>getComputedStyle(e).display!=='none')")
        for tool in ('pen','highlighter','text','eraser','select','pen'):
            button=toolbar.locator('[data-ink-tool='+tool+']');button.click()
            expect(button).to_have_attribute('aria-pressed','true')
            assert button.locator('svg').evaluate('e=>{const r=e.getBoundingClientRect();return r.width>=16&&r.height>=16&&getComputedStyle(e).stroke!=="none"}')
        assert toolbar.locator('input[type=color]').evaluate("e=>e.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}))"), 'Default caller retains native activation'
        expect(page.locator('.graph-floating-color-window.show')).to_have_count(0)
        toolbar.locator('[data-ink-settings]').click()
        expect(toolbar.locator('.canvas-ink-options')).to_be_visible()
        page.screenshot(path=str(OUT/(name+'-default-tools.png')))
        toolbar.locator('[data-ink-close]').click();expect(toolbar).to_be_hidden()
        print('PASS '+name+': default groups/labels, visible icons, tool states, settings and close',flush=True)
    default_tools(page.locator('.canvas-ink-toolbar'),'recall')
    response=context.request.post(args.base_url+'/api/v1/files',data={'name':'Task5 caller regression','graphData':{'nodes':[{'id':'task5-node','title':'Task5 caller node','x':400,'y':300}],'links':[],'strokes':[]}})
    assert response.ok,response.text()
    fid=response.json()['file']['id']
    assert context.request.put(args.base_url+'/api/v1/files/current',data={'fileId':fid}).ok
    page.goto(args.base_url+'/index.html',wait_until='networkidle')
    for selector in ('#learningEntryDismissBtn','.tour-skip','#hideHelpBtn'):
        if page.locator(selector).is_visible():page.locator(selector).click()
    page.wait_for_function('!!window.KGHomeInk')
    page.evaluate('KGHomeInteractionModes.setMode("professional")')
    page.wait_for_function('!KGGraphFileTabs.isSwitching()')
    page.locator('#homeInkBtn').click()
    default_tools(page.locator('.canvas-ink-toolbar'),'home')
    page.evaluate('()=>{selectedNodeIds=new Set(["task5-node"]);state.selectedNodeId="task5-node";refreshSelectionUI()}')
    assert page.evaluate('openRelatedCanvasModal(false)')
    modal=page.locator('.related-canvas-backdrop')
    modal.locator('[data-action=ink]').click()
    default_tools(modal.locator('.canvas-ink-toolbar'),'related')
    modal.locator('[data-action=close]').click()
    assert context.request.get(args.base_url+'/api/v1/files/'+fid).json()['graphData']['strokes']==[]
    context.close()
    browser.close()
