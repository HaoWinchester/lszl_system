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
    page=browser.new_page(viewport={'width':1500,'height':1050})
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content('<!doctype html><html><head></head><body>'+BODY+'</body></html>')
    for css in ['styles/teacher-workbench.css','styles/content-center.css','styles/workspace-panels.css','styles/content-organization.css']:
        page.add_style_tag(content=(ROOT/css).read_text(encoding='utf-8'))
    page.evaluate("""()=>{
      const local=new Map(),session=new Map();
      Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>local.has(k)?local.get(k):null,setItem:(k,v)=>local.set(k,String(v)),removeItem:k=>local.delete(k),clear:()=>local.clear(),key:i=>[...local.keys()][i]||null,get length(){return local.size}}});
      Object.defineProperty(window,'sessionStorage',{configurable:true,value:{getItem:k=>session.has(k)?session.get(k):null,setItem:(k,v)=>session.set(k,String(v)),removeItem:k=>session.delete(k),clear:()=>session.clear()}});
      const user='p33-admin';
      localStorage.setItem('kg_local_current_user_v1',user);
      localStorage.setItem('kg_local_users_v1',JSON.stringify({[user]:{username:user,displayName:'P3.3 管理员',role:'admin',status:'active',subject:'PMP',salt:'x',hash:'x'}}));
      const teaching={subjects:[{id:'subject-pmp',code:'PMP',name:{zh:'PMP 项目管理',en:''},defaultTaxonomyId:'taxonomy-current',status:'active',sortOrder:10}],taxonomies:[]};
      const nodes=[
        {id:'root',taxonomyId:'taxonomy-current',parentId:null,level:1,title:{zh:'当前根节点',en:''},description:{zh:''},status:'active',sortOrder:10},
        {id:'child-a',taxonomyId:'taxonomy-current',parentId:'root',level:2,title:{zh:'子节点 A',en:''},description:{zh:''},status:'active',sortOrder:10},
        {id:'child-b',taxonomyId:'taxonomy-current',parentId:'root',level:2,title:{zh:'子节点 B',en:''},description:{zh:''},status:'active',sortOrder:20}
      ];
      let parent='child-a';for(let level=3;level<=9;level++){const id='deep-'+level;nodes.push({id,taxonomyId:'taxonomy-current',parentId:parent,level,title:{zh:'第 '+level+' 层',en:''},description:{zh:''},status:'active',sortOrder:10});parent=id}
      teaching.taxonomies=[
        {id:'taxonomy-history',subjectId:'subject-pmp',name:{zh:'历史知识树'},version:1,versionLabel:'v1.0',maxDepth:9,status:'published',isDefault:false,nodes:[{id:'history-root',taxonomyId:'taxonomy-history',parentId:null,level:1,title:{zh:'历史根节点'},status:'active',sortOrder:10}]},
        {id:'taxonomy-current',subjectId:'subject-pmp',name:{zh:'当前知识树'},version:2,versionLabel:'v2.0',maxDepth:9,status:'published',isDefault:true,nodes},
        {id:'taxonomy-draft',subjectId:'subject-pmp',name:{zh:'重大调整草稿'},version:3,versionLabel:'v3.0',maxDepth:9,status:'draft',isDefault:false,nodes:[{id:'draft-root',taxonomyId:'taxonomy-draft',parentId:null,level:1,title:{zh:'草稿根节点'},status:'active',sortOrder:10}]}
      ];
      window.KGTeachingContentApi={readResource:(name,fallback)=>structuredClone(teaching[name]??fallback),saveSubjects:async rows=>(teaching.subjects=structuredClone(rows)),saveTaxonomies:async rows=>(teaching.taxonomies=structuredClone(rows)),saveActivityOverrides:async()=>[],saveCatalogResource:async(name,rows)=>(teaching[name]=structuredClone(rows)),saveCatalog:async patch=>{Object.entries(patch).forEach(([name,rows])=>teaching[name]=structuredClone(rows));return structuredClone(teaching)},ready:async()=>structuredClone(teaching)};
      if(!window.CSS)window.CSS={};if(!CSS.escape)CSS.escape=value=>String(value).replace(/[^a-zA-Z0-9_-]/g,'\\$&');
      if(!window.ResizeObserver)window.ResizeObserver=class{observe(){}disconnect(){}};
      if(!window.matchMedia)window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
    }""")
    for script in SCRIPTS: page.add_script_tag(content=(ROOT/script).read_text(encoding='utf-8'))
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
    page.wait_for_timeout(400)

    assert page.locator('#ccTaxonomyVersion').input_value()=='taxonomy-current'
    assert '运营维护模式' in page.locator('#ccTaxonomyMode').inner_text()
    assert page.locator('#ccAddRootBtn').is_enabled()
    page.locator('#ccKnowledgeTree [data-select-node="child-a"]').click()
    assert page.locator('#ccInspectorDescriptionZh').is_enabled()
    page.locator('#ccInspectorTitleZh').fill('子节点 A（已维护）')
    page.locator('#ccInspectorDescriptionZh').fill('当前知识树日常维护说明')
    page.locator('[data-inspector-save]').click();page.wait_for_timeout(150)
    saved=page.evaluate("()=>KGLearningContent.taxonomyById('taxonomy-current').nodes.find(n=>n.id==='child-a')")
    assert saved['title']['zh']=='子节点 A（已维护）'
    assert saved['description']['zh']=='当前知识树日常维护说明'

    page.locator('#ccKnowledgeTree [data-select-node="child-b"]').click()
    assert page.locator('[data-inspector-up]').is_enabled()
    page.locator('[data-inspector-up]').click();page.wait_for_timeout(120)
    order=page.evaluate("()=>KGLearningContent.taxonomyById('taxonomy-current').nodes.filter(n=>n.parentId==='root').sort((a,b)=>a.sortOrder-b.sortOrder).map(n=>n.id)")
    assert order[0]=='child-b'

    page.locator('#ccKnowledgeSearch').fill('第 9 层');page.wait_for_timeout(180)
    page.locator('#ccKnowledgeTree [data-select-node="deep-9"]').click()
    assert page.locator('[data-inspector-add-child]').is_disabled()
    page.locator('#ccKnowledgeSearch').fill('');page.wait_for_timeout(180)

    dialogs=[]
    def capture(dialog):
        dialogs.append(dialog.message)
        dialog.accept()
    page.once('dialog',capture)
    page.locator('#ccKnowledgeTree [data-select-node="root"]').click()
    page.locator('[data-inspector-delete]').click();page.wait_for_timeout(80)
    assert dialogs and '子节点' in dialogs[0]
    assert page.evaluate("()=>!!KGLearningContent.taxonomyById('taxonomy-current').nodes.find(n=>n.id==='root')")

    page.locator('#ccTaxonomyVersion').select_option('taxonomy-history');page.wait_for_timeout(120)
    assert '只读' in page.locator('#ccTaxonomyMode').inner_text()
    assert page.locator('#ccAddRootBtn').is_disabled()
    page.locator('#ccKnowledgeTree [data-select-node="history-root"]').click()
    assert page.locator('#ccInspectorTitleZh').is_disabled()

    page.locator('#ccTaxonomyVersion').select_option('taxonomy-draft');page.wait_for_timeout(120)
    assert '重大调整草稿模式' in page.locator('#ccTaxonomyMode').inner_text()
    assert page.locator('#ccAddRootBtn').is_enabled()

    audit_actions=page.evaluate("()=>KGAdminServices.audit.list().map(row=>row.action)")
    assert 'taxonomy.node.update' in audit_actions
    assert 'taxonomy.node.reorder' in audit_actions
    assert page.evaluate("()=>KGAdminServices.transactions.snapshots().length")>=2

    page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(120)
    page.locator('#ccTaxonomyVersion').select_option('taxonomy-current');page.wait_for_timeout(120)
    page.locator('#ccKnowledgeTree [data-select-node="child-a"]').click();page.wait_for_timeout(80)
    inspector=page.locator('#ccKnowledgeInspector').bounding_box();textarea=page.locator('#ccInspectorDescriptionZh').bounding_box()
    order_buttons=[page.locator('.cc-inspector-order button').nth(i).bounding_box() for i in range(page.locator('.cc-inspector-order button').count())]
    assert inspector and textarea and textarea['x']>=inspector['x']-1 and textarea['x']+textarea['width']<=inspector['x']+inspector['width']+1
    assert all(box and box['x']>=inspector['x']-1 and box['x']+box['width']<=inspector['x']+inspector['width']+1 for box in order_buttons)
    assert '运营维护模式' in page.locator('#ccTaxonomyMode').inner_text()
    assert not errors,errors
    browser.close()
print('v90-p33-current-taxonomy-maintenance-browser-ok')
