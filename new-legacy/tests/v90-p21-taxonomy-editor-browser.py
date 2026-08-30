#!/usr/bin/env python3
from pathlib import Path
import re
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'content-center.html').read_text(encoding='utf-8')
BODY=re.search(r'<body[^>]*>([\s\S]*)</body>',HTML,re.I).group(1)
BODY=re.sub(r'<script[\s\S]*?</script>','',BODY,flags=re.I)
SCRIPTS=[
 'src/28-app-storage.js','src/29-auth-core.js','src/86-activity-schema-v1.js','src/87-guided-learning-data.js','src/91-learning-content-core.js','src/93-content-organization-core.js',
 'src/admin/00-admin-core.js','src/admin/10-content-repository.js','src/admin/11-local-content-repository.js','src/admin/20-admin-permission-service.js','src/admin/21-admin-audit-service.js','src/admin/22-admin-transaction-service.js','src/admin/30-reference-index-service.js','src/admin/31-subject-service.js','src/admin/32-taxonomy-service.js','src/admin/33-activity-service.js','src/admin/34-course-service.js','src/admin/35-release-service.js','src/admin/40-admin-service-registry.js','src/admin/41-learning-content-compat.js',
 'src/91-knowledge-tree-index.js','src/91-content-center-app.js','src/93-content-organization-app.js','src/92-workspace-panel-manager.js'
]
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'])
    page=browser.new_page(viewport={'width':1500,'height':1000})
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content('<!doctype html><html><head></head><body>'+BODY+'</body></html>')
    for css in ['styles/teacher-workbench.css','styles/content-center.css','styles/workspace-panels.css','styles/content-organization.css']:
        page.add_style_tag(content=(ROOT/css).read_text(encoding='utf-8'))
    page.evaluate("""()=>{
      const local=new Map(),session=new Map();
      Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>local.has(k)?local.get(k):null,setItem:(k,v)=>local.set(k,String(v)),removeItem:k=>local.delete(k),clear:()=>local.clear(),key:i=>[...local.keys()][i]||null,get length(){return local.size}}});
      Object.defineProperty(window,'sessionStorage',{configurable:true,value:{getItem:k=>session.has(k)?session.get(k):null,setItem:(k,v)=>session.set(k,String(v)),removeItem:k=>session.delete(k),clear:()=>session.clear()}});
      const user='v90-teacher';
      localStorage.setItem('kg_local_current_user_v1',user);
      localStorage.setItem('kg_local_users_v1',JSON.stringify({[user]:{username:user,displayName:'V9 测试教师',role:'teacher',status:'active',subject:'PMP',salt:'x',hash:'x'}}));
      const teaching={subjects:[{id:'subject-pmp',code:'PMP',name:{zh:'PMP 项目管理',en:''},defaultTaxonomyId:'taxonomy-pmp-main',status:'active',sortOrder:10}],taxonomies:[
        {id:'taxonomy-pmp-main',subjectId:'subject-pmp',name:{zh:'PMP 主知识树'},version:1,versionLabel:'v1.0',maxDepth:9,status:'published',isDefault:true,nodes:[{id:'root-v1',taxonomyId:'taxonomy-pmp-main',parentId:null,level:1,title:{zh:'当前根节点'},status:'active',sortOrder:1}]},
        {id:'taxonomy-pmp-main-v2',subjectId:'subject-pmp',name:{zh:'PMP 导入草稿'},version:2,versionLabel:'v2.0',maxDepth:9,status:'draft',isDefault:false,nodes:[{id:'root-v2',taxonomyId:'taxonomy-pmp-main-v2',parentId:null,level:1,title:{zh:'草稿根节点'},status:'active',sortOrder:1}]}
      ]};
      window.KGTeachingContentApi={readResource:(name,fallback)=>structuredClone(teaching[name]??fallback),saveSubjects:async rows=>(teaching.subjects=structuredClone(rows)),saveTaxonomies:async rows=>(teaching.taxonomies=structuredClone(rows)),saveActivityOverrides:async()=>[],saveCatalogResource:async(name,rows)=>(teaching[name]=structuredClone(rows)),saveCatalog:async patch=>{Object.entries(patch).forEach(([name,rows])=>teaching[name]=structuredClone(rows));return structuredClone(teaching)},ready:async()=>structuredClone(teaching)};
      if(!window.CSS)window.CSS={};if(!CSS.escape)CSS.escape=value=>String(value).replace(/[^a-zA-Z0-9_-]/g,'\\$&');
      if(!window.ResizeObserver)window.ResizeObserver=class{observe(){}disconnect(){}};
      if(!window.matchMedia)window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
    }""")
    for script in SCRIPTS: page.add_script_tag(content=(ROOT/script).read_text(encoding='utf-8'))
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
    page.wait_for_timeout(350)
    assert page.locator('#ccTaxonomyVersion option').count()==2
    assert page.locator('#ccTaxonomyVersion').input_value()=='taxonomy-pmp-main'
    assert '运营维护模式' in page.locator('#ccTaxonomyMode').inner_text()
    assert page.locator('#ccAddRootBtn').is_enabled()
    page.locator('#ccTaxonomyVersion').select_option('taxonomy-pmp-main-v2')
    page.wait_for_timeout(150)
    assert '重大调整草稿模式' in page.locator('#ccTaxonomyMode').inner_text()
    assert page.locator('#ccAddRootBtn').is_enabled()
    assert '最多 9 层' in page.locator('#ccTaxonomyMeta').inner_text()
    page.locator('[data-tree-view="list"]').click()
    page.locator('#ccKnowledgeTree [data-select-node="root-v2"]').click()
    assert page.locator('#ccInspectorTitleZh').is_enabled()
    page.locator('#ccAddRootBtn').click()
    page.wait_for_timeout(160)
    assert page.evaluate("()=>KGLearningContent.taxonomyById('taxonomy-pmp-main-v2').nodes.length")==2
    page.locator('#ccTaxonomyVersion').select_option('taxonomy-pmp-main')
    page.wait_for_timeout(120)
    assert '运营维护模式' in page.locator('#ccTaxonomyMode').inner_text()
    assert page.locator('#ccAddRootBtn').is_enabled()
    page.locator('#ccKnowledgeTree [data-select-node="root-v1"]').click()
    assert page.locator('#ccInspectorTitleZh').is_enabled()
    assert not errors,errors
    browser.close()
print('v90-p21-taxonomy-editor-browser-ok')
