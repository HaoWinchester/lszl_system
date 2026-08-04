from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
BROWSER_ARGS=['--no-sandbox','--disable-dev-shm-usage','--in-process-gpu','--disable-gpu-sandbox','--use-gl=swiftshader','--disable-crash-reporter','--disable-breakpad','--noerrdialogs']

def text(path): return (ROOT/path).read_text()
def body_html(path):
    source=text(path); match=re.search(r'<body[^>]*>([\s\S]*)</body>',source,re.I)
    return re.sub(r'<script[\s\S]*?</script>','',match.group(1),flags=re.I)
def install(page):
    page.evaluate("""()=>{const values=new Map();Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:key=>values.has(key)?values.get(key):null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key),clear:()=>values.clear()}});window.confirm=()=>true;window.alert=()=>{};}""")
def add_core(page):
    for path in ['src/28-app-storage.js','src/29-auth-core.js','src/86-activity-schema-v1.js','src/87-guided-learning-data.js','src/91-learning-content-core.js','src/91-knowledge-tree-index.js']:
        page.add_script_tag(content=text(path))

def test_content_center(browser):
    page=browser.new_page(viewport={'width':1500,'height':1000}); page.set_default_timeout(4000); errors=[]; page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content('<body>'+body_html('content-center.html')+'</body>'); install(page); page.add_style_tag(content=text('styles/content-center.css')); add_core(page); page.evaluate("()=>{const rows=KGLearningContent.getTaxonomies();const item=rows.find(t=>t.id==='taxonomy-pmp-main');item.status='draft';item.isDefault=false;KGLearningContent.saveTaxonomies(rows)}"); page.add_script_tag(content=text('src/91-content-center-app.js')); page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))"); page.wait_for_timeout(120)
    assert page.locator('#ccSubjectChips button').count()==5
    assert page.locator('#ccActivityRows tr').count()==82
    assert '最多 9 层' in page.locator('#ccTaxonomyMeta').inner_text()
    assert page.locator('[data-drag-node="kp-pmp-rtm-bidirectional"]').count()==0
    page.locator('[data-tree-view="graph"]').dispatch_event('click'); page.wait_for_timeout(60)
    # Expand the sample six-level branch in visual graph mode.
    for node_id in ['kp-pmp-requirements','kp-pmp-plan-requirements','kp-pmp-plan-requirements-output','kp-pmp-rtm']:
        page.locator(f'#ccKnowledgeGraph [data-toggle-node="{node_id}"]').dispatch_event('click')
    assert page.locator('[data-drag-node="kp-pmp-rtm-bidirectional"]').count()==1
    first=page.locator('[data-map-one]').first
    first.dispatch_event('click'); page.fill('#ccMapKnowledgeSearch','敏捷方法'); page.locator('[data-map-node="kp-pmp-agile"]').dispatch_event('click'); page.locator('#ccConfirmMapBtn').dispatch_event('click'); page.wait_for_timeout(60)
    assert '敏捷方法' in page.locator('#ccActivityRows tr').first.inner_text()
    page.locator('#ccKnowledgeGraph [data-select-node="kp-pmp-rtm"]').first.dispatch_event('click'); page.locator('[data-inspector-add-child]').dispatch_event('click'); page.wait_for_timeout(80); page.fill('#ccInspectorTitleZh','需求跟踪矩阵使用场景'); page.locator('[data-inspector-save]').dispatch_event('click'); page.wait_for_timeout(60)
    page.locator('[data-tree-view="list"]').dispatch_event('click'); page.fill('#ccKnowledgeSearch','需求跟踪矩阵使用场景'); page.wait_for_timeout(30)
    assert '需求跟踪矩阵使用场景' in page.locator('#ccKnowledgeTree').inner_text()
    assert not errors,errors
    page.close()

def test_course_admin(browser):
    page=browser.new_page(viewport={'width':1500,'height':1000}); page.set_default_timeout(4000); errors=[]; page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content('<body>'+body_html('course-admin.html')+'</body>'); install(page); page.add_style_tag(content=text('styles/course-admin.css')); add_core(page); page.add_script_tag(content=text('src/91-course-admin-app.js')); page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))"); page.wait_for_timeout(150)
    assert page.locator('#caStructureTree [data-kind="stage"]').count()==1
    visible_parts=page.locator('#caStructureTree [data-kind="part"]').count()
    visible_nodes=page.locator('#caStructureTree [data-kind="node"]').count()
    assert 0<visible_parts<9
    assert 0<visible_nodes<108
    draft=page.evaluate('KGLearningContent.getCourseDrafts()[0]')
    assert len(draft['parts'])==9 and len(draft['nodes'])==108
    page.locator('#caStructureTree [data-kind="node"]').first.dispatch_event('click'); page.wait_for_timeout(50)
    assert not page.locator('#caNodeActivities').is_hidden()
    page.locator('#caPublishBtn').dispatch_event('click'); page.wait_for_timeout(30); assert not page.locator('#caPublishDialog').is_hidden(); page.locator('#caConfirmPublishBtn').dispatch_event('click'); page.wait_for_timeout(60)
    assert 'v1' in page.locator('#caReleases').inner_text()
    assert not errors,errors
    page.close()

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=BROWSER_ARGS)
    test_content_center(browser); test_course_admin(browser); browser.close()
print('v861-browser-smoke-ok')
