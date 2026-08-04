from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
def text(p): return (ROOT/p).read_text()

with sync_playwright() as p:
    b=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'])
    page=b.new_page(viewport={'width':1100,'height':720})
    page.set_content("""<body class="question-workspace-page">
      <div class="qw-workspace-tabbar" id="qwWorkspaceTabbar">
        <a id="qwWorkspaceListBtn" href="file-manager.html?type=workspace"></a>
        <div class="qw-workspace-tabs" id="qwWorkspaceTabs"></div>
        <button id="qwCreateWorkspaceBtn">＋</button>
      </div>
    </body>""")
    page.add_style_tag(content=text('styles/question-workspace.css'))
    page.evaluate("""()=>{
      const m=new Map();
      Object.defineProperty(window,'sessionStorage',{configurable:true,value:{
        getItem:k=>m.has(k)?m.get(k):null,
        setItem:(k,v)=>m.set(k,String(v)),
        removeItem:k=>m.delete(k)
      }});
      window._opened=[];window._renamed=[];
    }""")
    page.add_script_tag(content=text('src/78-multi-question-workspace-tabs.js'))
    page.evaluate("""()=>{
      KGMultiQuestionWorkspaceTabs.render({
        ownerKey:'u1',
        activeWorkspaceId:'w1',
        workspaces:[
          {id:'w1',title:'画布一',nodeCount:2},
          {id:'w2',title:'画布二',nodeCount:4},
          {id:'w3',title:'画布三',nodeCount:1}
        ],
        onOpen:id=>window._opened.push(id),
        onRename:id=>window._renamed.push(id),
        onNotify:()=>{}
      });
    }""")
    assert page.locator('.qw-workspace-tab').count()==3
    assert page.locator('.qw-workspace-tab.is-active .qw-workspace-tab-title').inner_text()=='画布一'
    page.locator('[data-workspace-id="w2"]').hover()
    page.locator('[data-close-workspace-id="w2"]').click()
    assert page.locator('.qw-workspace-tab').count()==2
    assert page.locator('#qwWorkspaceListBtn').get_attribute('href')=='file-manager.html?type=workspace'
    page.evaluate("KGMultiQuestionWorkspaceTabs.reopen('w2')")
    page.evaluate("""()=>KGMultiQuestionWorkspaceTabs.render({
      ownerKey:'u1',activeWorkspaceId:'w2',
      workspaces:[{id:'w1',title:'画布一',nodeCount:2},{id:'w2',title:'画布二',nodeCount:4},{id:'w3',title:'画布三',nodeCount:1}],
      onOpen:id=>window._opened.push(id),onRename:id=>window._renamed.push(id),onNotify:()=>{}
    })""")
    assert page.locator('.qw-workspace-tab').count()==3
    page.locator('[data-workspace-id="w3"] .qw-workspace-tab-title').dblclick()
    assert page.evaluate("window._renamed.at(-1)")=='w3'
    page.close();b.close()

print('v862-p2212-workspace-tabs-browser-ok')
