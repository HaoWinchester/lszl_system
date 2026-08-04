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
def install_storage(page,course=None):
    payload=json.dumps([course],ensure_ascii=False) if course else None
    page.evaluate("""payload=>{const local=new Map(),session=new Map();Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>local.has(k)?local.get(k):null,setItem:(k,v)=>local.set(k,String(v)),removeItem:k=>local.delete(k),clear:()=>local.clear()}});Object.defineProperty(window,'sessionStorage',{configurable:true,value:{getItem:k=>session.has(k)?session.get(k):null,setItem:(k,v)=>session.set(k,String(v)),removeItem:k=>session.delete(k),clear:()=>session.clear()}});const u='p2-teacher';localStorage.setItem('kg_local_current_user_v1',u);localStorage.setItem('kg_local_users_v1',JSON.stringify({[u]:{username:u,displayName:'P2测试教师',role:'teacher',status:'active',subject:'PMP',salt:'x',hash:'x'}}));if(payload)localStorage.setItem('kg_course_config_drafts_v1',payload);window.confirm=()=>true;window.alert=()=>{};window.open=()=>({});}""",payload)

def open_question(page):
    page.set_content('<body>'+body_html('question-bank.html')+'</body>');install_storage(page);page.evaluate("document.body.dataset.qbWorkflowMode='simple';document.body.dataset.qbWorkflowStep='questions'")
    add_styles(page,['styles/teacher-workbench.css','styles/question-bank-admin.css','styles/teacher-question-workflow.css'])
    add_scripts(page,['src/28-app-storage.js','src/29-auth-core.js','src/34-role-permissions.js','src/50-question-data.js','src/95-recall-association-library.js','src/98-teacher-workflow-p2-services.js','src/65-question-bank-admin.js','src/97-teacher-question-workflow.js'])
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))");page.wait_for_timeout(250)

def open_course(page,course):
    page.set_content('<body>'+body_html('course-admin.html')+'</body>');install_storage(page,course);page.evaluate("document.body.dataset.caWorkflowMode='simple'")
    add_styles(page,['styles/teacher-workbench.css','styles/course-admin.css','styles/workspace-panels.css','styles/config-organization.css','styles/teacher-course-workflow.css'])
    add_scripts(page,['src/28-app-storage.js','src/29-auth-core.js','src/86-activity-schema-v1.js','src/87-guided-learning-data.js','src/91-learning-content-core.js','src/65-canvas-workspace-store.js','src/93-content-organization-core.js','src/98-teacher-workflow-p2-services.js','src/91-course-admin-app.js','src/93-assessment-config-app.js','src/92-workspace-panel-manager.js','src/97-teacher-course-workflow.js'])
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))");page.wait_for_timeout(260)

