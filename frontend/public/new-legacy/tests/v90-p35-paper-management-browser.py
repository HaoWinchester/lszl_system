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
    page=browser.new_page(viewport={'width':1440,'height':1000});page.set_default_timeout(10000)
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    attrs,body=body_html('paper-management.html')
    page.set_content(f'<!doctype html><html><head><base href="http://localhost/"></head><body{attrs}>{body}</body></html>')
    page.evaluate("""()=>{
      const local=new Map(),session=new Map();
      Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>local.has(k)?local.get(k):null,setItem:(k,v)=>local.set(k,String(v)),removeItem:k=>local.delete(k),clear:()=>local.clear(),key:i=>[...local.keys()][i]||null,get length(){return local.size}}});
      Object.defineProperty(window,'sessionStorage',{configurable:true,value:{getItem:k=>session.has(k)?session.get(k):null,setItem:(k,v)=>session.set(k,String(v)),removeItem:k=>session.delete(k),clear:()=>session.clear(),key:i=>[...session.keys()][i]||null,get length(){return session.size}}});
      const user='p35-teacher',scope='user__'+encodeURIComponent(user);
      localStorage.setItem('kg_local_current_user_v1',user);
      localStorage.setItem('kg_local_users_v1',JSON.stringify({[user]:{username:user,displayName:'P3.5 教师',role:'admin',status:'active',subject:'PMP',salt:'x',hash:'x'}}));
      const questions=Array.from({length:25},(_,i)=>({id:'q'+(i+1),teacherNumber:'PMP-'+String(i+1).padStart(6,'0'),title:'试卷测试题 '+(i+1),type:'single_choice',subject:'PMP',difficulty:'中等',domain:i%2?'过程':'人员',topic:'敏捷',tags:['测试'],stemParts:[{text:'题干 '+(i+1)}],options:[{id:'A',text:'A',correct:true},{id:'B',text:'B'}],correctAnswer:'A',analysis:'解析',clues:[],concepts:[],reasoningSteps:[],metadata:{knowledge:{primaryNodeId:null}},status:{contentReady:true}}));
      localStorage.setItem('kg_question_banks_v1__'+scope,JSON.stringify([{id:'bank-p35',name:'P3.5 题库',subject:'PMP',visibility:'private',questions}]));
      window.confirm=()=>true;window.alert=()=>{};window.__prompts=[];window.prompt=()=>window.__prompts.shift()||'';
    }""")
    add_files(page,['styles/teacher-workbench.css','styles/question-bank-admin.css','styles/admin-context-nav.css','styles/paper-management.css'],'css')
    add_files(page,['src/01-runtime-config.js','src/28-app-storage.js','src/29-auth-core.js','src/34-role-permissions.js','src/37-subscription-plans.js','src/37-subscription-orders.js','src/37-subscription-redeem-codes.js','src/37-subscription-core.js','src/33-user-center.js','src/50-question-data.js','src/91-learning-content-core.js','src/95-recall-association-library.js','src/98-teacher-workflow-p2-services.js','src/98-question-classification.js','src/65-question-bank-admin.js'],'js')
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))");page.wait_for_timeout(400)
    page.locator('#qbAddPaperBtn').click();page.wait_for_timeout(120)
    assert page.locator('[data-paper-candidate]').count()==20
    # Layout stays horizontal and supports maximize, collapse, keyboard resize.
    assert page.locator('#pmQuestionPickerPane').bounding_box()['width'] > 400
    assert page.locator('#pmPreviewPane').bounding_box()['width'] > 400
    assert page.locator('.pm-mode-fieldset label').first.evaluate("e=>getComputedStyle(e).writingMode") == 'horizontal-tb'
    before_value=int(page.locator('#pmPaneSplitter').get_attribute('aria-valuenow'))
    page.locator('#pmPaneSplitter').press('ArrowRight');page.wait_for_timeout(50)
    assert int(page.locator('#pmPaneSplitter').get_attribute('aria-valuenow')) > before_value
    picker_width=page.locator('#pmQuestionPickerPane').bounding_box()['width']
    splitter_box=page.locator('#pmPaneSplitter').bounding_box()
    page.mouse.move(splitter_box['x']+splitter_box['width']/2,splitter_box['y']+80);page.mouse.down();page.mouse.move(splitter_box['x']+110,splitter_box['y']+80,steps=5);page.mouse.up();page.wait_for_timeout(80)
    assert page.locator('#pmQuestionPickerPane').bounding_box()['width'] > picker_width
    page.locator('[data-pane-action="maximize"][data-pane-target="picker"]').click();page.wait_for_timeout(70)
    assert page.locator('#pmPreviewPane').is_hidden()
    page.locator('[data-pane-action="maximize"][data-pane-target="picker"]').click();page.wait_for_timeout(70)
    assert page.locator('#pmPreviewPane').is_visible()
    page.locator('[data-pane-action="collapse"][data-pane-target="preview"]').click();page.wait_for_timeout(70)
    assert page.locator('#pmPreviewPane').bounding_box()['width'] <= 60
    page.locator('[data-pane-action="collapse"][data-pane-target="preview"]').click();page.wait_for_timeout(70)
    # Double click opens preview; edit icon builds a deep link to the exact question.
    page.evaluate("window.__paperEditorUrl='';window.open=url=>{window.__paperEditorUrl=String(url);return null}")
    page.locator('[data-question-preview="bank-p35::q1"]').dblclick();page.wait_for_timeout(80)
    assert not page.locator('#qbQuestionPreviewPopover').is_hidden()
    assert page.locator('#qbQuestionPreviewPopover').get_attribute('data-placement') in {'left','right','top','bottom'}
    assert '题干 1' in page.locator('#qbQuestionPreviewContent').inner_text()
    page.locator('[data-question-preview="bank-p35::q2"] [class*="qb-paper-candidate-number"]').click();page.wait_for_timeout(300)
    assert '题干 2' in page.locator('#qbQuestionPreviewContent').inner_text()
    page.locator('[data-question-preview="bank-p35::q2"]').dblclick();page.wait_for_timeout(80)
    assert page.locator('#qbQuestionPreviewPopover').is_hidden()
    page.locator('[data-question-preview="bank-p35::q1"]').dblclick();page.wait_for_timeout(80)
    page.locator('#qbQuestionPreviewEditBtn').click();page.wait_for_timeout(40)
    opened=page.evaluate('window.__paperEditorUrl')
    assert 'question-bank.html' in opened and 'bankId=bank-p35' in opened and 'questionId=q1' in opened and 'view=base' in opened
    page.locator('#qbQuestionPreviewCloseBtn').click();page.wait_for_timeout(40)
    assert page.locator('#qbQuestionPreviewPopover').is_hidden()
    page.locator('#qbSelectPaperCandidatesPage').check();page.locator('#qbAddSelectedToPaperBtn').click();page.wait_for_timeout(180)
    assert page.locator('[data-paper-preview-check]').count()==20
    page.locator('[data-paper-preview-check]').nth(0).check();page.locator('[data-paper-preview-check]').nth(1).check();page.wait_for_timeout(80)
    assert page.locator('#qbPaperPreviewBulkToolbar').is_visible()
    assert '已选择 2 道题' in page.locator('#qbPaperPreviewSelectedCount').inner_text()
    page.locator('#qbPaperBulkRemoveBtn').click();page.wait_for_timeout(140)
    assert page.locator('[data-paper-preview-check]').count()==18
    page.locator('#qbPublishPaperBtn').click();page.wait_for_timeout(180)
    release=page.evaluate("JSON.parse(localStorage.getItem('kg_exam_papers_published_v1')||'[]')[0]")
    assert release['version']==1 and len(release['questions'])==18 and len(release['questionSnapshots'])==18
    assert set(release['enabledModes'])=={'practice_mode','deep_recall','multi_question_canvas'}
    # Edit draft after publish: released snapshot remains immutable until a new publish.
    page.locator('[data-paper-remove="0"]').click();page.wait_for_timeout(100)
    assert page.locator('[data-paper-preview-check]').count()==17
    assert len(page.evaluate("JSON.parse(localStorage.getItem('kg_exam_papers_published_v1')||'[]')[0].questions"))==18
    page.locator('#qbPublishPaperBtn').click();page.wait_for_timeout(160)
    release2=page.evaluate("JSON.parse(localStorage.getItem('kg_exam_papers_published_v1')||'[]')[0]")
    assert release2['version']==2 and len(release2['questions'])==17

    # Classification, current-page selection and batch draft deletion.
    page.evaluate("window.__prompts=['专项训练']")
    page.locator('#qbAddPaperCategoryBtn').click();page.wait_for_timeout(100)
    category_a=page.locator('.pm-paper-category-row').filter(has_text='专项训练')
    assert category_a.count()==1
    category_a_id=category_a.locator('[data-paper-category-id]').get_attribute('data-paper-category-id')
    page.locator('#qbAddPaperBtn').click();page.locator('#qbAddPaperBtn').click();page.wait_for_timeout(140)
    assert page.locator('#qbPaperList [data-paper-id]').count()==2
    assert page.locator('#paperCategoryInput').input_value()==category_a_id
    page.evaluate("window.__prompts=['模拟卷']")
    page.locator('#qbAddPaperCategoryBtn').click();page.wait_for_timeout(100)
    category_b=page.locator('.pm-paper-category-row').filter(has_text='模拟卷')
    category_b_id=category_b.locator('[data-paper-category-id]').get_attribute('data-paper-category-id')
    category_a.locator('[data-paper-category-id]').click();page.wait_for_timeout(100)
    page.locator('#qbPaperListSelectPage').check();page.wait_for_timeout(50)
    assert '已选择 2 张试卷' in page.locator('#qbPaperListSelectedCount').inner_text()
    page.locator('#qbPaperBulkCategorySelect').select_option(category_b_id)
    page.locator('#qbPaperBulkMoveCategoryBtn').click();page.wait_for_timeout(120)
    assert page.locator('#qbPaperList [data-paper-id]').count()==0
    category_b.locator('[data-paper-category-id]').click();page.wait_for_timeout(100)
    assert page.locator('#qbPaperList [data-paper-id]').count()==2
    page.locator('#qbPaperListSelectPage').check();page.wait_for_timeout(50)
    page.locator('#qbPaperBulkDeleteDraftBtn').click();page.wait_for_timeout(120)
    assert page.locator('#qbPaperList [data-paper-id]').count()==0
    assert category_b.locator('em').inner_text()=='0'

    # Switch to a student account: public release and snapshots must remain readable.
    page.evaluate("""()=>{const users=JSON.parse(localStorage.getItem('kg_local_users_v1')||'{}');users['p35-student']={username:'p35-student',displayName:'P3.5 学员',role:'student',status:'active',subject:'PMP',salt:'x',hash:'x'};localStorage.setItem('kg_local_users_v1',JSON.stringify(users));localStorage.setItem('kg_local_current_user_v1','p35-student');window.authRequire=()=>true;window.showStatus=()=>{};}""")
    add_files(page,['src/59-published-paper-repository.js','src/60-question-bank.js','src/96-recall-question-source.js'],'js')
    student=page.evaluate("""()=>{qbInvalidateCaches();KGRecallQuestionSource.invalidate();const single=qbPublishedPaperCatalog({respectRole:true,mode:'single_deep_study'});const multi=qbPublishedPaperCatalog({respectRole:true,mode:'multi_question_canvas'});const recall=KGRecallQuestionSource.list().filter(bank=>bank.id.startsWith('paper-release:'));return {single:single.length,singleAvailable:single[0]?.availableCount||0,multi:multi.length,recall:recall.length,recallCount:recall[0]?.questions.length||0,title:single[0]?.items[0]?.question?.title||''}}""")
    assert student['single']==1 and student['singleAvailable']==17
    assert student['multi']==1 and student['recall']==1 and student['recallCount']==17
    assert student['title'].startswith('试卷测试题')
    assert not errors,errors
    browser.close()
print('v90-p35-paper-management-browser-ok')
