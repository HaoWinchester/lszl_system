from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
def text(path): return (ROOT/path).read_text(encoding='utf-8')
def body_html(path):
    match=re.search(r'<body[^>]*>(.*)</body>',text(path),re.S)
    return match.group(1) if match else text(path)

def add_script(page,path): page.add_script_tag(content=text(path))

def rgb_red(value): return value in ('rgb(239, 68, 68)','rgba(239, 68, 68, 1)')

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'])
    page=browser.new_page(viewport={'width':1400,'height':900})
    page.set_content('<body>'+body_html('index.html')+'</body>')
    page.add_style_tag(content=text('styles/main.css'))
    for script in ['src/00-config-state.js','src/09-graph-connector-drag-controller.js','src/10-graph-editor.js','src/20-flashcards-toolbar.js']:
        add_script(page,script)
    page.evaluate('render()')
    assert page.locator('.knowledge-card').count()>=2

    first=page.locator('.knowledge-card').first
    first.hover()
    assert rgb_red(first.evaluate("el=>getComputedStyle(el).outlineColor"))

    pair=page.evaluate("""()=>{for(const a of state.nodes){for(const b of state.nodes){if(a.id!==b.id&&!relationExists(a.id,b.id))return [a.id,b.id]}}return null}""")
    assert pair
    source=page.locator(f'.knowledge-card[data-node-id="{pair[0]}"]')
    target=page.locator(f'.knowledge-card[data-node-id="{pair[1]}"]')
    source.click();page.wait_for_timeout(60)
    handle=page.locator('.node-growth-handle.node-growth-right')
    hb,tb=handle.bounding_box(),target.bounding_box()
    assert hb and tb
    before_links=page.evaluate('state.links.length')
    page.mouse.move(hb['x']+hb['width']/2,hb['y']+hb['height']/2)
    page.mouse.down()
    page.mouse.move(tb['x']+tb['width']/2,tb['y']+tb['height']/2,steps=8)
    page.wait_for_timeout(50)
    assert page.locator('.edge-connect-draft').count()==1
    assert target.evaluate("el=>el.classList.contains('is-connector-drag-target')")
    page.mouse.up();page.wait_for_timeout(120)
    assert page.evaluate('state.links.length')==before_links+1
    last=page.evaluate('state.links[state.links.length-1]')
    assert last['type']==''
    assert page.locator(f'[data-link-id="{last["id"]}"] .edge-label').count()==0

    # A click still keeps the original quick-create behavior, but its new edge is also label-free.
    before=page.evaluate('[state.nodes.length,state.links.length]')
    page.locator('.node-growth-handle.node-growth-bottom').click();page.wait_for_timeout(120)
    after=page.evaluate('[state.nodes.length,state.links.length,state.links[state.links.length-1].type]')
    assert after==[before[0]+1,before[1]+1,'']
    page.close()

    workspace=browser.new_page(viewport={'width':1000,'height':700})
    workspace.set_content('<body class="question-workspace-page qw-light-canvas"><article class="qw-question-card" style="left:100px;top:100px;width:360px;height:240px"></article></body>')
    workspace.add_style_tag(content=text('styles/question-workspace.css'))
    card=workspace.locator('.qw-question-card');card.hover()
    assert rgb_red(card.evaluate("el=>getComputedStyle(el).outlineColor"))
    workspace.close();browser.close()

print('v862-p2228-graph-hover-drag-connect-browser-ok')
