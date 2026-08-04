from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
def text(p): return (ROOT/p).read_text()

with sync_playwright() as p:
    b=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'])
    page=b.new_page(viewport={'width':1200,'height':760})
    page.set_content("""<body>
      <button id="fmNewFileBtn"><span>新建图谱</span></button>
      <div id="fmPageSubtitle"></div>
      <button data-fm-file-type="graph" class="is-active"></button>
      <button data-fm-file-type="workspace"></button>
      <section id="fmGraphBrowser"></section>
      <section id="fmWorkspaceLibrary" hidden>
        <input id="fmWorkspaceSearch"><button id="fmWorkspaceCreateBtn"></button><strong id="fmWorkspaceCount"></strong>
        <div id="fmWorkspaceGrid"></div><div id="fmWorkspaceEmpty" hidden><button id="fmWorkspaceEmptyCreate"></button></div>
      </section>
      <div id="fmToastStack"></div>
    </body>""")
    page.add_style_tag(content=text('styles/file-manager.css'))
    page.evaluate("""()=>{
      window._workspaces=[
        {id:'w1',title:'我的PMP解题规律',questionCount:4,synthesisCount:1,nodeCount:5,updatedAt:Date.now()},
        {id:'w2',title:'敏捷归纳',questionCount:8,synthesisCount:2,nodeCount:10,updatedAt:Date.now()}
      ];
      window.KGCanvasWorkspaceStore={
        listWorkspaces:()=>window._workspaces,
        currentUserId:()=> 'u',
        setActiveWorkspace:()=>true,
        createWorkspace:()=>null,renameWorkspace:()=>null,deleteWorkspace:()=>null,
        read:()=>null,write:()=>null
      };
    }""")
    page.add_script_tag(content=text('src/80-file-manager-workspace-library.js'))
    page.evaluate("KGFileManagerWorkspaceLibrary.updateMode('workspace',{push:false})")
    page.wait_for_timeout(20)
    assert not page.locator('#fmWorkspaceLibrary').get_attribute('hidden')
    assert page.locator('#fmGraphBrowser').get_attribute('hidden') is not None
    assert page.locator('.fm-workspace-card').count()==2
    assert page.locator('#fmWorkspaceCount').inner_text()=='2 个画布'
    page.locator('#fmWorkspaceSearch').fill('敏捷')
    assert page.locator('.fm-workspace-card').count()==1
    page.close();b.close()
print('v862-p2214-file-manager-workspace-browser-ok')
