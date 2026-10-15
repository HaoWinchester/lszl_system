"""Shared text editing, dragging, formatting and recovery in real Chromium."""
import os
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT = Path(__file__).resolve().parents[1]
with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    page=browser.new_page(viewport={'width':1100,'height':780})
    page.set_content('<style>#view{position:relative;width:1000px;height:680px}#world{position:absolute;transform:translate(100px,100px) scale(2);transform-origin:0 0}</style><div id="view"><div id="world"></div></div>')
    page.add_style_tag(content=(ROOT/'styles/canvas-ink.css').read_text())
    for name in ['83-canvas-history-controller.js','text-box-geometry.js','text-edit-session.js','94-canvas-ink.js']:
        source=(ROOT/'src/canvas'/name).read_text()
        if os.environ.get('INK_BASELINE') and name=='94-canvas-ink.js':
            source=subprocess.check_output(['git','show','HEAD:new-legacy/src/canvas/94-canvas-ink.js'],cwd=ROOT.parent,text=True)
        page.add_script_tag(content=source)
    page.evaluate('''()=>{window.strokes=[];window.locked=false;window.fail=false;window.errors=[];window.ink=KGCanvasInk.create({viewport:document.querySelector('#view'),world:document.querySelector('#world'),getViewport:()=>({x:100,y:100,scale:2}),getStrokes:()=>strokes,setStrokes:s=>{if(fail)throw Error('save failed');strokes=s},isReadonly:()=>locked,onError:e=>errors.push(e)});}''')
    text=page.get_by_role('button',name='文字',exact=True)
    text.click();expect(page.locator('.canvas-ink-options')).to_be_visible();page.mouse.click(408,308)
    editor=page.locator('.canvas-ink-text-editor')
    editor.fill('第一行');text.click();expect(editor).to_have_value('第一行')
    page.get_by_role('button',name='文字加粗',exact=True).click()
    page.get_by_role('button',name='绿色',exact=True).click()
    expect(editor).to_have_value('第一行')
    editor.press('End');editor.press('Enter')
    expect(editor).to_be_visible()
    editor.press('End');editor.type('第二行');editor.press('Control+Enter')
    assert page.evaluate('strokes[0].text')=='第一行\n第二行'
    assert page.evaluate('strokes[0].bold') is True
    assert page.evaluate('strokes[0].color')=='#22c55e'
    assert page.locator('.canvas-ink-layer tspan').count()==2
    page.get_by_role('button',name='红色',exact=True).click()
    page.mouse.click(430,325)
    expect(page.get_by_role('button',name='绿色',exact=True)).to_have_attribute('aria-pressed','true')
    expect(page.get_by_role('button',name='文字加粗',exact=True)).to_have_attribute('aria-pressed','true')
    # Hit the lower line and cancel a drag without mutating the saved position.
    page.mouse.move(430,385);page.mouse.down();page.mouse.move(480,415,steps=5)
    page.evaluate("document.querySelector('#view').dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,bubbles:true}))")
    page.mouse.up();assert page.evaluate('strokes[0].points[0]')==[150,100]
    original=page.evaluate('JSON.parse(JSON.stringify(strokes[0]))')
    page.mouse.move(430,325);page.mouse.down();page.mouse.move(470,365,steps=5);page.mouse.up()
    assert page.evaluate('strokes[0].points[0]')==[original['points'][0][0]+20,original['points'][0][1]+20]
    expect(editor).to_have_count(0)
    text.click();expect(page.get_by_role('button',name='文字加粗',exact=True)).to_have_attribute('aria-pressed','true')
    expect(page.get_by_role('slider',name='文字字号')).to_have_count(0)
    page.get_by_role('button',name='红色',exact=True).click()
    assert page.evaluate('strokes[0].width')==24
    assert page.evaluate('strokes[0].bold') is True
    assert page.evaluate('strokes[0].color')=='#ef4444'
    page.get_by_role('button',name='撤销笔迹',exact=True).click();assert page.evaluate('strokes[0].color')==original['color']
    page.get_by_role('button',name='重做笔迹',exact=True).click();assert page.evaluate('strokes[0].color')=='#ef4444'
    page.mouse.dblclick(470,365);expect(editor).to_be_visible()
    editor.fill('取消内容');editor.press('Escape');assert page.evaluate('strokes[0].text')==original['text']
    page.mouse.dblclick(470,365);editor.fill('保留失败草稿');page.evaluate('fail=true');editor.press('Control+Enter')
    expect(editor).to_have_value('保留失败草稿');assert page.evaluate('strokes[0].text')==original['text']
    page.evaluate('fail=false');page.mouse.click(950,620);assert page.evaluate('strokes[0].text')=='保留失败草稿'
    # IME Enter must stay in editor even with the save modifier.
    page.mouse.dblclick(470,365)
    editor.evaluate("el=>el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,isComposing:true,bubbles:true}))")
    expect(editor).to_be_visible();editor.press('Escape')
    page.keyboard.press('Escape');page.mouse.move(470,365);page.mouse.down();page.mouse.move(510,405,steps=5);page.mouse.up()
    # Every edge changes geometry and font from a frozen start; each gesture is one undo.
    page.evaluate("()=>{strokes=[{id:'resize',tool:'text',color:'#ef4444',width:20,points:[[50,40]],text:'清晰 mixed 中文',boxWidth:200,boxHeight:100}];ink.reset();ink.setTool('text');ink.render()}")
    resize_text=page.locator('.canvas-ink-layer text');resize_text.click(position={'x':5,'y':5},force=True)
    # 轻量化拖拽框：把手仅透明命中区（无可见小方块），拖动文字时外框暂时隐藏，松手恢复。
    assert page.locator('.canvas-ink-layer [data-ink-resize-handle]').evaluate_all('(els)=>els.every(el=>getComputedStyle(el).fill==="rgba(0, 0, 0, 0)"&&getComputedStyle(el).strokeWidth==="0px")')
    page.mouse.move(250,190);page.mouse.down();page.mouse.move(280,220,steps=3)
    assert page.evaluate('getComputedStyle(document.querySelector(".canvas-ink-text-box")).opacity')=='0'
    page.mouse.up()
    assert page.evaluate('getComputedStyle(document.querySelector(".canvas-ink-text-box")).opacity')=='1'
    for side in ['n','s','e','w']:
        old=page.evaluate('JSON.parse(JSON.stringify(strokes[0]))');handle=page.locator('[data-ink-resize-handle='+side+']');box=handle.bounding_box();dx=32 if side in ['e','w'] else 0;dy=24 if side in ['n','s'] else 0
        page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2);page.mouse.down();page.mouse.move(box['x']+box['width']/2+dx,box['y']+box['height']/2+dy,steps=5);page.mouse.up()
        next=page.evaluate('strokes[0]');assert next['width']!=old['width'];assert abs(next['width']-old['width']*(next['boxWidth']*next['boxHeight']/(old['boxWidth']*old['boxHeight']))**.5)<.01
        page.get_by_role('button',name='撤销笔迹',exact=True).click();assert page.evaluate('strokes[0]')==old
    original=page.evaluate('JSON.parse(JSON.stringify(strokes[0]))');box=page.locator('[data-ink-resize-handle=se]').bounding_box();page.mouse.move(box['x']+5,box['y']+5);page.mouse.down();page.mouse.move(box['x']+85,box['y']+45,steps=5);page.keyboard.press('Escape');page.mouse.up();assert page.evaluate('strokes[0]')==original
    moved=page.evaluate('JSON.parse(JSON.stringify(strokes))')
    page.evaluate('locked=true;ink.render()');page.mouse.move(510,405);page.mouse.down();page.mouse.move(550,445);page.mouse.up()
    assert page.evaluate('strokes')==moved
    assert page.locator('.canvas-ink-layer text').evaluate('el=>getComputedStyle(el).filter')=='none'
    output=ROOT.parent/'artifacts/uat-canvas-text-fixes';output.mkdir(parents=True,exist_ok=True)
    page.screenshot(path=str(output/'shared-text-controller.png'))
    browser.close()
print('canvas-ink-text-browser: passed')
