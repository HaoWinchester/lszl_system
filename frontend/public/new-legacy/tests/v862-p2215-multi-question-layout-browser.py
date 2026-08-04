from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
def text(p): return (ROOT/p).read_text()
def body_html(p):
    s=text(p)
    m=re.search(r'<body[^>]*>([\s\S]*)</body>',s,re.I)
    return re.sub(r'<script[\s\S]*?</script>','',m.group(1),flags=re.I)

with sync_playwright() as p:
    b=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'])
    page=b.new_page(viewport={'width':1200,'height':760})
    page.set_content('<meta name="viewport" content="width=device-width,initial-scale=1"><body class="question-workspace-page">'+body_html('question-workspace.html')+'</body>')
    page.add_style_tag(content=text('styles/question-workspace.css'))
    page.add_style_tag(content=text('styles/learning-practice-shell.css'))

    # Top-left library button and filename bar share the same top and height.
    q=page.locator('#qwQuestionDockBtn').bounding_box()
    f=page.locator('#qwWorkspaceFilebar').bounding_box()
    assert q and f,(q,f)
    assert abs(q['y']-f['y'])<1.5,(q,f)
    assert abs(q['height']-f['height'])<1.5,(q,f)

    # White preset is visible.
    assert page.locator('[data-qw-selection-color="#ffffff"]').count()==1
    assert page.locator('#qwSynthesisColor option[value="#ffffff"]').count()==1
    assert page.locator('#qwGroupColor option[value="#ffffff"]').count()==1

    # Build a question card and a synthesis card with identical connector UI.
    page.locator('#qwNodeLayer').evaluate("""el=>{
      el.innerHTML=`
        <article class="qw-question-card show-connectors" data-node-id="q1" style="left:220px;top:190px;width:400px;height:280px">
          <header class="qw-card-header"></header><div class="qw-card-body"></div>
          <button class="qw-card-connector is-top"></button><button class="qw-card-connector is-right"></button>
          <button class="qw-card-connector is-bottom"></button><button class="qw-card-connector is-left"></button>
        </article>
        <article class="qw-question-card qw-synthesis-card qw-synthesis-principle show-connectors" data-node-id="s1" style="left:700px;top:190px;width:400px;height:280px">
          <header class="qw-card-header"></header><div class="qw-card-body"></div>
          <button class="qw-card-connector is-top"></button><button class="qw-card-connector is-right"></button>
          <button class="qw-card-connector is-bottom"></button><button class="qw-card-connector is-left"></button>
        </article>`; }""")
    for selector in ('[data-node-id="q1"]','[data-node-id="s1"]'):
        card=page.locator(selector)
        cb=card.bounding_box()
        assert cb
        top=card.locator('.is-top').bounding_box()
        right=card.locator('.is-right').bounding_box()
        bottom=card.locator('.is-bottom').bounding_box()
        left=card.locator('.is-left').bounding_box()
        assert top and right and bottom and left
        # Entire dot sits outside the card border, not straddling the edge.
        assert top['y']+top['height'] < cb['y'],(selector,cb,top)
        assert right['x'] > cb['x']+cb['width'],(selector,cb,right)
        assert bottom['y'] > cb['y']+cb['height'],(selector,cb,bottom)
        assert left['x']+left['width'] < cb['x'],(selector,cb,left)

    # Floating selection toolbar and connector dots are fully hidden during motion.
    toolbar=page.locator('#qwSelectionToolbar')
    toolbar.evaluate("el=>{el.hidden=false}")
    page.locator('body').evaluate("el=>el.classList.add('qw-selection-toolbar-motion')")
    assert not toolbar.is_visible()
    assert not page.locator('[data-node-id="q1"] .qw-card-connector.is-top').is_visible()

    assert page.evaluate("document.documentElement.scrollWidth-document.documentElement.clientWidth")<=4
    page.close();b.close()

print('v862-p2215-multi-question-layout-browser-ok')
