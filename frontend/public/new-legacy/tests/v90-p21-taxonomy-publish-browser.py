#!/usr/bin/env python3
from pathlib import Path
import re
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'admin-subjects.html').read_text(encoding='utf-8')
BODY=re.search(r'<body[^>]*>([\s\S]*)</body>',HTML,re.I).group(1)
BODY=re.sub(r'<script[\s\S]*?</script>','',BODY,flags=re.I)
SCRIPTS=[
 'src/28-app-storage.js','src/29-auth-core.js','src/86-activity-schema-v1.js','src/87-guided-learning-data.js','src/91-learning-content-core.js','src/93-content-organization-core.js',
 'src/admin/00-admin-core.js','src/admin/10-content-repository.js','src/admin/11-local-content-repository.js','src/admin/20-admin-permission-service.js','src/admin/21-admin-audit-service.js','src/admin/22-admin-transaction-service.js','src/admin/30-reference-index-service.js','src/admin/31-subject-service.js','src/admin/32-taxonomy-service.js','src/admin/33-activity-service.js','src/admin/34-course-service.js','src/admin/35-release-service.js','src/admin/40-admin-service-registry.js','src/admin/41-learning-content-compat.js','src/admin/49-admin-ui.js','src/admin/51-admin-subjects-app.js'
]
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'])
    page=browser.new_page(viewport={'width':1500,'height':1000})
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content('<!doctype html><html><head></head><body>'+BODY+'</body></html>')
    page.add_style_tag(content=(ROOT/'styles/admin-console.css').read_text(encoding='utf-8'))
    page.add_style_tag(content=(ROOT/'styles/admin-context-nav.css').read_text(encoding='utf-8'))
    page.evaluate("""()=>{
      const local=new Map(),session=new Map();
      Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>local.has(k)?local.get(k):null,setItem:(k,v)=>local.set(k,String(v)),removeItem:k=>local.delete(k),clear:()=>local.clear(),key:i=>[...local.keys()][i]||null,get length(){return local.size}}});
      Object.defineProperty(window,'sessionStorage',{configurable:true,value:{getItem:k=>session.has(k)?session.get(k):null,setItem:(k,v)=>session.set(k,String(v)),removeItem:k=>session.delete(k),clear:()=>session.clear()}});
      const user='v90-admin';localStorage.setItem('kg_local_current_user_v1',user);localStorage.setItem('kg_local_users_v1',JSON.stringify({[user]:{username:user,displayName:'V9 管理员',role:'admin',status:'active',subject:'PMP',salt:'x',hash:'x'}}));
      localStorage.setItem('kg_content_subjects_v1',JSON.stringify([{id:'subject-pmp',code:'PMP',name:{zh:'PMP 项目管理'},defaultTaxonomyId:'taxonomy-pmp-main',status:'active',sortOrder:10}]));
      localStorage.setItem('kg_content_taxonomies_v1',JSON.stringify([
        {id:'taxonomy-pmp-main',subjectId:'subject-pmp',name:{zh:'PMP 主知识树'},version:1,versionLabel:'v1.0',maxDepth:9,status:'published',isDefault:true,nodes:[{id:'root-v1',taxonomyId:'taxonomy-pmp-main',parentId:null,level:1,title:{zh:'当前根节点'},status:'active',sortOrder:1}]},
        {id:'taxonomy-pmp-main-v2',subjectId:'subject-pmp',name:{zh:'PMP 新草稿'},version:2,versionLabel:'v2.0',maxDepth:9,status:'draft',isDefault:false,nodes:[{id:'root-v2',taxonomyId:'taxonomy-pmp-main-v2',parentId:null,level:1,title:{zh:'新根节点'},status:'active',sortOrder:1}]}
      ]));
    }""")
    for script in SCRIPTS:page.add_script_tag(content=(ROOT/script).read_text(encoding='utf-8'))
    page.wait_for_timeout(250)
    page.locator('[data-subject-tab="history"]').click()
    page.wait_for_timeout(80)
    assert page.locator('[data-publish-taxonomy="taxonomy-pmp-main-v2"]').is_enabled()
    dialogs=[]
    def handle_dialog(dialog):
        dialogs.append(dialog.type)
        dialog.accept('P2.1 browser release') if dialog.type=='prompt' else dialog.accept()
    page.on('dialog',handle_dialog)
    page.locator('[data-publish-taxonomy="taxonomy-pmp-main-v2"]').click()
    page.wait_for_timeout(220)
    assert page.evaluate("()=>KGAdminServices.taxonomies.currentForSubject('subject-pmp').id")=='taxonomy-pmp-main-v2'
    assert page.evaluate("()=>KGLearningContent.subjectById('subject-pmp').defaultTaxonomyId")=='taxonomy-pmp-main-v2'
    assert page.locator('tr.current').count()==1
    assert page.evaluate("()=>KGAdminServices.taxonomies.releaseRecords().some(item=>item.taxonomyId==='taxonomy-pmp-main-v2'&&['publish','activate'].includes(item.action))")
    assert dialogs==['confirm','prompt'],dialogs
    assert not errors,errors
    browser.close()
print('v90-p21-taxonomy-publish-browser-ok')
