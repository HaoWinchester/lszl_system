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
    page.add_style_tag(content=text('styles/global-shortcuts.css'))
    for script in ['src/00-config-state.js','src/09-graph-connector-drag-controller.js','src/10-graph-editor.js','src/19-home-toolbar-registry.js','src/20-flashcards-toolbar.js']:
        add_script(page,script)
    page.evaluate('render()')

    assert page.locator('.learning-mode-entry').inner_text().strip()=='学习模式'

    tool_colors=page.locator('.floating-toolbox .floating-tool-btn').evaluate_all("els=>els.map(el=>getComputedStyle(el).backgroundColor)")
    assert tool_colors and all(color in ('rgb(255, 255, 255)','rgba(255, 255, 255, 1)') for color in tool_colors)

    source=page.locator('.knowledge-card').first
    source.click();page.wait_for_timeout(80)
    handle=page.locator('.node-growth-handle.node-growth-right')
    assert handle.count()==1
    page.evaluate("""()=>{
      const layer=document.querySelector('.node-growth-layer');
      window.__growthStable={handle:document.querySelector('.node-growth-handle.node-growth-right'),added:0,removed:0};
      window.__growthStable.observer=new MutationObserver(records=>records.forEach(record=>{
        for(const node of record.addedNodes){if(node.nodeType===1&&node.matches?.('.node-growth-handle'))window.__growthStable.added++}
        for(const node of record.removedNodes){if(node.nodeType===1&&node.matches?.('.node-growth-handle'))window.__growthStable.removed++}
      }));
      window.__growthStable.observer.observe(layer,{childList:true});
    }""")
    title_before=source.locator('.node-title').inner_text()
    handle.hover();page.wait_for_timeout(360)
    assert page.locator('.node-growth-preview-card').count()==1
    stability=page.evaluate("""()=>({
      same:window.__growthStable.handle===document.querySelector('.node-growth-handle.node-growth-right'),
      connected:window.__growthStable.handle.isConnected,
      added:window.__growthStable.added,
      removed:window.__growthStable.removed
    })""")
    assert stability=={'same':True,'connected':True,'added':0,'removed':0}
    samples=[]
    for _ in range(8):
        samples.append(handle.evaluate("el=>{const s=getComputedStyle(el,'::before');return [s.width,s.height,s.transform]}"))
        page.wait_for_timeout(25)
    assert len({tuple(item) for item in samples})==1
    assert source.locator('.node-title').inner_text()==title_before

    shortcuts=browser.new_page()
    shortcuts.set_content('<body><a class="kg-global-shortcuts-link training">训练</a><a class="kg-global-shortcuts-link training current">当前训练</a></body>')
    shortcuts.add_style_tag(content=text('styles/global-shortcuts.css'))
    inactive=shortcuts.locator('a').nth(0).evaluate("el=>getComputedStyle(el).backgroundColor")
    active=shortcuts.locator('a').nth(1).evaluate("el=>getComputedStyle(el).backgroundImage")
    assert inactive in ('rgb(255, 255, 255)','rgba(255, 255, 255, 1)')
    assert active!='none'
    shortcuts.close();page.close();browser.close()

print('v862-p2234-graph-toolbar-shortcut-handle-stability-browser-ok')
