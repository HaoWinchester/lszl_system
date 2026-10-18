"""Source-only Chromium regressions for common ink transactions and natural text."""
import sys
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
def text(browser):
    page=setup(browser);page.get_by_role('button',name='文字',exact=True).click();font=page.get_by_role('spinbutton',name='文字字号',exact=True);expect(font).to_be_visible();font.fill('30');font.dispatch_event('change')
    page.mouse.click(300,200);editor=page.locator('.canvas-ink-text-editor');editor.fill('abcdefghijklmnop');wide=editor.bounding_box()['width'];editor.fill('hi');assert editor.bounding_box()['width']<wide/2,'Automatic text width must shrink'
    assert editor.bounding_box()['width']<100
    draft_box=editor.bounding_box();editor.press('Control+Enter');page.mouse.click(310,210);saved_box=page.locator('.canvas-ink-text-box > rect').first.bounding_box();assert abs(draft_box['x']-saved_box['x'])<2 and abs(draft_box['width']-saved_box['width'])<3,(draft_box,saved_box);assert 'boxWidth' not in page.evaluate('strokes[0]'),'Automatic width remains automatic after reload'
    page.mouse.dblclick(310,210);expect(editor).to_be_visible();editor.fill('h');editor.press('Control+Enter');assert page.evaluate('strokes[0].width')==30
    page.evaluate("strokes=[{id:'fixed',tool:'text',color:'#111827',width:24,points:[[100,100]],text:'fixed',boxWidth:250,boxHeight:40}];ink.reset();ink.setTool('text')")
    page.mouse.dblclick(110,110);expect(editor).to_be_visible();editor.fill('hi');assert editor.bounding_box()['width']>=250;editor.press('Control+Enter');assert page.evaluate('strokes[0].boxWidth')==250
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
with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    cases={'external_history':external_history,'explicit_word_wrap':explicit_word_wrap,'long_automatic_text':long_automatic_text,'eraser':eraser,'curve_eraser':curve_eraser,'selection':selection,'text':text,'public_entry':public_entry,'export_opacity':export_opacity,'responsive_controls':responsive_controls}
    for name in sys.argv[1:] or cases:
        cases[name](browser);print(name+': passed')
    browser.close()
