from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
ARGS=['--no-sandbox','--disable-dev-shm-usage','--in-process-gpu','--disable-gpu-sandbox','--use-gl=swiftshader']

def text(path): return (ROOT/path).read_text()
def body_html(path):
    source=text(path);match=re.search(r'<body[^>]*>([\s\S]*)</body>',source,re.I)
    return re.sub(r'<script[\s\S]*?</script>','',match.group(1),flags=re.I)
def install_storage(page):
    page.evaluate("""()=>{const local=new Map(),session=new Map();Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>local.has(k)?local.get(k):null,setItem:(k,v)=>local.set(k,String(v)),removeItem:k=>local.delete(k),clear:()=>local.clear()}});Object.defineProperty(window,'sessionStorage',{configurable:true,value:{getItem:k=>session.has(k)?session.get(k):null,setItem:(k,v)=>session.set(k,String(v)),removeItem:k=>session.delete(k),clear:()=>session.clear()}});const u='p0-teacher';localStorage.setItem('kg_local_current_user_v1',u);localStorage.setItem('kg_local_users_v1',JSON.stringify({[u]:{username:u,displayName:'P0测试教师',role:'teacher',status:'active',subject:'PMP',salt:'x',hash:'x'}}));window.confirm=()=>true;window.alert=()=>{};window.open=()=>({});}""")
def add_styles(page,paths):
    for path in paths: page.add_style_tag(content=text(path))
def add_scripts(page,paths):
    for path in paths: page.add_script_tag(content=text(path))

def open_question(page,step):
    page.set_content('<body>'+body_html('question-bank.html')+'</body>');install_storage(page)
    page.evaluate("([step])=>{document.body.dataset.qbWorkflowMode='simple';document.body.dataset.qbWorkflowStep=step}",[step])
    add_styles(page,['styles/teacher-workbench.css','styles/question-bank-admin.css','styles/teacher-question-workflow.css'])
    add_scripts(page,['src/28-app-storage.js','src/29-auth-core.js','src/34-role-permissions.js','src/50-question-data.js','src/95-recall-association-library.js','src/98-teacher-workflow-p2-services.js','src/65-question-bank-admin.js','src/97-teacher-question-workflow.js'])
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))");page.wait_for_timeout(220)

