from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
ARGS=['--no-sandbox','--disable-dev-shm-usage','--in-process-gpu','--disable-gpu-sandbox','--use-gl=swiftshader','--disable-crash-reporter','--disable-breakpad','--noerrdialogs']

def text(path):
    return (ROOT/path).read_text(encoding='utf-8')

def body_html(path):
    source=text(path)
    match=re.search(r'<body[^>]*>([\s\S]*)</body>',source,re.I)
    return re.sub(r'<script[\s\S]*?</script>','',match.group(1),flags=re.I)

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=ARGS)
    page=browser.new_page(viewport={'width':1440,'height':900})
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content('<body>'+body_html('question-studio/index.html')+'</body>')
    page.evaluate("""()=>{const values=new Map();Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:key=>values.has(key)?values.get(key):null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key),clear:()=>values.clear()}});window.confirm=()=>true;}""")
    for path in ['question-studio/styles.css','styles/workspace-panels.css']:
        page.add_style_tag(content=text(path))
    for path in ['question-studio/activity-schema-v1.js','question-studio/knowledge-taxonomy-v1.js','question-studio/question-studio-sync.js','question-studio/question-studio-parser.js','question-studio/question-studio.js','src/92-workspace-panel-manager.js']:
        page.add_script_tag(content=text(path))
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
    page.wait_for_timeout(80)

    page.locator('#qsBatchKnowledgeBtn').dispatch_event('click')
    page.fill('#qsPickerSearch','敏捷方法')
    page.locator('[data-picker-node="kp-pmp-agile"]').dispatch_event('click')
    page.locator('#qsPickerConfirmBtn').dispatch_event('click')
    page.locator('#qsParseBtn').dispatch_event('click')
    page.wait_for_timeout(100)

    assert page.locator('#qsQuestionLocator option').count()==2
    assert page.locator('#qsCurrentIndex').inner_text()=='1 / 2'
    assert page.locator('#qsQuestionLocator').input_value()=='0'

    page.locator('#qsNextActivityBtn').dispatch_event('click')
    page.wait_for_timeout(40)
    assert page.locator('#qsCurrentIndex').inner_text()=='2 / 2'
    assert page.locator('#qsQuestionLocator').input_value()=='1'
    assert page.locator('.qs-activity-item.active .qs-activity-number').inner_text()=='2'

    page.select_option('#qsQuestionLocator','0')
    page.wait_for_timeout(40)
    assert page.locator('#qsCurrentIndex').inner_text()=='1 / 2'

    page.locator('[data-workspace-panel="structured-editor"] [data-wsp-action="maximize"]').dispatch_event('click')
    page.wait_for_timeout(40)
    assert page.locator('#qsQuestionLocator').is_visible()
    page.locator('#qsNextActivityBtn').dispatch_event('click')
    page.wait_for_timeout(40)
    assert page.locator('#qsCurrentIndex').inner_text()=='2 / 2'
    assert not errors,errors
    browser.close()

print('v861121-question-locator-browser-smoke-ok')
