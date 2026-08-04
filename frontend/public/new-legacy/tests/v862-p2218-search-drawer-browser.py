from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
def text(p): return (ROOT/p).read_text()
def body_html(p):
    s=text(p);m=re.search(r'<body[^>]*>([\s\S]*)</body>',s,re.I)
    return re.sub(r'<script[\s\S]*?</script>','',m.group(1),flags=re.I)

with sync_playwright() as p:
    b=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'])

    # Global search must stay inside a small viewport.
    page=b.new_page(viewport={'width':340,'height':440})
    page.set_content("""<body class="question-workspace-page">
      <div class="qw-workspace-filebar" id="qwWorkspaceFilebar" style="position:absolute;left:118px;top:78px">
        <button id="qwWorkspaceSaveState"><span class="qw-workspace-save-state-text"></span></button>
        <span id="qwWorkspaceChip"></span>
        <button class="qw-workspace-global-search-btn" id="qwWorkspaceGlobalSearchBtn"></button>
        <div class="qw-workspace-global-search-panel" id="qwWorkspaceGlobalSearchPanel" hidden>
          <div class="qw-workspace-global-search-head"><label><span>⌕</span><input id="qwWorkspaceGlobalSearchInput"></label><button id="qwWorkspaceGlobalSearchClose">×</button></div>
          <div id="qwWorkspaceGlobalSearchMeta"></div><div id="qwWorkspaceGlobalSearchResults"></div>
        </div>
      </div>
    </body>""")
    for st in ['styles/question-workspace.css','styles/learning-practice-shell.css','styles/question-workspace-p2218.css']:
        page.add_style_tag(content=text(st))
    page.evaluate("""()=>{window._workspace={id:'w',title:'测试画布',nodes:Object.fromEntries(Array.from({length:25},(_,i)=>['n'+i,{id:'n'+i,nodeType:'synthesis-card',title:'测试归纳卡 '+i,content:'内容 '+i}]))};window.KGMultiQuestionWorkspace={selectNodes:()=>{},focusNode:()=>{}}}""")
    page.add_script_tag(content=text('src/79-multi-question-workspace-filebar.js'))
    page.evaluate("""()=>KGMultiQuestionWorkspaceFilebar.configure({getWorkspace:()=>window._workspace,canEdit:()=>true,onRename:()=>null,onSave:()=>window._workspace,onNotify:()=>{}})""")
    page.locator('#qwWorkspaceGlobalSearchBtn').click()
    page.wait_for_timeout(50)
    box=page.locator('#qwWorkspaceGlobalSearchPanel').bounding_box()
    assert box
    assert box['x']>=8 and box['x']+box['width']<=340-8,(box,340)
    assert box['y']>=8 and box['y']+box['height']<=440-8,(box,440)
    page.close()

    # Multi-question drawer dimensions should match single-question drawer.
    multi=b.new_page(viewport={'width':1000,'height':720})
    multi.set_content('<body class="question-workspace-page">'+body_html('question-workspace.html')+'</body>')
    for st in ['styles/question-workspace.css','styles/learning-practice-shell.css','styles/question-workspace-p2218.css']:
        multi.add_style_tag(content=text(st))
    multi.locator('#qwQuestionDrawer').evaluate("el=>{el.classList.add('open');el.hidden=false}")
    multi.wait_for_timeout(260)
    mb=multi.locator('#qwQuestionDrawer').bounding_box()
    assert mb

    single=b.new_page(viewport={'width':1000,'height':720})
    single.set_content('<body class="question-training-page">'+body_html('question-training.html')+'</body>')
    for st in ['styles/question-training.css','styles/learning-practice-shell.css']:
        single.add_style_tag(content=text(st))
    single.locator('#qtQuestionDrawer').evaluate("el=>{el.classList.add('open');el.hidden=false}")
    single.wait_for_timeout(260)
    sb=single.locator('#qtQuestionDrawer').bounding_box()
    assert sb

    for key in ('x','y','width','height'):
        assert abs(mb[key]-sb[key])<2,(key,mb,sb)
    multi.close();single.close();b.close()

print('v862-p2218-search-drawer-browser-ok')
