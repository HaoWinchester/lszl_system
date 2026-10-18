"""Source-only Chromium regressions for common ink transactions and natural text."""
import sys,argparse,json,uuid,traceback,re
from urllib.parse import urlparse
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[1]
BASE={'id':'p','tool':'pen','color':'#2563eb','width':3,'points':[[100,100],[200,100]]}
def setup(browser, strokes=None):
    page=browser.new_page(viewport={'width':1100,'height':800})
    page.set_content('<style>body{margin:0}#view{position:relative;width:1050px;height:700px}#world{position:absolute;transform-origin:0 0}</style><div id="view"><div id="world"><button id="card" style="position:absolute;left:600px;top:100px">card</button></div></div>')
    page.add_style_tag(content=(ROOT/'styles/canvas-ink.css').read_text())
    for name in ['83-canvas-history-controller.js','text-box-geometry.js','text-edit-session.js','94-canvas-ink.js']:
        page.add_script_tag(content=(ROOT/'src/canvas'/name).read_text())
    page.evaluate('''strokes=>{window.strokes=strokes;window.locked=false;window.writes=0;window.errors=[];window.cardClicks=0;document.querySelector('#card').onclick=()=>cardClicks++;window.ink=KGCanvasInk.create({viewport:document.querySelector('#view'),world:document.querySelector('#world'),getViewport:()=>({x:0,y:0,scale:1}),getStrokes:()=>window.strokes,setStrokes:s=>{window.strokes=s;writes++},isReadonly:()=>locked,onError:e=>errors.push(e)});}''',strokes or [])
    return page
def eraser(browser):
    originals=[BASE,{**BASE,'id':'h','tool':'highlighter','width':16,'points':[[100,200],[200,200]]}]
    page=setup(browser,originals);page.get_by_role('button',name='橡皮擦',exact=True).click()
    page.mouse.move(150,40);page.mouse.down();page.mouse.move(150,250)
    assert page.locator('.canvas-ink-layer path').count()==0,'Sparse sweep from blank must preview erasure of every crossed stroke'
    assert page.evaluate('writes')==0 and page.evaluate('strokes')==originals,'Eraser preview must not persist'
    page.mouse.up();assert page.evaluate('writes')==1 and page.evaluate('strokes')==[]
    page.get_by_role('button',name='撤销笔迹',exact=True).click();assert page.evaluate('strokes')==originals,'One undo restores whole sweep'
    page.get_by_role('button',name='重做笔迹',exact=True).click();assert page.evaluate('strokes')==[]
    page.get_by_role('button',name='撤销笔迹',exact=True).click()
    for cancel in ['escape','pointercancel','blur','tool']:
        page.evaluate("ink.setTool('eraser')");before=page.evaluate('writes')
        page.mouse.move(150,40);page.mouse.down();page.mouse.move(150,250)
        if cancel=='escape':page.keyboard.press('Escape')
        elif cancel=='tool':page.evaluate("ink.setTool('pen')")
        else:page.evaluate("window.dispatchEvent(new "+('PointerEvent' if cancel=='pointercancel' else 'Event')+"('"+cancel+"',"+('{pointerId:1,bubbles:true}' if cancel=='pointercancel' else '{}')+"))")
        page.mouse.up();assert page.evaluate('strokes')==originals and page.evaluate('writes')==before,cancel
        expect(page.locator('.canvas-ink-layer path')).to_have_count(2)
    page.evaluate("ink.setTool('eraser')");page.mouse.move(150,40);page.mouse.down();page.mouse.move(150,250);before=page.evaluate('writes');page.evaluate('locked=true');page.mouse.up();assert page.evaluate('writes')==before and page.evaluate('strokes')==originals
    page.evaluate("locked=true;ink.setTool('eraser')");before=page.evaluate('writes');page.mouse.move(150,40);page.mouse.down();page.mouse.move(150,250);page.mouse.up();assert page.evaluate('writes')==before
    page.close()
def curve_eraser(browser):
    page=setup(browser,[{**BASE,'points':[[100,100],[200,200],[300,100]]}]);page.get_by_role('button',name='橡皮擦',exact=True).click()
    page.mouse.click(200,200);assert page.evaluate('strokes.length')==1,'Polyline control point is outside actual smoothed path'
    page.mouse.click(187.5,162.5);assert page.evaluate('strokes')==[],'Actual quadratic curve must be erased'
    page.close()
def selection(browser):
    other={**BASE,'id':'other','points':[[100,300],[200,300]]}
    page=setup(browser,[BASE,other]);expect(page.get_by_role('button',name='选择',exact=True)).to_be_visible();page.mouse.move(150,100);page.mouse.down();page.mouse.move(180,130)
    assert page.evaluate('writes')==0;page.keyboard.press('Escape');page.mouse.up();assert page.evaluate('strokes[0].points')==BASE['points']
    page.mouse.move(150,100);page.mouse.down();page.mouse.move(180,130);page.mouse.up();assert page.evaluate('strokes[0].points')==[[130,130],[230,130]],'Select must move regular stroke'
    page.get_by_role('button',name='笔迹设置',exact=True).click()
    page.get_by_role('button',name='红色',exact=True).click();width=page.get_by_role('spinbutton',name='笔迹粗细数值',exact=True);expect(width).to_be_visible();width.fill('8');width.dispatch_event('change');page.get_by_role('slider',name='笔迹透明度',exact=True).fill('0.5')
    item=page.evaluate('strokes[0]');assert (item['color'],item['width'],item['opacity'])==('#ef4444',8,.5)
    expect(page.locator('.canvas-ink-layer path[data-stroke-id=p]')).to_have_attribute('opacity','0.5')
    assert page.evaluate('strokes[1]')==other,'Formatting affects only the selected stroke'
    page.mouse.click(180,130);page.keyboard.press('Delete');assert page.evaluate('strokes')==[other]
    page.get_by_role('button',name='撤销笔迹',exact=True).click();assert page.evaluate('strokes[0]')==item
    page.get_by_role('button',name='撤销笔迹',exact=True).click();assert page.evaluate('strokes[0].opacity??1')==1
    page.get_by_role('button',name='重做笔迹',exact=True).click();page.evaluate('ink.render()');expect(page.locator('.canvas-ink-layer path[data-stroke-id=p]')).to_have_attribute('opacity','0.5')
    page.mouse.click(620,115);assert page.evaluate('cardClicks')==1,'Selection miss must preserve card click'
    page.mouse.click(180,130);before=page.evaluate('JSON.stringify(strokes)');page.get_by_role('button',name='文字',exact=True).click();page.get_by_role('button',name='文字加粗',exact=True).click();assert page.evaluate('JSON.stringify(strokes)')==before,'Switching to text cannot format a regular stroke';assert page.evaluate('errors')==[]
    page.close()
