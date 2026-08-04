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
    for st in ['styles/question-workspace.css','styles/learning-practice-shell.css']:
        page.add_style_tag(content=text(st))
    assert page.locator('.qw-top-actions a').count()==0
    assert page.locator('.qw-back').get_attribute('href')=='index.html?mode=free'
    dock=page.locator('#qwBottomRightDock')
    assert dock.evaluate("el=>el.classList.contains('collapsed')")
    assert page.locator('#qwHelpBtn').count()==1
    assert page.locator('#qwMinimapToggleBtn').count()==1
    dock.evaluate("el=>el.classList.remove('collapsed')")
    page.wait_for_timeout(20)
    assert page.locator('#qwMinimap').is_visible()
    assert page.locator('.qw-help-more').get_attribute('href')=='multi-question-help.html'
    page.close()
    b.close()
print('v862-p2211-multi-question-nav-help-minimap-browser-ok')
