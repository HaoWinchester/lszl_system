from pathlib import Path
import re
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
def text(p):return (ROOT/p).read_text()
def body_html(p):
 s=text(p);m=re.search(r'<body[^>]*>([\s\S]*)</body>',s,re.I);return re.sub(r'<script[\s\S]*?</script>','',m.group(1),flags=re.I)
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'])
 page=b.new_page(viewport={'width':1366,'height':768})
 page.set_content('<meta name="viewport" content="width=device-width,initial-scale=1"><body class="question-training-page">'+body_html('question-training.html')+'</body>')
 for st in ['styles/question-training.css','styles/infinite-learning-canvas.css','styles/canvas-interaction-fixes.css','styles/compact-learning-shell.css','styles/dual-canvas.css','styles/learning-practice-shell.css']:page.add_style_tag(content=text(st))
 page.add_script_tag(content=text('src/99-learning-practice-shell.js'));page.wait_for_timeout(60)
 topbar=page.locator('.qt-topbar').bounding_box();drawer=page.locator('#qtQuestionDrawer');drawer.evaluate("el=>el.classList.add('open')");page.wait_for_timeout(220);box=drawer.bounding_box()
 assert topbar and box;expected=topbar['y']+topbar['height'];assert abs(box['y']-expected)<1.5,(topbar,box);assert abs((box['y']+box['height'])-768)<2.5,(box)
 zoom=page.locator('#qtCanvasZoomDock').bounding_box();action=page.locator('.qt-guided-dock-compact').bounding_box();mapbtn=page.locator('#qtMinimapToggleBtn').bounding_box()
 status=page.locator('#status');status.evaluate("el=>{el.textContent='测试提醒';el.style.display='flex';el.classList.add('show')}");page.wait_for_timeout(30);sb=status.bounding_box()
 assert zoom and action and mapbtn and sb;bottoms=[zoom['y']+zoom['height'],action['y']+action['height'],mapbtn['y']+mapbtn['height'],sb['y']+sb['height']];assert max(bottoms)-min(bottoms)<3,bottoms
 page.close();b.close()
print('v862-p228-drawer-status-alignment-browser-ok')
