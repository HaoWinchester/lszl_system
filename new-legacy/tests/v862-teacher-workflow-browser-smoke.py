from pathlib import Path
import re
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
ARGS=['--no-sandbox','--disable-dev-shm-usage','--in-process-gpu','--disable-gpu-sandbox','--use-gl=swiftshader']
def text(path): return (ROOT/path).read_text()
def body_html(path):
    source=text(path);match=re.search(r'<body[^>]*>([\s\S]*)</body>',source,re.I)
    return re.sub(r'<script[\s\S]*?</script>','',match.group(1),flags=re.I)
def install_storage(page,role='teacher'):
    page.evaluate("""role=>{const local=new Map(),session=new Map();Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>local.has(k)?local.get(k):null,setItem:(k,v)=>local.set(k,String(v)),removeItem:k=>local.delete(k),clear:()=>local.clear()}});Object.defineProperty(window,'sessionStorage',{configurable:true,value:{getItem:k=>session.has(k)?session.get(k):null,setItem:(k,v)=>session.set(k,String(v)),removeItem:k=>session.delete(k),clear:()=>session.clear()}});const u='flow-test';localStorage.setItem('kg_local_current_user_v1',u);localStorage.setItem('kg_local_users_v1',JSON.stringify({[u]:{username:u,displayName:'流程测试教师',role,status:'active',subject:'PMP',salt:'x',hash:'x'}}));window.confirm=()=>true;window.alert=()=>{};window.open=()=>({});}""",role)
def add_scripts(page,paths):
    for path in paths: page.add_script_tag(content=text(path))