course={'id':'course-p2','name':'P2效率测试课程','subjectId':'subject-pmp','taxonomyId':'taxonomy-pmp-main','status':'draft','version':1,'description':'','stages':[{'id':'stage-a','title':'阶段 A','order':1}],'parts':[{'id':'part-a','stageId':'stage-a','title':'章节 A','order':1}],'nodes':[{'id':'node-a','partId':'part-a','title':'已有步骤','order':1,'nodeType':'standard','activityIds':[],'description':'','settings':{}}]}

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=ARGS)
    errors=[]
    page=browser.new_page(viewport={'width':1440,'height':1000});page.set_default_timeout(5000);page.on('pageerror',lambda e:errors.append('question:'+str(e)))
    open_question(page)
    page.locator('#tqNewQuestionBtn').dispatch_event('click');page.wait_for_timeout(80)
    page.locator('[data-tq-paste-mode="batch"]').dispatch_event('click')
    batch='''1. 第一题题干？\nA. 甲\nB. 乙\nC. 丙\nD. 丁\n答案：A\n解析：第一题解析。\n\n2. 第二题题干？\nA. 一\nB. 二\nC. 三\nD. 四\n答案：D\n解析：第二题解析。'''
    before=page.evaluate("KGQuestionBankAdminAPI.getCurrentBank().questions.length")
    page.locator('#tqPasteInput').fill(batch);page.locator('#tqParseBtn').dispatch_event('click');page.wait_for_timeout(50)
    assert '共 2 道' in page.locator('#tqParseSummary').inner_text()
    assert page.locator('#tqApplyParsedBtn').is_enabled()
    page.locator('#tqApplyParsedBtn').dispatch_event('click');page.wait_for_timeout(180)
    after=page.evaluate("KGQuestionBankAdminAPI.getCurrentBank().questions.length")
    assert after==before+2,(before,after)
    page.close()

    page=browser.new_page(viewport={'width':1440,'height':1000});page.set_default_timeout(5000);page.on('pageerror',lambda e:errors.append('course:'+str(e)))
    open_course(page,course)
    page.locator('#caBatchToolsBtn').dispatch_event('click');page.wait_for_timeout(50)
    assert page.locator('#caBatchToolsDialog').is_visible()
    page.locator('#caTemplateSelect').select_option('complete_learning')
    page.locator('#caApplyTemplateBtn').dispatch_event('click');page.wait_for_timeout(120)
    data=page.evaluate("KGLearningContent.getCourseDrafts()[0]")
    assert len(data['nodes'])==8,len(data['nodes'])
    ids=[item['id'] for item in data['nodes']];assert len(ids)==len(set(ids))

    # 复制当前章节两份，所有复制项使用新 ID。
    page.locator('#caCopyKind').select_option('part');page.locator('#caCopyCount').fill('2');page.locator('#caCopyStructureBtn').dispatch_event('click');page.wait_for_timeout(120)
    data=page.evaluate("KGLearningContent.getCourseDrafts()[0]")
    assert len(data['parts'])==3,len(data['parts'])
    assert len({item['id'] for item in data['parts']})==3
    assert len({item['id'] for item in data['nodes']})==len(data['nodes'])

    # 按大纲追加结构。
    outline='# 新阶段\n## 新章节\n- 关键词回忆 | deep_recall\n- 多题归纳 | multi_question'
    page.locator('#caOutlineInput').fill(outline);page.locator('#caParseOutlineBtn').dispatch_event('click');page.wait_for_timeout(40)
    assert page.locator('#caApplyOutlineBtn').is_enabled()
    page.locator('#caApplyOutlineBtn').dispatch_event('click');page.wait_for_timeout(120)
    data=page.evaluate("KGLearningContent.getCourseDrafts()[0]")
    assert len(data['stages'])==2
    assert any(item['title']=='新章节' for item in data['parts'])

    # 最近编辑可定位，课程检查可列出待配置项。
    page.locator('#caRecentBtn').dispatch_event('click');page.wait_for_timeout(40)
    assert page.locator('#caRecentDialog').is_visible()
    assert page.locator('#caRecentList .ca-p2-list-item').count()>=1
    page.locator('#caRecentDialog button[value="cancel"]').first.dispatch_event('click');page.locator('#caValidationBtn').dispatch_event('click');page.wait_for_timeout(40)
    assert page.locator('#caValidationDialog').is_visible()
    assert page.locator('#caValidationList .ca-p2-list-item').count()>=1

    for width,height in [(1366,768),(1440,900),(1920,1080)]:
        for zoom in [1,1.25,1.5]:
            page.set_viewport_size({'width':width,'height':height});page.evaluate('(z)=>document.documentElement.style.zoom=String(z)',zoom);page.wait_for_timeout(35)
            overflow=page.evaluate('document.documentElement.scrollWidth-document.documentElement.clientWidth')
            assert overflow<=4,(width,height,zoom,overflow)
    page.close();browser.close();assert not errors,errors
print('v862-p2-teacher-efficiency-browser-ok')
