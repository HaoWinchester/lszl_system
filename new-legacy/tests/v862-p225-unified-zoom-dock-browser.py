from pathlib import Path
import re
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
def text(p): return (ROOT/p).read_text()
def body_html(p):
 s=text(p);m=re.search(r'<body[^>]*>([\s\S]*)</body>',s,re.I);return re.sub(r'<script[\s\S]*?</script>','',m.group(1),flags=re.I)
CONFIGS=[
 ('question-training.html','question-training-page',['styles/question-training.css','styles/dual-canvas.css'],'.qt-canvas-shell','#qtCanvasZoomDock','#qtCanvasZoomLabel','#qtCanvasZoomSlider'),
 ('question-workspace.html','question-workspace-page',['styles/question-workspace.css'],'.qw-canvas-shell','#qwCanvasZoomDock','#qwZoomLabel','#qwZoomSlider'),
 ('knowledge-recall.html','knowledge-recall-page',['styles/knowledge-recall.css'],'#krViewport','#krCanvasZoomDock','#krZoomLabel','#krZoomSlider')]
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'])
 for file,cls,styles,parent_sel,dock_sel,label_sel,slider_sel in CONFIGS:
  page=b.new_page(viewport={'width':1366,'height':768});page.set_content('<meta name="viewport" content="width=device-width,initial-scale=1"><body class="'+cls+'">'+body_html(file)+'</body>')
  for st in styles+['styles/learning-practice-shell.css']: page.add_style_tag(content=text(st))
  dock=page.locator(dock_sel);box=dock.bounding_box();parent=page.locator(parent_sel).bounding_box();assert box and parent,(file,box,parent);assert 7<=box['x']-parent['x']<=14,(file,box,parent);gap=parent['y']+parent['height']-box['y']-box['height'];assert gap<=16,(file,box,parent,gap);assert page.locator(label_sel).inner_text()=='100%';dock.evaluate("el=>el.classList.add('slider-open')");page.wait_for_timeout(30);assert dock.evaluate("el=>el.classList.contains('slider-open')");assert page.locator(slider_sel).count()==1;page.close()
 page=b.new_page(viewport={'width':1366,'height':768});page.set_content('<body class="question-training-page">'+body_html('question-training.html')+'</body>')
 for st in ['styles/question-training.css','styles/dual-canvas.css','styles/learning-practice-shell.css']: page.add_style_tag(content=text(st))
 assert page.locator('.qt-canvas-overlay-right #qtFontScaleBtn').count()==1;assert page.locator('.qt-canvas-font-menu').count()==0;page.close();b.close()
print('v862-p225-unified-zoom-dock-browser-ok')
