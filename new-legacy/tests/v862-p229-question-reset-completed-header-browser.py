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
    page.set_content('<meta name="viewport" content="width=device-width,initial-scale=1"><body class="question-training-page">'+body_html('question-training.html')+'</body>')
    for st in ['styles/question-training.css','styles/infinite-learning-canvas.css','styles/canvas-interaction-fixes.css','styles/compact-learning-shell.css','styles/dual-canvas.css','styles/learning-practice-shell.css']:
        page.add_style_tag(content=text(st))

    # New reset icon sits in the right toolbar and is icon-only.
    reset=page.locator('#qtQuestionResetBtn')
    assert reset.count()==1
    assert reset.locator('svg').count()==1
    assert reset.inner_text().strip()==''

    # Completed card header becomes a clearly visible solid green strip.
    card=page.locator('#qtCanvasCardStep1')
    card.evaluate("el=>{el.classList.remove('current');el.classList.add('done')}")
    page.wait_for_timeout(20)
    header=card.locator('.qt-canvas-card-header')
    bg=header.evaluate("el=>getComputedStyle(el).backgroundColor")
    assert bg in ('rgb(22, 163, 74)','rgba(22, 163, 74, 1)'),bg
    title=card.locator('.qt-canvas-card-heading h3')
    assert title.evaluate("el=>getComputedStyle(el).color") in ('rgb(255, 255, 255)','rgba(255, 255, 255, 1)')
    status=card.locator('.qt-canvas-card-status')
    assert status.evaluate("el=>parseFloat(getComputedStyle(el).fontSize)")>=11
    page.close();b.close()
print('v862-p229-question-reset-completed-header-browser-ok')