def add_styles(page,paths):
    for path in paths: page.add_style_tag(content=text(path))

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=ARGS)
    errors=[]

    page=browser.new_page(viewport={'width':1440,'height':900});page.on('pageerror',lambda e:errors.append('workbench:'+str(e)))
    page.set_content('<body>'+body_html('teacher-workbench.html')+'</body>');install_storage(page)
    add_styles(page,['styles/teacher-workbench.css','styles/workbench-home.css'])
    add_scripts(page,['src/28-app-storage.js','src/29-auth-core.js','src/86-activity-schema-v1.js','src/87-guided-learning-data.js','src/91-learning-content-core.js','src/93-content-organization-core.js','src/91-teacher-workbench-app.js'])
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))");page.wait_for_timeout(120)
    assert page.locator('[data-workflow-card]').count()==3
    assert page.locator('.tw-workflow .tw-step').count()==3
    assert '录入活动' not in page.locator('body').inner_text()
    page.close()

    page=browser.new_page(viewport={'width':1440,'height':1000});page.on('pageerror',lambda e:errors.append('questions:'+str(e)))
    page.set_content('<body>'+body_html('question-bank.html')+'</body>');install_storage(page);page.evaluate("document.body.dataset.qbWorkflowMode='simple';document.body.dataset.qbWorkflowStep='questions'")
    add_styles(page,['styles/question-bank-admin.css','styles/teacher-question-workflow.css'])
    add_scripts(page,['src/28-app-storage.js','src/29-auth-core.js','src/34-role-permissions.js','src/50-question-data.js','src/95-recall-association-library.js','src/98-teacher-workflow-p2-services.js','src/65-question-bank-admin.js','src/97-teacher-question-workflow.js'])
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))");page.wait_for_timeout(180)
    assert page.locator('body.qb-simple-mode.qb-question-step').count()==1
    assert page.locator('.qb-sidebar').is_hidden() and page.locator('#qbAnnotationCard').is_hidden()
    assert page.locator('#tqStepGuide').is_visible()
    page.locator('#tqOpenQuestionBtn').dispatch_event('click');page.wait_for_timeout(30)
    assert page.locator('#qbQuestionBaseCard').is_visible()
    page.close()

    page=browser.new_page(viewport={'width':1440,'height':1000});page.on('pageerror',lambda e:errors.append('training:'+str(e)))
    page.set_content('<body>'+body_html('question-bank.html')+'</body>');install_storage(page);page.evaluate("document.body.dataset.qbWorkflowMode='simple';document.body.dataset.qbWorkflowStep='training'")
    add_styles(page,['styles/question-bank-admin.css','styles/teacher-question-workflow.css'])
    add_scripts(page,['src/28-app-storage.js','src/29-auth-core.js','src/34-role-permissions.js','src/50-question-data.js','src/95-recall-association-library.js','src/98-teacher-workflow-p2-services.js','src/65-question-bank-admin.js','src/97-teacher-question-workflow.js'])
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))");page.wait_for_timeout(180)
    assert page.locator('body.qb-training-step').count()==1
    assert page.locator('#qbRecallAnnotationPanel').is_visible()
    assert page.locator('#qbBankTabPanel').is_hidden() and page.locator('#qbQuestionTabPanel').is_visible()
    assert page.locator('[data-annotation-tab="clues"]').is_hidden()
    page.close()


    page=browser.new_page(viewport={'width':1440,'height':1000});page.on('pageerror',lambda e:errors.append('question-advanced:'+str(e)))
    page.set_content('<body>'+body_html('question-bank.html')+'</body>');install_storage(page);page.evaluate("document.body.dataset.qbWorkflowMode='advanced'")
    add_styles(page,['styles/question-bank-admin.css','styles/teacher-question-workflow.css'])
    add_scripts(page,['src/28-app-storage.js','src/29-auth-core.js','src/34-role-permissions.js','src/50-question-data.js','src/95-recall-association-library.js','src/98-teacher-workflow-p2-services.js','src/65-question-bank-admin.js','src/97-teacher-question-workflow.js'])
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))");page.wait_for_timeout(120)
    assert page.locator('.qb-sidebar').is_visible() and page.locator('[data-annotation-tab="clues"]').is_visible()
    page.close()

    page=browser.new_page(viewport={'width':1440,'height':900});page.on('pageerror',lambda e:errors.append('course:'+str(e)))
    page.set_content('<body>'+body_html('course-admin.html')+'</body>');install_storage(page);page.evaluate("document.body.dataset.caWorkflowMode='simple'")
    add_styles(page,['styles/teacher-workbench.css','styles/course-admin.css','styles/workspace-panels.css','styles/config-organization.css','styles/teacher-course-workflow.css'])
    add_scripts(page,['src/28-app-storage.js','src/29-auth-core.js','src/86-activity-schema-v1.js','src/87-guided-learning-data.js','src/91-learning-content-core.js','src/65-canvas-workspace-store.js','src/93-content-organization-core.js','src/98-teacher-workflow-p2-services.js','src/91-course-admin-app.js','src/93-assessment-config-app.js','src/92-workspace-panel-manager.js','src/97-teacher-course-workflow.js'])
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))");page.wait_for_timeout(180)
    assert page.locator('body.ca-simple-mode').count()==1
    assert page.locator('#caSimpleGuide').is_visible() and page.locator('.ca-config-tabs').is_hidden()
    assert page.locator('#caTaxonomy').is_hidden()
    for width,height in [(1366,768),(1440,900),(1920,1080)]:
        for zoom in [1,1.25,1.5]:
            page.set_viewport_size({'width':width,'height':height});page.evaluate('(z)=>document.documentElement.style.zoom=String(z)',zoom);page.wait_for_timeout(25)
            overflow=page.evaluate('document.documentElement.scrollWidth-document.documentElement.clientWidth')
            assert overflow<=3,(width,height,zoom,overflow)
    page.close()


    page=browser.new_page(viewport={'width':1440,'height':900});page.on('pageerror',lambda e:errors.append('course-advanced:'+str(e)))
    page.set_content('<body>'+body_html('course-admin.html')+'</body>');install_storage(page);page.evaluate("document.body.dataset.caWorkflowMode='advanced'")
    add_styles(page,['styles/teacher-workbench.css','styles/course-admin.css','styles/workspace-panels.css','styles/config-organization.css','styles/teacher-course-workflow.css'])
    add_scripts(page,['src/28-app-storage.js','src/29-auth-core.js','src/86-activity-schema-v1.js','src/87-guided-learning-data.js','src/91-learning-content-core.js','src/65-canvas-workspace-store.js','src/93-content-organization-core.js','src/98-teacher-workflow-p2-services.js','src/91-course-admin-app.js','src/93-assessment-config-app.js','src/92-workspace-panel-manager.js','src/97-teacher-course-workflow.js'])
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))");page.wait_for_timeout(120)
    assert page.locator('.ca-config-tabs').is_visible()
    page.close()

    page=browser.new_page(viewport={'width':1440,'height':900});page.on('pageerror',lambda e:errors.append('path:'+str(e)))
    page.set_content('<body><div id="status"></div><button id="glStageSwitch"><small id="glStageIndex"></small><strong id="glStageTitle"></strong><span id="glStageDescription"></span></button><input id="glDefaultMode" type="checkbox"><div id="glPathParts"></div><button id="glCurrentNodeBtn"><span></span></button><button id="glResetBtn"></button><div id="glStagePicker"><button id="glStagePickerClose"></button><div id="glStageList"></div></div><div id="glPlacementChoice"><button id="glPlacementClose"></button><h3 id="glPlacementPartTitle"></h3><p id="glPlacementPartDescription"></p><div id="glPlacementRequirements"></div><p id="glPlacementHistory"></p><button id="glPlacementNormalBtn"></button><button id="glPlacementTestBtn"></button></div></body>');install_storage(page,'student')
    add_styles(page,['styles/guided-learning-path.css'])
    add_scripts(page,['src/86-activity-schema-v1.js','src/87-guided-learning-data.js','src/88-guided-learning-store.js','src/89-guided-learning-icon-registry.js','src/94-practice-navigation.js','src/89-guided-learning-app.js'])
    page.evaluate('KGGuidedLearningApp.init()');page.wait_for_timeout(80)
    assert page.locator('.gl-practice-entry').count()==6
    assert page.locator('.gl-practice-image').count()==6 and page.locator('.gl-practice-copy').count()==0
    assert page.locator('.gl-practice-entry').first.evaluate('el=>getComputedStyle(el).backgroundColor')=='rgba(0, 0, 0, 0)'
    page.close();browser.close()
    assert not errors,errors
print('v862-teacher-workflow-browser-smoke-ok')
