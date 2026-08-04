#!/usr/bin/env python3
from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
ARGS=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']

def body_html(file):
    html=(ROOT/file).read_text(encoding='utf-8')
    match=re.search(r'<body([^>]*)>([\s\S]*)</body>',html,re.I)
    return match.group(1),re.sub(r'<script[\s\S]*?</script>','',match.group(2),flags=re.I)

def add_files(page,files,kind='script'):
    for file in files:
        content=(ROOT/file).read_text(encoding='utf-8')
        (page.add_script_tag if kind=='script' else page.add_style_tag)(content=content)

def storage(page,username='p357-admin'):
    page.evaluate(f"""()=>{{const local=new Map(),session=new Map();Object.defineProperty(window,'localStorage',{{configurable:true,value:{{getItem:k=>local.has(k)?local.get(k):null,setItem:(k,v)=>local.set(k,String(v)),removeItem:k=>local.delete(k),clear:()=>local.clear(),key:i=>[...local.keys()][i]||null,get length(){{return local.size}}}}}});Object.defineProperty(window,'sessionStorage',{{configurable:true,value:{{getItem:k=>session.has(k)?session.get(k):null,setItem:(k,v)=>session.set(k,String(v)),removeItem:k=>session.delete(k),clear:()=>session.clear()}}}});const u='{username}';localStorage.setItem('kg_local_current_user_v1',u);localStorage.setItem('kg_local_users_v1',JSON.stringify({{[u]:{{username:u,displayName:'P3.5.7 管理员',role:'admin',status:'active',subject:'PMP',salt:'x',hash:'x'}}}}));window.confirm=()=>true;window.prompt=()=>'';}}""")

ADMIN=[
 'src/28-app-storage.js','src/29-auth-core.js','src/33-user-center.js','src/86-activity-schema-v1.js','src/87-guided-learning-data.js','src/91-learning-content-core.js','src/93-content-organization-core.js',
 'src/admin/00-admin-core.js','src/admin/10-content-repository.js','src/admin/11-local-content-repository.js','src/admin/20-admin-permission-service.js','src/admin/21-admin-audit-service.js','src/admin/22-admin-transaction-service.js','src/admin/30-reference-index-service.js','src/admin/31-subject-service.js','src/admin/32-taxonomy-service.js','src/admin/33-activity-service.js','src/admin/34-course-service.js','src/admin/35-release-service.js','src/admin/40-admin-service-registry.js','src/admin/41-learning-content-compat.js','src/admin/49-admin-ui.js','src/95-recall-association-library.js','src/admin/51-admin-subjects-app.js','src/admin/53-recall-association-management.js'
]
CONTENT=[
 'src/28-app-storage.js','src/29-auth-core.js','src/86-activity-schema-v1.js','src/87-guided-learning-data.js','src/91-learning-content-core.js','src/93-content-organization-core.js',
 'src/admin/00-admin-core.js','src/admin/10-content-repository.js','src/admin/11-local-content-repository.js','src/admin/20-admin-permission-service.js','src/admin/21-admin-audit-service.js','src/admin/22-admin-transaction-service.js','src/admin/30-reference-index-service.js','src/admin/31-subject-service.js','src/admin/32-taxonomy-service.js','src/admin/33-activity-service.js','src/admin/34-course-service.js','src/admin/35-release-service.js','src/admin/40-admin-service-registry.js','src/admin/41-learning-content-compat.js','src/91-knowledge-tree-index.js','src/97-knowledge-question-stats.js','src/91-content-center-app.js'
]

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=ARGS)

    page=browser.new_page(viewport={'width':1500,'height':1050});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    attrs,body=body_html('admin-subjects.html');page.set_content(f'<!doctype html><html><head></head><body{attrs}>{body}</body></html>')
    add_files(page,['styles/admin-console.css','styles/admin-context-nav.css'],'style');storage(page);add_files(page,ADMIN);page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))");page.wait_for_timeout(350)
    assert page.locator('[data-subject-tab="association"]').count()==1
    assert page.locator('[data-subject-tab="unmapped"]').count()==0
    page.locator('[data-subject-tab="association"]').click();page.wait_for_timeout(80)
    assert page.locator('#adminRecallPanel').is_visible()
    page.locator('#adminRecallNewBtn').click();page.wait_for_timeout(50)
    page.locator('#adminRecallEditorTitle').fill('范围基准')
    page.locator('#adminRecallEditorAliases').fill('范围基线, Scope Baseline')
    page.locator('#adminRecallEditorTargets').fill('需求文件\n工作分解结构')
    page.locator('#adminRecallEditorSave').click();page.wait_for_timeout(50)
    assert '范围基准' in page.locator('#adminRecallRows').inner_text()
    page.locator('#adminRecallSaveDraftBtn').click();page.locator('#adminRecallPublishBtn').click();page.wait_for_timeout(80)
    live=page.evaluate("JSON.parse(localStorage.getItem('kg_recall_association_library_v1__subject__PMP'))")
    assert any(n['title']=='范围基准' for n in live['nodes']),live
    assert page.locator('#adminRecallPublishedVersion').inner_text()=='v1'
    page.locator('[data-recall-view="graph"]').click();assert page.locator('#adminRecallGraph svg').count()==1
    page.locator('[data-recall-view="imports"]').click();assert page.locator('#adminRecallReleaseHistory').inner_text().find('正式版本 v1')>=0
    assert not errors,errors;page.close()

    page=browser.new_page(viewport={'width':1450,'height':1000});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    attrs,body=body_html('content-center.html');page.set_content(f'<!doctype html><html class="kg-embedded" data-embed-mode="knowledge"><head></head><body{attrs}>{body}</body></html>')
    add_files(page,['styles/content-center.css','styles/workspace-placement.css'],'style');storage(page)
    # Load through the content core first so the test can use real stable knowledge node IDs.
    add_files(page,CONTENT[:-3])
    ids=page.evaluate("""()=>{const t=KGLearningContent.defaultTaxonomyForSubject('subject-pmp');return {taxonomyId:t.id,nodes:t.nodes.slice(0,3).map(n=>n.id)}}""")
    page.evaluate("""ids=>{localStorage.setItem('kg_question_banks_v1__user__p357-admin',JSON.stringify([{id:'bank-p357',name:'统计测试题库',subject:'PMP',questions:[{id:'q1',teacherNumber:'T-1',title:'第一道题',metadata:{knowledge:{taxonomyId:ids.taxonomyId,primaryNodeId:ids.nodes[0]}}},{id:'q2',teacherNumber:'T-2',title:'第二道题',metadata:{knowledge:{taxonomyId:ids.taxonomyId,primaryNodeId:ids.nodes[1]}}},{id:'q3',teacherNumber:'T-3',title:'待分类题',metadata:{knowledge:{taxonomyId:ids.taxonomyId,primaryNodeId:null}}}]}]));}""",ids)
    add_files(page,CONTENT[-3:]);page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))");page.wait_for_timeout(350)
    summary=page.locator('#ccTreeSummary').inner_text();assert '正常题目 3' in summary and '待分类 1' in summary,summary
    badges=page.locator('[data-question-count-node]');assert badges.count()>0
    badges.first.click();page.wait_for_timeout(50);assert page.locator('#ccQuestionCountDrawer').is_visible()
    assert '道题目' in page.locator('#ccQuestionDrawerSummary').inner_text()
    page.locator('[data-question-scope="branch"]').click();page.wait_for_timeout(30)
    assert page.locator('#ccQuestionDrawerList').count()==1
    assert not errors,errors;page.close();browser.close()
print('v90-p357-recall-library-question-stats-browser-ok')
