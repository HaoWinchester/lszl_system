from pathlib import Path
import re
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
def text(p):return (ROOT/p).read_text()
def body_html(p):
 s=text(p);m=re.search(r'<body[^>]*>([\s\S]*)</body>',s,re.I);return re.sub(r'<script[\s\S]*?</script>','',m.group(1),flags=re.I)
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'])
 page=b.new_page(viewport={'width':1366,'height':768});page.set_content('<meta name="viewport" content="width=device-width,initial-scale=1"><body class="question-training-page">'+body_html('question-training.html')+'</body>')
 for st in ['styles/question-training.css','styles/infinite-learning-canvas.css','styles/canvas-interaction-fixes.css','styles/compact-learning-shell.css','styles/dual-canvas.css','styles/learning-practice-shell.css']:page.add_style_tag(content=text(st))
 assert page.locator('#qtWorkflow .qt-workflow-tooltip small').count()==0
 step=page.locator('#qtWorkflow .qt-workflow-step').first;num=step.locator('.qt-workflow-number');sb=step.bounding_box();nb=num.bounding_box();assert sb and nb;assert abs((sb['x']+sb['width']/2)-(nb['x']+nb['width']/2))<1.1,(sb,nb);assert abs((sb['y']+sb['height']/2)-(nb['y']+nb['height']/2))<1.1,(sb,nb)
 group=page.locator('.qt-question-library-nav');assert group.locator('#qtPrevQuestionBtn').count()==1 and group.locator('#qtQuestionListBtn').count()==1 and group.locator('#qtNextQuestionBtn').count()==1
 drawer=page.locator('#qtQuestionDrawer');drawer.evaluate("el=>el.classList.add('open')");page.wait_for_timeout(20);box=drawer.bounding_box();assert box and 63<=box['y']<=73 and box['height']>=694,(box);assert int(float(drawer.evaluate("el=>getComputedStyle(el).zIndex")))>=5000
 zoom=page.locator('#qtCanvasZoomDock').bounding_box();action=page.locator('.qt-guided-dock-compact').bounding_box();mapbtn=page.locator('#qtMinimapToggleBtn').bounding_box();assert zoom and action and mapbtn;bottoms=[zoom['y']+zoom['height'],action['y']+action['height'],mapbtn['y']+mapbtn['height']];assert max(bottoms)-min(bottoms)<3,bottoms
 dock=page.locator('#qtMinimapDock');assert dock.evaluate("el=>el.classList.contains('collapsed')");assert page.locator('#qtMinimapToggleBtn').count()==1;dock.evaluate("el=>el.classList.remove('collapsed')");page.wait_for_timeout(20);assert page.locator('#qtCanvasMinimap').is_visible();dock.evaluate("el=>el.classList.add('collapsed')");assert dock.evaluate("el=>el.classList.contains('collapsed')")
 page.close();b.close()
print('v862-p227-single-deep-bottom-toolbar-minimap-browser-ok')
