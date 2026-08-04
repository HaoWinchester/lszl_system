from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
def text(p): return (ROOT/p).read_text()

with sync_playwright() as p:
    b=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'])
    page=b.new_page(viewport={'width':900,'height':620})
    page.set_content("""<body class="question-workspace-page">
      <div class="qw-workspace-filebar" id="qwWorkspaceFilebar">
        <button class="qw-workspace-save-state" id="qwWorkspaceSaveState" type="button">
          <svg viewBox="0 0 24 24"><path d="M7 18h10a4 4 0 0 0 .8-7.9A6 6 0 0 0 6.4 8.5 4.8 4.8 0 0 0 7 18Z"/><path d="m9.5 13 1.7 1.7 3.5-3.7"/></svg>
          <span class="qw-workspace-save-state-text">已保存</span>
        </button>
        <span class="qw-workspace-chip" id="qwWorkspaceChip" role="button" tabindex="0">我的PMP解题规律</span>
      </div>
    </body>""")
    page.add_style_tag(content=text('styles/question-workspace.css'))
    page.evaluate("""()=>{window._workspace={id:'w1',title:'我的PMP解题规律'};window._saved=0;}""")
    page.add_script_tag(content=text('src/79-multi-question-workspace-filebar.js'))
    page.evaluate("""()=>KGMultiQuestionWorkspaceFilebar.configure({
      getWorkspace:()=>window._workspace,
      canEdit:()=>true,
      onRename:title=>(window._workspace={...window._workspace,title}),
      onSave:()=>{window._saved+=1;return window._workspace},
      onNotify:()=>{}
    })""")
    page.wait_for_timeout(20)

    save=page.locator('#qwWorkspaceSaveState')
    assert save.locator('svg').count()==1
    assert not save.evaluate("el=>el.classList.contains('is-dirty')")
    assert page.locator('#qwWorkspaceChip').inner_text()=='我的PMP解题规律'

    chip=page.locator('#qwWorkspaceChip')
    chip.dblclick()
    assert chip.get_attribute('contenteditable')=='true'
    chip.evaluate("(el)=>{el.textContent='新的解题规律'}")
    chip.press('Enter')
    page.wait_for_timeout(20)
    assert chip.inner_text()=='新的解题规律'
    assert page.evaluate("window._workspace.title")=='新的解题规律'

    page.evaluate("KGMultiQuestionWorkspaceFilebar.markDirty()")
    assert save.evaluate("el=>el.classList.contains('is-dirty')")
    save.click()
    page.wait_for_timeout(20)
    assert page.evaluate("window._saved")==1
    assert not save.evaluate("el=>el.classList.contains('is-dirty')")

    page.keyboard.press('Control+s')
    page.wait_for_timeout(20)
    assert page.evaluate("window._saved")==2
    page.close();b.close()

print('v862-p2213-workspace-filebar-cloud-save-browser-ok')
