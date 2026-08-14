#!/usr/bin/env python3

from pathlib import Path
import re
import shutil
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]

def text(path): return (ROOT/path).read_text(encoding='utf-8')
def body_html(path):
    source=text(path)
    match=re.search(r'<body[^>]*>([\s\S]*)</body>',source,re.I)
    return re.sub(r'<script[\s\S]*?</script>','',match.group(1),flags=re.I)

with sync_playwright() as p:
    candidates=[shutil.which('chromium'),shutil.which('google-chrome'),'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',p.chromium.executable_path]
    executable=next((item for item in candidates if item and Path(item).exists()),None)
    browser=p.chromium.launch(headless=True,executable_path=executable,args=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'])
    page=browser.new_page(viewport={'width':1366,'height':768})
    page.set_content('<body class="question-workspace-page">'+body_html('question-workspace.html')+'</body>')
    page.add_style_tag(content=text('styles/question-workspace.css'))
    page.add_style_tag(content=text('styles/learning-practice-shell.css'))
    page.locator('#qwQuestionDrawer').evaluate("element=>element.classList.add('open')")
    page.locator('#qwQuestionList').evaluate("""element=>{element.innerHTML=Array.from({length:3},(_,index)=>`
      <div class="qw-question-item" data-question-index="${index}" draggable="true">
        <label class="qw-question-select"><input type="checkbox" data-qw-question-select="${index}"><span></span></label>
        <span class="qw-question-drag">⋮⋮</span><div class="qw-question-copy"><span>${index+1}</span><div><strong>题目 ${index+1}</strong><small>项目管理 · 中等</small></div><em class="not-started">未开始</em></div>
        <button type="button" class="qw-question-add" data-add-index="${index}">+</button>
      </div>`).join('')}""")
    page.locator('#qwQuestionSelectionMeta').evaluate("element=>element.textContent='已选 3 题'")
    page.locator('#qwQuestionList input[data-qw-question-select]').nth(0).check()
    page.locator('#qwQuestionList input[data-qw-question-select]').nth(1).check()
    page.locator('#qwQuestionList input[data-qw-question-select]').nth(2).check()
    assert page.locator('#qwQuestionList input[data-qw-question-select]:checked').count()==3
    assert page.locator('#qwQuestionSelectionMeta').inner_text()=='已选 3 题'
    first_row=page.locator('#qwQuestionList .qw-question-item').first
    first_title=first_row.locator('strong')
    first_add=first_row.locator('.qw-question-add')
    first_checkbox=first_row.locator('.qw-question-select')
    assert first_title.is_visible()
    assert first_title.bounding_box()['width'] >= 80
    assert abs(first_checkbox.bounding_box()['y']-first_add.bounding_box()['y']) <= 12
    assert first_title.bounding_box()['x']+first_title.bounding_box()['width'] <= first_row.bounding_box()['x']+first_row.bounding_box()['width']
    page.locator('#qwQuestionSelectionClear').evaluate("element=>element.disabled=false")
    page.locator('#qwQuestionSelectionClear').click()
    assert page.locator('#qwQuestionSelectionClear').is_visible()
    assert page.evaluate("document.documentElement.scrollWidth-document.documentElement.clientWidth")<=4
    browser.close()

print('multi-question-batch-selection-browser-ok')
