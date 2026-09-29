#!/usr/bin/env python3
"""Exercise the actual publication checklist with native browser dialog behavior."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
source = (ROOT / "src/65-question-bank-admin.js").read_text()
dialog = source[source.index("  function showPublicationChecklist("):source.index("  let publicationCheckBusy=")]

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page()
    page.set_content('<button id="publish">发布试卷</button><button id="outside">页面其他操作</button>')
    page.add_style_tag(path=str(ROOT / "styles/paper-management.css"))
    page.add_script_tag(path=str(ROOT / "src/29-auth-core.js"))
    page.add_script_tag(content="""
      const $=id=>document.getElementById(id),escapeHTML=KGAuthCore.escapeHTML;
      const questionBasicInfoUrl=(id,bank)=>`question-bank.html?questionId=${id}&bankId=${bank}`;
    """ + dialog + """
      $('publish').onclick=()=>{
        window.result=null;
        showPublicationChecklist(window.checklist,{name:'<img src=x onerror=alert(1)>'})
          .then(result=>window.result=result);
      };
    """)

    def open_checklist(blocked=False):
        page.evaluate("blocked=>window.checklist={issues:blocked?[{title:'题目一',number:1,message:'缺少解析',questionId:'q1',bankId:'b1'}]:[],warnings:[]}", blocked)
        page.locator('#publish').click()
        expect(page.locator('dialog')).to_be_visible()
        assert page.evaluate("document.querySelector('dialog').matches(':modal')")
        expect(page.locator('[data-check-action="cancel"]')).to_be_focused()
        assert page.locator('dialog img').count() == 0

    def closed(result):
        page.wait_for_function("expected=>window.result===expected", arg=result)
        assert page.locator('dialog').count() == 0
        expect(page.locator('#publish')).to_be_focused()

    open_checklist(True)
    assert page.locator('[data-check-action="publish"]').count() == 0
    expect(page.get_by_role('link', name='修改题目')).to_have_attribute('href', 'question-bank.html?questionId=q1&bankId=b1')
    for _ in range(7):
        page.keyboard.press('Tab')
        assert page.evaluate("document.activeElement===document.body||!!document.activeElement.closest('dialog')")
    page.keyboard.press('Escape')
    closed('cancel')

    for action in ['retry', 'cancel', 'publish']:
        open_checklist()
        page.locator(f'[data-check-action="{action}"]').click()
        closed(action)

    open_checklist()
    # Dialog padding is not a backdrop; clicking it must not cancel publishing.
    page.locator('dialog').click(position={"x": 4, "y": 4})
    expect(page.locator('dialog')).to_be_visible()
    page.mouse.click(2, 2)
    closed('cancel')

    page.set_viewport_size({"width": 390, "height": 844})
    open_checklist(True)
    assert page.evaluate("document.documentElement.scrollWidth<=innerWidth")
    bounds = page.locator('dialog').bounding_box()
    assert bounds['x'] >= 0 and bounds['x'] + bounds['width'] <= 390
    page.keyboard.press('Escape')
    closed('cancel')
    # The real entry disables its trigger while awaiting the checklist; restore focus
    # only after the workflow re-enables that trigger (native dialog alone cannot).
    entry = source[source.index("  async function togglePublishPaper("):source.index("  async function withdrawCurrentPaper(")]
    page.add_script_tag(content="""
      let publicationCheckBusy=false;
      const currentPaper=()=>({id:'p1',name:'焦点检查',questions:[{}],enabledModes:['practice_mode']});
      const isPaperArchived=()=>false,savePaperForm=async()=>true,paperIntegrity=()=>({});
      window.KGPaperReleaseApi={preflight:async()=>window.checklist};
    """ + entry + """
      const trigger=document.createElement('button');trigger.id='qbPublishPaperBtn';trigger.textContent='发布入口';
      trigger.onclick=togglePublishPaper;document.body.appendChild(trigger);
    """)
    page.locator('#qbPublishPaperBtn').click()
    expect(page.locator('dialog')).to_be_visible()
    expect(page.locator('#qbPublishPaperBtn')).to_be_disabled()
    page.keyboard.press('Escape')
    expect(page.locator('dialog')).to_have_count(0)
    expect(page.locator('#qbPublishPaperBtn')).to_be_enabled()
    expect(page.locator('#qbPublishPaperBtn')).to_be_focused()
    browser.close()
print('publication-checklist-browser: passed (actions, focus, keyboard, backdrop, mobile)')