def selection_over_control(browser):
    page=setup(browser,[{**BASE,'points':[[590,115],[690,115]]}])
    page.locator('#card').click()
    assert page.evaluate('cardClicks')==1,'Select mode must preserve a button underneath an existing stroke'
    assert page.locator('.canvas-ink-stroke-selection').count()==0
    # The same stroke remains selectable on its adjacent non-interactive segment.
    page.mouse.click(675,115);expect(page.locator('.canvas-ink-stroke-selection')).to_have_count(1)
    page.locator('#card').click();assert page.evaluate('cardClicks')==2,'Rapid control click must clear ink click suppression'
    page.keyboard.press('Delete');assert page.evaluate('strokes.length')==1,'Control click must clear stale ink selection'
    page.mouse.click(675,115);expect(page.locator('.canvas-ink-stroke-selection')).to_have_count(1)
    page.keyboard.press('Delete');assert page.evaluate('strokes')==[]
    page.close()
def text(browser):
    page=setup(browser);page.get_by_role('button',name='文字',exact=True).click();font=page.get_by_role('spinbutton',name='文字字号',exact=True);expect(font).to_be_visible();font.fill('30');font.dispatch_event('change')
    page.mouse.click(300,200);editor=page.locator('.canvas-ink-text-editor');editor.fill('abcdefghijklmnop');wide=editor.bounding_box()['width'];editor.fill('hi');assert editor.bounding_box()['width']<wide/2,'Automatic text width must shrink'
    assert editor.bounding_box()['width']<100
    draft_box=editor.bounding_box();editor.press('Control+Enter');page.mouse.click(310,210);saved_box=page.locator('.canvas-ink-text-box > rect').first.bounding_box();assert abs(draft_box['x']-saved_box['x'])<2 and abs(draft_box['width']-saved_box['width'])<3,(draft_box,saved_box);assert 'boxWidth' not in page.evaluate('strokes[0]'),'Automatic width remains automatic after reload'
    page.mouse.dblclick(310,210);expect(editor).to_be_visible();editor.fill('h');editor.press('Control+Enter');assert page.evaluate('strokes[0].width')==30
    page.evaluate("strokes=[{id:'fixed',tool:'text',color:'#111827',width:24,points:[[100,100]],text:'fixed',boxWidth:250,boxHeight:40}];ink.reset();ink.setTool('text')")
    page.mouse.dblclick(110,110);expect(editor).to_be_visible();editor.fill('hi');assert editor.bounding_box()['width']>=250;editor.press('Control+Enter');assert page.evaluate('strokes[0].boxWidth')==250
    page.close()
def draft_formatting(browser):
    for entry in ['text','select']:
        for initial in [False,True]:
            page=setup(browser,[{'id':'text','tool':'text','color':'#111827','width':24,'bold':initial,'opacity':.8,'points':[[100,100]],'text':'Existing draft'}])
            page.evaluate("ink.setTool('"+entry+"')")
            page.mouse.dblclick(110,110)
            editor=page.locator('.canvas-ink-text-editor');expect(editor).to_be_visible()
            settings=page.get_by_role('button',name='笔迹设置',exact=True)
            if settings.get_attribute('aria-expanded')!='true':settings.click()
            bold=page.get_by_role('button',name='文字加粗',exact=True)
            expect(bold).to_have_attribute('aria-pressed',str(initial).lower())
            for expected in [not initial,initial,not initial]:
                bold.click();expect(bold).to_have_attribute('aria-pressed',str(expected).lower())
                assert editor.evaluate('el=>getComputedStyle(el).fontWeight')==('700' if expected else '400')
                expect(editor).to_have_attribute('data-save-state','draft')
                assert page.evaluate('strokes[0].bold')==initial,'Formatting must remain in the draft'
            page.get_by_role('button',name='红色',exact=True).click()
            font=page.get_by_role('spinbutton',name='文字字号',exact=True);font.fill('32');font.dispatch_event('change')
            opacity=page.get_by_role('slider',name='笔迹透明度',exact=True);opacity.fill('0.5')
            expect(font).to_have_value('32');expect(opacity).to_have_value('0.5');expect(page.get_by_role('button',name='红色',exact=True)).to_have_attribute('aria-pressed','true')
            editor.press('Control+Enter');expect(editor).to_have_count(0)
            item=page.evaluate('strokes[0]');assert (item['bold'],item['width'],item['color'],item['opacity'])==(not initial,32,'#ef4444',.5)
            page.close()
def public_entry(browser):
    page=setup(browser);assert page.evaluate('ink.activateText()') is True;assert page.evaluate('ink.tool')=='text'
    assert page.evaluate('ink.openTextAt(300,200)') is True;editor=page.locator('.canvas-ink-text-editor');expect(editor).to_be_focused();editor.fill('入口')
    assert page.evaluate('ink.openTextAt(400,300)') is True;expect(editor).to_have_value('');assert page.evaluate('strokes[0].text')=='入口'
    editor.press('Escape');page.evaluate('locked=true');assert page.evaluate('ink.activateText()') is False;assert page.evaluate('ink.openTextAt(500,400)') is False;expect(editor).to_have_count(0);page.close()
def export_opacity(browser):
    page=setup(browser)
    page.add_script_tag(content=(ROOT/'src/26-graph-export-service.js').read_text())
    result=page.evaluate("""()=>{window.state={nodes:[],links:[],strokes:[{id:'export',tool:'pen',color:'#ff0000',width:10,opacity:.5,points:[[3000,103],[3100,103]]}]};const result=KGGraphExportService.renderGraphCanvas();const {canvas,bounds,scale}=result;return {bounds,pixel:Array.from(canvas.getContext('2d').getImageData(Math.round((3050-bounds.x)*scale),Math.round((103-bounds.y)*scale),1,1).data)}}""")
    assert result['bounds']['x']<=3000 and result['bounds']['x']+result['bounds']['width']>=3100,'Ink beyond cards must expand visual export bounds'
    assert 248<=result['pixel'][0]<=254 and 120<=result['pixel'][1]<=128 and result['pixel'][3]==255,result
    page.close()
