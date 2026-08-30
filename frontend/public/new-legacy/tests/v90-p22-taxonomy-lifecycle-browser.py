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
    page=browser.new_page(viewport={'width':1600,'height':1050})
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content('<!doctype html><html><head></head><body>'+BODY+'</body></html>')
    page.add_style_tag(content=(ROOT/'styles/admin-console.css').read_text(encoding='utf-8'))
    page.add_style_tag(content=(ROOT/'styles/admin-context-nav.css').read_text(encoding='utf-8'))
    page.evaluate("""()=>{
      const local=new Map(),session=new Map();
      Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>local.has(k)?local.get(k):null,setItem:(k,v)=>local.set(k,String(v)),removeItem:k=>local.delete(k),clear:()=>local.clear(),key:i=>[...local.keys()][i]||null,get length(){return local.size}}});
      Object.defineProperty(window,'sessionStorage',{configurable:true,value:{getItem:k=>session.has(k)?session.get(k):null,setItem:(k,v)=>session.set(k,String(v)),removeItem:k=>session.delete(k),clear:()=>session.clear()}});
      const user='v90-admin';localStorage.setItem('kg_local_current_user_v1',user);localStorage.setItem('kg_local_users_v1',JSON.stringify({[user]:{username:user,displayName:'V9 管理员',role:'admin',status:'active',subject:'PMP',salt:'x',hash:'x'}}));
      const teaching={subjects:[{id:'subject-pmp',code:'PMP',name:{zh:'PMP 项目管理'},defaultTaxonomyId:'taxonomy-delete-v2',status:'active',sortOrder:10}],taxonomies:[
        {id:'taxonomy-delete-v1',subjectId:'subject-pmp',name:{zh:'PMP 历史树'},version:1,versionLabel:'v1.0',maxDepth:9,status:'published',isDefault:false,nodes:[{id:'delete-root-v1',taxonomyId:'taxonomy-delete-v1',parentId:null,level:1,title:{zh:'历史根节点'},status:'active',sortOrder:1}]},
        {id:'taxonomy-delete-v2',subjectId:'subject-pmp',name:{zh:'PMP 当前树'},version:2,versionLabel:'v2.0',maxDepth:9,status:'published',isDefault:true,nodes:[{id:'delete-root-v2',taxonomyId:'taxonomy-delete-v2',parentId:null,level:1,title:{zh:'当前根节点'},status:'active',sortOrder:1}]},
        {id:'taxonomy-delete-v3',subjectId:'subject-pmp',name:{zh:'PMP 临时草稿'},version:3,versionLabel:'v3.0',maxDepth:9,status:'draft',isDefault:false,nodes:[{id:'delete-root-v3',taxonomyId:'taxonomy-delete-v3',parentId:null,level:1,title:{zh:'草稿根节点'},status:'active',sortOrder:1}]}
      ]};
      window.KGTeachingContentApi={readResource:(name,fallback)=>structuredClone(teaching[name]??fallback),saveSubjects:async rows=>(teaching.subjects=structuredClone(rows)),saveTaxonomies:async rows=>(teaching.taxonomies=structuredClone(rows)),saveActivityOverrides:async()=>[],saveCatalogResource:async(name,rows)=>(teaching[name]=structuredClone(rows)),saveCatalog:async patch=>{Object.entries(patch).forEach(([name,rows])=>teaching[name]=structuredClone(rows));return structuredClone(teaching)},ready:async()=>structuredClone(teaching)};
    }""")
    for script in SCRIPTS: page.add_script_tag(content=(ROOT/script).read_text(encoding='utf-8'))
    page.wait_for_timeout(260)
    page.locator('[data-subject-tab="history"]').click()
    page.wait_for_timeout(80)
    assert page.locator('[data-archive-taxonomy="taxonomy-delete-v2"]').count()==0
    assert page.locator('[data-delete-taxonomy="taxonomy-delete-v2"]').count()==0
    assert page.locator('[data-archive-taxonomy="taxonomy-delete-v1"]').is_enabled()
    assert page.locator('[data-delete-taxonomy="taxonomy-delete-v3"]').is_enabled()
    dialogs=[]
    def handle_dialog(dialog):
        dialogs.append((dialog.type,dialog.message))
        if dialog.type=='prompt':
            if '归档说明' in dialog.message: dialog.accept('browser archive')
            elif 'v1.0' in dialog.message: dialog.accept('v1.0')
            elif 'v3.0' in dialog.message: dialog.accept('v3.0')
            else: dialog.accept('')
        else: dialog.accept()
    page.on('dialog',handle_dialog)
    page.locator('[data-archive-taxonomy="taxonomy-delete-v1"]').click()
    page.wait_for_timeout(170)
    assert page.evaluate("()=>KGAdminServices.taxonomies.get('taxonomy-delete-v1').status")=='archived'
    assert page.locator('[data-restore-taxonomy="taxonomy-delete-v1"]').is_enabled()
    assert page.locator('[data-delete-taxonomy="taxonomy-delete-v1"]').is_enabled()
    page.locator('[data-delete-taxonomy="taxonomy-delete-v1"]').click()
    page.wait_for_timeout(180)
    assert page.evaluate("()=>KGAdminServices.taxonomies.get('taxonomy-delete-v1')") is None
    page.locator('[data-delete-taxonomy="taxonomy-delete-v3"]').click()
    page.wait_for_timeout(180)
    assert page.evaluate("()=>KGAdminServices.taxonomies.get('taxonomy-delete-v3')") is None
    assert page.evaluate("()=>KGAdminServices.taxonomies.deletionRecords().length")==2
    assert page.locator('tr.current').count()==1
    assert page.evaluate("()=>KGAdminServices.taxonomies.releaseRecords().some(item=>item.action==='archive'&&item.taxonomyId==='taxonomy-delete-v1')")
    assert not errors,errors
    browser.close()
print('v90-p22-taxonomy-lifecycle-browser-ok')
