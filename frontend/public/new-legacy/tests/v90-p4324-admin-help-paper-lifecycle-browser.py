#!/usr/bin/env python3
from pathlib import Path
import re
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
ARGS=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']
def txt(p):return (ROOT/p).read_text(encoding='utf-8')
def body(file):
    m=re.search(r'<body([^>]*)>([\s\S]*)</body>',txt(file),re.I);return m.group(1),re.sub(r'<script[\s\S]*?</script>','',m.group(2),flags=re.I)
def add(page,files,kind='js'):
    for f in files:(page.add_style_tag if kind=='css' else page.add_script_tag)(content=txt(f))
with sync_playwright() as p:
    launch_options={'headless':True,'args':ARGS}
    if Path('/usr/bin/chromium').exists(): launch_options['executable_path']='/usr/bin/chromium'
    b=p.chromium.launch(**launch_options)
    page=b.new_page(viewport={'width':1440,'height':980});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    attrs,markup=body('paper-management.html');page.set_content(f'<!doctype html><html><head></head><body{attrs}>{markup}</body></html>')
    page.evaluate("""()=>{const L=new Map(),S=new Map();Object.defineProperty(window,'localStorage',{configurable:true,value:{get length(){return L.size},key:i=>[...L.keys()][i]||null,getItem:k=>L.get(String(k))??null,setItem:(k,v)=>L.set(String(k),String(v)),removeItem:k=>L.delete(String(k)),clear:()=>L.clear()}});Object.defineProperty(window,'sessionStorage',{configurable:true,value:{getItem:k=>S.get(String(k))??null,setItem:(k,v)=>S.set(String(k),String(v)),removeItem:k=>S.delete(String(k)),clear:()=>S.clear()}});const u='p4324-teacher',scope='user__'+encodeURIComponent(u);localStorage.setItem('kg_local_current_user_v1',u);localStorage.setItem('kg_local_users_v1',JSON.stringify({[u]:{username:u,displayName:'生命周期教师',role:'admin',status:'active',subject:'PMP',salt:'x',hash:'x'}}));localStorage.setItem('kg_question_banks_v1__'+scope,JSON.stringify([{id:'bank-1',name:'测试题库',subject:'PMP',questions:[{id:'q1',teacherNumber:'PMP-000001',title:'测试题',type:'single_choice',subject:'PMP',difficulty:'easy',stemParts:[{text:'题干'}],options:[{id:'A',text:'A',correct:true},{id:'B',text:'B'}],correctAnswer:'A',analysis:'',clues:[],concepts:[],reasoningSteps:[],metadata:{knowledge:{primaryNodeId:null}},status:{contentReady:true}}]}]));window.confirm=()=>true;window.alert=()=>{};}""")
    add(page,['styles/teacher-workbench.css','styles/question-bank-admin.css','styles/paper-management.css','styles/admin-module-help.css'],'css')
    add(page,['src/01-runtime-config.js','src/28-app-storage.js','src/29-auth-core.js','src/34-role-permissions.js','src/50-question-data.js','src/91-learning-content-core.js','src/95-recall-association-library.js','src/teacher/shared/domain-core.js','src/teacher/question-bank/batch-operation-service.js','src/teacher/question-bank/safe-delete-service.js','src/teacher/paper-management/paper-list-controller.js','src/teacher/paper-management/paper-category-service.js','src/teacher/paper-management/paper-editor-controller.js','src/teacher/paper-management/paper-question-picker.js','src/teacher/paper-management/paper-preview.js','src/teacher/paper-management/paper-audit-service.js','src/teacher/paper-management/paper-release-service.js','src/teacher/teacher-domain-registry.js','src/98-teacher-workflow-p2-services.js','src/65-question-bank-admin.js','src/admin/module-help-content.js','src/admin/module-help-controller.js'])
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))");page.wait_for_timeout(350)
    page.locator('[data-module-help="paper-management"]').click();page.wait_for_timeout(30)
    assert page.locator('#kgModuleHelpPopover').is_visible();assert '取消发布' in page.locator('#kgModuleHelpPopover').inner_text()
    page.locator('#qbAddPaperBtn').click();page.wait_for_timeout(80)
    page.locator('[data-paper-candidate="bank-1::q1"]').check();page.locator('#qbAddSelectedToPaperBtn').click();page.wait_for_timeout(80)
    page.locator('#qbPublishPaperBtn').click();page.wait_for_timeout(100)
    assert page.locator('#qbWithdrawPaperBtn').is_visible();assert page.locator('#qbUnarchivePaperBtn').is_hidden()
    assert len(page.evaluate("JSON.parse(localStorage.getItem('kg_exam_papers_published_v1')||'[]')"))==1
    page.locator('#qbWithdrawPaperBtn').click();page.wait_for_timeout(100)
    assert len(page.evaluate("JSON.parse(localStorage.getItem('kg_exam_papers_published_v1')||'[]')"))==0
    paper=page.evaluate("JSON.parse(localStorage.getItem('kg_exam_papers_v1__user__p4324-teacher')||'[]')[0]")
    assert paper['status']=='draft' and paper['publishedVersion']==1 and paper['withdrawnAt']>0,paper
    assert page.locator('#qbWithdrawPaperBtn').is_hidden();assert page.locator('#qbPublishPaperBtn').inner_text()=='发布新版本'
    page.locator('#qbArchivePaperBtn').click();page.wait_for_timeout(90)
    assert page.locator('#qbUnarchivePaperBtn').is_visible();assert page.locator('#qbPublishPaperBtn').is_disabled()
    page.locator('#qbUnarchivePaperBtn').click();page.wait_for_timeout(90)
    paper=page.evaluate("JSON.parse(localStorage.getItem('kg_exam_papers_v1__user__p4324-teacher')||'[]')[0]")
    assert paper['status']=='draft' and paper['archivedAt']==0 and paper['restoredAt']>0,paper
    assert page.locator('#qbUnarchivePaperBtn').is_hidden();assert not page.locator('#qbPublishPaperBtn').is_disabled()
    page.locator('#qbPublishPaperBtn').click();page.wait_for_timeout(100)
    release=page.evaluate("JSON.parse(localStorage.getItem('kg_exam_papers_published_v1')||'[]')[0]")
    assert release['version']==2,release
    history=page.evaluate("JSON.parse(localStorage.getItem('kg_exam_paper_release_history_v1')||'[]')")
    assert len(history)>=2
    assert not errors,errors
    b.close()
print('v90-p4324-admin-help-paper-lifecycle-browser-ok')
