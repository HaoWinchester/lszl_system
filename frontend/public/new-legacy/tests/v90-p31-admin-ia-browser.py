#!/usr/bin/env python3
from pathlib import Path
import re
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
ARGS=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']
COMMON=[
 'src/28-app-storage.js','src/29-auth-core.js','src/86-activity-schema-v1.js','src/87-guided-learning-data.js','src/91-learning-content-core.js','src/93-content-organization-core.js',
 'src/admin/00-admin-core.js','src/admin/10-content-repository.js','src/admin/11-local-content-repository.js','src/admin/20-admin-permission-service.js','src/admin/21-admin-audit-service.js','src/admin/22-admin-transaction-service.js','src/admin/30-reference-index-service.js','src/admin/31-subject-service.js','src/admin/32-taxonomy-service.js','src/admin/33-activity-service.js','src/admin/34-course-service.js','src/admin/35-release-service.js','src/admin/40-admin-service-registry.js','src/admin/41-learning-content-compat.js','src/admin/49-admin-ui.js'
]
def mount(page,name,app):
    html=(ROOT/name).read_text(encoding='utf-8')
    match=re.search(r'<body([^>]*)>([\s\S]*)</body>',html,re.I)
    body=re.sub(r'<script[\s\S]*?</script>','',match.group(2),flags=re.I)
    page.set_content(f'<!doctype html><html><head></head><body{match.group(1)}>{body}</body></html>')
    page.add_style_tag(content=(ROOT/'styles/admin-console.css').read_text(encoding='utf-8'))
    page.add_style_tag(content=(ROOT/'styles/admin-context-nav.css').read_text(encoding='utf-8'))
    page.evaluate("""()=>{const local=new Map(),session=new Map();Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>local.has(k)?local.get(k):null,setItem:(k,v)=>local.set(k,String(v)),removeItem:k=>local.delete(k),clear:()=>local.clear(),key:i=>[...local.keys()][i]||null,get length(){return local.size}}});Object.defineProperty(window,'sessionStorage',{configurable:true,value:{getItem:k=>session.has(k)?session.get(k):null,setItem:(k,v)=>session.set(k,String(v)),removeItem:k=>session.delete(k),clear:()=>session.clear()}});const u='p31-teacher';localStorage.setItem('kg_local_current_user_v1',u);localStorage.setItem('kg_local_users_v1',JSON.stringify({[u]:{username:u,displayName:'P3.1 测试教师',role:'teacher',status:'active',subject:'PMP',salt:'x',hash:'x'}}));} """)
    for script in COMMON+[app]:page.add_script_tag(content=(ROOT/script).read_text(encoding='utf-8'))
    page.wait_for_timeout(220)
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=ARGS)
    page=browser.new_page(viewport={'width':1440,'height':1000});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    mount(page,'admin-console.html','src/admin/50-admin-shell-app.js')
    assert page.locator('h1').inner_text()=='管理后台'
    assert page.locator('.admin-context-nav a').count()==8
    assert page.locator('.admin-sidebar').count()==0
    nav_box=page.locator('.admin-context-nav').bounding_box(); topbar_box=page.locator('.admin-topbar').bounding_box(); main_box=page.locator('.admin-main').bounding_box()
    assert nav_box and nav_box['y']==0 and nav_box['width']>=1439
    assert topbar_box and topbar_box['y']>=nav_box['height']
    assert main_box and main_box['x']>0 and main_box['width']>1000
    assert int(page.locator('#adminSubjectCount').inner_text())>=1
    assert int(page.locator('#adminQuestionCount').inner_text())>=1
    assert page.locator('#adminRepositoryMode').count()==0
    page.close()
    page=browser.new_page(viewport={'width':1440,'height':1000});errors2=[];page.on('pageerror',lambda e:errors2.append(str(e)))
    mount(page,'admin-subjects.html','src/admin/51-admin-subjects-app.js')
    assert page.locator('#adminSubjectList button').count()>=5
    assert page.locator('#adminSelectedSubjectName').inner_text()=='PMP 项目管理'
    assert page.locator('#adminCurrentTreeName').inner_text()!='尚无当前知识树'
    page.locator('[data-subject-tab="history"]').click()
    assert page.locator('[data-subject-panel="history"]').get_attribute('class').endswith('active')
    assert page.locator('#adminTaxonomyRows tr').count()>=1
    assert page.locator('#adminImportTaxonomyBtn').is_enabled()
    assert page.locator('.admin-context-nav a.active').get_attribute('data-admin-nav')=='subjects'
    assert not errors and not errors2,(errors,errors2)
    browser.close()
print('v90-p31-admin-ia-browser-ok')
