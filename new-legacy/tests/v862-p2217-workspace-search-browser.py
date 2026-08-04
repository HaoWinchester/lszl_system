from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
def text(p): return (ROOT/p).read_text()

with sync_playwright() as p:
    b=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'])
    page=b.new_page(viewport={'width':1000,'height':650})
    page.set_content("""<body class="question-workspace-page">
      <div class="qw-workspace-filebar" id="qwWorkspaceFilebar">
        <button class="qw-workspace-save-state" id="qwWorkspaceSaveState"><span class="qw-workspace-save-state-text">已保存</span></button>
        <span class="qw-workspace-chip" id="qwWorkspaceChip" role="button" tabindex="0"></span>
        <button class="qw-workspace-global-search-btn" id="qwWorkspaceGlobalSearchBtn" aria-expanded="false"><svg viewBox="0 0 24 24"></svg></button>
        <div class="qw-workspace-global-search-panel" id="qwWorkspaceGlobalSearchPanel" hidden>
          <div class="qw-workspace-global-search-head"><label><span>⌕</span><input id="qwWorkspaceGlobalSearchInput"></label><button id="qwWorkspaceGlobalSearchClose">×</button></div>
          <div id="qwWorkspaceGlobalSearchMeta"></div>
          <div class="qw-workspace-global-search-results" id="qwWorkspaceGlobalSearchResults"></div>
        </div>
      </div>
    </body>""")
    page.add_style_tag(content=text('styles/question-workspace.css'))
    page.evaluate("""()=>{
      window._focused=[];window._selected=[];
      window._workspace={id:'w1',title:'新建解题范德萨放到沙发沙发的沙发沙发',
        nodes:{
          q1:{id:'q1',nodeType:'question-reference',title:'外部审批晚于计划',stemSummary:'审批时间晚于计划怎么办',topic:'进度管理',tags:['审批']},
          s1:{id:'s1',nodeType:'synthesis-card',title:'敏捷团队原则',content:'团队协作和沟通',tags:['敏捷']}
        }};
      window.KGMultiQuestionWorkspace={
        selectNodes:ids=>window._selected.push(ids),
        focusNode:id=>window._focused.push(id)
      };
    }""")
    page.add_script_tag(content=text('src/79-multi-question-workspace-filebar.js'))
    page.evaluate("""()=>KGMultiQuestionWorkspaceFilebar.configure({
      getWorkspace:()=>window._workspace,canEdit:()=>true,onRename:()=>null,onSave:()=>window._workspace,onNotify:()=>{}
    })""")
    chip=page.locator('#qwWorkspaceChip')
    assert chip.inner_text()=='新建解题范德萨放到沙发沙'
    assert len(chip.inner_text())==12
    assert '新建解题范德萨放到沙发沙发的沙发沙发' in (chip.get_attribute('title') or '')

    page.locator('#qwWorkspaceGlobalSearchBtn').click()
    assert page.locator('#qwWorkspaceGlobalSearchPanel').is_visible()
    page.locator('#qwWorkspaceGlobalSearchInput').fill('审批')
    assert page.locator('[data-qw-search-node="q1"]').count()==1
    assert page.locator('[data-qw-search-node="s1"]').count()==0
    page.locator('[data-qw-search-node="q1"]').click()
    assert page.evaluate("window._focused.at(-1)")=='q1'
    assert page.evaluate("window._selected.at(-1)[0]")=='q1'
    assert page.locator('#qwWorkspaceGlobalSearchPanel').is_hidden()

    # Double-click editing still exposes the complete title, not the 12-char display slice.
    chip.dblclick()
    assert chip.get_attribute('contenteditable')=='true'
    assert chip.inner_text()=='新建解题范德萨放到沙发沙发的沙发沙发'
    chip.press('Escape')
    assert len(chip.inner_text())==12
    page.close();b.close()

print('v862-p2217-workspace-search-browser-ok')
