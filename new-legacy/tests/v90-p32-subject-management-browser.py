#!/usr/bin/env python3
from pathlib import Path
import re
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
ARGS=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']
SCRIPTS=[
 'src/28-app-storage.js','src/29-auth-core.js','src/86-activity-schema-v1.js','src/87-guided-learning-data.js','src/91-learning-content-core.js','src/93-content-organization-core.js',
 'src/admin/00-admin-core.js','src/admin/10-content-repository.js','src/admin/11-local-content-repository.js','src/admin/20-admin-permission-service.js','src/admin/21-admin-audit-service.js','src/admin/22-admin-transaction-service.js','src/admin/30-reference-index-service.js','src/admin/31-subject-service.js','src/admin/32-taxonomy-service.js','src/admin/33-activity-service.js','src/admin/34-course-service.js','src/admin/35-release-service.js','src/admin/40-admin-service-registry.js','src/admin/41-learning-content-compat.js','src/admin/49-admin-ui.js','src/admin/51-admin-subjects-app.js'
]
def mount(page):
    html=(ROOT/'admin-subjects.html').read_text(encoding='utf-8')
    match=re.search(r'<body([^>]*)>([\s\S]*)</body>',html,re.I);body=re.sub(r'<script[\s\S]*?</script>','',match.group(2),flags=re.I)
    page.set_content(f'<!doctype html><html><head></head><body{match.group(1)}>{body}</body></html>')
    page.add_style_tag(content=(ROOT/'styles/admin-console.css').read_text(encoding='utf-8'));page.add_style_tag(content=(ROOT/'styles/admin-context-nav.css').read_text(encoding='utf-8'))
    page.evaluate("""()=>{const local=new Map(),session=new Map();Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>local.has(k)?local.get(k):null,setItem:(k,v)=>local.set(k,String(v)),removeItem:k=>local.delete(k),clear:()=>local.clear(),key:i=>[...local.keys()][i]||null,get length(){return local.size}}});Object.defineProperty(window,'sessionStorage',{configurable:true,value:{getItem:k=>session.has(k)?session.get(k):null,setItem:(k,v)=>session.set(k,String(v)),removeItem:k=>session.delete(k),clear:()=>session.clear()}});const u='p32-admin';localStorage.setItem('kg_local_current_user_v1',u);localStorage.setItem('kg_local_users_v1',JSON.stringify({[u]:{username:u,displayName:'P3.2 测试管理员',role:'admin',status:'active',subject:'PMP',salt:'x',hash:'x'}}));}""")
    for script in SCRIPTS:page.add_script_tag(content=(ROOT/script).read_text(encoding='utf-8'))
    page.wait_for_timeout(250)
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=ARGS)
    page=browser.new_page(viewport={'width':1440,'height':1000});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    mount(page)
    initial=page.locator('#adminSubjectList button').count();assert initial>=5
    assert page.locator('#adminAddSubjectBtn').is_enabled()
    assert '[object Object]' not in page.locator('#adminSelectedSubjectDescription').inner_text()
    page.locator('#adminAddSubjectBtn').click();assert page.locator('#adminSubjectDialog').get_attribute('open') is not None
    page.locator('#adminSubjectCode').fill('QA');page.locator('#adminSubjectNameZh').fill('质量管理');page.locator('#adminSubjectNameEn').fill('Quality Management');    page.locator('#adminSubjectDialogSubmit').click();page.wait_for_function("document.querySelector('#adminSelectedSubjectName')?.textContent==='质量管理'")
    assert page.locator('#adminSubjectList button').count()==initial+1
    assert page.locator('#adminUsageQuestionCount').inner_text()=='0';assert '可以永久删除' in page.locator('#adminSubjectDeletionHint').inner_text()
    assert '[object Object]' not in page.locator('#adminSelectedSubjectDescription').inner_text()
    page.locator('#adminEditSubjectBtn').click();page.locator('#adminSubjectNameZh').fill('质量与过程管理');page.locator('#adminSubjectDescriptionZh').fill('编辑后的说明');page.locator('#adminSubjectDialogSubmit').click();page.wait_for_timeout(80)
    assert page.locator('#adminSelectedSubjectName').inner_text()=='质量与过程管理';assert page.locator('#adminSelectedSubjectDescription').inner_text()=='编辑后的说明'
    page.once('dialog',lambda dialog: dialog.accept())
    page.locator('#adminToggleSubjectBtn').click();page.wait_for_function("document.querySelector('#adminSelectedSubjectStatus')?.textContent==='已停用'")
    page.once('dialog',lambda dialog: dialog.accept())
    page.locator('#adminToggleSubjectBtn').click();page.wait_for_function("document.querySelector('#adminSelectedSubjectStatus')?.textContent==='启用'")
    dialog_count={'value':0}
    def accept_delete(dialog):
        dialog_count['value']+=1
        dialog.accept('QA' if dialog.type=='prompt' else '')
    page.on('dialog',accept_delete);page.locator('#adminDeleteSubjectBtn').click();page.wait_for_function(f"document.querySelectorAll('#adminSubjectList button').length=={initial}")
    page.remove_listener('dialog',accept_delete)
    assert dialog_count['value']==2
    assert page.locator('#adminSubjectList button').count()==initial
    pmp=page.locator('#adminSubjectList button').filter(has_text='PMP 项目管理').first;pmp.click();page.wait_for_timeout(50)
    captured=[]
    def capture(dialog):captured.append(dialog.message);dialog.accept()
    page.once('dialog',capture);page.locator('#adminDeleteSubjectBtn').click();page.wait_for_timeout(50)
    assert any('不能永久删除' in msg for msg in captured);assert page.locator('#adminSelectedSubjectName').inner_text()=='PMP 项目管理'
    assert not errors,errors
    page.close();browser.close()
print('v90-p32-subject-management-browser-ok')
