from pathlib import Path
import re
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
ARGS=['--no-sandbox','--disable-dev-shm-usage','--use-gl=swiftshader']
def text(path): return (ROOT/path).read_text(encoding='utf-8')
def body_html():
    source=text('learning-path.html')
    match=re.search(r'<body[^>]*>([\s\S]*)</body>',source,re.I)
    return re.sub(r'<script[\s\S]*?</script>','',match.group(1),flags=re.I)
def prepare(page):
    page.set_content('<body class="guided-learning-page">'+body_html()+'</body>')
    for file in ['styles/main.css','styles/guided-learning-path.css','styles/subscription.css','styles/user-center.css','styles/account-menu.css']:
        page.add_style_tag(content=text(file))
    page.evaluate("""()=>{const data=new Map();Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:key=>data.has(key)?data.get(key):null,setItem:(key,value)=>data.set(key,String(value)),removeItem:key=>data.delete(key),clear:()=>data.clear()}});Object.defineProperty(window,'sessionStorage',{configurable:true,value:{getItem:key=>data.has('s:'+key)?data.get('s:'+key):null,setItem:(key,value)=>data.set('s:'+key,String(value)),removeItem:key=>data.delete('s:'+key)}});window.confirm=()=>true;}""")
    files=['src/01-runtime-config.js','src/28-app-storage.js','src/29-auth-core.js','src/30-standalone-auth-dialog.js','src/34-role-permissions.js','src/63-learning-event-repository.js','src/86-activity-schema-v1.js','src/87-guided-learning-data.js','src/94-practice-navigation.js','src/88-guided-learning-store.js','src/89-guided-learning-icon-registry.js','src/89-guided-learning-path-layout.js','src/41-account-menu.js','src/89-guided-learning-app.js']
    for file in files: page.add_script_tag(content=text(file))
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
    page.wait_for_timeout(350)
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=ARGS)
    page=browser.new_page(viewport={'width':1366,'height':768})
    errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    prepare(page)
    assert not errors,errors
    scroller=page.locator('#glStagePathScroll')
    metrics=scroller.evaluate("e=>({scrollHeight:e.scrollHeight,clientHeight:e.clientHeight,overflow:getComputedStyle(e).overflowY})")
    assert metrics['clientHeight']>250 and metrics['scrollHeight']>metrics['clientHeight']*4,metrics
    scroller.hover();page.mouse.wheel(0,620);page.wait_for_timeout(160)
    assert scroller.evaluate('e=>e.scrollTop')>100
    assert page.locator('.gl-mode-choice').count()==2
    assert page.locator('.gl-mode-choice').nth(1).get_attribute('href')=='index.html?mode=free'
    page.locator('#authStatus').click();assert page.locator('#accountMenu').is_visible()
    toggle=page.locator('#glDefaultModeMenu');before=toggle.is_checked()
    page.locator('#glDefaultModeRow .account-menu-setting-label').click();page.wait_for_timeout(60)
    after=toggle.is_checked();assert after!=before
    assert page.evaluate('window.KGGuidedLearningStore.defaultMode()')==('learning' if after else 'free')
    page.locator('.account-menu-toggle-ui').click();page.wait_for_timeout(60)
    assert toggle.is_checked()!=after
    page.locator('#authStatus').click();assert not page.locator('#accountMenu').is_visible()
    page.locator('#glSubjectBtn').click();assert page.locator('#glSubjectMenu').is_visible()
    browser.close()
print('v862-p2233-guided-learning-interactions-browser-ok')
