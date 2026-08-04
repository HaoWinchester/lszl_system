from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
ARGS=['--no-sandbox','--disable-dev-shm-usage','--in-process-gpu','--disable-gpu-sandbox','--use-gl=swiftshader','--disable-crash-reporter','--disable-breakpad','--noerrdialogs']

def text(path): return (ROOT/path).read_text()
def body_html(path):
    source=text(path); match=re.search(r'<body[^>]*>([\s\S]*)</body>',source,re.I)
    return re.sub(r'<script[\s\S]*?</script>','',match.group(1),flags=re.I)
def storage(page):
    page.evaluate("""()=>{const values=new Map();Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:key=>values.has(key)?values.get(key):null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key),clear:()=>values.clear()}});window.confirm=()=>true;window.alert=()=>{};}""")
def add_core(page):
    for path in ['src/28-app-storage.js','src/29-auth-core.js','src/86-activity-schema-v1.js','src/87-guided-learning-data.js','src/91-learning-content-core.js','src/91-knowledge-tree-index.js']:
        page.add_script_tag(content=text(path))

def content_visual(browser):
    page=browser.new_page(viewport={'width':1600,'height':1000}); errors=[]; page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content('<body>'+body_html('content-center.html')+'</body>'); storage(page); add_core(page); page.add_script_tag(content=text('src/91-content-center-app.js')); page.add_script_tag(content=text('src/92-workspace-panel-manager.js')); page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))"); page.wait_for_timeout(120)
    assert page.locator('.tw-tabs a').count()==4
    assert page.locator('#ccKnowledgeTree .cc-tree-row').count()>0
    page.locator('[data-tree-view="graph"]').dispatch_event('click'); page.wait_for_timeout(80)
    assert page.locator('#ccKnowledgeGraph .cc-map-node').count()>0
    page.locator('#ccKnowledgeGraph [data-inline-title="kp-pmp"]').dispatch_event('dblclick'); page.locator('.cc-inline-title').fill('PMP知识体系'); page.locator('.cc-inline-title').press('Enter'); page.wait_for_timeout(50)
    assert 'PMP知识体系' in page.locator('#ccKnowledgeGraph').inner_text()
    page.locator('#ccUndoBtn').dispatch_event('click'); page.wait_for_timeout(50)
    assert 'PMP知识体系' not in page.locator('#ccKnowledgeGraph').inner_text()
    page.locator('[data-tree-view="list"]').dispatch_event('click'); assert not page.locator('#ccKnowledgeTree').is_hidden()
    before_ids=set(page.evaluate("KGLearningContent.nodesForTaxonomy('taxonomy-pmp-main',{includeDeprecated:true}).map(x=>x.id)")); page.locator('#ccAddRootBtn').dispatch_event('click'); page.wait_for_timeout(60); after_ids=set(page.evaluate("KGLearningContent.nodesForTaxonomy('taxonomy-pmp-main',{includeDeprecated:true}).map(x=>x.id)")); new_id=next(iter(after_ids-before_ids)); assert new_id
    if page.locator('.cc-inline-title').count(): page.locator('.cc-inline-title').press('Escape'); page.wait_for_timeout(20)
    page.locator(f'[data-delete-node="{new_id}"]').dispatch_event('click'); page.wait_for_timeout(40); assert page.locator(f'[data-select-node="{new_id}"]').count()==0
    max_btn=page.locator('[data-workspace-panel="knowledge-tree"] [data-wsp-action="maximize"]'); max_btn.dispatch_event('click'); assert page.locator('[data-workspace-panel="knowledge-tree"]').evaluate('(el)=>el.classList.contains("wsp-panel-maximized")'); max_btn.dispatch_event('click')
    page.locator('[data-workspace-panel="activity-library"] [data-wsp-action="collapse"]').dispatch_event('click'); assert page.locator('#wspCollapsedRail [data-restore-panel="activity-library"]').count()==1; page.locator('#wspCollapsedRail [data-restore-panel="activity-library"]').dispatch_event('click')
    assert not errors,errors; page.close()

def question_picker(browser):
    page=browser.new_page(viewport={'width':1500,'height':1000}); errors=[]; page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content('<body>'+body_html('question-studio/index.html')+'</body>'); storage(page)
    for path in ['question-studio/activity-schema-v1.js','question-studio/knowledge-taxonomy-v1.js','question-studio/question-studio-sync.js','question-studio/question-studio-parser.js','question-studio/question-studio.js']:
        page.add_script_tag(content=text(path))
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))"); page.wait_for_timeout(100)
    page.locator('#qsBatchKnowledgeBtn').dispatch_event('click'); page.fill('#qsPickerSearch','需求跟踪'); page.wait_for_timeout(20)
    assert page.locator('[data-picker-node="kp-pmp-rtm"]').count()==1
    page.locator('[data-picker-node="kp-pmp-rtm"]').dispatch_event('click'); page.locator('#qsPickerFavoriteBtn').dispatch_event('click'); page.locator('#qsPickerConfirmBtn').dispatch_event('click'); page.wait_for_timeout(30)
    assert '需求跟踪矩阵' in page.locator('#qsBatchKnowledgeLabel').inner_text()
    page.locator('#qsBatchKnowledgeBtn').dispatch_event('click'); page.locator('[data-picker-tab="recent"]').dispatch_event('click'); assert page.locator('[data-picker-node="kp-pmp-rtm"]').count()==1
    page.locator('[data-picker-tab="favorite"]').dispatch_event('click'); assert page.locator('[data-picker-node="kp-pmp-rtm"]').count()==1
    assert not errors,errors; page.close()

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=ARGS)
    content_visual(browser); question_picker(browser); browser.close()
print('v8611-workflow-browser-smoke-ok')
