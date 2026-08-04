from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
def text(p): return (ROOT/p).read_text()

with sync_playwright() as p:
    b=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'])
    page=b.new_page(viewport={'width':1100,'height':720})
    page.set_content("""<body class="question-workspace-page">
      <article class="qw-question-card is-selected show-connectors" style="position:absolute;left:200px;top:160px;width:400px;height:280px">
        <button class="qw-card-connector is-top"></button><button class="qw-card-connector is-right"></button><button class="qw-card-connector is-bottom"></button><button class="qw-card-connector is-left"></button>
      </article>
      <div class="qw-selection-toolbar qw-selection-toolbar-pro" id="qwSelectionToolbar">
        <span class="qw-selection-count">多选（3）</span>
        <div class="qw-selection-menu-wrap"><button></button><div class="qw-selection-popover qw-selection-align-menu"><strong>对齐</strong><div class="qw-align-grid"><button>↤</button><button>↔</button></div></div></div>
      </div>
    </body>""")
    page.add_style_tag(content=text('styles/question-workspace.css'))
    card=page.locator('.qw-question-card')
    cb=card.bounding_box()
    top=page.locator('.qw-card-connector.is-top');right=page.locator('.qw-card-connector.is-right')
    tb=top.bounding_box();rb=right.bounding_box()
    assert cb and tb and rb
    assert abs((tb['x']+tb['width']/2)-(cb['x']+cb['width']/2))<2
    assert abs((rb['y']+rb['height']/2)-(cb['y']+cb['height']/2))<2
    assert page.locator('.qw-selection-toolbar-pro').is_visible()
    assert page.locator('.qw-selection-align-menu').is_visible()
    page.close();b.close()
print('v862-p2214-interaction-layout-browser-ok')
