"""Text drafts survive tool switches, pending saves, auth and context changes."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[1]
with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True, executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    page=browser.new_page(viewport={'width':1100,'height':780})
    page.set_content('<style>#view{position:relative;width:1000px;height:680px}#world{position:absolute}</style><div id="view"><div id="world"></div></div>')
    page.add_style_tag(content=(ROOT/'styles/canvas-ink.css').read_text())
    for name in ['83-canvas-history-controller.js','dom-interaction.js','text-box-geometry.js','text-edit-session.js','94-canvas-ink.js']:
        page.add_script_tag(content=(ROOT/'src/canvas'/name).read_text())
    page.evaluate('''()=>{window.strokes=[];window.context='owner:file';window.locked=false;window.mode='pending';window.writes=0;window.changes=0;window.errors=[];
      window.ink=KGCanvasInk.create({viewport:document.querySelector('#view'),world:document.querySelector('#world'),getViewport:()=>({x:0,y:0,scale:1}),getStrokes:()=>strokes,setStrokes:s=>{changes++;strokes=s},isReadonly:()=>locked,getTextContext:()=>context,allowReadonlyToolSelection:()=>true,onError:e=>errors.push(e),persistText:()=>{writes++;if(mode==='pending')return new Promise((resolve,reject)=>{window.saveResolve=resolve;window.saveReject=reject});if(mode==='failed')throw Error('session expired');return true}})}''')
    page.evaluate('ink.openTextAt(250,200)')
    editor=page.get_by_role('textbox',name='画布文字内容')
    editor.fill('保留文字草稿')
    page.get_by_role('button',name='画笔',exact=True).click()
    assert page.evaluate('ink.tool')=='pen', 'Tool switching must not wait for persistence'
    assert page.evaluate('ink.hasTextDraft()')
    expect(editor).to_have_value('保留文字草稿')
    assert page.evaluate('writes')==1
    page.mouse.move(650,350);page.mouse.down();page.mouse.move(710,390,steps=4);page.mouse.up()
    assert page.evaluate('strokes.some(s=>s.tool==="pen")'), 'Pending text must not block pen drawing'
    page.get_by_role('button',name='荧光笔',exact=True).click()
    page.get_by_role('button',name='画笔',exact=True).click()
    assert page.evaluate('writes')==1
    page.evaluate("saveReject(Error('session expired'))")
    expect(editor).to_have_attribute('data-save-state','failed')
    expect(page.locator('.canvas-ink-text-status')).to_contain_text('未保存')
    page.mouse.click(800,420);assert page.evaluate('writes')==1
    page.evaluate('locked=true;ink.render()')
    assert page.evaluate('ink.commitText()') is False
    assert page.evaluate('writes')==1, 'Readonly retries must never call persistence'
    page.evaluate('locked=false;ink.render()')
    # Resume the identical editor and retry once even when two guards commit together.
    page.get_by_role('button',name='文字',exact=True).click()
    expect(editor).to_be_focused();expect(editor).to_have_value('保留文字草稿')
    page.wait_for_timeout(200)
    expect(editor).to_have_value('保留文字草稿');assert page.evaluate('writes')==1
    page.evaluate("mode='ok'")
    applied_changes=page.evaluate('changes')
    assert page.evaluate('Promise.all([ink.commitText(),ink.commitText()])')==[True,True]
    assert page.evaluate('changes')==applied_changes, 'Retry acknowledgement must not add another undo step'
    expect(editor).to_have_count(0)
    assert page.evaluate('writes')==2
    assert page.evaluate('strokes.filter(s=>s.tool==="text").length')==1
    assert page.evaluate('strokes.some(s=>s.tool==="pen")')
    # Even an unchanged existing text edit must not retry writes while readonly.
    page.locator('.canvas-ink-layer text').first.dblclick(position={'x':8,'y':8},force=True)
    expect(editor).to_be_visible();count=page.evaluate('writes')
    page.evaluate('locked=true;ink.render()')
    assert page.evaluate('ink.commitText()') is False
    assert page.evaluate('writes')==count
    page.evaluate('locked=false;ink.render()');editor.press('Escape')
    # A pending completion cannot close content typed after returning to the draft.
    page.evaluate("mode='pending';ink.openTextAt(300,250)")
    editor.fill('先提交');page.get_by_role('button',name='画笔',exact=True).click()
    page.get_by_role('button',name='文字',exact=True).click();editor.fill('更新内容')
    page.evaluate('saveResolve(true)');expect(editor).to_have_value('更新内容')
    page.evaluate("mode='ok'");assert page.evaluate('ink.commitText()')
    assert page.evaluate('strokes.some(s=>s.text==="更新内容")')
    # Auth readonly keeps the original textarea, including text not yet applied.
    page.evaluate('ink.openTextAt(350,280)');editor.fill('登录过期仍保留')
    page.evaluate('locked=true;ink.render()')
    page.get_by_role('button',name='画笔',exact=True).click()
    assert page.evaluate('ink.tool')=='pen'
    frozen=page.evaluate('JSON.stringify(strokes)')
    page.mouse.move(700,400);page.mouse.down();page.mouse.move(760,440,steps=3);page.mouse.up()
    assert page.evaluate('JSON.stringify(strokes)')==frozen
    page.get_by_role('button',name='文字',exact=True).click()
    assert page.evaluate('ink.commitText()') is False
    expect(editor).to_have_value('登录过期仍保留')
    page.evaluate('locked=false;ink.render()');assert page.evaluate('ink.commitText()')
    # Cancel restores only this text object and retains pen marks added in parallel.
    page.evaluate("mode='failed';ink.openTextAt(350,280)");editor.fill('取消草稿')
    page.get_by_role('button',name='画笔',exact=True).click()
    expect(editor).to_have_attribute('data-save-state','failed')
    page.mouse.move(700,450);page.mouse.down();page.mouse.move(750,490,steps=3);page.mouse.up()
    count=page.evaluate('strokes.filter(s=>s.tool==="pen").length')
    page.get_by_role('button',name='文字',exact=True).click();editor.press('Escape')
    assert page.evaluate('strokes.filter(s=>s.tool==="pen").length')==count
    assert not page.evaluate('strokes.some(s=>s.text==="取消草稿")')
    # History may undo the applied text while its failed draft is suspended.
    page.evaluate("mode='failed';ink.openTextAt(350,280)");editor.fill('撤销后重试仍保留')
    page.get_by_role('button',name='画笔',exact=True).click()
    expect(editor).to_have_attribute('data-save-state','failed')
    page.get_by_role('button',name='撤销笔迹',exact=True).click()
    assert not page.evaluate('strokes.some(s=>s.text==="撤销后重试仍保留")')
    page.evaluate("mode='ok'");assert page.evaluate('ink.commitText()')
    assert page.evaluate('strokes.some(s=>s.text==="撤销后重试仍保留")')
    # A context change without reset cannot commit into the next canvas either.
    page.evaluate('ink.openTextAt(350,280)');editor.fill('未 reset 的原文件草稿')
    page.evaluate("context='next:file';strokes=[]")
    assert page.evaluate('ink.commitText()') is False
    assert page.evaluate('strokes')==[]
    expect(editor).to_have_value('未 reset 的原文件草稿');editor.press('Escape')
    # A save acknowledgement from the old context cannot dismiss its retained draft.
    page.evaluate("mode='pending';ink.openTextAt(350,280)");editor.fill('旧请求草稿')
    page.get_by_role('button',name='画笔',exact=True).click()
    page.evaluate("context='third:file';strokes=[];saveResolve(true)")
    expect(editor).to_have_attribute('data-save-state','failed')
    assert page.evaluate('ink.hasTextDraft()')
    assert page.evaluate('strokes')==[]
    page.get_by_role('button',name='文字',exact=True).click();editor.press('Escape')
    page.evaluate("mode='ok'")
    # Context changes quarantine rather than writing into another file/user.
    page.evaluate('ink.openTextAt(350,280)');editor.fill('原文件草稿')
    page.evaluate("context='other:file';strokes=[];ink.reset({keepTool:true})")
    assert page.evaluate('ink.hasTextDraft()')
    assert page.evaluate('ink.commitText()') is False
    assert page.evaluate('strokes')==[]
    expect(editor).to_have_value('原文件草稿');editor.press('Escape')
    assert page.evaluate('ink.hasTextDraft()') is False
    assert page.evaluate('strokes')==[]
    # Switching during IME is immediate, committing only after composition ends.
    page.evaluate('ink.openTextAt(250,200)');editor.fill('拼音输入')
    editor.evaluate("el=>el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}))")
    page.get_by_role('button',name='画笔',exact=True).click();assert page.evaluate('ink.tool')=='pen'
    assert page.evaluate('ink.hasTextDraft()')
    editor.evaluate("el=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}))")
    expect(editor).to_have_count(0)
    # A delayed blur from suspending cannot retry a draft that regained focus.
    page.evaluate("mode='failed';ink.openTextAt(250,200)");editor.fill('恢复焦点后保留')
    count=page.evaluate('writes')
    page.evaluate("ink.setTool('pen');ink.setTool('text')")
    expect(editor).to_be_focused();page.wait_for_timeout(220)
    assert page.evaluate('writes')==count+1, 'Stale blur must not retry a resumed draft'
    expect(editor).to_have_value('恢复焦点后保留');editor.press('Escape')
    page.evaluate("mode='ok'")
    # Empty new text creates no object or network save.
    count=page.evaluate('writes');page.evaluate('ink.openTextAt(250,200)');page.get_by_role('button',name='画笔',exact=True).click()
    expect(editor).to_have_count(0);assert page.evaluate('writes')==count
    # An expired session can open a previously closed toolbar and select tools,
    # while all drawing/text creation remains readonly. Viewers retain their lock.
    page.evaluate('''()=>{ink.destroy();window.paused=false;window.locked=false;
      const launch=document.createElement('button');launch.id='launch';launch.textContent='打开画笔';document.body.prepend(launch);
      window.ink=KGCanvasInk.create({trigger:launch,viewport:document.querySelector('#view'),world:document.querySelector('#world'),getViewport:()=>({x:0,y:0,scale:1}),getStrokes:()=>strokes,setStrokes:s=>{changes++;strokes=s},isReadonly:()=>locked,allowReadonlyToolSelection:()=>paused});
      window.closedSnapshot=JSON.stringify(strokes);window.closedChanges=changes;
      paused=true;locked=true;ink.render()}''')
    launch=page.locator('#launch');expect(page.locator('.canvas-ink-toolbar')).to_be_hidden()
    expect(launch).to_be_enabled(timeout=1000);launch.click();expect(page.locator('.canvas-ink-toolbar')).to_be_visible()
    page.get_by_role('button',name='画笔',exact=True).click();assert page.evaluate('ink.tool')=='pen'
    page.mouse.move(700,400);page.mouse.down();page.mouse.move(760,440,steps=3);page.mouse.up()
    page.get_by_role('button',name='文字',exact=True).click();assert page.evaluate('ink.tool')=='text'
    page.mouse.click(600,300);expect(editor).to_have_count(0)
    assert page.evaluate('ink.openTextAt(500,300)') is False
    page.evaluate('ink.setOpen(false)');expect(page.locator('.canvas-ink-toolbar')).to_be_hidden()
    assert page.evaluate('ink.activateText()') is True
    assert page.evaluate('ink.tool')=='text';expect(page.locator('.canvas-ink-toolbar')).to_be_visible()
    assert page.evaluate('JSON.stringify(strokes)===closedSnapshot && changes===closedChanges')
    page.evaluate('ink.setOpen(false);paused=false;ink.render()');expect(launch).to_be_disabled()
    assert page.evaluate('ink.activateText()') is False
    page.evaluate('ink.setOpen(true)');expect(page.locator('.canvas-ink-toolbar')).to_be_hidden()
    assert page.evaluate('JSON.stringify(strokes)===closedSnapshot && changes===closedChanges')
    browser.close()
print('canvas-ink-draft-recovery-browser: passed')
