from pathlib import Path
import json,re
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
ARGS=['--no-sandbox','--disable-dev-shm-usage','--in-process-gpu','--disable-gpu-sandbox','--use-gl=swiftshader']

def text(path): return (ROOT/path).read_text()
def body_html(path):
    source=text(path);match=re.search(r'<body[^>]*>([\s\S]*)</body>',source,re.I)
    return re.sub(r'<script[\s\S]*?</script>','',match.group(1),flags=re.I)
def add_styles(page,paths):
    for path in paths: page.add_style_tag(content=text(path))
def add_scripts(page,paths):
    for path in paths: page.add_script_tag(content=text(path))
def install_storage(page):
    page.evaluate("""()=>{const local=new Map(),session=new Map();Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>local.has(k)?local.get(k):null,setItem:(k,v)=>local.set(k,String(v)),removeItem:k=>local.delete(k),clear:()=>local.clear()}});Object.defineProperty(window,'sessionStorage',{configurable:true,value:{getItem:k=>session.has(k)?session.get(k):null,setItem:(k,v)=>session.set(k,String(v)),removeItem:k=>session.delete(k),clear:()=>session.clear()}});const u='p21-teacher';localStorage.setItem('kg_local_current_user_v1',u);localStorage.setItem('kg_local_users_v1',JSON.stringify({[u]:{username:u,displayName:'P2.1测试教师',role:'teacher',status:'active',subject:'PMP',salt:'x',hash:'x'}}));window.confirm=()=>true;window.alert=()=>{};window.open=()=>({});}""")
def open_question(page):
    page.set_content('<body>'+body_html('question-bank.html')+'</body>');install_storage(page);page.evaluate("document.body.dataset.qbWorkflowMode='simple';document.body.dataset.qbWorkflowStep='questions'")
    add_styles(page,['styles/teacher-workbench.css','styles/question-bank-admin.css','styles/teacher-question-workflow.css'])
    add_scripts(page,['src/28-app-storage.js','src/29-auth-core.js','src/34-role-permissions.js','src/50-question-data.js','src/95-recall-association-library.js','question-studio/question-studio-parser.js','src/98-teacher-workflow-p2-services.js','src/65-question-bank-admin.js','src/97-teacher-question-workflow.js'])
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))");page.wait_for_timeout(300)

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=ARGS)
    page=browser.new_page(viewport={'width':1440,'height':1000},accept_downloads=True);page.set_default_timeout(6000)
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    open_question(page)
    page.locator('#tqNewQuestionBtn').dispatch_event('click');page.wait_for_timeout(80)
    assert page.locator('#tqTemplateSelect option').count()==4
    page.locator('#tqShowTemplateExampleBtn').dispatch_event('click');page.wait_for_timeout(50);assert page.locator('#tqTemplateExample').is_visible();assert '【题干-English】' in page.locator('#tqTemplateExampleText').inner_text()
    with page.expect_download() as event:
        page.locator('#tqDownloadTemplateBtn').dispatch_event('click')
    assert event.value.suggested_filename=='标准双语单题模板.txt'

    sample=page.evaluate('KGTeacherWorkflowP2.TEMPLATE_TEXTS.example')
    before=page.evaluate('KGQuestionBankAdminAPI.getCurrentBank().questions.length')
    page.locator('#tqPasteInput').fill(sample);page.locator('#tqParseBtn').dispatch_event('click');page.wait_for_timeout(80)
    assert '中英双语' in page.locator('#tqParseSummary').inner_text()
    assert page.locator('#tqApplyParsedBtn').is_enabled()
    assert page.locator('#tqParseResult .tq-keyword-summary article').count()==5
    page.locator('#tqApplyParsedBtn').dispatch_event('click');page.wait_for_timeout(260)
    after=page.evaluate('KGQuestionBankAdminAPI.getCurrentBank().questions.length')
    assert after in (before,before+1),(before,after)
    question=page.evaluate('KGQuestionBankAdminAPI.getCurrentQuestion()')
    assert re.match(r'^PMP-\d{6}$',question['teacherNumber']),question['teacherNumber']
    assert question['metadata']['translationStatus']=='bilingual'
    assert len(question['translations']['en']['options'])==4
    assert len(question['clues'])==5
    assert page.locator('#questionTeacherNumber').inner_text()==question['teacherNumber']

    page.locator('[data-tq-editor-language="en"]').dispatch_event('click');assert page.locator('#questionStemEnInput').is_visible()
    original_en=''.join(part['text'] for part in question['translations']['en']['stemParts'])
    amended=original_en+' Updated.'
    page.locator('#questionStemEnInput').fill(amended);page.locator('#qbSaveQuestionBtn').dispatch_event('click');page.wait_for_timeout(150)
    saved=page.evaluate('KGQuestionBankAdminAPI.getCurrentQuestion()')
    assert ''.join(part['text'] for part in saved['translations']['en']['stemParts'])==amended

    page.locator('[data-tq-entry-mode="paste"]').dispatch_event('click');page.locator('[data-tq-paste-mode="batch"]').dispatch_event('click')
    batch=page.evaluate('KGTeacherWorkflowP2.TEMPLATE_TEXTS.batch')
    page.locator('#tqPasteInput').fill(batch);page.locator('#tqParseBtn').dispatch_event('click');page.wait_for_timeout(80)
    assert '共 2 道' in page.locator('#tqParseSummary').inner_text()
    assert page.locator('#tqApplyParsedBtn').is_enabled()

    for width,height in [(1366,768),(1440,900),(1920,1080)]:
        for zoom in [1,1.25,1.5]:
            page.set_viewport_size({'width':width,'height':height});page.evaluate('(z)=>document.documentElement.style.zoom=String(z)',zoom);page.wait_for_timeout(40)
            overflow=page.evaluate('document.documentElement.scrollWidth-document.documentElement.clientWidth')
            assert overflow<=4,(width,height,zoom,overflow)
    browser.close();assert not errors,errors
print('v862-p21-bilingual-entry-browser-ok')
