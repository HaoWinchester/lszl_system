from pathlib import Path
import json,re,time
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

def stress_course():
    course={'id':'course-p1-stress','name':'P1 大型课程压力样本','subjectId':'subject-pmp','taxonomyId':'taxonomy-pmp-main','status':'draft','version':1,'description':'24 阶段 × 12 章节 × 10 步骤','stages':[],'parts':[],'nodes':[]}
    for si in range(1,25):
        sid=f'stage-{si:02d}';course['stages'].append({'id':sid,'title':f'阶段 {si:02d}','order':si})
        for pi in range(1,13):
            pid=f'part-{si:02d}-{pi:02d}';course['parts'].append({'id':pid,'stageId':sid,'title':f'章节 {si:02d}.{pi:02d}','order':pi})
            for ni in range(1,11):
                nid=f'node-{si:02d}-{pi:02d}-{ni:02d}'
                activities=['missing-activity'] if (si,pi,ni)==(2,3,4) else []
                course['nodes'].append({'id':nid,'partId':pid,'title':f'学习步骤 {si:02d}.{pi:02d}.{ni:02d}','order':ni,'nodeType':'standard','activityIds':activities,'description':'','settings':{}})
    return course

def install_storage(page):
    payload=json.dumps([stress_course()],ensure_ascii=False)
    page.evaluate("""payload=>{const local=new Map(),session=new Map();Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>local.has(k)?local.get(k):null,setItem:(k,v)=>local.set(k,String(v)),removeItem:k=>local.delete(k),clear:()=>local.clear()}});Object.defineProperty(window,'sessionStorage',{configurable:true,value:{getItem:k=>session.has(k)?session.get(k):null,setItem:(k,v)=>session.set(k,String(v)),removeItem:k=>session.delete(k),clear:()=>session.clear()}});const u='p1-teacher';localStorage.setItem('kg_local_current_user_v1',u);localStorage.setItem('kg_local_users_v1',JSON.stringify({[u]:{username:u,displayName:'P1测试教师',role:'teacher',status:'active',subject:'PMP',salt:'x',hash:'x'}}));localStorage.setItem('kg_course_config_drafts_v1',payload);window.confirm=()=>true;window.alert=()=>{};window.open=()=>({});}""",payload)

def open_course(page):
    page.set_content('<body>'+body_html('course-admin.html')+'</body>');install_storage(page);page.evaluate("document.body.dataset.caWorkflowMode='simple'")
    add_styles(page,['styles/teacher-workbench.css','styles/course-admin.css','styles/workspace-panels.css','styles/config-organization.css','styles/teacher-course-workflow.css'])
    started=time.perf_counter()
    add_scripts(page,['src/28-app-storage.js','src/29-auth-core.js','src/86-activity-schema-v1.js','src/87-guided-learning-data.js','src/91-learning-content-core.js','src/65-canvas-workspace-store.js','src/93-content-organization-core.js','src/98-teacher-workflow-p2-services.js','src/91-course-admin-app.js','src/93-assessment-config-app.js','src/92-workspace-panel-manager.js','src/97-teacher-course-workflow.js'])
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))");page.wait_for_timeout(260)
    return time.perf_counter()-started

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=ARGS)
    page=browser.new_page(viewport={'width':1440,'height':1000});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    elapsed=open_course(page)
    assert elapsed<3.5,elapsed
    assert page.locator('#caStageSelector option').count()==24
    assert page.locator('#caStagePosition').inner_text()=='1 / 24'
    assert page.locator('#caStructureTree .ca-tree-stage').count()==1
    assert page.locator('#caStructureTree .ca-tree-row.depth-1').count()==12
    assert page.locator('#caStructureTree .ca-tree-row.depth-2').count()==10
    assert page.locator('#caStructureTree [data-stage-id="stage-24"]').count()==0

    # 全课程搜索定位，但结构区仍只渲染目标阶段。
    page.locator('#caStructureSearch').fill('学习步骤 24.12.10');page.wait_for_timeout(80)
    result=page.locator('#caStructureSearchResults [data-search-id="node-24-12-10"]')
    assert result.count()==1
    result.click(force=True);page.wait_for_timeout(100)
    assert page.locator('#caStageSelector').input_value()=='stage-24'
    assert page.locator('#caStagePosition').inner_text()=='24 / 24'
    assert page.locator('#caStructureTree .ca-tree-stage').count()==1
    assert page.locator('#caStructureTree .label.active .ca-tree-number').inner_text()=='24.12.10'

    # 编辑位置自动保存。
    workspace=page.evaluate("JSON.parse(localStorage.getItem('kg_course_admin_workspace_v862_p1'))['course-p1-stress']")
    assert workspace['currentStageId']=='stage-24'
    assert workspace['selection']['id']=='node-24-12-10'

    # 章节前后导航。
    page.locator('#caPrevPartBtn').dispatch_event('click');page.wait_for_timeout(70)
    assert page.locator('#caStructureTree .label.active .ca-tree-number').inner_text().startswith('24.11.')

    # 跳转结构问题：定位到唯一缺失活动节点。
    page.locator('#caJumpIssueBtn').dispatch_event('click');page.wait_for_timeout(100)
    assert page.locator('#caStageSelector').input_value()=='stage-02'
    assert page.locator('#caStructureTree .label.active .ca-tree-number').inner_text()=='02.03.04'
    assert '有问题 1' in page.locator('#caJumpIssueBtn').inner_text()

    # 独立章节预览只渲染当前章节，并支持章节切换。
    page.locator('#caOpenChapterPreviewBtn').dispatch_event('click');page.wait_for_timeout(80)
    assert page.locator('#caChapterPreviewDialog').is_visible()
    assert page.locator('#caChapterPreviewBody .preview-node').count()==10
    before=page.locator('#caChapterPreviewTitle').inner_text()
    page.locator('#caPreviewNextPartBtn').dispatch_event('click');page.wait_for_timeout(60)
    after=page.locator('#caChapterPreviewTitle').inner_text()
    assert before!=after
    page.locator('#caChapterPreviewDialog button[value="cancel"]').first.dispatch_event('click')

    # 待配置筛选与大屏/缩放无页面级横向溢出。
    page.locator('#caStructureFilter').select_option('incomplete');page.wait_for_timeout(50)
    assert page.locator('#caStructureTree .ca-tree-stage').count()==1
    for width,height in [(1366,768),(1440,900),(1920,1080)]:
        for zoom in [1,1.25,1.5]:
            page.set_viewport_size({'width':width,'height':height});page.evaluate('(z)=>document.documentElement.style.zoom=String(z)',zoom);page.wait_for_timeout(45)
            overflow=page.evaluate('document.documentElement.scrollWidth-document.documentElement.clientWidth')
            assert overflow<=4,(width,height,zoom,overflow)
    browser.close();assert not errors,errors
print('v862-p1-large-course-browser-ok')