def responsive_controls(browser):
    page=setup(browser,[BASE]);page.get_by_role('button',name='画笔',exact=True).click();page.get_by_role('button',name='笔迹设置',exact=True).click()
    palette=page.get_by_role('button',name='蓝色',exact=True).bounding_box();pen=page.get_by_role('button',name='画笔',exact=True).bounding_box();assert abs(palette['y']+palette['height']/2-pen['y']-pen['height']/2)<3,'Desktop palette remains in the tool row'
    output=ROOT.parent/'artifacts/boardmix-interaction-polish';output.mkdir(parents=True,exist_ok=True);page.screenshot(path=str(output/'shared-ink-desktop.png'))
    page.locator('#view').evaluate("el=>{el.style.width='100%';el.style.height='100vh'}");page.set_viewport_size({'width':360,'height':640})
    for selector in ['.canvas-ink-toolbar','.canvas-ink-options']:
        box=page.locator(selector).bounding_box();assert box['x']>=0 and box['x']+box['width']<=360 and box['y']>=0 and box['y']+box['height']<=640,(selector,box)
    page.screenshot(path=str(output/'shared-ink-mobile.png'))
    page.evaluate('locked=true;ink.render()');expect(page.get_by_role('button',name='蓝色',exact=True)).to_be_disabled();expect(page.get_by_role('spinbutton',name='笔迹粗细数值',exact=True)).to_be_disabled();page.close()
def external_history(browser):
    other={**BASE,'id':'b','points':[[100,300],[200,300]]}
    for route in ['keyboard','direct','render']:
        page=setup(browser,[BASE,other])
        page.evaluate("""()=>{ink.destroy();window.shared=KGCanvasHistoryController.create();window.ink=KGCanvasInk.create({viewport:document.querySelector('#view'),world:document.querySelector('#world'),history:shared,getViewport:()=>({x:0,y:0,scale:1}),getStrokes:()=>strokes,setStrokes:s=>{strokes=s;writes++}});const full=KGCanvasInk.normalize(strokes);shared.push({label:'create b',undo:()=>{strokes=full.slice(0,1)},redo:()=>{strokes=KGCanvasInk.normalize(full)}});document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='z'){e.preventDefault();shared.undo();ink.render()}});ink.setTool('eraser')}""")
        page.mouse.move(150,80);page.mouse.down();page.mouse.move(150,100)
        if route=='keyboard':page.keyboard.press('Control+z')
        else:page.evaluate('shared.undo()'+(';ink.render()' if route=='render' else ''))
        page.mouse.up();assert page.evaluate('strokes')==[BASE],('External undo must not resurrect b or erase restored p',route,page.evaluate('strokes'));assert page.evaluate('writes')==0
        expect(page.locator('.canvas-ink-layer path')).to_have_count(1);page.close()
    # A selected move must not overwrite an externally restored color/geometry.
    page=setup(browser,[{**BASE,'color':'#ef4444'}]);page.mouse.move(150,100);page.mouse.down();page.mouse.move(180,130)
    page.evaluate("strokes=[{id:'p',tool:'pen',color:'#2563eb',width:3,points:[[100,100],[200,100]]}]")
    page.mouse.up();assert page.evaluate('strokes')==[BASE],'Stale selected move must not overwrite newer stroke state';assert page.evaluate('writes')==0;page.close()
def explicit_word_wrap(browser):
    page=setup(browser,[{'id':'text','tool':'text','color':'#111827','width':24,'points':[[100,100]],'text':'wrap','boxWidth':120}]);page.evaluate("ink.setTool('text')");page.mouse.dblclick(110,110)
    editor=page.locator('.canvas-ink-text-editor');editor.fill('alpha beta gamma delta epsilon zeta eta theta iota kappa')
    metrics=editor.evaluate('el=>({client:el.clientHeight,scroll:el.scrollHeight})');assert metrics['scroll']<=metrics['client']+1,('No wrapped draft text may be clipped',metrics)
    draft=editor.bounding_box();editor.press('Control+Enter');saved=page.locator('.canvas-ink-text-box > rect').first.bounding_box();assert abs(draft['height']-saved['height'])<3,(draft,saved);assert page.evaluate('strokes[0].boxWidth')==120;page.close()
def long_automatic_text(browser):
    page=setup(browser);page.evaluate('ink.openTextAt(100,100)');editor=page.locator('.canvas-ink-text-editor');editor.fill('W'*500)
    metrics=editor.evaluate('el=>({client:el.clientHeight,scroll:el.scrollHeight,width:parseFloat(el.style.width)})');assert metrics['scroll']<=metrics['client']+1,('Long automatic draft may not be clipped',metrics)
    draft=editor.bounding_box();editor.press('Control+Enter');page.mouse.click(110,110);saved=page.locator('.canvas-ink-text-box > rect').first.bounding_box();assert abs(draft['width']-saved['width'])<3 and abs(draft['height']-saved['height'])<3,(draft,saved);assert 'boxWidth' not in page.evaluate('strokes[0]');page.close()
def deferred_tool_exit(browser):
    for action in ['pen','close']:
        page=setup(browser);page.evaluate('ink.openTextAt(300,200)');editor=page.locator('.canvas-ink-text-editor');editor.fill('输入法草稿')
        editor.evaluate("el=>el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}))")
        page.get_by_role('button',name='画笔' if action=='pen' else '关闭画笔工具',exact=True).click()
        expect(editor).to_have_value('输入法草稿');assert page.evaluate('writes')==0
        editor.evaluate("el=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}))")
        expect(editor).to_have_count(0)
        assert page.evaluate('ink.tool')==('pen' if action=='pen' else 'select'),('Composition completion must finish the requested tool/close action',action,page.evaluate('ink.tool'))
        if action=='close':expect(page.locator('.canvas-ink-toolbar')).to_be_hidden()
        assert page.evaluate('strokes[0].text')=='输入法草稿';page.close()
def right_grip(browser):
    original={'id':'text','tool':'text','color':'#111827','width':24,'points':[[100,100]],'text':'Right click grip','boxWidth':200,'boxHeight':40}
    page=setup(browser,[original]);page.evaluate("ink.setTool('text')");page.mouse.click(110,110)
    handle=page.locator('[data-ink-resize-handle=e]');box=handle.bounding_box();x=box['x']+box['width']/2;y=box['y']+box['height']/2
    page.mouse.move(x,y);page.mouse.down(button='right');page.mouse.move(x+20,y+15,steps=3);page.mouse.up(button='right')
    assert page.evaluate('strokes')==[original] and page.evaluate('writes')==0,'Right button on text grip must never resize or save'
    page.mouse.click(x,y,button='right');page.wait_for_timeout(100);page.mouse.click(x,y,button='right')
    assert page.evaluate('ink.tool')=='select' and page.evaluate('writes')==0,'Two right clicks on a grip must exit drawing safely'
    page.close()
