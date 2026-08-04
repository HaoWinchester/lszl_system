#!/usr/bin/env python3
from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
if (ROOT/'VERSION').read_text(encoding='utf-8').strip()!='v9.0-p3.3.2':
    print('v90-p332-workspace-placement-browser-skipped')
    raise SystemExit(0)
ARGS=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']
ADMIN_SCRIPTS=[
 'src/28-app-storage.js','src/29-auth-core.js','src/86-activity-schema-v1.js','src/87-guided-learning-data.js','src/91-learning-content-core.js','src/93-content-organization-core.js',
 'src/admin/00-admin-core.js','src/admin/10-content-repository.js','src/admin/11-local-content-repository.js','src/admin/20-admin-permission-service.js','src/admin/21-admin-audit-service.js','src/admin/22-admin-transaction-service.js','src/admin/30-reference-index-service.js','src/admin/31-subject-service.js','src/admin/32-taxonomy-service.js','src/admin/33-activity-service.js','src/admin/34-course-service.js','src/admin/35-release-service.js','src/admin/40-admin-service-registry.js','src/admin/41-learning-content-compat.js','src/admin/49-admin-ui.js','src/admin/51-admin-subjects-app.js','src/99-workspace-placement.js'
]

def body_html(file):
    html=(ROOT/file).read_text(encoding='utf-8')
    match=re.search(r'<body([^>]*)>([\s\S]*)</body>',html,re.I)
    return match.group(1),re.sub(r'<script[\s\S]*?</script>','',match.group(2),flags=re.I)

def add_css(page,*files):
    for file in files:page.add_style_tag(content=(ROOT/file).read_text(encoding='utf-8'))

def install_storage(page):
    page.evaluate("""()=>{const local=new Map(),session=new Map();Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>local.has(k)?local.get(k):null,setItem:(k,v)=>local.set(k,String(v)),removeItem:k=>local.delete(k),clear:()=>local.clear(),key:i=>[...local.keys()][i]||null,get length(){return local.size}}});Object.defineProperty(window,'sessionStorage',{configurable:true,value:{getItem:k=>session.has(k)?session.get(k):null,setItem:(k,v)=>session.set(k,String(v)),removeItem:k=>session.delete(k),clear:()=>session.clear()}});const u='p332-admin';localStorage.setItem('kg_local_current_user_v1',u);localStorage.setItem('kg_local_users_v1',JSON.stringify({[u]:{username:u,displayName:'P3.3.2 管理员',role:'admin',status:'active',subject:'PMP',salt:'x',hash:'x'}}));}""")

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=ARGS)

    # 题目管理：页签切换并延迟挂载录入中心。
    page=browser.new_page(viewport={'width':1440,'height':920});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    attrs,body=body_html('question-bank.html');page.set_content(f'<!doctype html><html><head></head><body{attrs}>{body}</body></html>')
    add_css(page,'styles/teacher-workbench.css','styles/question-bank-admin.css','styles/teacher-question-workflow.css','styles/admin-context-nav.css','styles/workspace-placement.css')
    page.add_script_tag(content=(ROOT/'src/99-workspace-placement.js').read_text(encoding='utf-8'))
    assert page.locator('[data-question-workspace]').count()==2
    assert page.locator('#questionLibraryWorkspace').is_visible();assert not page.locator('#questionEntryWorkspace').is_visible()
    page.get_by_role('tab',name='录入中心').click();page.wait_for_timeout(80)
    assert page.locator('#questionEntryWorkspace').is_visible();assert not page.locator('#questionLibraryWorkspace').is_visible()
    assert page.locator('#questionEntryFrame').get_attribute('src')=='question-studio/index.html?embed=entry'
    assert page.get_by_role('tab',name='录入中心').get_attribute('aria-selected')=='true'
    page.get_by_role('tab',name='题库与题目').click();assert page.locator('#questionLibraryWorkspace').is_visible()
    page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(50)
    tab_metrics=page.evaluate("""()=>{const n=document.querySelector('.business-workspace-tabs');return {client:n.clientWidth,scroll:n.scrollWidth,display:getComputedStyle(n).display}}""")
    assert tab_metrics['display']=='flex' and tab_metrics['scroll']>=tab_metrics['client']
    assert not errors,errors;page.close()

    # 嵌入模式外壳：录入中心隐藏旧顶部外壳；知识树只显示知识树工作区。
    page=browser.new_page(viewport={'width':1200,'height':900})
    attrs,body=body_html('question-studio/index.html');page.set_content(f'<!doctype html><html class="kg-embedded" data-embed-mode="entry"><head></head><body{attrs}>{body}</body></html>')
    add_css(page,'question-studio/teacher-workbench.css','question-studio/styles.css','styles/workspace-placement.css')
    assert not page.locator('.tw-topbar').is_visible();assert page.locator('.qs-header').is_visible();page.close()

    page=browser.new_page(viewport={'width':1200,'height':900})
    attrs,body=body_html('content-center.html');page.set_content(f'<!doctype html><html class="kg-embedded" data-embed-mode="knowledge"><head></head><body{attrs}>{body}</body></html>')
    add_css(page,'styles/teacher-workbench.css','styles/content-center.css','styles/content-organization.css','styles/workspace-placement.css')
    assert not page.locator('.tw-topbar').is_visible();assert page.locator('#knowledge').is_visible();assert not page.locator('.cc-library-panel').is_visible();assert not page.locator('.cc-organize-panel').is_visible();page.close()

    # 科目与知识树：当前知识树组件直接挂在当前页签，且随科目切换更新。
    page=browser.new_page(viewport={'width':1440,'height':1000});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    attrs,body=body_html('admin-subjects.html');page.set_content(f'<!doctype html><html><head></head><body{attrs}>{body}</body></html>')
    add_css(page,'styles/admin-console.css','styles/admin-context-nav.css','styles/workspace-placement.css');install_storage(page)
    for script in ADMIN_SCRIPTS:page.add_script_tag(content=(ROOT/script).read_text(encoding='utf-8'))
    page.wait_for_timeout(280)
    frame=page.locator('#adminCurrentTreeFrame');assert frame.is_visible();src=frame.get_attribute('src') or ''
    assert 'content-center.html?embed=knowledge' in src and 'subjectId=' in src and 'taxonomyId=' in src
    assert page.locator('#adminTreeWorkspaceTitle').inner_text()=='当前知识树工作区'
    pmp_src=src
    other=page.locator('#adminSubjectList button').nth(1);other.click();page.wait_for_timeout(120)
    other_src=frame.get_attribute('src') or ''
    assert other_src!=pmp_src and 'embed=knowledge' in other_src
    page.locator('[data-subject-tab="history"]').click();assert page.locator('[data-subject-panel="history"]').is_visible()
    first_view=page.locator('#adminTaxonomyRows .admin-action-link').first
    if first_view.count():
        href=first_view.get_attribute('href') or ''
        assert href.startswith('admin-subjects.html?') and 'tab=current' in href and 'taxonomyId=' in href
    assert page.locator('.admin-context-nav [data-admin-nav]').count()==8
    assert not errors,errors;page.close();browser.close()
print('v90-p332-workspace-placement-browser-ok')
