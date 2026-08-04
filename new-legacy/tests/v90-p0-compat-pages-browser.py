#!/usr/bin/env python3
from pathlib import Path
import re
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
ARGS=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']

def mount(page,name):
    source=(ROOT/name).read_text(encoding='utf-8')
    body=re.search(r'<body[^>]*>([\s\S]*)</body>',source,re.I).group(1)
    scripts=re.findall(r'<script[^>]+src="([^"]+)"[^>]*></script>',body,re.I)
    body=re.sub(r'<script[\s\S]*?</script>','',body,flags=re.I)
    page.set_content('<!doctype html><html><head></head><body>'+body+'</body></html>')
    for href in re.findall(r'<link[^>]+href="([^"]+\.css)"',source,re.I):
        target=ROOT/href
        if target.exists(): page.add_style_tag(content=target.read_text(encoding='utf-8'))
    page.evaluate("""()=>{const local=new Map(),session=new Map();Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>local.has(k)?local.get(k):null,setItem:(k,v)=>local.set(k,String(v)),removeItem:k=>local.delete(k),clear:()=>local.clear(),key:i=>[...local.keys()][i]||null,get length(){return local.size}}});Object.defineProperty(window,'sessionStorage',{configurable:true,value:{getItem:k=>session.has(k)?session.get(k):null,setItem:(k,v)=>session.set(k,String(v)),removeItem:k=>session.delete(k),clear:()=>session.clear()}});const u='compat-teacher';localStorage.setItem('kg_local_current_user_v1',u);localStorage.setItem('kg_local_users_v1',JSON.stringify({[u]:{username:u,displayName:'兼容测试教师',role:'teacher',status:'active',subject:'PMP',salt:'x',hash:'x'}}));window.confirm=()=>true;window.alert=()=>{};window.open=()=>({});}""")
    for src in scripts:
        target=ROOT/src
        if target.exists(): page.add_script_tag(content=target.read_text(encoding='utf-8'))
    page.wait_for_timeout(250)
    assert page.evaluate('()=>!!window.KGAdminServices'),name
    assert page.evaluate('()=>!!window.KGLearningContent.adminServices'),name

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=ARGS)
    for name in ['teacher-workbench.html','content-center.html','course-admin.html']:
        page=browser.new_page(viewport={'width':1440,'height':1000});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        mount(page,name)
        if name=='content-center.html':
            result=page.evaluate("""()=>{const draft=KGAdminServices.taxonomies.createDraftFrom('taxonomy-pmp-main');if(!draft.valid)return draft;const saved=KGLearningContent.saveKnowledgeNode(draft.taxonomy.id,{id:'compat-node',parentId:'kp-pmp',title:{zh:'兼容节点'},code:'PMP.COMPAT',status:'active'});return {...saved,taxonomyId:draft.taxonomy.id}}""")
            assert result['valid'],result
            assert page.evaluate("id=>!!KGLearningContent.nodeById(id,'compat-node')",result['taxonomyId'])
            assert page.evaluate("()=>KGAdminServices.audit.list().some(item=>['taxonomy.node.create','taxonomy.node.update'].includes(item.action))")
        if name=='course-admin.html':
            result=page.evaluate("""()=>{const course=KGLearningContent.getCourseDrafts()[0];course.description='compat-save';return KGLearningContent.saveCourseDraft(course)}""")
            assert result['description']=='compat-save',result
            assert page.evaluate("()=>KGAdminServices.audit.list().some(item=>item.action==='course.draft.save')")
        assert not errors,(name,errors)
        page.close()
    browser.close()
print('v90-p0-compat-pages-browser-ok')