def readonly_resize(browser):
    original={'id':'text','tool':'text','color':'#111827','width':24,'points':[[100,100]],'text':'Readonly mid-resize','boxWidth':200,'boxHeight':40}
    page=setup(browser,[original]);page.evaluate("ink.setTool('text')");page.mouse.click(110,110);handle=page.locator('[data-ink-resize-handle=e]');box=handle.bounding_box();x=box['x']+box['width']/2;y=box['y']+box['height']/2
    page.mouse.move(x,y);page.mouse.down();page.evaluate('locked=true');page.mouse.move(x+50,y,steps=3)
    expect(page.locator('.canvas-ink-layer text')).to_have_attribute('font-size','24')
    assert page.locator('[data-ink-resize-handle]').count()==0,'Readonly transition cancels preview and removes edit handles'
    page.mouse.up();assert page.evaluate('writes')==0 and page.evaluate('strokes')==[original];page.close()
def eraser_hold_exit(browser):
    for route in ['escape','close','readonly','readonly-without-render','complete']:
        page=setup(browser,[BASE]);page.evaluate('ink.destroy();window.held=0;window.ink=KGCanvasInk.create({viewport:document.querySelector("#view"),world:document.querySelector("#world"),getViewport:()=>({x:0,y:0,scale:1}),getStrokes:()=>strokes,setStrokes:s=>{strokes=s;writes++},isReadonly:()=>locked,onLongPressEraser:()=>held++})')
        btn=page.get_by_role('button',name='橡皮擦',exact=True);b=btn.bounding_box();page.mouse.move(b['x']+10,b['y']+10);page.mouse.down()
        if route=='escape':page.keyboard.press('Escape')
        elif route=='close':page.get_by_role('button',name='关闭画笔工具',exact=True).evaluate('el=>el.click()')
        elif route=='readonly':page.evaluate('locked=true;ink.render()')
        elif route=='readonly-without-render':page.evaluate('locked=true')
        page.wait_for_timeout(3100);page.mouse.up()
        assert page.evaluate('held')==(1 if route=='complete' else 0),('Canceled/readonly eraser hold must not invoke whole-paper clear',route)
        page.close()
def asynchronous_tool_exit(browser):
    page=setup(browser);page.evaluate('ink.destroy();window.failSave=true;window.ink=KGCanvasInk.create({viewport:document.querySelector("#view"),world:document.querySelector("#world"),getViewport:()=>({x:0,y:0,scale:1}),getStrokes:()=>strokes,setStrokes:s=>{strokes=s;writes++},persistText:()=>!failSave})');page.evaluate('ink.openTextAt(300,200)')
    editor=page.locator('.canvas-ink-text-editor');editor.fill('失败保留');page.get_by_role('button',name='画笔',exact=True).click();expect(editor).to_have_attribute('data-save-state','failed');assert page.evaluate('ink.tool')=='text'
    page.evaluate('failSave=false');page.get_by_role('button',name='画笔',exact=True).click();expect(editor).to_have_count(0);assert page.evaluate('ink.tool')=='pen' and page.evaluate('strokes.length')==1
    page.close()
    page=setup(browser);page.evaluate('ink.destroy();window.ink=KGCanvasInk.create({viewport:document.querySelector("#view"),world:document.querySelector("#world"),getViewport:()=>({x:0,y:0,scale:1}),getStrokes:()=>strokes,setStrokes:s=>{strokes=s;writes++},persistText:()=>new Promise(resolve=>window.finishSave=resolve)})');page.evaluate('ink.openTextAt(300,200)');editor=page.locator('.canvas-ink-text-editor');editor.fill('最后选择')
    page.get_by_role('button',name='画笔',exact=True).click();page.get_by_role('button',name='荧光笔',exact=True).click();page.evaluate('finishSave(true)');expect(editor).to_have_count(0)
    assert page.evaluate('ink.tool')=='highlighter','The last requested tool wins after one delayed save';assert page.evaluate('strokes.length')==1;page.close()
