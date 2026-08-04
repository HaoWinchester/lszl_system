#!/usr/bin/env python3
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
ARGS=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=ARGS)
    page=browser.new_page(viewport={'width':1100,'height':760});page.set_default_timeout(8000)
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content('<!doctype html><html><body><div id="status"></div></body></html>')
    page.evaluate("""()=>{
      const data=new Map();
      Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>data.has(k)?data.get(k):null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)}});
      window.__role='guest';
      window.KGRolePermissions={
        currentRole:()=>window.__role,
        currentUser:()=>window.__role==='guest'?null:{role:window.__role,username:window.__role},
        can:permission=>window.__role==='admin'||(window.__role==='teacher'&&permission!=='accessUserManagement'&&permission!=='accessSystemSettings')
      };
    }""")
    page.add_script_tag(content=(ROOT/'src/39-global-shortcuts.js').read_text(encoding='utf-8'))
    page.wait_for_timeout(80)
    def labels(): return page.locator('[data-global-shortcut] span').all_inner_texts()
    assert labels()==['首页','多题画布','深度回忆'],labels()
    for role in ['viewer','student']:
      page.evaluate(f"window.__role='{role}';KGGlobalShortcuts.render()")
      assert labels()==['首页','多题画布','深度回忆'],(role,labels())
      assert page.locator('[data-global-shortcut="users"]').count()==0
    page.evaluate("window.__role='admin';KGGlobalShortcuts.render()")
    assert page.locator('[data-global-shortcut="users"]').count()==1
    assert page.locator('[data-global-shortcut="settings"]').count()==1
    assert not errors,errors
    browser.close()
print('v90-p402-navigation-role-danger-browser-ok')