def open_course(page):
    page.set_content('<body>'+body_html('course-admin.html')+'</body>');install_storage(page);page.evaluate("document.body.dataset.caWorkflowMode='simple'")
    add_styles(page,['styles/teacher-workbench.css','styles/course-admin.css','styles/workspace-panels.css','styles/config-organization.css','styles/teacher-course-workflow.css'])
    add_scripts(page,['src/28-app-storage.js','src/29-auth-core.js','src/86-activity-schema-v1.js','src/87-guided-learning-data.js','src/91-learning-content-core.js','src/65-canvas-workspace-store.js','src/93-content-organization-core.js','src/98-teacher-workflow-p2-services.js','src/91-course-admin-app.js','src/93-assessment-config-app.js','src/92-workspace-panel-manager.js','src/97-teacher-course-workflow.js'])
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))");page.wait_for_timeout(240)

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=ARGS)
    errors=[]

    page=browser.new_page(viewport={'width':1440,'height':1000});page.on('pageerror',lambda e:errors.append('questions:'+str(e)))
    open_question(page,'questions')
    assert page.locator('.tw-topbar .tw-tabs a.active').inner_text()=='题目管理'
    page.locator('#tqNewQuestionBtn').dispatch_event('click');page.wait_for_timeout(80)
    assert page.locator('#tqPastePanel').is_visible()
    sample='''项目经理发现一位关键干系人对项目目标存在误解，下一步应该怎么做？\nA. 立即升级给发起人\nB. 与干系人沟通并澄清目标\nC. 修改项目章程\nD. 忽略该问题\n答案：B\n解析：应先沟通并澄清干系人的理解。'''
    page.locator('#tqPasteInput').fill(sample);page.locator('#tqParseBtn').dispatch_event('click');page.wait_for_timeout(30)
    assert page.locator('#tqApplyParsedBtn').is_enabled()
    assert '4 个选项' in page.locator('#tqParseSummary').inner_text()
    page.locator('#tqApplyParsedBtn').dispatch_event('click');page.wait_for_timeout(320)
    assert page.locator('#questionStemInput').input_value().startswith('项目经理发现')
    assert page.locator('#questionAnalysisInput').input_value().startswith('应先沟通')
    rows=page.locator('#qbOptionsEditor .qb-option-row')
    assert rows.count()==4
    assert rows.nth(1).locator('.option-text').input_value().startswith('与干系人沟通')
    assert rows.nth(1).locator('input[name="correctOption"]').is_checked()
    page.close()

    page=browser.new_page(viewport={'width':1440,'height':1000});page.on('pageerror',lambda e:errors.append('training:'+str(e)))
    open_question(page,'training')
    boxes=page.evaluate("""()=>{const a=document.querySelector('#qbMainWorkspace').getBoundingClientRect(),b=document.querySelector('#qbAnnotationCard').getBoundingClientRect();return {a,b}}""")
    assert boxes['a']['right']<=boxes['b']['left']+2
    assert abs(boxes['a']['top']-boxes['b']['top'])<=3
    assert page.locator('#tqTrainingPreview').is_visible()
    for width,height in [(1366,768),(1440,900),(1920,1080)]:
        for zoom in [1,1.25,1.5]:
            page.set_viewport_size({'width':width,'height':height});page.evaluate('(z)=>document.documentElement.style.zoom=String(z)',zoom);page.wait_for_timeout(40)
            overflow=page.evaluate('document.documentElement.scrollWidth-document.documentElement.clientWidth')
            assert overflow<=4,(width,height,zoom,overflow)
    page.close()

    page=browser.new_page(viewport={'width':1440,'height':1000});page.on('pageerror',lambda e:errors.append('course:'+str(e)))
    open_course(page)
    tops=page.evaluate("""()=>['.ca-structure','.ca-node-editor','.ca-library'].map(s=>document.querySelector(s).getBoundingClientRect().top)""")
    assert max(tops)-min(tops)<=2,tops
    stage_rows=page.locator('.ca-tree-row.depth-0');part_rows=page.locator('.ca-tree-row.depth-1');node_rows=page.locator('.ca-tree-row.depth-2')
    assert stage_rows.count()>=1 and part_rows.count()>=1 and node_rows.count()>=1
    assert re.match(r'^\d{2}$',stage_rows.first.locator('.ca-tree-number').inner_text())
    assert re.match(r'^\d{2}\.\d{2}$',part_rows.first.locator('.ca-tree-number').inner_text())
    assert re.match(r'^\d{2}\.\d{2}\.\d{2}$',node_rows.first.locator('.ca-tree-number').inner_text())
    # 默认只展开当前位置：可见章节少于课程全部章节。
    visible_parts=part_rows.count()
    total_parts=page.evaluate("KGLearningContent.getCourseDrafts()[0].parts.length")
    assert visible_parts<total_parts,(visible_parts,total_parts)
    preview_parts=page.locator('#caPreviewTree .preview-current')
    assert preview_parts.count()==1
    assert page.locator('#caPreviewTree .preview-stage').count()==0
    for width,height in [(1366,768),(1440,900),(1920,1080)]:
        for zoom in [1,1.25,1.5]:
            page.set_viewport_size({'width':width,'height':height});page.evaluate('(z)=>document.documentElement.style.zoom=String(z)',zoom);page.wait_for_timeout(40)
            overflow=page.evaluate('document.documentElement.scrollWidth-document.documentElement.clientWidth')
            assert overflow<=4,(width,height,zoom,overflow)
    page.close();browser.close()
    assert not errors,errors
print('v862-p0-teacher-workflow-browser-ok')
