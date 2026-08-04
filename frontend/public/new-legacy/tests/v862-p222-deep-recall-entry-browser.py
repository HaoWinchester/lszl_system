from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
ARGS=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']

def text(path): return (ROOT/path).read_text()

def body_html(path):
    src=text(path)
    match=re.search(r'<body[^>]*>([\s\S]*)</body>',src,re.I)
    return re.sub(r'<script[\s\S]*?</script>','',match.group(1),flags=re.I)

def style(page,*paths):
    for path in paths: page.add_style_tag(content=text(path))

def script(page,*paths):
    for path in paths: page.add_script_tag(content=text(path))

def mock_storage(page):
    page.evaluate("""()=>{
      const m=new Map();
      Object.defineProperty(window,'localStorage',{configurable:true,value:{
        getItem:k=>m.has(k)?m.get(k):null,
        setItem:(k,v)=>m.set(k,String(v)),
        removeItem:k=>m.delete(k),
        clear:()=>m.clear()
      }});
      window.confirm=()=>true;window.alert=()=>{};
    }""")

def open_page(browser,mobile=False):
    page=browser.new_page(viewport={'width':390,'height':844} if mobile else {'width':1366,'height':768},is_mobile=mobile,has_touch=mobile)
    page.set_content('<meta name="viewport" content="width=device-width, initial-scale=1"><body class="knowledge-recall-page">'+body_html('knowledge-recall.html')+'</body>')
    mock_storage(page)
    style(page,'styles/knowledge-recall.css','styles/learning-practice-shell.css')
    script(page,'src/28-app-storage.js','src/50-question-data.js','src/86-activity-schema-v1.js','src/86-free-mode-language.js','src/85-knowledge-recall-data.js','src/95-recall-association-library.js','src/97-recall-storage.js','src/96-recall-question-source.js','src/99-learning-practice-shell.js','src/98-recall-graph-model.js', 'src/86-knowledge-recall.js')
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
    page.wait_for_timeout(220)
    return page

def test_real_click(browser,mobile):
    page=open_page(browser,mobile)
    trigger=page.locator('#krQuestionListBtn')
    assert page.locator('#krQuestionDrawer').get_attribute('aria-hidden')=='true'
    trigger.click()
    page.wait_for_timeout(90)
    assert page.locator('#krQuestionDrawer').get_attribute('aria-hidden')=='false'
    assert not page.locator('#krQuestionSearch').evaluate('el=>document.activeElement===el')
    assert page.locator('#krBankSelect option').count()>=1
    assert page.locator('.kr-question-item').count()>=1
    page.keyboard.press('Escape')
    page.wait_for_timeout(50)
    assert page.locator('#krQuestionDrawer').get_attribute('aria-hidden')=='true'
    page.close()

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=ARGS)
    test_real_click(browser,False)
    test_real_click(browser,True)
    browser.close()
print('v862-p222-deep-recall-entry-browser-ok')
