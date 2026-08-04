from pathlib import Path
import re
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
def text(p): return (ROOT/p).read_text()
def body_html(p):
    s=text(p);m=re.search(r'<body[^>]*>([\s\S]*)</body>',s,re.I);return re.sub(r'<script[\s\S]*?</script>','',m.group(1),flags=re.I)
with sync_playwright() as p:
    b=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'])
    page=b.new_page(viewport={'width':1366,'height':768})
    page.set_content('<meta name="viewport" content="width=device-width,initial-scale=1"><body class="question-training-page">'+body_html('question-training.html')+'</body>')
    for st in ['styles/question-training.css','styles/progress-workspace-dock.css','styles/dual-canvas.css','styles/learning-practice-shell.css']: page.add_style_tag(content=text(st))
    modal=page.locator('.question-modal').bounding_box();shell=page.locator('#questionModal').bounding_box();assert modal and shell;assert abs(modal['width']-shell['width'])<2
    assert page.locator('.qt-learning-head').count()==0;assert page.locator('#qtFontScaleBtn').count()==1;assert page.locator('.qt-canvas-font-menu').count()==0
    top=page.locator('.qt-canvas-topline').bounding_box();prog=page.locator('#qtWorkflow').bounding_box();right=page.locator('.qt-canvas-topline-right').bounding_box();assert top and prog and right
    assert abs(prog['y']-top['y'])<4 and abs(right['y']-top['y'])<4
    page.add_script_tag(content=text('src/80-question-font-scale.js'));page.wait_for_timeout(360)
    assert page.locator('#questionModal').get_attribute('data-q-font-size')=='normal'
    page.locator('#qtFontScaleBtn').click();assert page.locator('#questionModal').get_attribute('data-q-font-size')=='large'
    page.locator('#qtFontScaleBtn').click();assert page.locator('#questionModal').get_attribute('data-q-font-size')=='xlarge'
    page.locator('#qtFontScaleBtn').click();assert page.locator('#questionModal').get_attribute('data-q-font-size')=='normal'
    page.close();b.close()
print('v862-p226-single-deep-cleanup-browser-ok')
