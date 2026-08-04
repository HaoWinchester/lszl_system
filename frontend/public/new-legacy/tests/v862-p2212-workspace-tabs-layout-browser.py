from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
def text(p): return (ROOT/p).read_text()
def body_html(p):
    s=text(p)
    m=re.search(r'<body[^>]*>([\s\S]*)</body>',s,re.I)
    return re.sub(r'<script[\s\S]*?</script>','',m.group(1),flags=re.I)

with sync_playwright() as p:
    b=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'])
    for width in (1366,1000,760):
        page=b.new_page(viewport={'width':width,'height':760})
        page.set_content('<meta name="viewport" content="width=device-width,initial-scale=1"><body class="question-workspace-page">'+body_html('question-workspace.html')+'</body>')
        for st in ['styles/question-workspace.css','styles/learning-practice-shell.css']:
            page.add_style_tag(content=text(st))
        page.evaluate("""()=>{
          const m=new Map();
          Object.defineProperty(window,'sessionStorage',{configurable:true,value:{
            getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)
          }});
        }""")
        page.add_script_tag(content=text('src/78-multi-question-workspace-tabs.js'))
        page.evaluate("""()=>{
          const ws=Array.from({length:8},(_,i)=>({id:'w'+(i+1),title:'解题画布 '+(i+1),nodeCount:i+1}));
          KGMultiQuestionWorkspaceTabs.render({ownerKey:'layout',activeWorkspaceId:'w8',workspaces:ws,onOpen:()=>{},onNotify:()=>{}});
        }""")
        page.wait_for_timeout(50)
        assert page.locator('#qwWorkspaceTabbar').count()==1
        assert page.locator('.qw-workspace-tab').count()==8
        host=page.locator('#qwWorkspaceTabs')
        assert host.evaluate("el=>el.scrollWidth>=el.clientWidth")
        active=page.locator('[data-workspace-id="w8"]')
        hb=host.bounding_box();ab=active.bounding_box()
        assert hb and ab
        assert ab['x']+ab['width'] <= hb['x']+hb['width']+2,(width,hb,ab)
        overflow=page.evaluate("document.documentElement.scrollWidth-document.documentElement.clientWidth")
        assert overflow<=4,(width,overflow)
        if width<=760:
            top=page.locator('.qw-topbar').bounding_box()
            tabs=page.locator('#qwWorkspaceTabbar').bounding_box()
            assert top and tabs and tabs['y']>top['y']+25,(top,tabs)
        page.close()
    b.close()

print('v862-p2212-workspace-tabs-layout-browser-ok')
