from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
ARGS=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']
def text(path): return (ROOT/path).read_text(encoding='utf-8')
def body_html(path):
    source=text(path);match=re.search(r'<body[^>]*>([\s\S]*)</body>',source,re.I)
    return re.sub(r'<script[\s\S]*?</script>','',match.group(1),flags=re.I)
def add_script(page,path): page.add_script_tag(content=text(path))
def add_styles_from_html(page,path):
    for href in re.findall(r'<link[^>]+href="([^"]+\.css)"',text(path),re.I):
        target=ROOT/href
        if target.exists(): page.add_style_tag(content=target.read_text(encoding='utf-8'))
def install_storage(page):
    page.evaluate("""()=>{const local=new Map(),session=new Map();Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>local.has(k)?local.get(k):null,setItem:(k,v)=>local.set(k,String(v)),removeItem:k=>local.delete(k),clear:()=>local.clear()}});Object.defineProperty(window,'sessionStorage',{configurable:true,value:{getItem:k=>session.has(k)?session.get(k):null,setItem:(k,v)=>session.set(k,String(v)),removeItem:k=>session.delete(k),clear:()=>session.clear()}});const u='batch-edge-user';localStorage.setItem('kg_local_current_user_v1',u);localStorage.setItem('kg_local_users_v1',JSON.stringify({[u]:{username:u,displayName:'批量关系测试',role:'teacher',status:'active',subject:'PMP',salt:'x',hash:'x'}}));window.confirm=()=>true;window.alert=()=>{};window.open=()=>({});}""")

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=ARGS)

    # Knowledge graph: box-select two visible links, delete once, undo once.
    page=browser.new_page(viewport={'width':1400,'height':900})
    page.set_content('<body>'+body_html('index.html')+'</body>')
    add_styles_from_html(page,'index.html')
    for script in ['src/00-config-state.js','src/canvas/84-canvas-edge-selection-geometry.js','src/09-graph-connector-drag-controller.js','src/10-graph-editor.js','src/19-home-toolbar-registry.js','src/20-flashcards-toolbar.js']:
        add_script(page,script)
    page.evaluate("""()=>{
      window.KGGraphUserPreferences={get:()=>({largeGraphMode:false})};
      const a=makeNode('A',80,80,'#2563eb'),b=makeNode('B',720,80,'#2563eb');
      const c=makeNode('C',80,440,'#2563eb'),d=makeNode('D',720,440,'#2563eb');
      state.nodes=[a,b,c,d];state.links=[makeLink(a.id,b.id,'上方关系'),makeLink(c.id,d.id,'下方关系')];
      state.viewport={x:0,y:0,scale:1};selectedNodeIds.clear();selectedLinkIds.clear();state.selectedNodeId=null;state.selectedLinkId=null;render();document.querySelectorAll('.help-card,.help-overlay').forEach(el=>el.remove());
    }""")
    box=page.evaluate("""()=>{
      const stageRect=stage.getBoundingClientRect();
      const points=[...document.querySelectorAll('.edge-hit')].map(path=>{
        const p=path.getPointAtLength(path.getTotalLength()/2);
        return{x:stageRect.left+state.viewport.x+p.x*state.viewport.scale,y:stageRect.top+state.viewport.y+p.y*state.viewport.scale};
      });
      const x=points.reduce((s,p)=>s+p.x,0)/points.length;
      return{sx:x-38,sy:Math.min(...points.map(p=>p.y))-32,ex:x+38,ey:Math.max(...points.map(p=>p.y))+32};
    }""")
    page.mouse.move(box['ex'],box['ey']);page.mouse.down();page.mouse.move(box['sx'],box['sy'],steps=10);page.mouse.up();page.wait_for_timeout(80)
    selected=page.evaluate("()=>({links:selectedLinkIds.size,nodes:selectedNodeIds.size,total:state.links.length})")
    assert selected=={'links':2,'nodes':0,'total':2},selected
    page.keyboard.press('Delete');page.wait_for_timeout(60)
    assert page.evaluate('state.links.length')==0
    page.keyboard.press('Control+z');page.wait_for_timeout(80)
    assert page.evaluate('state.links.length')==2
    page.close()

    # Multi-question canvas: initialize real workspace, box-select two links, delete and undo.
    page=browser.new_page(viewport={'width':1440,'height':960})
    page.set_content('<body class="question-workspace-page">'+body_html('question-workspace.html')+'</body>')
    install_storage(page);add_styles_from_html(page,'question-workspace.html')
    scripts=re.findall(r'<script[^>]+src="([^"]+)"',text('question-workspace.html'),re.I)
    delayed=[]
    for script in scripts:
      if script.endswith('77-multi-question-workspace.js') or script.endswith('94-practice-navigation.js') or script.endswith('99-learning-practice-shell.js'):
        delayed.append(script)
      else:
        add_script(page,script)
    page.evaluate("""()=>{
      const S=KGCanvasWorkspaceStore;const opts={workspaceId:'batch-edge-test'};
      S.createWorkspace('批量关系测试',{workspaceId:'batch-edge-test',activate:true});
      S.addSynthesisCard({id:'n1',title:'N1',content:'N1',synthesisType:'note'},{x:160,y:160,width:320,height:220},opts);
      S.addSynthesisCard({id:'n2',title:'N2',content:'N2',synthesisType:'note'},{x:900,y:160,width:320,height:220},opts);
      S.addSynthesisCard({id:'n3',title:'N3',content:'N3',synthesisType:'note'},{x:160,y:560,width:320,height:220},opts);
      S.addSynthesisCard({id:'n4',title:'N4',content:'N4',synthesisType:'note'},{x:900,y:560,width:320,height:220},opts);
      S.addEdge({id:'e1',source:'n1',target:'n2',type:'same',pathStyle:'straight'},opts);
      S.addEdge({id:'e2',source:'n3',target:'n4',type:'same',pathStyle:'straight'},opts);
    }""")
    for script in delayed:add_script(page,script)
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
    page.wait_for_timeout(500)
    initial=page.evaluate('KGMultiQuestionWorkspace.getState()')
    assert initial['edgeCount']==2,initial
    rect=page.evaluate("""()=>{
      const points=[...document.querySelectorAll('.qw-edge-hit')].map(path=>{
        const p=path.getPointAtLength(path.getTotalLength()/2),m=path.getScreenCTM(),s=new DOMPoint(p.x,p.y).matrixTransform(m);return{x:s.x,y:s.y};
      });
      const x=points.reduce((sum,p)=>sum+p.x,0)/points.length;
      return{sx:x-34,sy:Math.min(...points.map(p=>p.y))-28,ex:x+34,ey:Math.max(...points.map(p=>p.y))+28};
    }""")
    page.mouse.move(rect['sx'],rect['sy']);page.mouse.down();page.mouse.move(rect['ex'],rect['ey'],steps=12);page.mouse.up();page.wait_for_timeout(100)
    chosen=page.evaluate('KGMultiQuestionWorkspace.getState()')
    assert len(chosen['selectedEdgeIds'])==2,chosen
    assert len(chosen['selectedNodeIds'])==0,chosen
    page.keyboard.press('Delete');page.wait_for_timeout(120)
    assert page.evaluate('KGMultiQuestionWorkspace.getState().edgeCount')==0
    page.keyboard.press('Control+z');page.wait_for_timeout(160)
    assert page.evaluate('KGMultiQuestionWorkspace.getState().edgeCount')==2
    page.close();browser.close()

print('v862-p2237-batch-edge-selection-browser-ok')
