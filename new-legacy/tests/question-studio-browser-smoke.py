from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
BROWSER_ARGS=[
    '--no-sandbox','--disable-dev-shm-usage','--in-process-gpu',
    '--disable-gpu-sandbox','--use-gl=swiftshader','--disable-crash-reporter',
    '--disable-breakpad','--noerrdialogs'
]

def text(path):
    return (ROOT/path).read_text()

def body_html(path):
    source=text(path)
    match=re.search(r'<body[^>]*>([\s\S]*)</body>',source,re.I)
    body=match.group(1)
    return re.sub(r'<script[\s\S]*?</script>','',body,flags=re.I)

def install_storage(page):
    page.evaluate("""()=>{const values=new Map();Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:key=>values.has(key)?values.get(key):null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key),clear:()=>values.clear()}});window.confirm=()=>true;}""")

def test_question_studio(browser):
    page=browser.new_page(viewport={'width':1400,'height':1000})
    errors=[]
    page.on('pageerror',lambda error: errors.append(str(error)))
    page.set_content('<body>'+body_html('question-studio/index.html')+'</body>')
    install_storage(page)
    page.add_style_tag(content=text('question-studio/styles.css'))
    page.add_script_tag(content=text('question-studio/activity-schema-v1.js'))
    page.add_script_tag(content=text('question-studio/knowledge-taxonomy-v1.js'))
    page.add_script_tag(content=text('question-studio/question-studio-sync.js'))
    page.add_script_tag(content=text('question-studio/question-studio-parser.js'))
    page.add_script_tag(content=text('question-studio/question-studio.js'))
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
    page.wait_for_timeout(80)
    assert page.locator('#qsRawText').input_value().startswith('【题型】')
    page.locator('#qsBatchKnowledgeBtn').dispatch_event('click')
    page.fill('#qsPickerSearch','敏捷方法')
    page.locator('[data-picker-node="kp-pmp-agile"]').dispatch_event('click')
    page.locator('#qsPickerConfirmBtn').dispatch_event('click')
    page.evaluate("document.getElementById('qsParseBtn').click()")
    page.wait_for_timeout(100)
    assert page.locator('.qs-activity-item').count()==2
    assert '当前：0 个错误' in page.locator('#qsValidationSummary').inner_text()
    page.evaluate("document.querySelector('[data-preview-language=\"bilingual\"]')?.click()")
    assert not page.locator('#qsLanguageNote').is_hidden()
    assert page.locator('.qs-en').count()>0
    assert not errors,errors
    page.close()

def test_free_mode_language(browser):
    page=browser.new_page()
    errors=[]
    page.on('pageerror',lambda error: errors.append(str(error)))
    page.set_content('<button data-question-language="zh">中文</button><button data-question-language="bilingual">中英对照</button><p data-question-language-note hidden>英文仅供对照</p>')
    page.evaluate("document.body.className='question-workspace-page'")
    install_storage(page)
    page.add_script_tag(content=text('src/86-activity-schema-v1.js'))
    page.add_script_tag(content=text('src/86-free-mode-language.js'))
    page.add_script_tag(content=text('src/86-question-language-ui.js'))
    page.add_script_tag(content=text('src/50-question-data.js'))
    page.evaluate("document.querySelector('[data-question-language=\"bilingual\"]')?.click()")
    assert page.locator('html').get_attribute('data-question-language-mode')=='bilingual'
    assert not page.locator('[data-question-language-note]').is_hidden()
    view=page.evaluate("KGFreeModeLanguage.questionView(PMP_QUESTION_MVP,'bilingual')")
    assert view['stem']['hasEnglish']
    assert any(option['display']['hasEnglish'] for option in view['options'])
    assert page.evaluate("KGActivitySchemaV1.ASSESSMENT_LANGUAGE")=='zh'
    assert not errors,errors
    page.close()

with sync_playwright() as playwright:
    browser=playwright.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=BROWSER_ARGS)
    test_question_studio(browser)
    test_free_mode_language(browser)
    browser.close()

print('question-studio-browser-smoke-ok')
