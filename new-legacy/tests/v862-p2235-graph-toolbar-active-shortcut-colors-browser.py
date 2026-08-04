from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
def text(path): return (ROOT/path).read_text(encoding='utf-8')
def body_html(path):
    match=re.search(r'<body[^>]*>(.*)</body>',text(path),re.S)
    return match.group(1) if match else text(path)
def add_script(page,path): page.add_script_tag(content=text(path))

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'])
    page=browser.new_page(viewport={'width':1400,'height':900})
    page.set_content('<body>'+body_html('index.html')+'</body>')
    page.add_style_tag(content=text('styles/main.css'))
    for script in ['src/00-config-state.js','src/09-graph-connector-drag-controller.js','src/10-graph-editor.js','src/19-home-toolbar-registry.js','src/20-flashcards-toolbar.js']:
        add_script(page,script)
    page.evaluate('render()')

    focus=page.locator('#focusBtn')
    assert focus.count()==1
    before=focus.evaluate("el=>({bg:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color,active:el.classList.contains('active-toggle')})")
    assert before['bg'] in ('rgb(255, 255, 255)','rgba(255, 255, 255, 1)')
    assert before['active'] is False

    focus.click()
    page.wait_for_timeout(240)
    after=focus.evaluate("el=>({bg:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color,active:el.classList.contains('active-toggle')})")
    assert after['active'] is True
    assert after['bg']=='rgb(17, 24, 39)'
    assert after['color']=='rgb(255, 255, 255)'

    size_trigger=page.locator('#sizeMenuBtn')
    size_trigger.click()
    page.wait_for_timeout(240)
    menu_state=size_trigger.evaluate("el=>({bg:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color,open:el.closest('.floating-tool-menu-shell').classList.contains('menu-open')})")
    assert menu_state=={'bg':'rgb(17, 24, 39)','color':'rgb(255, 255, 255)','open':True}

    shortcuts=browser.new_page()
    shortcuts.set_content('''<body>
      <a class="kg-global-shortcuts-link training"><svg></svg></a>
      <a class="kg-global-shortcuts-link recall"><svg></svg></a>
      <a class="kg-global-shortcuts-link bank current"><svg></svg></a>
    </body>''')
    shortcuts.add_style_tag(content=text('styles/global-shortcuts.css'))
    inactive_colors=shortcuts.locator('a:not(.current)').evaluate_all("els=>els.map(el=>getComputedStyle(el).color)")
    assert inactive_colors==['rgb(17, 24, 39)','rgb(17, 24, 39)']
    active=shortcuts.locator('a.current').evaluate("el=>({color:getComputedStyle(el).color,bg:getComputedStyle(el).backgroundImage})")
    assert active['color']=='rgb(255, 255, 255)'
    assert active['bg']!='none'

    shortcuts.close();page.close();browser.close()

print('v862-p2235-graph-toolbar-active-shortcut-colors-browser-ok')
