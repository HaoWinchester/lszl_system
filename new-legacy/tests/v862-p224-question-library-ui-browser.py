from pathlib import Path
import re
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
def text(p): return (ROOT/p).read_text()
def body_html(p):
 s=text(p);m=re.search(r'<body[^>]*>([\s\S]*)</body>',s,re.I);return re.sub(r'<script[\s\S]*?</script>','',m.group(1),flags=re.I)
configs=[('knowledge-recall.html','knowledge-recall-page',['styles/knowledge-recall.css']),('question-workspace.html','question-workspace-page',['styles/question-workspace.css']),('question-training.html','question-training-page',['styles/question-training.css','styles/progress-workspace-dock.css','styles/dual-canvas.css'])]
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'])
 for file,cls,styles in configs:
  page=b.new_page(viewport={'width':1366,'height':768});page.set_content('<meta name="viewport" content="width=device-width,initial-scale=1"><body class="'+cls+'">'+body_html(file)+'</body>')
  for st in styles+['styles/learning-practice-shell.css']: page.add_style_tag(content=text(st))
  drawer=page.locator('.lp-question-library-compact');assert drawer.locator('.lp-question-library-close').count()==1;assert drawer.evaluate("el=>getComputedStyle(el).transitionDuration")!='0s';drawer.evaluate("el=>el.classList.add('open')");page.wait_for_timeout(220);box=drawer.bounding_box();assert box and 350<=box['width']<=363,(file,box);assert (abs(box['x'])<1.5 if file=='question-training.html' else 10<=box['x']<=13.5),(file,box);assert page.locator('[data-question-language="zh"]').inner_text()=='中';assert page.locator('[data-question-language="bilingual"]').inner_text()=='中英';page.close()
 for file,cls,styles in configs:
  page=b.new_page(viewport={'width':390,'height':844},is_mobile=True,has_touch=True);page.set_content('<meta name="viewport" content="width=device-width,initial-scale=1"><body class="'+cls+'">'+body_html(file)+'</body>')
  for st in styles+['styles/learning-practice-shell.css']: page.add_style_tag(content=text(st))
  drawer=page.locator('.lp-question-library-compact');drawer.evaluate("el=>el.classList.add('open')");page.wait_for_timeout(220);box=drawer.bounding_box();assert box and abs(box['x'])<1.5,(file,box);assert box['width']<=363,(file,box);page.close()
 b.close()
print('v862-p224-question-library-ui-browser-ok')