def live_pages(base):
    base=base.rstrip('/')
    assert urlparse(base).hostname in ('127.0.0.1','localhost') and urlparse(base).port==5258
    SOURCE='src/canvas/94-canvas-ink.js'
    def override(route):
        path=urlparse(route.request.url).path.lstrip('/')
        if path==SOURCE:route.fulfill(path=str(ROOT/SOURCE));return
        if path.startswith('bundles/') and path.endswith('.js'):
            response=route.fetch();body=response.text();marker='})([['
            if marker in body:
                start=body.index(marker)+3;entries=json.loads(body[start:body.rindex(');')])
                for entry in entries:
                    if entry[0]==SOURCE:entry[1]=(ROOT/SOURCE).read_text()
                body=body[:start]+json.dumps(entries,ensure_ascii=False)+');'
            route.fulfill(response=response,body=body);return
        route.continue_()
    with sync_playwright() as p:
        b=p.chromium.launch(channel='chrome');c=b.new_context(viewport={'width':1440,'height':1000});c.route('**/*',override)
        assert c.request.post(base+'/api/v1/auth/login',data={'username':'ink-browser','password':'ink-browser-test'}).ok
        r=c.request.post(base+'/api/v1/files',data={'name':'画笔退出'+uuid.uuid4().hex[:8],'graphData':{'nodes':[{'id':'a','title':'隔离画布','x':400,'y':300}],'links':[],'strokes':[]}});assert r.ok;fid=r.json()['file']['id'];assert c.request.put(base+'/api/v1/files/current',data={'fileId':fid}).ok
        paths=[('home','/index.html','KGHomeInk'),('recall','/knowledge-recall.html?questionId=ink-question-1&bankId=ink-bank&paperId=ink-paper&releaseId=ink-release','KGRecallInk'),('workspace','/question-workspace.html?paperId=ink-paper&releaseId=ink-release','KGWorkspaceInk')]
        for name,path,controller in paths:
            page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto(base+path,wait_until='networkidle');page.wait_for_function('!!window.'+controller)
            if name=='home':
                for sel in ['#learningEntryDismissBtn','.tour-skip','#hideHelpBtn']:
                    if page.locator(sel).is_visible():page.locator(sel).click()
                page.evaluate('KGHomeInteractionModes.setMode("professional")');page.wait_for_function('!KGGraphFileTabs.isSwitching()')
            for tool in ['pen','close']:
                assert page.evaluate(controller+'.openTextAt(330,300)')
                editor=page.locator('.canvas-ink-text-editor');message=name+'-'+tool+'-'+uuid.uuid4().hex[:5];editor.fill(message)
                editor.evaluate("el=>el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}))")
                page.get_by_role('button',name='画笔' if tool=='pen' else '关闭画笔工具',exact=True).click();expect(editor).to_have_value(message)
                editor.evaluate("el=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}))");expect(editor).to_have_count(0)
                assert page.evaluate(controller+'.tool')==('pen' if tool=='pen' else 'select')
                if tool=='close':expect(page.locator('.canvas-ink-toolbar')).to_be_hidden()
                text=page.locator('.canvas-ink-layer text').filter(has_text=message);expect(text).to_be_visible()
                page.reload(wait_until='networkidle');expect(page.locator('.canvas-ink-layer text').filter(has_text=message)).to_be_visible()
                if name=='home':
                    for sel in ['#learningEntryDismissBtn','.tour-skip','#hideHelpBtn']:
                        if page.locator(sel).is_visible():page.locator(sel).click()
            page.evaluate(controller+'.setOpen(true);'+controller+'.setTool("text")');text=page.locator('.canvas-ink-layer text').filter(has_text=message);text.click(position={'x':5,'y':5},force=True)
            h=page.locator('[data-ink-resize-handle=e]');rect=h.bounding_box();before=page.locator('.canvas-ink-layer').inner_html();x=rect['x']+rect['width']/2;y=rect['y']+rect['height']/2
            page.mouse.move(x,y);page.mouse.down(button='right');page.mouse.move(x+25,y+15,steps=5);page.mouse.up(button='right')
            assert page.locator('.canvas-ink-layer').inner_html()==before,'Right drag cannot resize annotations on '+name
            page.mouse.click(x,y,button='right');page.wait_for_timeout(100);page.mouse.click(x,y,button='right');assert page.evaluate(controller+'.tool')=='select'
            page.get_by_role('button',name='关闭画笔工具',exact=True).click();expect(page.locator('.canvas-ink-toolbar')).to_be_hidden()
            if name=='workspace':
                if page.locator('.qw-question-card').count()==0:
                    page.locator('#qwQuestionDockBtn').click();page.locator('[data-add-index]').first.click();page.keyboard.press('Escape');page.evaluate('KGMultiQuestionWorkspace.closeQuestionDrawer()')
                card=page.locator('.qw-question-card').first;page.evaluate(controller+'.setOpen(true)');page.mouse.move(1400,950);page.wait_for_timeout(200)
                decoration='el=>({shadow:getComputedStyle(el).boxShadow,outline:getComputedStyle(el).outline})';before_hover=card.evaluate(decoration);card.hover();page.wait_for_timeout(200)
                assert card.evaluate(decoration)==before_hover,'Drawing across a card must not flash red outlines/shadows'
                page.evaluate(controller+'.setOpen(false)')
            assert not errors,errors;print('PASS '+name+': IME tool/close intent, durable reload, right-grip no mutation, right exit and X',flush=True)
            if name=='home':
                page.evaluate('()=>{selectedNodeIds=new Set(["a"]);state.selectedNodeId="a";refreshSelectionUI()}');assert page.evaluate('openRelatedCanvasModal(false)')
                modal=page.locator('.related-canvas-backdrop');modal.locator('[data-action=ink]').click();toolbar=modal.locator('.canvas-ink-toolbar');toolbar.get_by_role('button',name='文字',exact=True).click()
                target=page.evaluate('''()=>{const v=document.querySelector('.related-canvas-viewport'),r=v.getBoundingClientRect();for(let y=r.top+5;y<r.bottom-5;y+=10)for(let x=r.left+5;x<r.right-5;x+=10){const el=document.elementFromPoint(x,y);if(el===v||el?.classList.contains('related-canvas-stage'))return {x,y}}return null}''');assert target
                page.mouse.click(target['x'],target['y']);editor=page.locator('.canvas-ink-text-editor');editor.fill('临时文字退出');editor.evaluate("el=>el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}))");toolbar.get_by_role('button',name='关闭画笔工具',exact=True).click();editor.evaluate("el=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}))");expect(editor).to_have_count(0);expect(toolbar).to_be_hidden();expect(modal.locator('.canvas-ink-layer text')).to_contain_text('临时文字退出')
                modal.locator('[data-action=close]').click();assert not any('临时文字退出' in s.get('text','') for s in c.request.get(base+'/api/v1/files/'+fid).json()['graphData'].get('strokes',[]));print('PASS temporary: blank text, IME X, local-only discard',flush=True)
            page.close()
        b.close()
