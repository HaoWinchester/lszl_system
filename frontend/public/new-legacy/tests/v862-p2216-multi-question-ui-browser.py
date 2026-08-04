from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
def text(p): return (ROOT/p).read_text()
def body_html(p):
    s=text(p);m=re.search(r'<body[^>]*>([\s\S]*)</body>',s,re.I)
    return re.sub(r'<script[\s\S]*?</script>','',m.group(1),flags=re.I)

with sync_playwright() as p:
    b=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'])
    page=b.new_page(viewport={'width':1366,'height':768})
    page.set_content('<meta name="viewport" content="width=device-width,initial-scale=1"><body class="question-workspace-page">'+body_html('question-workspace.html')+'</body>')
    for st in ['styles/question-workspace.css','styles/learning-practice-shell.css','styles/user-center.css','styles/account-menu.css']:
        page.add_style_tag(content=text(st))

    # Conventional alignment menu has eight recognizable SVG buttons.
    align=page.locator('#qwSelectionAlignMenu [data-qw-arrange]')
    assert align.count()==8
    for i in range(8):
        assert align.nth(i).locator('svg').count()==1

    # Summary moved to bottom center and is horizontally aligned with zoom dock.
    summary=page.locator('#qwCanvasSummaryDock').bounding_box()
    zoom=page.locator('#qwCanvasZoomDock').bounding_box()
    assert summary and zoom,(summary,zoom)
    assert abs((summary['y']+summary['height']/2)-(zoom['y']+zoom['height']/2))<3,(summary,zoom)
    viewport=page.locator('#qwCanvasShell').bounding_box()
    assert viewport
    assert abs((summary['x']+summary['width']/2)-(viewport['x']+viewport['width']/2))<3,(summary,viewport)

    # No visible standalone logout; account capsule/menu is present.
    assert page.locator('#accountMenuShell').count()==1
    assert page.locator('#authLogoutBtn').is_hidden()
    assert page.locator('.auth-logout-btn').count()==0

    # Load the same account-menu controller used by Knowledge Graph.
    page.add_script_tag(content=text('src/41-account-menu.js'))
    page.wait_for_timeout(20)

    # Account menu opens from the capsule and contains session action.
    page.locator('#authStatus').click()
    assert page.locator('#accountMenu').is_visible()
    assert page.locator('#accountMenuSessionBtn').count()==1

    assert page.evaluate("document.documentElement.scrollWidth-document.documentElement.clientWidth")<=4
    page.close();b.close()

print('v862-p2216-multi-question-ui-browser-ok')
