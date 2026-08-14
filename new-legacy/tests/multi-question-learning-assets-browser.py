#!/usr/bin/env python3

from pathlib import Path
import re
import shutil
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
def text(path): return (ROOT/path).read_text(encoding='utf-8')
def body_html(path):
    source=text(path);match=re.search(r'<body[^>]*>([\s\S]*)</body>',source,re.I)
    return re.sub(r'<script[\s\S]*?</script>','',match.group(1),flags=re.I)

with sync_playwright() as p:
    candidates=[shutil.which('chromium'),shutil.which('google-chrome'),'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',p.chromium.executable_path]
    executable=next((item for item in candidates if item and Path(item).exists()),None)
    browser=p.chromium.launch(headless=True,executable_path=executable,args=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'])
    page=browser.new_page(viewport={'width':1440,'height':900});errors=[];page.on('pageerror',lambda error: errors.append(str(error)))
    page.set_content('<body class="question-workspace-page">'+body_html('question-workspace.html')+'</body>')
    page.add_style_tag(content=text('styles/question-workspace.css'))
    page.evaluate("""()=>{
      window._inserted=[];window._mistakeAdded=[];
      const active={id:'psc_1',title:'风险处理原则',synthesisType:'principle',content:'先判断风险归属。',tags:['风险'],status:'verified',revision:2,archivedAt:null};
      const archived={...active,id:'psc_2',title:'已归档卡',archivedAt:'2026-08-13T00:00:00Z'};
      window.KGPersonalSynthesisCardApi={
        _active:[active],_archived:[archived],
        async refresh(){return {active:this._active,archived:this._archived}},
        snapshot(){return {active:this._active,archived:this._archived}},
        async update(id,input){const card={...active,...input,id,revision:input.revision+1};this._active=[card];return card},
        async archive(){this._active=[];this._archived=[archived];return archived},
        async restore(){this._active=[active];this._archived=[];return active}
      };
      window.KGPracticeLearningApi={
        async refresh(){return this.snapshot()},
        snapshot(){return {mistakes:[
          {id:'pm_1',questionId:'q_1',bankId:'b_1',releaseId:'r_1',status:'pending',wrongCount:2,questionSnapshot:{id:'q_1',title:'待复习错题'}},
          {id:'pm_2',questionId:'q_2',bankId:'b_1',releaseId:'r_1',status:'mastered',wrongCount:1,questionSnapshot:{id:'q_2',title:'已掌握错题'}}
        ],stats:{active:1,mastered:1}}}
      };
      window.KGMultiQuestionWorkspace={
        async insertPersonalCard(card){window._inserted.push(card.id);return {created:true}},
        addQuestionByReference(ref){window._mistakeAdded.push(ref.questionId);return {created:true}},
        hydratePersonalCards(){}
      };
    }""")
    page.add_script_tag(content=text('src/108-multi-question-learning-assets.js'))
    page.wait_for_timeout(80)
    assert page.locator('#qwPersonalCardsCount').inner_text()=='1'
    assert page.locator('#qwMistakesCount').inner_text()=='1'
    page.locator('#qwPersonalCardsBtn').click();assert page.locator('#qwPersonalCardsDrawer').is_visible()
    assert page.locator('#qwPersonalCardsList [data-card-id]').count()==1
    page.locator('[data-card-action="edit"]').click();assert page.locator('#qwPersonalCardEditor').is_visible()
    page.locator('#qwPersonalCardEditorCancel').click();assert not page.locator('#qwPersonalCardEditor').is_visible()
    page.locator('[data-card-action="insert"]').click();page.wait_for_timeout(20);assert page.evaluate("window._inserted") == ['psc_1']
    page.locator('#qwPersonalCardsBtn').click();page.locator('[data-personal-card-filter="archived"]').click();assert page.get_by_text('已归档卡').is_visible()
    page.locator('#qwMistakesBtn').click();assert page.locator('#qwMistakesDrawer').is_visible();assert not page.locator('#qwPersonalCardsDrawer').is_visible()
    assert page.get_by_text('待复习错题').is_visible()
    page.locator('[data-mistake-action="insert"]').click();assert page.evaluate("window._mistakeAdded") == ['q_1']
    page.locator('#qwMistakesBtn').click();page.locator('[data-mistake-filter="mastered"]').click();assert page.get_by_text('已掌握错题').is_visible()
    page.keyboard.press('Escape');assert not page.locator('#qwMistakesDrawer').is_visible()
    assert not errors,errors
    browser.close()

print('multi-question-learning-assets-browser-ok')
