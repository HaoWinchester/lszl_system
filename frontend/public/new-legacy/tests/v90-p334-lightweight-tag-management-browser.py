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

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=ARGS)
    page=browser.new_page(viewport={'width':1440,'height':1000});page.set_default_timeout(8000)
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    attrs,body=body_html('question-bank.html')
    page.set_content(f'<!doctype html><html><head></head><body{attrs}>{body}</body></html>')
    page.evaluate("""()=>{const local=new Map(),session=new Map();Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>local.has(k)?local.get(k):null,setItem:(k,v)=>local.set(k,String(v)),removeItem:k=>local.delete(k),clear:()=>local.clear(),key:i=>[...local.keys()][i]||null,get length(){return local.size}}});Object.defineProperty(window,'sessionStorage',{configurable:true,value:{getItem:k=>session.has(k)?session.get(k):null,setItem:(k,v)=>session.set(k,String(v)),removeItem:k=>session.delete(k),clear:()=>session.clear(),key:i=>[...session.keys()][i]||null,get length(){return session.size}}});const user='p334-teacher';localStorage.setItem('kg_local_current_user_v1',user);localStorage.setItem('kg_local_users_v1',JSON.stringify({[user]:{username:user,displayName:'P3.3.4 教师',role:'admin',status:'active',subject:'PMP',salt:'x',hash:'x'}}));window.confirm=()=>true;window.alert=()=>{};window.open=()=>({});if(!window.ResizeObserver)window.ResizeObserver=class{observe(){}disconnect(){}};}""")
    add_files(page,['styles/teacher-workbench.css','styles/question-bank-admin.css','styles/teacher-question-workflow.css','styles/admin-context-nav.css','styles/workspace-placement.css','styles/question-classification.css'],'css')
    add_files(page,['src/01-runtime-config.js','src/28-app-storage.js','src/29-auth-core.js','src/34-role-permissions.js','src/50-question-data.js','src/91-learning-content-core.js','src/95-recall-association-library.js','question-studio/question-studio-parser.js','src/98-teacher-workflow-p2-services.js','src/65-question-bank-admin.js','src/98-question-classification.js','src/97-teacher-question-workflow.js','src/99-workspace-placement.js'],'js')
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))");page.wait_for_timeout(500)

    page.locator('[data-main-tab="base"]').click();page.wait_for_timeout(80)
    page.evaluate("KGQuestionBankAdminAPI.updateCurrentQuestion({tags:['阶段测试','易错题']})")
    page.wait_for_timeout(120)
    page.locator('#qbTagPickerBtn').click();page.wait_for_timeout(80)
    assert page.locator('#qbTagManageBtn').is_visible()
    page.locator('#qbTagManageBtn').click();page.wait_for_timeout(80)
    manager=page.locator('#qbTagManagerDialog');assert manager.is_visible()
    target=manager.locator('[data-tag-manage-name="阶段测试"]');assert target.count()==1
    target.dblclick();editor=manager.locator('.qb-tag-manage-input');assert editor.is_visible()
    editor.fill('阶段测评');editor.press('Enter');page.wait_for_timeout(180)
    assert manager.get_by_text('阶段测评',exact=True).count()>=1
    question=page.evaluate('KGQuestionBankAdminAPI.getCurrentQuestion()')
    assert '阶段测评' in question['tags'] and '阶段测试' not in question['tags']
    config=page.evaluate("JSON.parse(localStorage.getItem('kg_question_tag_names_v1'))")
    assert config['aliases']['阶段测试']=='阶段测评'
    assert any(v=='阶段测评' for v in config['names'].values())

    duplicate=manager.locator('[data-tag-manage-name="模拟考试"]');duplicate.dblclick();editor=manager.locator('.qb-tag-manage-input');editor.fill('阶段测评');editor.press('Enter');page.wait_for_timeout(80)
    assert '已存在同名标签' in page.locator('#qbTagManagerMessage').inner_text()
    assert manager.locator('[data-tag-manage-name="模拟考试"]').count()==1

    manager.locator('[value="cancel"]').last.click();page.wait_for_timeout(80)
    assert page.locator('#qbTagPickerDialog').is_visible()
    page.get_by_role('button',name='用途标签').click();page.get_by_role('button',name='训练阶段').click()
    assert page.get_by_text('阶段测评',exact=True).count()>=1
    assert page.get_by_text('阶段测试',exact=True).count()==0
    page.locator('#qbTagPickerDialog [value="cancel"]').last.click();

    # Batch default picker should immediately use the renamed managed tag.
    page.locator('#tqNewQuestionBtn').click();page.wait_for_timeout(80)
    page.locator('[data-tq-paste-mode="batch"]').click();page.locator('#tqBatchDefaultEditBtn').click();page.wait_for_timeout(100)
    page.locator('[data-tq-batch-class-tab="tags"]').click();page.wait_for_timeout(50)
    assert page.locator('#tqBatchTagOptionList').get_by_text('阶段测评',exact=True).count()==1
    assert page.locator('#tqBatchTagOptionList').get_by_text('阶段测试',exact=True).count()==0

    page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(100)
    # close batch dialog, reopen tag manager from tag picker to verify mobile viewport safety
    page.locator('#tqBatchClassificationDialog [value="cancel"]').first.click();page.locator('#qbTagPickerBtn').click();page.locator('#qbTagManageBtn').click();page.wait_for_timeout(80)
    box=page.locator('#qbTagManagerDialog').bounding_box();assert box and box['x']>=0 and box['x']+box['width']<=391
    assert page.locator('body').evaluate('(el)=>el.scrollWidth-el.clientWidth') <= 2
    assert not errors,errors
    browser.close()
print('v90-p334-lightweight-tag-management-browser-ok')
