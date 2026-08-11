#!/usr/bin/env python3
from pathlib import Path
import re

from playwright.sync_api import sync_playwright


ROOT=Path(__file__).resolve().parents[1]
ARGS=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']


def text(path):
    return (ROOT/path).read_text(encoding='utf-8')


def body_html(path):
    source=text(path)
    match=re.search(r'<body[^>]*>([\s\S]*)</body>',source,re.I)
    return re.sub(r'<script[\s\S]*?</script>','',match.group(1),flags=re.I)


def add_page_styles(page):
    for href in re.findall(r'<link[^>]+href="([^"]+\.css)"',text('question-workspace.html'),re.I):
        target=ROOT/href
        if target.exists():
            page.add_style_tag(content=target.read_text(encoding='utf-8'))


def add_script(page,path):
    page.add_script_tag(content=text(path))


with sync_playwright() as p:
    launch_options={'headless':True,'args':ARGS}
    if Path('/usr/bin/chromium').exists():
        launch_options['executable_path']='/usr/bin/chromium'
    browser=p.chromium.launch(**launch_options)
    page=browser.new_page(viewport={'width':1440,'height':960})
    page.set_content('<body class="question-workspace-page">'+body_html('question-workspace.html')+'</body>')
    page.evaluate("""()=>{
      const local=new Map(),session=new Map();
      Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>local.has(k)?local.get(k):null,setItem:(k,v)=>local.set(k,String(v)),removeItem:k=>local.delete(k),clear:()=>local.clear()}});
      Object.defineProperty(window,'sessionStorage',{configurable:true,value:{getItem:k=>session.has(k)?session.get(k):null,setItem:(k,v)=>session.set(k,String(v)),removeItem:k=>session.clear()}});
      localStorage.setItem('kg_local_current_user_v1','edge-helper-test');
      localStorage.setItem('kg_local_users_v1',JSON.stringify({'edge-helper-test':{username:'edge-helper-test',displayName:'关系线测试',role:'teacher',status:'active',subject:'PMP',salt:'x',hash:'x'}}));
      window.confirm=()=>true;window.alert=()=>{};window.open=()=>({});
    }""")
    add_page_styles(page)
    delayed=[]
    for script in re.findall(r'<script[^>]+src="([^"]+)"',text('question-workspace.html'),re.I):
        if script.endswith('77-multi-question-workspace.js') or script.endswith('94-practice-navigation.js') or script.endswith('99-learning-practice-shell.js'):
            delayed.append(script)
        else:
            add_script(page,script)
    page.evaluate("window.KGQuestionCatalogAdapter={ready:Promise.resolve()}")
    page.evaluate("""()=>{
      const store=KGCanvasWorkspaceStore,options={workspaceId:'edge-helper-test'};
      store.createWorkspace('关系线辅助路径测试',{workspaceId:'edge-helper-test',activate:true});
      store.addSynthesisCard({id:'summary',title:'归纳卡',content:'归纳内容',synthesisType:'note'},{x:220,y:520,width:360,height:220},options);
      store.addSynthesisCard({id:'question',title:'题目卡',content:'题目内容',synthesisType:'note'},{x:900,y:160,width:360,height:220},options);
      store.addEdge({id:'edge',source:'question',target:'summary',type:'cause',pathStyle:'curve'},options);
    }""")
    for script in delayed:
        add_script(page,script)
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
    page.locator('.qw-edge-group').wait_for(state='attached')

    helpers=page.locator('.qw-edge-group :is(.qw-edge-hover-outline,.qw-edge-selection-line)').evaluate_all(
        "paths=>paths.map(path=>({fill:path.getAttribute('fill'),stroke:path.getAttribute('stroke'),pointerEvents:path.getAttribute('pointer-events'),d:path.getAttribute('d')}))"
    )
    assert helpers==[
        {'fill':'none','stroke':'none','pointerEvents':'none','d':helpers[0]['d']},
        {'fill':'none','stroke':'none','pointerEvents':'none','d':helpers[1]['d']},
    ],helpers
    assert all(item['d'].startswith('M ') for item in helpers),helpers
    browser.close()

print('v90-p439-multi-question-edge-helper-attributes-browser-ok')
