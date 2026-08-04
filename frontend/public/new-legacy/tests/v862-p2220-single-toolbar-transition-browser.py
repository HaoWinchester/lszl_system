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
    single=b.new_page(viewport={'width':1200,'height':760})
    single.set_content('<body class="question-training-page">'+body_html('question-training.html')+'</body>')
    single.locator('html').evaluate("el=>el.classList.add('qt-incoming-question-pending')")
    for st in ['styles/question-training.css','styles/dual-canvas.css','styles/learning-practice-shell.css','styles/question-training-p2220.css']:
        single.add_style_tag(content=text(st))
    loader=single.locator('#qtQuestionSwitchLoader')
    assert loader.is_visible()
    single.wait_for_timeout(220)
    assert float(single.locator('#qtAnswerCardHost').evaluate("el=>getComputedStyle(el).opacity")) < .3
    left_single=single.locator('.qt-question-library-nav').bounding_box()
    right_single=single.locator('.qt-canvas-overlay-right').bounding_box()
    font_single=single.locator('#qtFontScaleBtn').evaluate("el=>getComputedStyle(el).fontSize")
    assert left_single and right_single
    multi=b.new_page(viewport={'width':1200,'height':760})
    multi.set_content('<body class="question-workspace-page">'+body_html('question-workspace.html')+'</body>')
    for st in ['styles/question-workspace.css','styles/learning-practice-shell.css','styles/question-workspace-p2218.css','styles/question-workspace-p2219.css']:
        multi.add_style_tag(content=text(st))
    left_multi=multi.locator('#qwQuestionDockBtn').bounding_box()
    right_multi=multi.locator('.qw-overlay-right').bounding_box()
    font_multi=multi.locator('#qwFontScaleBtn').evaluate("el=>getComputedStyle(el).fontSize")
    assert left_multi and right_multi
    assert abs(left_single['height']-left_multi['height']) < 1.5,(left_single,left_multi)
    assert abs(right_single['height']-right_multi['height']) < 1.5,(right_single,right_multi)
    assert abs(float(font_single.replace('px',''))-float(font_multi.replace('px',''))) < 1.0,(font_single,font_multi)
    single.close();multi.close();b.close()
print('v862-p2220-single-toolbar-transition-browser-ok')
