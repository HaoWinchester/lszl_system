#!/usr/bin/env python3
from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
CURRENT_VERSION=(ROOT/'VERSION').read_text(encoding='utf-8').strip()
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
    page=browser.new_page(viewport={'width':1440,'height':1000});page.set_default_timeout(9000)
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    attrs,body=body_html('question-bank.html')
    page.set_content(f'<!doctype html><html><head></head><body{attrs}>{body}</body></html>')
    page.evaluate("""()=>{
      const local=new Map(),session=new Map();
      Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>local.has(k)?local.get(k):null,setItem:(k,v)=>local.set(k,String(v)),removeItem:k=>local.delete(k),clear:()=>local.clear(),key:i=>[...local.keys()][i]||null,get length(){return local.size}}});
      Object.defineProperty(window,'sessionStorage',{configurable:true,value:{getItem:k=>session.has(k)?session.get(k):null,setItem:(k,v)=>session.set(k,String(v)),removeItem:k=>session.delete(k),clear:()=>session.clear(),key:i=>[...session.keys()][i]||null,get length(){return session.size}}});
      const user='p34-teacher',scope='user__'+encodeURIComponent(user),bankId='bank-p34';
      localStorage.setItem('kg_local_current_user_v1',user);
      localStorage.setItem('kg_local_users_v1',JSON.stringify({[user]:{username:user,displayName:'P3.4 教师',role:'admin',status:'active',subject:'PMP',salt:'x',hash:'x'}}));
      localStorage.setItem('kg_question_bank_demo_suppressed_v1__'+scope,'1');
      const questions=Array.from({length:25},(_,i)=>({
        id:'q'+String(i+1),teacherNumber:'PMP-'+String(i+1).padStart(6,'0'),title:'P3.4 测试题 '+String(i+1),type:'single_choice',subject:'PMP',difficulty:'中等',domain:'人员',topic:'敏捷',tags:[],stemParts:[{text:'题干 '+String(i+1)}],options:[{id:'A',text:'A',correct:true},{id:'B',text:'B'}],correctAnswer:'A',analysis:'解析',clues:[],concepts:[],reasoningSteps:[],metadata:{knowledge:{taxonomyId:'taxonomy-pmp-v1',taxonomyVersion:1,primaryNodeId:null,relatedNodeIds:[],mappingStatus:'unmapped',mappingSource:'',pathSnapshot:[]},classificationHistory:[]},status:{contentReady:true,keywordsReady:false,knowledgeReady:false,reasoningReady:false,published:false}
      }));
      localStorage.setItem('kg_question_banks_v1__'+scope,JSON.stringify([{id:bankId,name:'P3.4 回归题库',subject:'PMP',description:'',version:'1.0',visibility:'private',createdAt:Date.now(),updatedAt:Date.now(),questions}]));
      localStorage.setItem('kg_exam_papers_v1__'+scope,JSON.stringify([{id:'paper-1',name:'历史试卷',subject:'PMP',status:'published',totalCount:1,questionIds:['q1'],questionRefs:[{bankId,questionId:'q1'}]}]));
      localStorage.setItem('kg_course_drafts_v1',JSON.stringify([{id:'course-1',title:'历史课程',items:[{type:'question',questionId:'q2',bankId}]}]));
      localStorage.setItem('kg_learning_sessions_v1',JSON.stringify([{id:'session-1',questionId:'q3',bankId,score:1}]));
      window.confirm=()=>true;window.alert=()=>{};window.open=()=>({});
      if(!window.ResizeObserver)window.ResizeObserver=class{observe(){}disconnect(){}};
    }""")
    add_files(page,['styles/teacher-workbench.css','styles/question-bank-admin.css','styles/teacher-question-workflow.css','styles/admin-context-nav.css','styles/workspace-placement.css','styles/question-classification.css'],'css')
    add_files(page,['src/01-runtime-config.js','src/28-app-storage.js','src/29-auth-core.js','src/34-role-permissions.js','src/50-question-data.js','src/91-learning-content-core.js','src/95-recall-association-library.js','question-studio/question-studio-parser.js','src/98-teacher-workflow-p2-services.js','src/65-question-bank-admin.js','src/98-question-classification.js','src/97-teacher-question-workflow.js','src/99-workspace-placement.js'],'js')
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))");page.wait_for_timeout(500)

    # Current-page selection must stop at 20 and clear when paging.
    assert page.locator('[data-question-select]').count()==20
    page.locator('#qbSelectPageQuestions').check();page.wait_for_timeout(100)
    assert '已选择 20 道题' in page.locator('#qbBulkSelectionCount').inner_text()
    page.locator('[data-question-page="next"]').click();page.wait_for_timeout(100)
    assert page.locator('[data-question-select]').count()==5
    assert page.locator('#qbBulkToolbar').is_hidden()
    page.locator('[data-question-page="first"]').click();page.wait_for_timeout(100)

    def select(ids):
        for qid in ids:
            page.locator(f'[data-question-select="{qid}"]').check()
        page.wait_for_timeout(100)

    # Bulk knowledge movement keeps stable IDs.
    select(['q1','q2','q3'])
    before_ids=page.evaluate("KGQuestionBankAdminAPI.getAllQuestions({includeDeleted:true}).map(q=>q.id)")
    page.locator('#qbBulkKnowledgeBtn').click();page.wait_for_timeout(100)
    page.locator('#qbBulkKnowledgeSearchInput').fill('敏捷方法');page.wait_for_timeout(100)
    page.locator('#qbBulkKnowledgeSearchResults [data-bulk-knowledge-search="kp-pmp-agile"]').click()
    page.locator('#qbBulkKnowledgeConfirmBtn').click();page.wait_for_timeout(180)
    moved=page.evaluate("KGQuestionBankAdminAPI.getAllQuestions({includeDeleted:true}).filter(q=>['q1','q2','q3'].includes(q.id))")
    assert all(q['metadata']['knowledge']['primaryNodeId']=='kp-pmp-agile' for q in moved)
    assert page.evaluate("KGQuestionBankAdminAPI.getAllQuestions({includeDeleted:true}).map(q=>q.id)")==before_ids

    # Move into unclassified and assign again from the unclassified view.
    select(['q3'])
    page.locator('#qbBulkUnclassifiedBtn').click();page.wait_for_timeout(150)
    assert page.evaluate("KGQuestionBankAdminAPI.getAllQuestions({includeDeleted:true}).find(q=>q.id==='q3').metadata.knowledge.primaryNodeId") is None
    page.locator('#qbQuestionLifecycleFilter').select_option('unclassified');page.wait_for_timeout(120)
    select(['q3']);page.locator('#qbBulkKnowledgeBtn').click();page.locator('#qbBulkKnowledgeSearchInput').fill('敏捷方法');page.wait_for_timeout(80)
    page.locator('#qbBulkKnowledgeSearchResults [data-bulk-knowledge-search="kp-pmp-agile"]').click();page.locator('#qbBulkKnowledgeConfirmBtn').click();page.wait_for_timeout(150)
    page.locator('#qbQuestionLifecycleFilter').select_option('active');page.wait_for_timeout(120)

    # Batch tags: add and remove use the same current-page boundary.
    select(['q1','q2','q3'])
    page.locator('#qbBulkTagsBtn').click();page.locator('#qbBulkCustomTagInput').fill('核心题');page.locator('#qbBulkCustomTagInput').press('Enter');page.locator('#qbBulkTagConfirmBtn').click();page.wait_for_timeout(180)
    tagged=page.evaluate("KGQuestionBankAdminAPI.getAllQuestions({includeDeleted:true}).filter(q=>['q1','q2','q3'].includes(q.id))")
    assert all('核心题' in q['tags'] for q in tagged)
    select(['q1','q2','q3'])
    page.locator('#qbBulkTagsBtn').click();page.locator('input[name="qbBulkTagMode"][value="remove"]').check();page.locator('#qbBulkCustomTagInput').fill('核心题');page.locator('#qbBulkCustomTagInput').press('Enter');page.locator('#qbBulkTagConfirmBtn').click();page.wait_for_timeout(160)
    untagged=page.evaluate("KGQuestionBankAdminAPI.getAllQuestions({includeDeleted:true}).filter(q=>['q1','q2','q3'].includes(q.id))")
    assert all('核心题' not in q['tags'] for q in untagged)

    # Safe delete allows references and shows question-level reference summary.
    select(['q1','q2','q3'])
    page.locator('#qbBulkDeleteBtn').click();page.wait_for_timeout(100)
    summary=page.locator('#qbSafeDeleteSummary').inner_text()
    assert '已有试卷引用\n1 道' in summary
    assert '已有课程或任务引用\n1 道' in summary
    assert '存在答题、成绩或统计记录\n1 道' in summary
    page.locator('#qbSafeDeleteConfirmBtn').click();page.wait_for_timeout(200)
    assert not any(q['id'] in ('q1','q2','q3') for q in page.evaluate('KGQuestionBankAdminAPI.getAllQuestions()'))
    deleted=page.evaluate("KGQuestionBankAdminAPI.getAllQuestions({includeDeleted:true}).filter(q=>['q1','q2','q3'].includes(q.id))")
    assert all(q['lifecycle']['status']=='deleted' for q in deleted)
    if CURRENT_VERSION=='v9.0-p3.4':
        page.locator('[data-main-tab="papers"]').evaluate('(el)=>el.click()');page.wait_for_timeout(120)
        assert 'P3.4 测试题 1' in page.locator('#qbPaperQuestionList').inner_text()
        page.locator('[data-main-tab="banks"]').evaluate('(el)=>el.click()');page.wait_for_timeout(120)
    else:
        assert (ROOT/'paper-management.html').exists()
        assert page.evaluate("JSON.parse(localStorage.getItem('kg_exam_papers_v1__user__p34-teacher')||'[]')[0].questionRefs[0].questionId")=='q1'

    # Restore one protected question.
    page.locator('#qbQuestionLifecycleFilter').select_option('deleted');page.wait_for_timeout(150)
    assert page.locator('[data-question-row="q1"]').count()==1
    page.locator('[data-question-restore="q2"]').click();page.wait_for_timeout(160)
    assert page.evaluate("KGQuestionBankAdminAPI.getAllQuestions({includeDeleted:true}).find(q=>q.id==='q2').lifecycle.status")=='active'

    # Protected permanent delete skips each referenced question.
    select(['q1','q3'])
    page.locator('#qbBulkPermanentDeleteBtn').click();page.wait_for_timeout(100)
    psummary=page.locator('#qbPermanentDeleteSummary').inner_text()
    assert '受引用保护，不会删除\n2 道' in psummary
    page.locator('#qbPermanentDeleteAcknowledge').check();page.locator('#qbPermanentDeleteConfirmBtn').click();page.wait_for_timeout(180)
    remain_ids=page.evaluate("KGQuestionBankAdminAPI.getAllQuestions({includeDeleted:true}).map(q=>q.id)")
    assert 'q1' in remain_ids and 'q3' in remain_ids

    # An unreferenced question can be permanently deleted after safe deletion.
    page.locator('#qbQuestionLifecycleFilter').select_option('active');page.wait_for_timeout(120)
    page.locator('[data-question-delete="q4"]').click();page.locator('#qbSafeDeleteConfirmBtn').click();page.wait_for_timeout(150)
    page.locator('#qbQuestionLifecycleFilter').select_option('deleted');page.wait_for_timeout(120)
    page.locator('[data-question-permanent="q4"]').click();page.locator('#qbPermanentDeleteAcknowledge').check();page.locator('#qbPermanentDeleteConfirmBtn').click();page.wait_for_timeout(180)
    assert 'q4' not in page.evaluate("KGQuestionBankAdminAPI.getAllQuestions({includeDeleted:true}).map(q=>q.id)")

    # Audit is complete and batched.
    audits=page.evaluate("JSON.parse(localStorage.getItem('kg_admin_audit_log_v1')||'[]')")
    actions={row['action'] for row in audits}
    assert 'question.knowledge.bulk_update' in actions
    assert 'question.tags.bulk_set' in actions
    assert 'question.safe_delete.bulk' in actions
    assert 'question.restore' in actions
    assert 'question.permanent_delete' in actions
    assert all(row['metadata'].get('questionId') and row['metadata'].get('batchId') for row in audits)

    # Learning pages no longer read mutable banks. A frozen published release remains resolvable after safe deletion.
    page.evaluate("""()=>{localStorage.setItem('kg_exam_papers_published_v1',JSON.stringify([{id:'release-p34',releaseId:'release-p34',paperId:'paper-p34',version:1,name:'历史发布卷',subject:'PMP',enabledModes:['deep_recall'],questions:[{bankId:'bank-p34',questionId:'q1',order:1}],questionSnapshots:[{bankId:'bank-p34',bankName:'P3.4 回归题库',questionId:'q1',question:{id:'q1',title:'发布时冻结题目',stemParts:[{text:'冻结题干'}],options:[]}}]}]));}""")
    add_files(page,['src/59-published-paper-repository.js','src/96-recall-question-source.js'],'js')
    page.evaluate('KGRecallQuestionSource.invalidate()')
    visible_ids=page.evaluate("KGRecallQuestionSource.list().flatMap(b=>b.questions.map(q=>q.id))")
    assert visible_ids==['q1']
    assert page.evaluate("KGRecallQuestionSource.find('paper-release:release-p34','q1').question.title")=='发布时冻结题目'

    assert not errors,errors
    browser.close()
print('v90-p34-question-ownership-safe-delete-browser-ok')
