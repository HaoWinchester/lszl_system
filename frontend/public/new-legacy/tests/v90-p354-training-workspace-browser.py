#!/usr/bin/env python3
from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
ARGS=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']

def body_html(file):
    text=(ROOT/file).read_text(encoding='utf-8')
    match=re.search(r'<body([^>]*)>([\s\S]*)</body>',text,re.I)
    attrs=match.group(1)+' data-qb-workflow-mode="simple" data-qb-workflow-step="training"'
    return attrs,re.sub(r'<script[\s\S]*?</script>','',match.group(2),flags=re.I)

def add_files(page,files,kind):
    for file in files:
        content=(ROOT/file).read_text(encoding='utf-8')
        (page.add_style_tag if kind=='css' else page.add_script_tag)(content=content)

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=ARGS)
    page=browser.new_page(viewport={'width':1600,'height':1000});page.set_default_timeout(10000)
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    attrs,body=body_html('question-bank.html')
    page.set_content(f'<!doctype html><html><head><base href="http://localhost/"></head><body{attrs}>{body}</body></html>')
    page.evaluate("""()=>{
      const local=new Map(),session=new Map();
      Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>local.has(k)?local.get(k):null,setItem:(k,v)=>local.set(k,String(v)),removeItem:k=>local.delete(k),clear:()=>local.clear(),key:i=>[...local.keys()][i]||null,get length(){return local.size}}});
      Object.defineProperty(window,'sessionStorage',{configurable:true,value:{getItem:k=>session.has(k)?session.get(k):null,setItem:(k,v)=>session.set(k,String(v)),removeItem:k=>session.delete(k),clear:()=>session.clear(),key:i=>[...session.keys()][i]||null,get length(){return session.size}}});
      const user='p354-teacher',scope='user__'+encodeURIComponent(user);
      localStorage.setItem('kg_local_current_user_v1',user);
      localStorage.setItem('kg_local_users_v1',JSON.stringify({[user]:{username:user,displayName:'P3.5.4 教师',role:'admin',status:'active',subject:'PMP',salt:'x',hash:'x'}}));
      localStorage.setItem('kg_question_bank_demo_suppressed_v1__'+scope,'1');
      const makeQuestions=(prefix,count)=>Array.from({length:count},(_,i)=>({id:prefix+'q'+(i+1),teacherNumber:'PMP-'+String(i+1).padStart(6,'0'),title:prefix.toUpperCase()+' 题目 '+(i+1),type:'single_choice',subject:prefix==='b'?'ACP':'PMP',difficulty:i%2?'中等':'基础',domain:'人员',topic:'敏捷',tags:['训练'],stemParts:[{text:prefix+' 题干 '+(i+1)}],options:[{id:'A',text:'正确选项',correct:true},{id:'B',text:'干扰选项'}],correctAnswer:'A',analysis:prefix+' 解析 '+(i+1),clues:[],concepts:[],reasoningSteps:[],metadata:{knowledge:{primaryNodeId:null}},status:{contentReady:true}}));
      localStorage.setItem('kg_question_banks_v1__'+scope,JSON.stringify([
        {id:'bank-a',name:'PMP 综合题库',subject:'PMP',description:'A',version:'1.0',visibility:'private',questions:makeQuestions('a',45)},
        {id:'bank-b',name:'ACP 敏捷题库',subject:'ACP',description:'B',version:'1.0',visibility:'private',questions:makeQuestions('b',8)}
      ]));
      window.confirm=()=>true;window.alert=()=>{};window.open=()=>({});
      if(!window.ResizeObserver)window.ResizeObserver=class{observe(){}disconnect(){}};
    }""")
    add_files(page,['styles/teacher-workbench.css','styles/question-bank-admin.css','styles/teacher-question-workflow.css','styles/admin-context-nav.css','styles/workspace-placement.css','styles/question-classification.css'],'css')
    add_files(page,['src/01-runtime-config.js','src/28-app-storage.js','src/29-auth-core.js','src/34-role-permissions.js','src/50-question-data.js','src/91-learning-content-core.js','src/95-recall-association-library.js','question-studio/question-studio-parser.js','src/98-teacher-workflow-p2-services.js','src/65-question-bank-admin.js','src/98-question-classification.js','src/97-teacher-question-workflow.js','src/99-workspace-placement.js'],'js')
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))");page.wait_for_timeout(650)

    assert page.locator('body').evaluate("e=>e.classList.contains('qb-training-step')")
    selector=page.locator('#qbTrainingBankSelect')
    assert selector.locator('option').count()==1
    assert selector.input_value()=='bank-a'
    assert selector.get_attribute('data-subject')=='PMP'
    assert page.locator('#qbSubjectChips [data-subject="PMP"]').evaluate("e=>e.classList.contains('active') && e.getAttribute('aria-pressed')==='true'")
    # Filters default to a compact collapsed summary, leaving more height for the question list.
    tools=page.locator('#qbQuestionPaneBody .qb-question-tools')
    summary=page.locator('#tqTrainingFilterSummary')
    toggle=page.locator('#tqTrainingFilterToggle')
    assert summary.is_visible() and not tools.is_visible()
    assert toggle.get_attribute('aria-expanded')=='false'
    list_box=page.locator('#qbQuestionList').bounding_box()
    assert list_box and list_box['height']>=300,list_box
    assert page.locator('#qbQuestionList').evaluate("e=>getComputedStyle(e).overflowY==='auto' && e.clientHeight<e.scrollHeight")
    summary.click();page.wait_for_timeout(80)
    assert tools.is_visible() and not summary.is_visible()
    assert toggle.get_attribute('aria-expanded')=='true'
    toggle.click();page.wait_for_timeout(80)
    assert summary.is_visible() and not tools.is_visible()
    assert page.evaluate("localStorage.getItem('kg_question_training_filters_collapsed_v1')")=='1'

    # The four frequent actions are compact SVG icon buttons with accessible labels and no visible text.
    row=page.locator('[data-question-row="aq1"]')
    actions=row.locator('.qb-question-icon-action')
    assert actions.count()==4
    assert actions.locator('svg').count()==4
    assert actions.evaluate_all("nodes=>nodes.every(n=>!n.textContent.trim() && !!n.getAttribute('aria-label') && !!n.getAttribute('title'))")

    # Subject chips are the subject switcher. The bank selector only lists banks for the active subject.
    page.locator('#qbSubjectChips [data-subject="ACP"]').click();page.wait_for_timeout(180)
    assert selector.locator('option').count()==1
    assert selector.get_attribute('data-subject')=='ACP'
    assert selector.input_value()=='bank-b'
    assert page.locator('[data-question-row="bq1"]').count()==1
    assert page.locator('[data-question-row="aq1"]').count()==0
    assert 'ACP 敏捷题库' in selector.locator('option:checked').inner_text()
    assert page.locator('#qbSubjectChips [data-subject="ACP"]').evaluate("e=>e.classList.contains('active') && getComputedStyle(e).backgroundColor==='rgb(55, 65, 81)'")

    # The lower preview is focused on the full stem and options only.
    preview=page.locator('#tqTrainingPreview')
    preview_box=preview.bounding_box();assert preview_box and preview_box['height']>=260,preview_box
    assert preview.locator('.tq-training-stem').is_visible()
    assert preview.locator('.tq-training-option').count()==2
    assert preview.locator('.tq-training-answer').count()==0
    assert preview.locator('.tq-training-analysis').count()==0
    assert '正确答案' not in preview.inner_text() and '题目解析' not in preview.inner_text()
    assert preview.locator('.tq-training-option.correct').count()==0
    assert page.locator('#qbRecallLibrarySection').count()==0
    assert page.locator('#qbRecallNodeStudio').count()==0
    assert page.locator('#qbRecallLibraryRelocatedNotice').is_visible()

    # Question/training panes resize through keyboard and pointer dragging, then persist the ratio.
    splitter=page.locator('#tqTrainingWorkspaceSplitter')
    assert splitter.is_visible()
    before=int(splitter.get_attribute('aria-valuenow'))
    left_before=page.locator('#qbMainWorkspace').bounding_box()['width']
    splitter.press('ArrowRight');page.wait_for_timeout(100)
    assert int(splitter.get_attribute('aria-valuenow'))>before
    assert page.locator('#qbMainWorkspace').bounding_box()['width']>left_before
    box=splitter.bounding_box();left_before=page.locator('#qbMainWorkspace').bounding_box()['width']
    page.mouse.move(box['x']+box['width']/2,box['y']+120);page.mouse.down();page.mouse.move(box['x']+90,box['y']+120,steps=5);page.mouse.up();page.wait_for_timeout(120)
    assert page.locator('#qbMainWorkspace').bounding_box()['width']>left_before
    saved=page.evaluate("JSON.parse(localStorage.getItem('kg_question_training_workspace_layout_v1')||'{}')")
    assert 0.28<=saved.get('ratio',0)<=0.68,saved
    assert not errors,errors
    browser.close()
print('v90-p354-training-workspace-browser-ok')
