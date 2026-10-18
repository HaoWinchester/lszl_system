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
    page.add_style_tag(content=(ROOT/'styles/custom-cursor.css').read_text())
    page.evaluate("document.body.classList.add('knowledge-graph-page')")
    for name in ['83-canvas-history-controller.js','dom-interaction.js','text-box-geometry.js','text-edit-session.js','94-canvas-ink.js']:
        source=(ROOT/'src/canvas'/name).read_text()
        if os.environ.get('INK_BASELINE') and name=='94-canvas-ink.js':
            source=subprocess.check_output(['git','show','HEAD:new-legacy/src/canvas/94-canvas-ink.js'],cwd=ROOT.parent,text=True)
        page.add_script_tag(content=source)
    page.evaluate('''()=>{window.strokes=[];window.locked=false;window.fail=false;window.errors=[];window.ink=KGCanvasInk.create({viewport:document.querySelector('#view'),world:document.querySelector('#world'),getViewport:()=>({x:100,y:100,scale:window.textTestScale||2}),getStrokes:()=>strokes,setStrokes:s=>{if(fail)throw Error('save failed');strokes=s},isReadonly:()=>locked,onError:e=>errors.push(e)});}''')
    text=page.get_by_role('button',name='文字',exact=True)
    # Editing follows the current content, including deletion of explicit blank lines.
    text.click();page.mouse.click(408,308)
    draft=page.locator('.canvas-ink-text-editor');assert draft.bounding_box()['height']<100,draft.bounding_box();draft.fill('短文字')
    assert draft.bounding_box()['height']<100, draft.bounding_box()
    draft.fill('一\n二\n三\n四\n');tall=draft.bounding_box()['height']
    draft.fill('短文字');assert draft.bounding_box()['height']<tall/2
    # Hover exposes real edge grips, with move feedback distinct from typing.
    edge=page.locator('[data-ink-edit-drag=top]');edge.hover(position={'x':15,'y':3})
    assert page.locator('.canvas-ink-text-edit-point').count()==8, 'Editing border needs visible hover grips'
    assert page.locator('.canvas-ink-text-edit-point').evaluate_all('(els)=>els.every(e=>getComputedStyle(e).opacity==="1")')
    assert edge.evaluate('e=>getComputedStyle(e).cursor')=='grab'
    assert draft.evaluate('e=>getComputedStyle(e).cursor')=='text'
    # Visible corner grips are draggable themselves, including their outside pixels.
    grip=page.locator('[data-ink-edit-point=nw]');g=grip.bounding_box();before_grip=draft.bounding_box()
    page.mouse.move(g['x']+1,g['y']+1);page.mouse.down();page.mouse.move(g['x']+21,g['y']+11,steps=3)
    expect(draft).to_be_focused();expect(draft).to_have_value('短文字')
    assert abs(draft.bounding_box()['x']-before_grip['x']-20)<1
    assert abs(draft.bounding_box()['y']-before_grip['y']-10)<1
    grip.dispatch_event('pointercancel',{'pointerId':1,'bubbles':True});page.mouse.up()
    assert abs(draft.bounding_box()['x']-before_grip['x'])<1
    assert page.evaluate('strokes.length')==0
    # Border drags never blur, commit or disturb the selection/composition session.
    draft.evaluate("el=>{el.setSelectionRange(1,2);el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}))}")
    border=page.locator('[data-ink-edit-drag=top]');b=border.bounding_box();origin=draft.bounding_box()
    page.mouse.move(b['x']+20,b['y']+b['height']/2);page.mouse.down();assert border.evaluate('e=>getComputedStyle(e).cursor')=='grabbing';page.mouse.move(b['x']+60,b['y']+b['height']/2+30,steps=5);page.mouse.up()
    expect(draft).to_be_focused();expect(draft).to_have_value('短文字')
    assert draft.evaluate('el=>[el.selectionStart,el.selectionEnd]')==[1,2]
    assert page.evaluate('strokes.length')==0
    assert abs(draft.bounding_box()['x']-origin['x']-40)<1
    assert abs(draft.bounding_box()['y']-origin['y']-30)<1
    draft.press('Control+Enter');expect(draft).to_be_visible()
    draft.evaluate("el=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}))")
    expect(draft).to_have_count(0);assert page.evaluate('strokes[0].boxHeight')<50
    assert page.evaluate('strokes[0].points[0]')==[170,115]
    page.evaluate('strokes=[];ink.reset();ink.setTool("select")')
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
    expect(page.get_by_role('spinbutton',name='文字字号',exact=True)).to_be_visible()
    expect(page.get_by_role('spinbutton',name='文字字号',exact=True)).to_have_value('24')
    page.get_by_role('button',name='红色',exact=True).click()
    assert page.evaluate('strokes[0].width')==24
    assert page.evaluate('strokes[0].bold') is True
    assert page.evaluate('strokes[0].color')=='#ef4444'
    page.get_by_role('button',name='撤销笔迹',exact=True).click();assert page.evaluate('strokes[0].color')==original['color']
    page.get_by_role('button',name='重做笔迹',exact=True).click();assert page.evaluate('strokes[0].color')=='#ef4444'
    page.mouse.dblclick(470,365);expect(editor).to_be_visible()
    editor.fill('取消内容');saved_point=page.evaluate('strokes[0].points[0]');border=page.locator('[data-ink-edit-drag=top]');b=border.bounding_box()
    page.mouse.move(b['x']+20,b['y']+3);page.mouse.down();page.mouse.move(b['x']+60,b['y']+23,steps=4);page.mouse.up()
    editor.press('Escape');assert page.evaluate('strokes[0].text')==original['text'];assert page.evaluate('strokes[0].points[0]')==saved_point
    page.mouse.dblclick(470,365);editor.fill('保留失败草稿');page.evaluate('fail=true');editor.press('Control+Enter')
    expect(editor).to_have_value('保留失败草稿');assert page.evaluate('strokes[0].text')==original['text']
    page.get_by_role('button',name='关闭画笔工具',exact=True).click();expect(editor).to_have_value('保留失败草稿');expect(page.locator('.canvas-ink-toolbar')).to_be_visible()
    page.evaluate('fail=false');page.mouse.click(950,620);assert page.evaluate('strokes[0].text')=='保留失败草稿'
    # IME Enter must stay in editor even with the save modifier.
    page.mouse.dblclick(470,365)
    editor.evaluate("el=>el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,isComposing:true,bubbles:true}))")
    expect(editor).to_be_visible();editor.press('Escape')
    page.keyboard.press('Escape');page.mouse.move(470,365);page.mouse.down();page.mouse.move(510,405,steps=5);page.mouse.up()
    # Every edge changes geometry and font from a frozen start; each gesture is one undo.
    page.evaluate("()=>{strokes=[{id:'resize',tool:'text',color:'#ef4444',width:20,points:[[50,40]],text:'清晰 mixed 中文',boxWidth:200,boxHeight:100}];ink.reset();ink.setTool('text');ink.render()}")
    resize_text=page.locator('.canvas-ink-layer text');resize_text.click(position={'x':5,'y':5},force=True)
    # Edge-hover grips are screen-sized and keep the resize cursor in drawing mode.
    handle=page.locator('[data-ink-resize-handle=e]');handle.hover()
    assert handle.evaluate('e=>getComputedStyle(e).cursor')=='e-resize'
    assert page.locator('.canvas-ink-text-handle-dot').count()==8
    assert page.locator('.canvas-ink-text-handle-dot').evaluate_all('(els)=>els.every(e=>getComputedStyle(e).opacity==="1" && Math.abs(e.getBoundingClientRect().width-8)<.1)')
    frame=page.locator('[data-ink-text-move]');frame.hover(position={'x':40,'y':1})
    assert frame.evaluate('e=>getComputedStyle(e).cursor')=='grab'
    frame_box=frame.bounding_box();old_position=page.evaluate('strokes[0].points[0]')
    page.mouse.move(frame_box['x']+40,frame_box['y']+1);page.mouse.down()
    assert page.locator('#view').evaluate('e=>getComputedStyle(e).cursor')=='grabbing'
    page.mouse.move(frame_box['x']+70,frame_box['y']+21,steps=4);page.mouse.up()
    assert page.evaluate('strokes[0].points[0]')==[old_position[0]+15,old_position[1]+10]
    page.get_by_role('button',name='撤销笔迹',exact=True).click()
    assert page.evaluate('strokes[0].points[0]')==old_position
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
    assert page.locator('[data-ink-resize-handle]').count()==0
    assert page.locator('.canvas-ink-layer text').evaluate('el=>getComputedStyle(el).filter')=='none'
    # Legacy saved 100px frames and larger explicit lines shrink on the next edit/save.
    page.evaluate("()=>{locked=false;strokes=[{id:'old-tall',tool:'text',color:'#111827',width:24,points:[[50,40]],text:'一\\n二\\n三',boxWidth:200,boxHeight:400}];ink.reset();ink.setTool('text');ink.render()}")
    page.mouse.dblclick(230,200);expect(editor).to_be_visible();editor.fill('一');assert editor.bounding_box()['height']<100
    editor.press('Control+Enter');assert page.evaluate('strokes[0].boxHeight')<50
    for zoom in [.5,1,2]:
        page.evaluate('(zoom)=>{window.textTestScale=zoom;document.querySelector("#world").style.transform=`translate(100px,100px) scale(${zoom})`;ink.render()}',zoom)
        handle=page.locator('[data-ink-resize-handle=e]');handle.hover()
        assert handle.evaluate('e=>getComputedStyle(e).cursor')=='e-resize'
        assert page.locator('.canvas-ink-text-handle-dot').evaluate_all('(els)=>els.every(e=>Math.abs(e.getBoundingClientRect().width-8)<.1 && getComputedStyle(e).opacity==="1")')
    output=ROOT.parent/'artifacts/uat-canvas-text-fixes';output.mkdir(parents=True,exist_ok=True)
    # Fullscreen moves the live overlay into the drawing surface; cursor overrides must still yield to grips.
    page.evaluate("()=>{const button=document.createElement('button');button.id='full-text-feedback';button.textContent='全屏';button.onclick=()=>document.querySelector('#view').requestFullscreen();document.body.append(button)}")
    page.locator('#full-text-feedback').click();page.wait_for_function('!!document.fullscreenElement')
    page.evaluate('ink.openTextAt(400,300)');editor.fill('边缘拖动继续输入')
    edge=page.locator('[data-ink-edit-drag=top]');edge.hover(position={'x':15,'y':3})
    assert edge.evaluate('e=>getComputedStyle(e).cursor')=='grab'
    grip=page.locator('[data-ink-edit-point=nw]');g=grip.bounding_box();start=editor.bounding_box()
    page.mouse.move(g['x']+1,g['y']+1);page.mouse.down();page.mouse.move(g['x']+31,g['y']+21,steps=4);page.mouse.up()
    expect(editor).to_be_focused();expect(editor).to_have_value('边缘拖动继续输入')
    assert abs(editor.bounding_box()['x']-start['x']-30)<1
    editor.type('，仍可打字');expect(editor).to_have_value('边缘拖动继续输入，仍可打字')
    page.screenshot(path=str(output/'hover-grips-fullscreen.png'))
    editor.press('Escape');page.evaluate('document.exitFullscreen()');page.wait_for_function('!document.fullscreenElement')
    assert page.locator('.canvas-ink-text-edit-border').count()==0
    page.screenshot(path=str(output/'shared-text-controller.png'))
    browser.close()
print('canvas-ink-text-browser: passed')
