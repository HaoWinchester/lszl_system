from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
def text(p): return (ROOT/p).read_text()
with sync_playwright() as p:
    b=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'])
    page=b.new_page(viewport={'width':1366,'height':768})
    page.set_content('<body><div id="status"></div></body>')
    page.add_style_tag(content=text('styles/global-shortcuts.css'))
    page.evaluate("""()=>{
      const m=new Map();
      Object.defineProperty(window,'localStorage',{configurable:true,value:{
        getItem:k=>m.has(k)?m.get(k):null,
        setItem:(k,v)=>m.set(k,String(v)),
        removeItem:k=>m.delete(k)
      }});
      window.KGRolePermissions={currentUser:()=>({username:'student'}),can:()=>true,canEnterUserManagement:()=>false};
    }""")
    page.add_script_tag(content=text('src/39-global-shortcuts.js'))
    page.wait_for_timeout(60)
    bar=page.locator('#kgGlobalShortcuts')
    box=bar.bounding_box()
    assert box and box['width']<=56,box
    workspace=page.locator('[data-global-shortcut="workspace"]')
    assert workspace.count()==1
    assert workspace.get_attribute('href')=='question-workspace.html'
    assert workspace.get_attribute('title')=='多题画布'
    assert workspace.locator('span').evaluate("el=>getComputedStyle(el).display")=='none'
    visible=bar.inner_text().strip()
    assert '多题画布' not in visible and '考题训练' not in visible and '全局快捷' not in visible
    link_box=workspace.bounding_box()
    assert link_box and 35<=link_box['width']<=39 and 35<=link_box['height']<=39,link_box
    page.close();b.close()
print('v862-p2210-compact-global-shortcuts-browser-ok')
