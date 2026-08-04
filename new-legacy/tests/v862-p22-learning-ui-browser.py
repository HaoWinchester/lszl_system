from pathlib import Path
import re
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
ARGS=['--no-sandbox','--disable-dev-shm-usage','--in-process-gpu','--disable-gpu-sandbox','--use-gl=swiftshader']
def text(path): return (ROOT/path).read_text()
def body_html(path):
    src=text(path);m=re.search(r'<body[^>]*>([\s\S]*)</body>',src,re.I);return re.sub(r'<script[\s\S]*?</script>','',m.group(1),flags=re.I)
def style(page,*paths):
    for p in paths: page.add_style_tag(content=text(p))
def script(page,*paths):
    for p in paths: page.add_script_tag(content=text(p))
def storage(page):
    page.evaluate("""()=>{const m=new Map();Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),clear:()=>m.clear()}});window.confirm=()=>true;window.alert=()=>{};window.open=()=>({});localStorage.setItem('kg_local_current_user_v1','p22');localStorage.setItem('kg_local_users_v1',JSON.stringify({p22:{username:'p22',displayName:'P2.2',role:'teacher',status:'active',subject:'PMP',salt:'x',hash:'x'}}));}""")
def no_overflow(page): return page.evaluate('document.documentElement.scrollWidth-document.documentElement.clientWidth')<=4
def test_recall(browser):
    page=browser.new_page(viewport={'width':1366,'height':768});page.set_content('<body class="knowledge-recall-page">'+body_html('knowledge-recall.html')+'</body>');storage(page);style(page,'styles/knowledge-recall.css','styles/learning-practice-shell.css');script(page,'src/28-app-storage.js','src/29-auth-core.js','src/34-role-permissions.js','src/50-question-data.js','src/86-activity-schema-v1.js','src/86-free-mode-language.js','src/86-question-language-ui.js','src/85-knowledge-recall-data.js','src/95-recall-association-library.js','src/97-recall-storage.js','src/96-recall-question-source.js','src/99-learning-practice-shell.js','src/98-recall-graph-model.js', 'src/86-knowledge-recall.js');page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))");page.wait_for_timeout(220);top=page.locator('.kr-topbar').bounding_box();assert top and 62<=top['height']<=66,top;before=page.locator('.kr-topbar').bounding_box();page.locator('details.lp-scene-menu').evaluate('el=>el.open=true');page.locator('#krThemeSelect').select_option('neon');page.wait_for_timeout(50);after=page.locator('.kr-topbar').bounding_box();assert abs(before['height']-after['height'])<1 and abs(before['y']-after['y'])<1,(before,after);page.locator('#krQuestionListBtn').dispatch_event('click');page.wait_for_timeout(50);assert page.locator('#krQuestionDrawer').get_attribute('aria-hidden')=='false';assert page.locator('#krBankSelect').count()==1;assert page.locator('[data-kr-question-filter="explored"]').count()==1;assert no_overflow(page);page.close()
def test_shell(browser,file,bodycls,topsel,styles):
    for width,height in [(1366,768),(1440,900),(1920,1080)]:
        page=browser.new_page(viewport={'width':width,'height':height});page.set_content(f'<body class="{bodycls}">'+body_html(file)+'</body>');style(page,*styles,'styles/learning-practice-shell.css');box=page.locator(topsel).bounding_box();assert box and 62<=box['height']<=66,(file,width,box);assert page.locator('.lp-canvas-zoom-dock').count()==1;assert no_overflow(page),(file,width);page.close()
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=ARGS);test_recall(browser);test_shell(browser,'question-workspace.html','question-workspace-page','.qw-topbar',['styles/question-training.css','styles/question-workspace.css']);test_shell(browser,'question-training.html','question-training-page','.qt-topbar',['styles/question-training.css']);browser.close()
print('v862-p22-learning-ui-browser-ok')
