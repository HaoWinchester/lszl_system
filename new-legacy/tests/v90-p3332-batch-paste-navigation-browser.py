#!/usr/bin/env python3
from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
ARGS=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']

def body_html(file):
    text=(ROOT/file).read_text(encoding='utf-8')
    match=re.search(r'<body([^>]*)>([\s\S]*)</body>',text,re.I)
    return match.group(1),re.sub(r'<script[\s\S]*?</script>','',match.group(2),flags=re.I)

def add_files(page,files,kind):
    for file in files:
        content=(ROOT/file).read_text(encoding='utf-8')
        (page.add_style_tag if kind=='css' else page.add_script_tag)(content=content)

def question(n):
    answer='A' if n%2 else 'B'
    return f"""【题干-中文】
批量导航测试题 {n}
【A-中文】
选项A-{n}
【B-中文】
选项B-{n}
【C-中文】
选项C-{n}
【D-中文】
选项D-{n}
【答案】
{answer}
【解析-中文】
解析-{n}"""

BATCH='\n\n===== 下一题 =====\n\n'.join(question(i) for i in range(1,6))

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=ARGS)
    page=browser.new_page(viewport={'width':1366,'height':768});page.set_default_timeout(7000)
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    attrs,body=body_html('question-bank.html')
    page.set_content(f'<!doctype html><html><head></head><body{attrs}>{body}</body></html>')
    page.evaluate("""()=>{const local=new Map(),session=new Map();Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>local.has(k)?local.get(k):null,setItem:(k,v)=>local.set(k,String(v)),removeItem:k=>local.delete(k),clear:()=>local.clear(),key:i=>[...local.keys()][i]||null,get length(){return local.size}}});Object.defineProperty(window,'sessionStorage',{configurable:true,value:{getItem:k=>session.has(k)?session.get(k):null,setItem:(k,v)=>session.set(k,String(v)),removeItem:k=>session.delete(k),clear:()=>session.clear(),key:i=>[...session.keys()][i]||null,get length(){return session.size}}});const user='p3332-teacher';localStorage.setItem('kg_local_current_user_v1',user);localStorage.setItem('kg_local_users_v1',JSON.stringify({[user]:{username:user,displayName:'P3.3.3.2 教师',role:'admin',status:'active',subject:'PMP',salt:'x',hash:'x'}}));window.confirm=()=>true;window.alert=()=>{};window.open=()=>({});if(!window.ResizeObserver)window.ResizeObserver=class{observe(){}disconnect(){}};}""")
    add_files(page,['styles/teacher-workbench.css','styles/question-bank-admin.css','styles/teacher-question-workflow.css','styles/admin-context-nav.css','styles/workspace-placement.css','styles/question-classification.css'],'css')
    add_files(page,['src/01-runtime-config.js','src/28-app-storage.js','src/29-auth-core.js','src/34-role-permissions.js','src/50-question-data.js','src/91-learning-content-core.js','src/95-recall-association-library.js','question-studio/question-studio-parser.js','src/98-teacher-workflow-p2-services.js','src/65-question-bank-admin.js','src/98-question-classification.js','src/97-teacher-question-workflow.js','src/99-workspace-placement.js'],'js')
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))");page.wait_for_timeout(450)

    page.locator('[data-main-tab="base"]').click();page.locator('[data-tq-paste-mode="batch"]').click();page.wait_for_timeout(80)

    overflow=page.locator('#tqBatchOptions').evaluate('(el)=>el.scrollWidth-el.clientWidth')
    assert overflow <= 2, overflow

    page.locator('#tqBatchDefaultEditBtn').click();page.wait_for_timeout(80)
    dialog=page.locator('#tqBatchClassificationDialog').bounding_box();footer=page.locator('#tqBatchClassificationDialog footer').bounding_box()
    assert dialog and dialog['x'] >= -1 and dialog['y'] >= -1 and dialog['x']+dialog['width'] <= 1367 and dialog['y']+dialog['height'] <= 769, dialog
    assert footer and footer['y']+footer['height'] <= dialog['y']+dialog['height']+1, (dialog,footer)
    page.locator('#tqBatchClassificationDialog button[value="cancel"]').first.click();page.wait_for_timeout(50)

    page.locator('#tqPasteInput').fill(BATCH);page.locator('#tqParseBtn').click();page.wait_for_timeout(160)
    assert '共 5 道' in page.locator('#tqParseSummary').inner_text(), page.locator('#tqParseSummary').inner_text()
    assert page.locator('.tq-batch-item').count()==5
    assert page.locator('.tq-batch-item:visible').count()==1
    assert '批量导航测试题 1' in page.locator('.tq-batch-item:visible').inner_text()
    assert page.locator('[data-tq-batch-position]').inner_text()=='第 1 / 5 题'

    page.locator('[data-tq-batch-next]').click();page.wait_for_timeout(40)
    assert '批量导航测试题 2' in page.locator('.tq-batch-item:visible').inner_text()
    assert page.locator('[data-tq-batch-position]').inner_text()=='第 2 / 5 题'

    page.locator('[data-tq-batch-jump="4"]').click();page.wait_for_timeout(40)
    assert '批量导航测试题 5' in page.locator('.tq-batch-item:visible').inner_text()
    assert page.locator('[data-tq-batch-next]').is_disabled()

    page.locator('[data-tq-batch-prev]').click();page.wait_for_timeout(40)
    assert '批量导航测试题 4' in page.locator('.tq-batch-item:visible').inner_text()

    page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(80)
    overflow=page.locator('#tqBatchOptions').evaluate('(el)=>el.scrollWidth-el.clientWidth')
    assert overflow <= 2, overflow
    page.locator('#tqBatchDefaultEditBtn').click();page.wait_for_timeout(80)
    dialog=page.locator('#tqBatchClassificationDialog').bounding_box();assert dialog and dialog['x']>=-1 and dialog['x']+dialog['width']<=391 and dialog['y']>=-1 and dialog['y']+dialog['height']<=845,dialog

    assert not errors,errors
    browser.close()
print('v90-p3332-batch-paste-navigation-browser-ok')
