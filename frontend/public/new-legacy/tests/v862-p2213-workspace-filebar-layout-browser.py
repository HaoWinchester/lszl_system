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
    page=b.new_page(viewport={'width':1366,'height':760})
    page.set_content('<meta name="viewport" content="width=device-width,initial-scale=1"><body class="question-workspace-page">'+body_html('question-workspace.html')+'</body>')
    for st in ['styles/question-workspace.css','styles/learning-practice-shell.css']:
        page.add_style_tag(content=text(st))
    assert page.locator('#qwPageTitle').count()==0
    filebar=page.locator('#qwWorkspaceFilebar');save=page.locator('#qwWorkspaceSaveState');chip=page.locator('#qwWorkspaceChip')
    assert filebar.count()==1 and save.count()==1 and chip.count()==1
    fb=filebar.bounding_box();sb=save.bounding_box();cb=chip.bounding_box()
    assert fb and sb and cb
    assert sb['x']>=fb['x'] and cb['x']>sb['x']
    assert abs((sb['y']+sb['height']/2)-(cb['y']+cb['height']/2))<2
    assert page.evaluate("document.documentElement.scrollWidth-document.documentElement.clientWidth")<=3
    page.close();b.close()
print('v862-p2213-workspace-filebar-layout-browser-ok')
