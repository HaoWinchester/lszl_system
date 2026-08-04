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
    page=browser.new_page(viewport={'width':1600,'height':1000});page.set_default_timeout(10000)
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    attrs,body=body_html('question-bank.html')
    page.set_content(f'<!doctype html><html><head><base href="http://localhost/"></head><body{attrs}>{body}</body></html>')
    page.evaluate("""()=>{
      const local=new Map(),session=new Map();
      Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>local.has(k)?local.get(k):null,setItem:(k,v)=>local.set(k,String(v)),removeItem:k=>local.delete(k),clear:()=>local.clear(),key:i=>[...local.keys()][i]||null,get length(){return local.size}}});
      Object.defineProperty(window,'sessionStorage',{configurable:true,value:{getItem:k=>session.has(k)?session.get(k):null,setItem:(k,v)=>session.set(k,String(v)),removeItem:k=>session.delete(k),clear:()=>session.clear(),key:i=>[...session.keys()][i]||null,get length(){return session.size}}});
      const user='p353-teacher',scope='user__'+encodeURIComponent(user);
      localStorage.setItem('kg_local_current_user_v1',user);
      localStorage.setItem('kg_local_users_v1',JSON.stringify({[user]:{username:user,displayName:'P3.5.3 教师',role:'admin',status:'active',subject:'PMP',salt:'x',hash:'x'}}));
      localStorage.setItem('kg_question_bank_demo_suppressed_v1__'+scope,'1');
      const makeQuestions=(prefix,count)=>Array.from({length:count},(_,i)=>({id:prefix+'q'+(i+1),teacherNumber:'PMP-'+String(i+1).padStart(6,'0'),title:prefix.toUpperCase()+' 题目 '+(i+1),type:'single_choice',subject:'PMP',difficulty:i%2?'中等':'简单',domain:'人员',topic:'敏捷',tags:['预览'],stemParts:[{text:prefix+' 题干 '+(i+1)}],options:[{id:'A',text:'正确选项',correct:true},{id:'B',text:'干扰选项'}],correctAnswer:'A',analysis:prefix+' 解析 '+(i+1),clues:[],concepts:[],reasoningSteps:[],metadata:{knowledge:{primaryNodeId:null}},status:{contentReady:true}}));
      localStorage.setItem('kg_question_banks_v1__'+scope,JSON.stringify([
        {id:'bank-a',name:'题库 A',subject:'PMP',description:'A',version:'1.0',visibility:'private',questions:makeQuestions('a',25)},
        {id:'bank-b',name:'题库 B',subject:'PMP',description:'B',version:'1.0',visibility:'private',questions:makeQuestions('b',6)}
      ]));
      window.confirm=()=>true;window.alert=()=>{};window.open=()=>({});
      if(!window.ResizeObserver)window.ResizeObserver=class{observe(){}disconnect(){}};
    }""")
    add_files(page,['styles/teacher-workbench.css','styles/question-bank-admin.css','styles/teacher-question-workflow.css','styles/admin-context-nav.css','styles/workspace-placement.css','styles/question-classification.css'],'css')
    add_files(page,['src/01-runtime-config.js','src/28-app-storage.js','src/29-auth-core.js','src/34-role-permissions.js','src/50-question-data.js','src/91-learning-content-core.js','src/95-recall-association-library.js','question-studio/question-studio-parser.js','src/98-teacher-workflow-p2-services.js','src/65-question-bank-admin.js','src/98-question-classification.js','src/97-teacher-question-workflow.js','src/99-workspace-placement.js'],'js')
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))");page.wait_for_timeout(500)

    # Two panes stay in one viewport and support keyboard/pointer resize.
    bank_box=page.locator('#qbBankTabPanel').bounding_box();question_box=page.locator('#qbQuestionTabPanel').bounding_box()
    assert bank_box['width']>260 and question_box['width']>340
    assert page.locator('#qbQuestionList').evaluate("e=>getComputedStyle(e).overflowY==='auto' && e.clientHeight<e.scrollHeight")
    before=int(page.locator('#qbLibrarySplitter').get_attribute('aria-valuenow'))
    page.locator('#qbLibrarySplitter').press('ArrowRight');page.wait_for_timeout(50)
    assert int(page.locator('#qbLibrarySplitter').get_attribute('aria-valuenow'))>before
    old_width=page.locator('#qbBankTabPanel').bounding_box()['width'];splitter=page.locator('#qbLibrarySplitter').bounding_box()
    page.mouse.move(splitter['x']+splitter['width']/2,splitter['y']+100);page.mouse.down();page.mouse.move(splitter['x']+120,splitter['y']+100,steps=5);page.mouse.up();page.wait_for_timeout(80)
    assert page.locator('#qbBankTabPanel').bounding_box()['width']>old_width
    page.locator('[data-library-pane-action="maximize"][data-library-pane-target="questions"]').click();page.wait_for_timeout(60)
    assert page.locator('#qbBankTabPanel').is_hidden()
    page.locator('[data-library-pane-action="maximize"][data-library-pane-target="questions"]').click();page.wait_for_timeout(60)
    assert page.locator('#qbBankTabPanel').is_visible()
    page.locator('[data-library-pane-action="collapse"][data-library-pane-target="banks"]').click();page.wait_for_timeout(60)
    assert page.locator('#qbBankTabPanel').bounding_box()['width']<=60
    page.locator('[data-library-pane-action="collapse"][data-library-pane-target="banks"]').click();page.wait_for_timeout(60)

    # Anchored, non-modal preview opens, switches and closes on the same row.
    page.locator('[data-library-question-preview="aq1"]').dblclick();page.wait_for_timeout(100)
    assert not page.locator('#qbLibraryQuestionPreviewPopover').is_hidden()
    assert page.locator('#qbLibraryQuestionPreviewPopover').get_attribute('data-placement') in {'left','right','top','bottom'}
    assert 'a 题干 1' in page.locator('#qbLibraryQuestionPreviewContent').inner_text()
    assert page.locator('[data-library-question-preview="aq1"]').evaluate("e=>e.classList.contains('library-preview-active')")
    page.locator('[data-library-question-preview="aq2"] .qb-question-main').click();page.wait_for_timeout(300)
    assert 'a 题干 2' in page.locator('#qbLibraryQuestionPreviewContent').inner_text()
    page.locator('[data-library-question-preview="aq2"]').dblclick();page.wait_for_timeout(100)
    assert page.locator('#qbLibraryQuestionPreviewPopover').is_hidden()

    # Edit icon switches to the exact question editor in the same page.
    page.locator('[data-library-question-preview="aq3"]').dblclick();page.wait_for_timeout(80)
    page.locator('#qbLibraryQuestionPreviewEditBtn').click();page.wait_for_timeout(120)
    assert page.locator('#qbQuestionBaseCard').is_visible()
    assert page.locator('#questionTitleInput').input_value()=='A 题目 3'
    page.locator('[data-main-tab="banks"]').click();page.wait_for_timeout(100)

    # Opening preview and switching banks closes it and refreshes the question list.
    page.locator('[data-library-question-preview="aq1"]').dblclick();page.wait_for_timeout(80)
    page.locator('[data-bank-id="bank-b"]').click();page.wait_for_timeout(120)
    assert page.locator('#qbLibraryQuestionPreviewPopover').is_hidden()
    assert page.locator('[data-library-question-preview="bq1"]').count()==1
    assert page.locator('[data-library-question-preview="aq1"]').count()==0

    saved=page.evaluate("JSON.parse(localStorage.getItem('kg_question_library_workspace_layout_v1')||'{}')")
    assert 0.25<=saved.get('ratio',0)<=0.75
    assert not errors,errors
    browser.close()
print('v90-p353-question-bank-workspace-browser-ok')