def role_matrix(base, selected_roles=None):
    base=base.rstrip('/');assert urlparse(base).hostname in ('127.0.0.1','localhost') and urlparse(base).port==5266
    out=ROOT.parent/'artifacts/window-role-qa/canvas';out.mkdir(parents=True,exist_ok=True)
    users={'admin':'ink-admin','teacher':'ink-browser','student':'ink-student','viewer':'ink-viewer','guest':None}
    results=[];contexts={};workspace_ids={};token=uuid.uuid4().hex[:5]
    def record(role,page,check,status='pass',detail=None):
        row={'role':role,'page':page,'check':check,'status':status}
        if detail is not None:row['detail']=detail
        results.append(row);(out/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2));print(json.dumps(row,ensure_ascii=False),flush=True)
    def override(route):
        path=urlparse(route.request.url).path.lstrip('/');source=ROOT/path
        if path.startswith('bundles/') and path.endswith('.js'):
            response=route.fetch();body=response.text();marker='})([['
            if marker in body:
                start=body.index(marker)+3;entries=json.loads(body[start:body.rindex(');')])
                for entry in entries:
                    target=ROOT/entry[0]
                    if target.is_file():entry[1]=target.read_text()
                body=body[:start]+json.dumps(entries,ensure_ascii=False)+');'
            route.fulfill(response=response,body=body);return
        if source.is_file() and path.endswith(('.js','.css')):route.fulfill(path=str(source));return
        route.continue_()
    def dismiss(page):
        for sel in ['#learningEntryDismissBtn','.tour-skip','#hideHelpBtn']:
            if page.locator(sel).is_visible():page.locator(sel).click()
    def assert_readonly_requests(page,role,phase,requests):
        analytics=[r for r in requests if urlparse(r['url']).path=='/api/v1/analytics/feature-intervals']
        business=[r for r in requests if urlparse(r['url']).path!='/api/v1/analytics/feature-intervals']
        assert not business,business
        record(role,'workspace','readonly '+phase+' sends no business mutation requests; explicit backend 403 checked separately',detail={'businessWrites':business,'allowedUsageIntervals':analytics})
    def common(page,role,name):
        assert page.evaluate('!window.KGCanvasTableModel||KGCanvasTableModel.ENABLED===false')
        assert page.locator('[id$=TableBtn],.canvas-table-entry,[data-canvas-tool=table]').count()==0
        viewport=page.locator({'graph':'#stage','workspace':'#qwCanvasViewport','recall':'#krViewport'}[name]).bounding_box();page.mouse.click(viewport['x']+viewport['width']-180,viewport['y']+viewport['height']-120,button='right')
        for item in ['workspace','recall']:expect(page.locator('[data-global-shortcut='+item+']')).to_be_visible()
        assert page.evaluate("()=>![...document.querySelectorAll('button,[role=menuitem]')].some(e=>e.getClientRects().length&&/文字高清|文本高清|高清文字/.test(e.textContent+' '+e.title+' '+e.getAttribute('aria-label')))")
        page.keyboard.press('Escape');record(role,name,'table disabled, actual right-menu HD-text absent, direct left entries present')
    def writable(page,role,name,ctl):
        marker='role-'+role+'-'+name+'-'+token
        assert page.evaluate(ctl+'.openTextAt(330,350)');editor=page.locator('.canvas-ink-text-editor');editor.fill(marker)
        edge=page.locator('[data-ink-edit-drag=top]');r=edge.bounding_box();before=editor.bounding_box();editor.evaluate('e=>e.setSelectionRange(1,3)')
        page.mouse.move(r['x']+15,r['y']+3);page.mouse.down();page.mouse.move(r['x']+35,r['y']+18,steps=4);page.mouse.up();expect(editor).to_be_focused();assert editor.evaluate('e=>[e.selectionStart,e.selectionEnd]')==[1,3];assert abs(editor.bounding_box()['x']-before['x']-20)<1
        assert page.locator('.canvas-ink-text-edit-point').count()==8
        editor.evaluate("e=>e.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}))");page.get_by_role('button',name='画笔',exact=True).click();expect(editor).to_have_value(marker);editor.evaluate("e=>e.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}))");expect(editor).to_have_count(0);assert page.evaluate(ctl+'.tool')=='pen'
        text=page.locator('.canvas-ink-layer text').filter(has_text=re.compile('^'+re.escape(marker)+'$'));expect(text).to_be_visible();page.evaluate(ctl+'.setTool("text")');text.click(position={'x':5,'y':5},force=True)
        r=page.locator('[data-ink-resize-handle=e]').bounding_box();x=r['x']+r['width']/2;y=r['y']+r['height']/2;font=text.get_attribute('font-size')
        page.mouse.move(x,y);page.mouse.down(button='right');page.mouse.move(x+30,y+10,steps=3);page.mouse.up(button='right');assert text.get_attribute('font-size')==font
        page.mouse.click(x,y,button='right');page.wait_for_timeout(100);page.mouse.click(x,y,button='right');assert page.evaluate(ctl+'.tool')=='select'
        page.get_by_role('button',name='关闭画笔工具',exact=True).click();expect(page.locator('.canvas-ink-toolbar')).to_be_hidden()
        assert page.evaluate(ctl+'.openTextAt(600,450)');editor.fill('close-'+marker);editor.evaluate("e=>e.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}))");page.get_by_role('button',name='关闭画笔工具',exact=True).click();expect(editor).to_have_value('close-'+marker);editor.evaluate("e=>e.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}))");expect(editor).to_have_count(0);expect(page.locator('.canvas-ink-toolbar')).to_be_hidden();expect(page.locator('.canvas-ink-layer text').filter(has_text='close-'+marker)).to_be_visible()
        assert page.evaluate(ctl+'.openTextAt(650,600)');editor.fill('cancel-'+marker);editor.press('Escape');expect(editor).to_have_count(0);assert page.locator('.canvas-ink-layer text').filter(has_text='cancel-'+marker).count()==0
        page.evaluate(ctl+'.setOpen(true)');viewport={'graph':'#stage','workspace':'#qwCanvasViewport','recall':'#krViewport'}[name]
        spot=page.locator(viewport).evaluate("v=>{const r=v.getBoundingClientRect();for(let y=r.top+120;y<r.bottom-100;y+=30)for(let x=r.left+180;x<r.right-180;x+=30){const e=document.elementFromPoint(x,y);if(e===v||e?.classList.contains('qw-background')||e?.id==='krWorld'||e?.id==='world'||e?.id==='qwCanvasWorld')return{x,y}}return null}");assert spot,'No genuine blank hit'
        n=page.locator('.canvas-ink-layer path').count();page.mouse.move(spot['x'],spot['y']);page.mouse.down();page.mouse.move(spot['x']+45,spot['y']+25,steps=5);page.mouse.up();expect(page.locator('.canvas-ink-layer path')).to_have_count(n+1)
        page.get_by_role('button',name='撤销笔迹',exact=True).click();expect(page.locator('.canvas-ink-layer path')).to_have_count(n);page.get_by_role('button',name='重做笔迹',exact=True).click();expect(page.locator('.canvas-ink-layer path')).to_have_count(n+1)
        page.keyboard.press('Escape');assert page.evaluate(ctl+'.tool')=='select'
        if name=='graph':assert page.evaluate('KGGraphFileAutosave.saveAcknowledged({force:true})')
        elif name=='workspace':page.evaluate('KGCanvasWorkspaceAdapter.flush({throwOnError:true})');workspace_ids[role]=[w['id'] for w in contexts[role].request.get(base+'/api/v1/workspaces').json()['workspaces']]
        else:assert page.evaluate("KGLearningProgress.flush('deep_recall')")
        page.reload(wait_until='networkidle');dismiss(page);expect(page.locator('.canvas-ink-layer text').filter(has_text=re.compile('^'+re.escape(marker)+'$'))).to_be_visible();expect(page.locator('.canvas-ink-layer path')).to_have_count(n+1)
        if name=='graph':data=contexts[role].request.get(base+'/api/v1/files/role-graph-'+users[role]).json()['graphData']
        elif name=='recall':data=contexts[role].request.get(base+'/api/v1/recall/session/ink-question-1?releaseId=ink-release').json()['progress']
        else:data=next(w['payload'] for w in contexts[role].request.get(base+'/api/v1/workspaces').json()['workspaces'] if any(s.get('text')==marker for s in w['payload'].get('strokes',[])))
        assert any(stroke.get('text')==marker for stroke in data.get('strokes',[]));assert not any(stroke.get('text','').startswith('role-') and not stroke['text'].startswith('role-'+role+'-') for stroke in data.get('strokes',[]))
        record(role,name,'blank pen, 8 grips, focus/selection, IME switch, right/Esc/X, undo/redo, API save+reload, owner strokes')
    with sync_playwright() as pw:
        browser=pw.chromium.launch(channel='chrome')
        for role in selected_roles or users:
            c=browser.new_context(viewport={'width':1440,'height':1000});c.route('**/*',override);contexts[role]=c;username=users[role]
            if username:
                login=c.request.post(base+'/api/v1/auth/login',data={'username':username,'password':'ink-browser-test'});assert login.ok and login.json()['user']['role']==role
            else:assert c.request.get(base+'/api/v1/files').status==401
            record(role,'auth','real authenticated role with isolated cookies' if username else 'no-cookie guest; API 401')
            for other_role,other in users.items():
                if other and other!=username:assert c.request.get(base+'/api/v1/files/role-graph-'+other).status in (401,404)
            record(role,'API','other-owner graph reads denied')
            for destination in ['workspace','recall']:
                nav=c.new_page();nav.set_default_timeout(7000)
                try:
                    nav.goto(base+'/index.html',wait_until='networkidle');dismiss(nav);nav.locator('[data-global-shortcut='+destination+']').click();nav.wait_for_url('**/'+('question-workspace.html*' if destination=='workspace' else 'knowledge-recall.html*'));record(role,'navigation','actual left direct link -> '+destination)
                except Exception:record(role,'navigation',destination,'fail',traceback.format_exc())
                finally:nav.close()
            for name,path,ctl in [('graph','/index.html','KGHomeInk'),('workspace','/question-workspace.html?paperId=ink-paper&releaseId=ink-release','KGWorkspaceInk'),('recall','/knowledge-recall.html?questionId=ink-question-1&bankId=ink-bank&paperId=ink-paper&releaseId=ink-release','KGRecallInk')]:
                page=c.new_page();page.set_default_timeout(7000);page_errors=[];page.on('pageerror',lambda e:page_errors.append(str(e)));page_writes=[]
                page.on('request',lambda request:page_writes.append({'method':request.method,'url':request.url}) if request.method in ('POST','PUT','PATCH','DELETE') and '/api/v1/' in request.url else None)
                try:
                    page.goto(base+path,wait_until='networkidle');dismiss(page)
                    if name=='workspace' and role in ('viewer','guest'):
                        page.wait_for_timeout(600);assert_readonly_requests(page,role,'page initialization',page_writes.copy())
                    if name=='graph' and role in ('admin','teacher','student'):page.evaluate('KGHomeInteractionModes.setMode("professional")');page.wait_for_function('!KGGraphFileTabs.isSwitching()')
                    if name=='recall' and role=='viewer':expect(page.get_by_text('暂无访问权限')).to_be_visible();record(role,name,'non-demo question restricted','blocked');continue
                    common(page,role,name)
                    if role in ('admin','teacher','student'):
                        page.wait_for_function('ctl=>!!window[ctl]',arg=ctl);writable(page,role,name,ctl)
                        if name=='graph':
                            before=c.request.get(base+'/api/v1/files/role-graph-'+username).json()['graphData'];page.evaluate('()=>{selectedNodeIds=new Set(["role-a"]);state.selectedNodeId="role-a";refreshSelectionUI()}');assert page.evaluate('openRelatedCanvasModal(false)')
                            modal=page.locator('.related-canvas-backdrop');modal.locator('[data-action=ink]').click();toolbar=modal.locator('.canvas-ink-toolbar');v=modal.locator('.related-canvas-viewport').bounding_box();x=v['x']+v['width']-130;y=v['y']+v['height']-150
                            page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+30,y-20,steps=4);page.mouse.up();expect(modal.locator('.canvas-ink-layer path')).to_have_count(1);modal.locator('[data-action=undo]').click();expect(modal.locator('.canvas-ink-layer path')).to_have_count(0);modal.locator('[data-action=redo]').click();expect(modal.locator('.canvas-ink-layer path')).to_have_count(1)
                            page.mouse.click(x,y,button='right');page.wait_for_timeout(100);page.mouse.click(x,y,button='right');expect(toolbar.locator('[data-ink-tool=select]')).to_have_attribute('aria-pressed','true')
                            toolbar.get_by_role('button',name='文字',exact=True).click();page.mouse.click(x,y-70);e=page.locator('.canvas-ink-text-editor');e.fill('temporary-'+role);e.press('Control+Enter');expect(modal.locator('.canvas-ink-layer text')).to_contain_text('temporary-'+role);toolbar.get_by_role('button',name='关闭画笔工具',exact=True).click();expect(toolbar).to_be_hidden();modal.locator('[data-action=close]').click();assert c.request.get(base+'/api/v1/files/role-graph-'+username).json()['graphData']==before;record(role,'temporary','blank pen/text, undo/redo, right exit, X, discard/no formal write')
                        if name in ('workspace','recall'):
                            theme=page.evaluate("name=>name==='recall'?document.querySelector('#krApp').dataset.theme:document.body.dataset.theme",name);assert theme=='platform',(name,theme);record(role,name,'default platform theme')
                            if name=='workspace':
                                if not page.locator('.qw-question-card').count():page.locator('#qwQuestionDockBtn').click();page.locator('[data-add-index]').first.click();page.keyboard.press('Escape');page.evaluate('KGMultiQuestionWorkspace.closeQuestionDrawer()')
                                card=page.locator('.qw-question-card').first;page.evaluate(ctl+'.setOpen(true)');page.mouse.move(1400,950);page.wait_for_timeout(200);css='e=>({shadow:getComputedStyle(e).boxShadow,outline:getComputedStyle(e).outline,background:getComputedStyle(e).backgroundColor})';appearance=card.evaluate(css);card.hover();page.wait_for_timeout(200);assert card.evaluate(css)==appearance;record(role,name,'light card, stable pen hover',detail=appearance);page.evaluate(ctl+'.setOpen(false)')
                    else:
                        page.wait_for_function('ctl=>!!window[ctl]',arg=ctl);assert page.evaluate(ctl+'.activateText()') is False,page.evaluate('({user:KGAuthCore.currentUser(),role:KGRolePermissions.currentRole(),readonly:document.body.dataset.qwReadonly})');assert page.locator('.canvas-ink-text-editor').count()==0
                        status=c.request.post(base+'/api/v1/files',data={'name':'forbidden','graphData':{'nodes':[],'links':[]}}).status;assert status in (401,403),status;record(role,name,'UI editing+backend write blocked','blocked',status)
                        if name=='workspace' and role=='viewer':
                            denied=page.evaluate('KGMultiQuestionWorkspace.addQuestionByReference({questionId:"readonly-check"})');assert denied.get('reason')=='readonly' and '当前账号仅可查看多题画布' in denied.get('message','') and '联系管理员' in denied['message']
                            assert not page.locator('#authModal').is_visible(),'Logged-in viewer must not be asked to log in';expect(page.locator('#status')).to_contain_text('当前账号仅可查看多题画布');expect(page.locator('#status')).to_have_class(re.compile(r'.*show.*'));record(role,name,'visible role-specific readonly status and no login dialog')
                        if name=='graph':
                            page.evaluate('()=>{selectedNodeIds=new Set([state.nodes[0].id]);state.selectedNodeId=state.nodes[0].id;refreshSelectionUI()}');before=page.evaluate('JSON.stringify(saveableState())');assert page.evaluate('openRelatedCanvasModal(false)'), 'Readonly graph must open temporary viewing without attempting a write'
                            modal=page.locator('.related-canvas-backdrop');expect(modal).to_be_visible();assert modal.locator('[data-action=ink],[data-action=add],[data-action=delete],[data-action=connect]').count()==0,'Readonly temporary view must not expose editing controls'
                            assert modal.locator('.canvas-ink-layer').count()==0;modal.locator('[data-action=close]').click();assert page.evaluate('JSON.stringify(saveableState())')==before;record(role,'temporary','readonly opens without forced save; no editing/ink; formal graph unchanged')
                    assert not page_errors,page_errors
                    if name=='workspace' and role in ('viewer','guest'):
                        page.wait_for_timeout(600);assert_readonly_requests(page,role,'interactions',page_writes.copy())
                except Exception as error:record(role,name,'scenario','fail',traceback.format_exc())
                finally:page.screenshot(path=str(out/(role+'-'+name+'.png')));page.close()
            page=c.new_page();page.set_default_timeout(7000)
            try:
                page.goto(base+'/practice-mode.html',wait_until='networkidle')
                if role in ('admin','teacher','student','viewer'):
                    paper=page.locator('#practicePaperLibrary [data-paper-id=ink-paper]');expect(paper).to_be_visible();paper.click();page.locator('[data-practice-start=practice]').click();expect(page.locator('#practiceGame')).to_be_visible();expect(page.locator('#practiceAnswerSheetDrawer')).to_be_hidden();page.locator('#practiceAnswerSheetMobileBtn').click();expect(page.locator('#practiceAnswerSheetDrawer')).to_be_visible();page.locator('#practiceAnswerSheetDrawerClose').click();
                    if page.locator('[data-option-id=A]').is_enabled():page.locator('[data-option-id=A]').click()
                    expect(page.locator('#practiceExplanationPanel')).to_be_visible();record(role,'practice','real free paper, lightweight answer sheet, actual answer/explanation')
                    message='匿名内容-'+role+'-'+token;response=c.request.post(base+'/api/v1/questions/ink-question-1/comments',data={'content':message});assert response.ok,response.text();page.reload(wait_until='networkidle')
                    if not page.locator('#practiceGame').is_visible():page.locator('#practicePaperLibrary [data-paper-id=ink-paper]').click();page.locator('[data-practice-start=practice]').click()
                    if page.locator('[data-option-id=A]').is_enabled():page.locator('[data-option-id=A]').click()
                    items=page.locator('.q-danmaku-item');expect(items.first).to_be_visible();assert items.locator('.q-comment-author,.q-comment-avatar').count()==0;assert not any(user and user in ''.join(items.all_text_contents()) for user in users.values());record(role,'practice','real comments -> anonymous content-only danmaku (other authors prioritized)')
                elif role=='guest':page.locator('[data-practice-start=practice]').click();expect(page.locator('#practiceGame')).to_be_hidden();expect(page.locator('#authModal')).to_be_visible();record(role,'practice','login required to start','blocked')
            except Exception as error:record(role,'practice','scenario','fail',traceback.format_exc())
            finally:
                if page.locator('#practiceQuestionCard').is_visible():page.wait_for_function('Number(getComputedStyle(document.querySelector("#practiceQuestionCard")).opacity)>.99')
                page.screenshot(path=str(out/(role+'-practice.png')));page.close()
        for role,c in contexts.items():
            if role not in ('admin','teacher','student'):continue
            mobile=browser.new_context(viewport={'width':1440,'height':1000},has_touch=True);mobile.add_cookies(c.cookies());mobile.route('**/*',override);page=mobile.new_page();page.set_default_timeout(7000)
            try:
                page.goto(base+'/question-workspace.html?paperId=ink-paper&releaseId=ink-release',wait_until='networkidle');assert page.evaluate('KGWorkspaceInk.openTextAt(400,350)');editor=page.locator('.canvas-ink-text-editor');message='readonly-cancel-'+role+'-'+token;editor.fill(message);editor.press('Control+Enter');expect(editor).to_have_count(0)
                page.evaluate('KGWorkspaceInk.setTool("text")');text=page.locator('.canvas-ink-layer text').filter(has_text=message);text.click(position={'x':4,'y':4},force=True);r=page.locator('[data-ink-resize-handle=e]').bounding_box();x=r['x']+r['width']/2;y=r['y']+r['height']/2;font=text.get_attribute('font-size');page.mouse.move(x,y);page.mouse.down();page.set_viewport_size({'width':390,'height':844});page.wait_for_function('document.body.dataset.qwReadonly==="1"');page.mouse.move(x+30,y+10,steps=3);page.mouse.up();assert text.get_attribute('font-size')==font;assert page.locator('[data-ink-resize-handle]').count()==0;record(role,'workspace','real coarse/mobile readonly transition cancels active resize')
            except Exception:record(role,'workspace','mobile readonly cancellation','fail',traceback.format_exc())
            finally:page.screenshot(path=str(out/(role+'-mobile-readonly.png')));mobile.close()
        for role,c in contexts.items():
            for other,ids in workspace_ids.items():
                if other!=role:
                    for workspace_id in ids:assert c.request.get(base+'/api/v1/workspaces/'+workspace_id).status in ((401,) if role=='guest' else (404,))
            record(role,'API','other-owner workspace reads denied')
        browser.close()
    failed=[r for r in results if r['status']=='fail'];print('ROLE MATRIX: '+str(len(results))+' checks, '+str(len(failed))+' failures',flush=True)
    if failed:raise AssertionError(json.dumps(failed,ensure_ascii=False))
if '--base-url' in sys.argv:
    parser=argparse.ArgumentParser();parser.add_argument('--base-url',required=True);parser.add_argument('--role-matrix',action='store_true');parser.add_argument('--roles',nargs='*');args=parser.parse_args();role_matrix(args.base_url,args.roles) if args.role_matrix else live_pages(args.base_url)
else:
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True,executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
        cases={'readonly_resize':readonly_resize,'asynchronous_tool_exit':asynchronous_tool_exit,'deferred_tool_exit':deferred_tool_exit,'right_grip':right_grip,'eraser_hold_exit':eraser_hold_exit,'selection_over_control':selection_over_control,'draft_formatting':draft_formatting,'external_history':external_history,'explicit_word_wrap':explicit_word_wrap,'long_automatic_text':long_automatic_text,'eraser':eraser,'curve_eraser':curve_eraser,'selection':selection,'text':text,'public_entry':public_entry,'export_opacity':export_opacity,'responsive_controls':responsive_controls}
        for name in sys.argv[1:] or cases:
            cases[name](browser);print(name+': passed')
        browser.close()
