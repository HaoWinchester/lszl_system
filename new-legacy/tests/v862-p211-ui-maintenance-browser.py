from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
ARGS=['--no-sandbox','--disable-dev-shm-usage','--in-process-gpu','--disable-gpu-sandbox','--use-gl=swiftshader']

def text(path): return (ROOT/path).read_text()
def body_html(path):
    source=text(path); match=re.search(r'<body[^>]*>([\s\S]*)</body>',source,re.I)
    return re.sub(r'<script[\s\S]*?</script>','',match.group(1),flags=re.I)
def install_storage(page):
    page.evaluate("""()=>{const local=new Map(),session=new Map();Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>local.has(k)?local.get(k):null,setItem:(k,v)=>local.set(k,String(v)),removeItem:k=>local.delete(k),clear:()=>local.clear()}});Object.defineProperty(window,'sessionStorage',{configurable:true,value:{getItem:k=>session.has(k)?session.get(k):null,setItem:(k,v)=>session.set(k,String(v)),removeItem:k=>session.delete(k),clear:()=>session.clear()}});const u='p211-ui';localStorage.setItem('kg_local_current_user_v1',u);localStorage.setItem('kg_local_users_v1',JSON.stringify({[u]:{username:u,displayName:'UI维护测试',role:'teacher',status:'active',subject:'PMP',salt:'x',hash:'x'}}));window.confirm=()=>true;window.alert=()=>{};window.open=()=>({});}""")
def add_styles(page,paths):
    for path in paths: page.add_style_tag(content=text(path))
def add_scripts(page,paths):
    for path in paths: page.add_script_tag(content=text(path))
def open_simple_question(page):
    page.set_content('<body>'+body_html('question-bank.html')+'</body>');install_storage(page)
    page.evaluate("document.body.dataset.qbWorkflowMode='simple';document.body.dataset.qbWorkflowStep='questions'")
    add_styles(page,['styles/teacher-workbench.css','styles/question-bank-admin.css','styles/teacher-question-workflow.css'])
    add_scripts(page,['src/28-app-storage.js','src/29-auth-core.js','src/34-role-permissions.js','src/50-question-data.js','src/95-recall-association-library.js','question-studio/question-studio-parser.js','src/98-teacher-workflow-p2-services.js','src/65-question-bank-admin.js','src/97-teacher-question-workflow.js'])
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))");page.wait_for_timeout(260)

def test_compact_entry(browser):
    page=browser.new_page(viewport={'width':1366,'height':768});open_simple_question(page)
    page.locator('#tqNewQuestionBtn').dispatch_event('click');page.wait_for_timeout(60)
    for zoom in [1,1.25,1.5]:
        page.evaluate('(z)=>document.documentElement.style.zoom=String(z)',zoom);page.wait_for_timeout(35)
        rects=page.evaluate("""()=>['.tq-entry-tabs','.tq-template-actions','.tq-paste-mode'].map(s=>{const r=document.querySelector(s).getBoundingClientRect();return {top:r.top,left:r.left,right:r.right}})""")
        assert max(item['top'] for item in rects)-min(item['top'] for item in rects)<12,(zoom,rects)
        assert page.evaluate('document.documentElement.scrollWidth-document.documentElement.clientWidth')<=4
    page.evaluate("document.documentElement.style.zoom='1'")
    page.locator('[data-tq-paste-mode="batch"]').dispatch_event('click');page.wait_for_timeout(30)
    options=page.evaluate("""()=>[...document.querySelectorAll('#tqBatchOptions label')].map(label=>{const r=label.getBoundingClientRect(),i=label.querySelector('input').getBoundingClientRect();return {y:r.y,x:r.x,inputX:i.x}})""")
    assert len(options)==2 and abs(options[0]['y']-options[1]['y'])<3,options
    assert all(item['inputX']-item['x']<30 for item in options),options
    page.close()

def test_recall_card_edit(browser):
    page=browser.new_page(viewport={'width':1440,'height':1000});page.set_content('<body>'+body_html('question-bank.html')+'</body>');install_storage(page)
    add_styles(page,['styles/question-bank-admin.css','styles/teacher-question-workflow.css'])
    add_scripts(page,['src/28-app-storage.js','src/29-auth-core.js','src/34-role-permissions.js','src/50-question-data.js','src/95-recall-association-library.js','src/98-teacher-workflow-p2-services.js','src/65-question-bank-admin.js'])
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))");page.wait_for_timeout(220)
    page.locator('[data-layout-nav="base"]').dispatch_event('click');page.wait_for_timeout(30)
    page.locator('#questionStemInput').fill('项目经理发现一位关键干系人对项目目标存在误解。')
    page.locator('#qbSaveQuestionBtn').dispatch_event('click');page.wait_for_timeout(50)
    page.locator('[data-layout-nav="recall"]').dispatch_event('click');page.wait_for_timeout(30)
    page.locator('#qbRecallKeywordsInput').fill('关键干系人')
    page.locator('#qbRecallBindingsInput').fill('关键干系人 -> 关键干系人')
    page.locator('#qbSyncRecallConfigBtn').dispatch_event('click');page.wait_for_timeout(70)
    button=page.locator('#qbRecallConfigStatus [data-edit-recall-binding]');assert button.count()==1
    assert '学员可自由输入' in page.locator('#qbRecallConfigStatus').inner_text()
    button.dispatch_event('click');page.wait_for_timeout(20)
    selection=page.evaluate("""()=>{const input=document.getElementById('qbRecallBindingsInput');return {focused:document.activeElement===input,selected:input.value.slice(input.selectionStart,input.selectionEnd)}}""")
    assert selection=={'focused':True,'selected':'关键干系人'},selection
    assert '箭头后填写' in page.locator('#qbRecallBindingsInput').evaluate("el=>el.parentElement.querySelector('small').innerText")
    page.close()

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=ARGS)
    test_compact_entry(browser);test_recall_card_edit(browser);browser.close()
print('v862-p211-ui-maintenance-browser-ok')
