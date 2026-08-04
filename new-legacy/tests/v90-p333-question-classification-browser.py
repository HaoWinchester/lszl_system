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
    page=browser.new_page(viewport={'width':1440,'height':1000});page.set_default_timeout(7000)
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    attrs,body=body_html('question-bank.html')
    page.set_content(f'<!doctype html><html><head></head><body{attrs}>{body}</body></html>')
    page.evaluate("""()=>{const local=new Map(),session=new Map();Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>local.has(k)?local.get(k):null,setItem:(k,v)=>local.set(k,String(v)),removeItem:k=>local.delete(k),clear:()=>local.clear(),key:i=>[...local.keys()][i]||null,get length(){return local.size}}});Object.defineProperty(window,'sessionStorage',{configurable:true,value:{getItem:k=>session.has(k)?session.get(k):null,setItem:(k,v)=>session.set(k,String(v)),removeItem:k=>session.delete(k),clear:()=>session.clear(),key:i=>[...session.keys()][i]||null,get length(){return session.size}}});const user='p333-teacher';localStorage.setItem('kg_local_current_user_v1',user);localStorage.setItem('kg_local_users_v1',JSON.stringify({[user]:{username:user,displayName:'P3.3.3 教师',role:'admin',status:'active',subject:'PMP',salt:'x',hash:'x'}}));window.confirm=()=>true;window.alert=()=>{};window.open=()=>({});if(!window.ResizeObserver)window.ResizeObserver=class{observe(){}disconnect(){}};}""")
    add_files(page,['styles/teacher-workbench.css','styles/question-bank-admin.css','styles/teacher-question-workflow.css','styles/admin-context-nav.css','styles/workspace-placement.css','styles/question-classification.css'],'css')
    add_files(page,['src/01-runtime-config.js','src/28-app-storage.js','src/29-auth-core.js','src/34-role-permissions.js','src/50-question-data.js','src/91-learning-content-core.js','src/95-recall-association-library.js','question-studio/question-studio-parser.js','src/98-teacher-workflow-p2-services.js','src/65-question-bank-admin.js','src/98-question-classification.js','src/97-teacher-question-workflow.js','src/99-workspace-placement.js'],'js')
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))");page.wait_for_timeout(450)

    assert page.locator('[data-question-workspace="entry"]').count()==0
    assert page.locator('#questionEntryFrame').count()==0
    page.locator('[data-main-tab="base"]').click();page.wait_for_timeout(120)
    assert page.locator('#qbClassificationBar').is_visible()
    assert page.locator('#questionSubjectInput').is_disabled()
    assert page.locator('#questionSubjectInput').input_value()=='subject-pmp'

    page.locator('#qbKnowledgePickerBtn').click();page.wait_for_timeout(80)
    dialog=page.locator('#qbKnowledgePickerDialog');assert dialog.is_visible()
    page.locator('#qbKnowledgeSearchInput').fill('敏捷方法');page.wait_for_timeout(80)
    page.locator('#qbKnowledgeSearchResults [data-knowledge-search-node="kp-pmp-agile"]').click();page.locator('#qbKnowledgeConfirmBtn').click();page.wait_for_timeout(180)
    question=page.evaluate('KGQuestionBankAdminAPI.getCurrentQuestion()')
    assert question['metadata']['knowledge']['primaryNodeId']=='kp-pmp-agile'
    assert question['metadata']['knowledge']['mappingStatus']=='confirmed'
    assert '敏捷方法' in page.locator('#qbKnowledgePathLabel').inner_text()

    page.locator('#qbTagPickerBtn').click();page.get_by_role('button',name='质量标签').click();page.get_by_role('button',name='题目特征').click()
    page.get_by_text('易错题',exact=True).click();page.locator('#qbCustomTagInput').fill('内部重点');page.locator('#qbCustomTagInput').press('Enter');page.locator('#qbTagConfirmBtn').click();page.wait_for_timeout(160)
    question=page.evaluate('KGQuestionBankAdminAPI.getCurrentQuestion()')
    assert '易错题' in question['tags'] and '内部重点' in question['tags']
    assert page.locator('#qbSelectedTagChips').get_by_text('易错题',exact=False).count()==1

    page.locator('#tqNewQuestionBtn').click();page.wait_for_timeout(100)
    sample=page.evaluate('KGTeacherWorkflowP2.TEMPLATE_TEXTS.example')
    page.locator('#tqPasteInput').fill(sample);page.locator('#tqParseBtn').click();page.wait_for_timeout(120)
    preview=page.locator('.tq-classification-preview').inner_text()
    assert 'PMP' in preview and '敏捷方法' in preview and '2 个标签' in preview
    page.locator('#tqApplyParsedBtn').click();page.wait_for_timeout(260)
    parsed=page.evaluate('KGQuestionBankAdminAPI.getCurrentQuestion()')
    assert parsed['metadata']['knowledge']['primaryNodeId']=='kp-pmp-agile'
    assert parsed['metadata']['knowledge']['mappingSource']=='template'
    assert '阶段测试' in parsed['tags'] and '易错题' in parsed['tags']

    page.locator('#qbSetUnclassifiedBtn').click();page.wait_for_timeout(130)
    unmapped=page.evaluate('KGQuestionBankAdminAPI.getCurrentQuestion().metadata.knowledge')
    assert unmapped['primaryNodeId'] is None and unmapped['mappingStatus']=='unmapped'
    assert page.locator('#qbKnowledgeStatus').inner_text()=='待分类'

    page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(120)
    bar=page.locator('#qbClassificationBar').bounding_box();fields=page.locator('#qbClassificationFields').bounding_box()
    assert bar and fields and fields['x']>=bar['x']-1 and fields['x']+fields['width']<=bar['x']+bar['width']+1
    page.locator('#qbKnowledgePickerBtn').click();page.wait_for_timeout(80)
    box=page.locator('#qbKnowledgePickerDialog').bounding_box();assert box and box['x']>=0 and box['x']+box['width']<=391
    page.locator('#qbKnowledgePickerDialog [value="cancel"]').first.click()
    assert not errors,errors
    browser.close()
print('v90-p333-question-classification-browser-ok')
