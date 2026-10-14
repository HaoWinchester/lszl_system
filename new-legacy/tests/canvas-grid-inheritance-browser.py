"""Grid animation stays on its surface rather than invalidating card descendants."""
from pathlib import Path
from playwright.sync_api import sync_playwright

css=(Path(__file__).resolve().parents[1]/'styles/unified-canvas-runtime.css').read_text()
with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome')
    page=browser.new_page()
    page.set_content('<style>'+css+'</style><main class="uc-canvas-surface" data-canvas-pattern="grid" style="--uc-canvas-grid-x:9px;--uc-canvas-grid-y:7px;--uc-canvas-grid-size:18px;--uc-canvas-grid-major-size:72px"><div class="knowledge-card"><span>card</span></div></main>')
    actual=page.evaluate('''()=>{const surface=document.querySelector('main'),card=document.querySelector('span');const keys=['--uc-canvas-grid-x','--uc-canvas-grid-y','--uc-canvas-grid-size','--uc-canvas-grid-major-size'];return{surface:keys.map(k=>getComputedStyle(surface).getPropertyValue(k).trim()),card:keys.map(k=>getComputedStyle(card).getPropertyValue(k).trim()),background:getComputedStyle(surface).backgroundPosition}}''')
    assert actual['surface']==['9px','7px','18px','72px'],actual
    assert actual['card']==['0px','0px','24px','96px'],actual
    assert actual['background'].startswith('9px 7px'),actual
    browser.close()
print('canvas grid inheritance browser passed')
