#!/usr/bin/env python3
"""Exercise the real shared dialog DOM, without native browser dialogs."""
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
assert (ROOT/'src/00-dialogs.js').exists(), 'shared asynchronous dialog component is required'
with sync_playwright() as p:
    browser=p.chromium.launch()
    page=browser.new_page(viewport={'width':390,'height':844})
    native=[]; errors=[]
    page.set_default_timeout(5000)
    page.on('dialog',lambda d:(native.append(d.type),d.dismiss()))
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content('<button id="origin">打开</button><div id="result"></div>')
    page.add_style_tag(path=str(ROOT/'styles/dialogs.css'))
    page.add_script_tag(path=str(ROOT/'src/00-dialogs.js'))
    page.locator('#origin').focus()
    page.evaluate("()=>{window.result='pending';KGDialogs.confirm('删除 <img src=x onerror=alert(1)>？',{danger:true}).then(v=>window.result=v)}")
    dialog=page.locator('dialog.kg-dialog')
    assert dialog.is_visible()
    assert dialog.locator('img').count()==0, 'messages must remain plain text'
    assert page.locator('[data-dialog-cancel]').evaluate('(el)=>el===document.activeElement')
    page.keyboard.press('Enter')
    page.wait_for_function('window.result===false')
    assert page.locator('#origin').evaluate('(el)=>el===document.activeElement')
    page.evaluate("()=>{window.result='pending';KGDialogs.confirm('确定删除？',{danger:true}).then(v=>window.result=v)}")
    page.locator('[data-dialog-accept]').click()
    page.wait_for_function('window.result===true')
    page.evaluate("()=>{window.result='pending';KGDialogs.prompt('名称','原名称').then(v=>window.result=v)}")
    page.locator('[data-dialog-input]').fill('新名称')
    page.keyboard.press('Enter')
    page.wait_for_function("window.result==='新名称'")
    page.evaluate("()=>{window.result='pending';KGDialogs.prompt('名称','保留').then(v=>window.result=v)}")
    page.keyboard.press('Escape')
    page.wait_for_function('window.result===null')
    page.evaluate("()=>{window.done=[];KGDialogs.alert('第一条').then(()=>done.push('alert'));KGDialogs.confirm('第二条').then(v=>done.push(v))}")
    assert page.locator('[data-dialog-message]').inner_text()=='第一条'
    page.locator('[data-dialog-accept]').click()
    assert page.locator('[data-dialog-message]').inner_text()=='第二条'
    page.locator('[data-dialog-close]').click()
    page.wait_for_function("JSON.stringify(done)===JSON.stringify(['alert',false])")
    page.evaluate("()=>{window.done=[];KGDialogs.confirm('旧账号删除').then(v=>done.push(v));KGDialogs.prompt('旧账号输入','').then(v=>done.push(v));window.dispatchEvent(new CustomEvent('kg-auth-session-change'))}")
    page.wait_for_function('done.length===2')
    assert page.evaluate('done')==[False,None]
    assert not dialog.is_visible()
    page.evaluate("()=>{KGDialogs.confirm('键盘焦点检查')}")
    page.locator('[data-dialog-accept]').focus()
    page.keyboard.press('Tab')
    assert dialog.evaluate('(el)=>el.contains(document.activeElement)')
    box=dialog.bounding_box();assert box['x']>=0 and box['x']+box['width']<=390
    page.keyboard.press('Escape')
    # Run the actual autosave conflict handler with the real dialog component.
    # Switching account during its await must end the entire old-owner chain.
    page.evaluate("""()=>{
      window.fixtureOwner='A';window.KGAuthCore={currentUser:()=>({username:fixtureOwner})};
      window.prepRuntime={draftId:'A-draft',dirty:true};window.markWorkspaceDirty=()=>{};
      window.updateWorkspaceSaveStatus=()=>{};window.toast=()=>{};window.recoveryActions=[];
      window.PMPPrepDraftUi={save:async()=>{throw Object.assign(new Error('conflict'),{status:409})},openDraft:async id=>recoveryActions.push(id)};
    }""")
    page.add_script_tag(path=str(ROOT/'content-prep-studio/src/js/38-shared-draft-autosave.js'))
    page.evaluate('()=>{window.PMPPrepAutosave.runNow()}')
    page.locator('[data-dialog-message]').filter(has_text='自动保存被拒绝').wait_for()
    page.evaluate("()=>{fixtureOwner='B';prepRuntime.draftId='B-draft';prepRuntime.dirty=false;window.dispatchEvent(new CustomEvent('kg-auth-session-change'))}")
    page.wait_for_function("!document.querySelector('dialog.kg-dialog').open")
    assert page.evaluate('recoveryActions')==[]
    assert page.evaluate('({id:prepRuntime.draftId,dirty:prepRuntime.dirty})')=={'id':'B-draft','dirty':False}
    assert not native and not errors, (native,errors)
    browser.close()
print('shared dialogs: alert/confirm/prompt, safe cancellation, queue, owner change, focus, mobile passed')
