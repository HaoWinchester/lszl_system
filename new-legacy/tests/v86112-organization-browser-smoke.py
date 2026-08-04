from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
ARGS=['--no-sandbox','--disable-dev-shm-usage','--in-process-gpu','--disable-gpu-sandbox','--use-gl=swiftshader','--disable-crash-reporter','--disable-breakpad','--noerrdialogs']

def text(path): return (ROOT/path).read_text()
def body_html(path):
    source=text(path); match=re.search(r'<body[^>]*>([\s\S]*)</body>',source,re.I)
    return re.sub(r'<script[\s\S]*?</script>','',match.group(1),flags=re.I)
def install(page):
    page.evaluate("""()=>{const values=new Map();Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:key=>values.has(key)?values.get(key):null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key),clear:()=>values.clear()}});window.confirm=()=>true;window.alert=()=>{};window.prompt=(message,value)=>value||'自动测试';}""")
def add(page, paths):
    for path in paths: page.add_script_tag(content=text(path))

def content_center(browser):
    page=browser.new_page(viewport={'width':1700,'height':1050}); page.set_default_timeout(5000); errors=[]; page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content('<body>'+body_html('content-center.html')+'</body>'); install(page)
    add(page,['src/28-app-storage.js','src/29-auth-core.js','src/86-activity-schema-v1.js','src/87-guided-learning-data.js','src/91-learning-content-core.js','src/93-content-organization-core.js','src/91-knowledge-tree-index.js','src/91-content-center-app.js','src/93-content-organization-app.js','src/92-workspace-panel-manager.js'])
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))"); page.wait_for_timeout(180)
    assert page.locator('#ccActivityRows tr').count()==82
    page.locator('#ccNewTagBtn').dispatch_event('click'); page.fill('#ccTagName','易错题'); page.fill('#ccTagDescription','自动测试标签'); page.locator('#ccSaveTagBtn').dispatch_event('click'); page.wait_for_timeout(60)
    assert '易错题' in page.locator('#ccTagList').inner_text()
    first_two=page.locator('#ccActivityRows [data-select]')
    first_two.nth(0).evaluate("el=>{el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}))}"); first_two.nth(1).evaluate("el=>{el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}))}"); page.wait_for_timeout(30)
    page.locator('#ccBatchMetaBtn').dispatch_event('click'); page.select_option('#ccMetaDifficulty','medium'); page.fill('#ccMetaTime','90'); page.locator('[data-meta-purpose][value="practice"]').evaluate("el=>el.checked=true"); page.locator('[data-meta-tag]').first.evaluate("el=>el.checked=true"); page.locator('#ccConfirmMetaBtn').dispatch_event('click'); page.wait_for_timeout(80)
    assert '中等' in page.locator('#ccActivityRows tr').first.inner_text()
    first_two=page.locator('#ccActivityRows [data-select]'); first_two.nth(0).evaluate("el=>{el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}))}"); first_two.nth(1).evaluate("el=>{el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}))}"); page.locator('#ccAddCollectionBtn').dispatch_event('click'); page.fill('#ccCollectionNewTitle','需求管理重点题'); page.locator('#ccConfirmCollectionBtn').dispatch_event('click'); page.wait_for_timeout(80)
    assert '需求管理重点题' in page.locator('#ccCollectionList').inner_text()
    page.locator('#ccActivityRows [data-favorite]').first.dispatch_event('click'); page.wait_for_timeout(40)
    assert page.locator('#ccActivityRows [data-favorite]').first.inner_text()=='★'
    assert not errors,errors
    page.close()

def config_center(browser):
    page=browser.new_page(viewport={'width':1700,'height':1050}); page.set_default_timeout(5000); errors=[]; page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content('<body>'+body_html('course-admin.html')+'</body>'); install(page)
    add(page,['src/28-app-storage.js','src/29-auth-core.js','src/86-activity-schema-v1.js','src/87-guided-learning-data.js','src/91-learning-content-core.js','src/65-canvas-workspace-store.js','src/93-content-organization-core.js','src/98-teacher-workflow-p2-services.js','src/91-course-admin-app.js','src/93-assessment-config-app.js','src/92-workspace-panel-manager.js'])
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))"); page.wait_for_timeout(220)
    page.locator('[data-config-view="tasks"]').dispatch_event('click'); page.locator('#caNewTaskBtn').dispatch_event('click'); page.wait_for_timeout(80)
    assert page.locator('#caTaskEditor input#caTaskTitle').count()==1
    page.fill('#caTaskTitle','需求管理深度回忆'); page.locator('#caTaskActivityPicker [data-add-task-activity]').first.dispatch_event('click'); page.locator('#caSaveTaskBtn').dispatch_event('click'); page.locator('#caPublishTaskBtn').dispatch_event('click'); page.wait_for_timeout(100)
    assert '已发布' in page.locator('#caTaskList').inner_text()
    page.locator('[data-config-view="papers"]').dispatch_event('click'); page.locator('#caNewPaperBtn').dispatch_event('click'); page.wait_for_timeout(80)
    page.fill('#caPaperTitle','需求管理模拟卷'); page.locator('#caPaperActivityPicker [data-add-paper-activity]').first.dispatch_event('click'); page.locator('#caPaperActivityPicker [data-add-paper-activity]').first.dispatch_event('click'); page.fill('#caPaperDuration','30'); page.fill('#caPaperPassing','2'); page.locator('#caSavePaperBtn').dispatch_event('click'); page.locator('#caPublishPaperBtn').dispatch_event('click'); page.wait_for_timeout(120)
    assert '已发布' in page.locator('#caPaperList').inner_text()
    assert page.locator('.paper-item').count()==2
    assert not errors,errors
    page.close()

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=ARGS)
    content_center(browser); config_center(browser); browser.close()
print('v86112-organization-browser-smoke-ok')
