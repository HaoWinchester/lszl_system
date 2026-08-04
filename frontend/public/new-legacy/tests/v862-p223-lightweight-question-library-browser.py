from pathlib import Path
import re
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
def text(p): return (ROOT/p).read_text()
def body_html(p):
    s=text(p);m=re.search(r'<body[^>]*>([\s\S]*)</body>',s,re.I);return re.sub(r'<script[\s\S]*?</script>','',m.group(1),flags=re.I)
def setup(page,file,body_class,styles):
    page.set_content('<meta name="viewport" content="width=device-width,initial-scale=1"><body class="'+body_class+'">'+body_html(file)+'</body>')
    for st in styles+['styles/learning-practice-shell.css']: page.add_style_tag(content=text(st))
    drawer=page.locator('.lp-question-library-compact');drawer.evaluate("el=>el.classList.add('open')")
    return drawer
with sync_playwright() as p:
    b=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'])
    configs=[('knowledge-recall.html','knowledge-recall-page',['styles/knowledge-recall.css','styles/knowledge-recall-p2223.css']),('question-workspace.html','question-workspace-page',['styles/question-workspace.css','styles/question-workspace-p2218.css','styles/question-workspace-p2219.css']),('question-training.html','question-training-page',['styles/question-training.css','styles/progress-workspace-dock.css','styles/dual-canvas.css','styles/question-training-p2220.css','styles/question-training-p2221.css'])]
    boxes=[]
    for file,cls,styles in configs:
        page=b.new_page(viewport={'width':1366,'height':768});drawer=setup(page,file,cls,styles);page.wait_for_timeout(220)
        box=drawer.bounding_box();boxes.append(box)
        assert 350<=box['width']<=362,(file,box);assert 700<=box['height']<=706,(file,box);assert abs(box['x'])<=1,(file,box);assert 63<=box['y']<=65,(file,box)
        assert drawer.locator('.lp-question-paper-select').count()==1
        assert drawer.locator('.lp-question-search-row input').count()==1
        assert drawer.locator('.lp-question-text-action').count()==1
        assert drawer.locator('.lp-question-filter-links button').count()==3
        button=drawer.locator('.lp-question-filter-links button').first
        style=button.evaluate("el=>({border:getComputedStyle(el).borderTopWidth,bg:getComputedStyle(el).backgroundColor})")
        assert style['border']=='0px',style
        # panel opening must not force search focus
        assert not drawer.locator('.lp-question-search-row input').evaluate('el=>document.activeElement===el')
        page.close()
    widths=[round(x['width'],1) for x in boxes];assert max(widths)-min(widths)<=2,widths
    # compact rows: representative static row geometry for all three class systems
    b.close()
print('v862-p223-lightweight-question-library-browser-ok')
