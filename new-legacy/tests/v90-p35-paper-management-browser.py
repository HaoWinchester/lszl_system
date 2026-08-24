#!/usr/bin/env python3
from pathlib import Path
import json
import re
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']


def body_html(file):
    text = (ROOT / file).read_text(encoding='utf-8')
    match = re.search(r'<body([^>]*)>([\s\S]*)</body>', text, re.I)
    return match.group(1), re.sub(r'<script[\s\S]*?</script>', '', match.group(2), flags=re.I)


def add_files(page, files, kind):
    for file in files:
        content = (ROOT / file).read_text(encoding='utf-8')
        (page.add_style_tag if kind == 'css' else page.add_script_tag)(content=content)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=ARGS)
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    page.set_default_timeout(10000)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    attrs, body = body_html('paper-management.html')
    page.set_content(f'<!doctype html><html><head><base href="http://localhost/"></head><body{attrs}>{body}</body></html>')
    page.evaluate("""()=>{
      const local=new Map(),session=new Map();window.__storageWrites=[];
      Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>local.has(k)?local.get(k):null,setItem:(k,v)=>{window.__storageWrites.push(String(k));local.set(k,String(v))},removeItem:k=>local.delete(k),clear:()=>local.clear(),key:i=>[...local.keys()][i]||null,get length(){return local.size}}});
      Object.defineProperty(window,'sessionStorage',{configurable:true,value:{getItem:k=>session.has(k)?session.get(k):null,setItem:(k,v)=>session.set(k,String(v)),removeItem:k=>session.delete(k),clear:()=>session.clear(),key:i=>[...session.keys()][i]||null,get length(){return session.size}}});
      const user='api-paper-teacher';localStorage.setItem('kg_local_current_user_v1',user);localStorage.setItem('kg_local_users_v1',JSON.stringify({[user]:{username:user,displayName:'API 试卷教师',role:'admin',status:'active',subject:'PMP',salt:'x',hash:'x'}}));
      window.confirm=()=>true;window.alert=message=>{window.__lastAlert=String(message)};window.__prompts=[];window.prompt=()=>window.__prompts.shift()||'';
      const questions=Array.from({length:25},(_,i)=>({id:'q'+(i+1),bankId:'bank-p35',teacherNumber:'PMP-'+String(i+1).padStart(6,'0'),title:'试卷测试题 '+(i+1),type:'single_choice',subject:'PMP',difficulty:'medium',domain:i%2?'过程':'人员',topic:'敏捷',tags:['测试'],stemParts:[{text:'题干 '+(i+1)}],options:[{id:'A',text:'A',correct:true},{id:'B',text:'B'}],correctAnswer:'A',analysis:'解析',clues:[],concepts:[],reasoningSteps:[],metadata:{knowledge:{primaryNodeId:null},classifications:{'exam-domain':i%3===0?'business-environment':(i%2?'process':'people')}},status:{contentReady:true}}));
      const banks=[{id:'bank-p35',name:'P3.5 题库',subject:'PMP',visibility:'private',revision:1,questions}];
      window.__bankImportCalls=[];window.__bankImportFailures=1;
      window.KGQuestionCatalogAdapter={
        ready:Promise.resolve(),
        snapshot:()=>({banks:banks.map(({questions,...bank})=>({...bank,questionCount:questions.length})),questions:banks.flatMap(bank=>bank.questions.map(item=>({...item,bankId:bank.id}))),contentRevision:1}),
        question:id=>clone(banks.flatMap(bank=>bank.questions).find(question=>question.id===id)||null),
        loadQuestion:async id=>clone(banks.flatMap(bank=>bank.questions).find(question=>question.id===id)||null),
        loadBankQuestions:async id=>clone(banks.find(bank=>bank.id===id)?.questions||[]),
        loadBankQuestionPage:async(id,options)=>{const keyword=String(options.search||'').toLowerCase(),all=(banks.find(bank=>bank.id===id)?.questions||[]).filter(question=>!keyword||JSON.stringify(question).toLowerCase().includes(keyword)),start=(options.page-1)*options.pageSize;return {questions:clone(all.slice(start,start+options.pageSize)),total:all.length,page:options.page,pageSize:options.pageSize}},
        importBanks:async body=>{
          window.__bankImportCalls.push(clone(body));
          if(window.__bankImportFailures>0){window.__bankImportFailures-=1;throw new Error('题库导入服务暂时不可用')}
          const saved=body.banks.map((source,index)=>{const bank={...clone(source),id:`db-import-bank-${index+1}`,sourceId:source.id,revision:1,questions:source.questions.map(question=>({...clone(question),bankId:`db-import-bank-${index+1}`,sourceId:question.id}))};banks.push(bank);return bank});
          return {banks:clone(saved),sourceBankIdMap:{},sourceQuestionIdMap:{},contentRevision:2,importPlan:{create:saved.length,replace:0,skip:0}};
        }
      };
      const clone=value=>JSON.parse(JSON.stringify(value));let paperSeq=0,categorySeq=0,batchSeq=0;
      let db={papers:[],categories:[]};window.__paperDb=db;window.__paperApiCalls=[];window.__paperReleaseCalls=[];window.__shortageOnce=true;window.__batchFail=false;window.__importPreflightFails=1;
      const stamp=()=>new Date().toISOString();
      const savePaper=(input,id)=>{const now=stamp(),paper={id:id||`p-${++paperSeq}`,name:input.name||'新试卷',subject:input.subject||'PMP',description:input.description||'',categoryId:input.categoryId||'',totalCount:Number(input.totalCount||input.questions?.length||0),status:'draft',quotas:input.quotas||{},accessPolicy:input.accessPolicy||{},enabledModes:input.enabledModes||[],modeConfigVersion:input.modeConfigVersion||2,purpose:input.purpose||'learning',revision:1,publishedVersion:0,createdAt:now,updatedAt:now,questions:(input.questions||[]).map((ref,index)=>({...ref,order:index+1}))};db.papers.push(paper);return clone(paper)};
      const find=id=>db.papers.find(item=>item.id===id),cas=(paper,revision)=>{if(!paper||Number(revision)!==paper.revision)throw Object.assign(new Error('数据已发生变化，请刷新后重试。'),{status:409})};
      window.KGPaperDraftApi={
        ready:async()=>({papers:clone(db.papers),categories:clone(db.categories)}),list:async()=>clone(db.papers),listCategories:async()=>clone(db.categories),detail:async id=>clone(find(id)),
        create:async body=>{window.__paperApiCalls.push(['create',clone(body)]);return savePaper(body)},
        update:async(id,body)=>{window.__paperApiCalls.push(['update',id,clone(body)]);const paper=find(id);cas(paper,body.revision);Object.assign(paper,clone(body),{categoryId:body.categoryId||'',revision:paper.revision+1,updatedAt:stamp()});return clone(paper)},
        replaceQuestions:async(id,body)=>{window.__paperApiCalls.push(['replaceQuestions',id,clone(body)]);const paper=find(id);cas(paper,body.revision);paper.questions=body.questions.map((ref,index)=>({...clone(ref),order:index+1}));paper.totalCount=Math.max(paper.totalCount,paper.questions.length);paper.revision+=1;paper.updatedAt=stamp();return clone(paper)},
        remove:async(id,options)=>{window.__paperApiCalls.push(['remove',id,clone(options)]);const paper=find(id);cas(paper,options.revision);db.papers=db.papers.filter(item=>item.id!==id);window.__paperDb=db;return {paperId:id}},
        archive:async(id,revision)=>{const paper=find(id);cas(paper,revision);paper.status='archived';paper.revision+=1;paper.archivedAt=stamp();return clone(paper)},restore:async(id,revision)=>{const paper=find(id);cas(paper,revision);paper.status='draft';paper.revision+=1;paper.archivedAt=null;return clone(paper)},
        createCategory:async body=>{const category={id:`pc-${++categorySeq}`,name:body.name,description:'',orderIndex:body.orderIndex||0,revision:1,createdAt:stamp(),updatedAt:stamp()};db.categories.push(category);window.__paperApiCalls.push(['createCategory',clone(body)]);return clone(category)},
        updateCategory:async(id,body)=>{const category=db.categories.find(item=>item.id===id);if(category.revision!==body.revision)throw Object.assign(new Error('分类已变更'),{status:409});Object.assign(category,clone(body),{revision:category.revision+1});return clone(category)},removeCategory:async(id,revision)=>{const category=db.categories.find(item=>item.id===id);if(category.revision!==revision)throw Object.assign(new Error('分类已变更'),{status:409});db.categories=db.categories.filter(item=>item.id!==id);window.__paperDb=db;return {categoryId:id}},
        importPreflight:async body=>{window.__paperApiCalls.push(['importPreflight',clone(body)]);if(window.__importPreflightFails>0){window.__importPreflightFails-=1;throw Object.assign(new Error('预检服务暂时不可用'),{status:500})}return {valid:true,payloadHash:'a'.repeat(64),summary:{paperId:body.package.paper.id,name:body.package.paper.name,subject:'PMP',questionCount:body.package.paper.questions.length,sourceBankCount:1},references:body.package.paper.questions,errors:[],warnings:[{message:'文件名与包内名称不一致，以包内名称为准。'}],paperConflict:{id:body.package.paper.id,status:'draft',revision:1},allowedActions:{create:false,copy:true,replaceDraft:true}}},
        importPaper:async body=>{window.__paperApiCalls.push(['importPaper',clone(body)]);await new Promise(resolve=>setTimeout(resolve,80));const source=body.package.paper;return {paper:savePaper({...source,name:source.name+' 副本'},body.conflictAction==='copy'?undefined:source.id),warnings:[]}},
        compositionPreflight:async body=>{window.__paperApiCalls.push(['compositionPreflight',clone(body)]);const shortage=window.__shortageOnce&&body.variants.some(item=>item.code==='C');const variants=body.variants.map(item=>({code:item.code,name:item.name,totalCount:item.totalCount,feasible:!(shortage&&item.code==='C'),hardTargets:{people:Math.round(item.totalCount*.42),process:Math.round(item.totalCount*.5),'business-environment':Math.max(0,item.totalCount-Math.round(item.totalCount*.42)-Math.round(item.totalCount*.5))},hardActual:{},hardShortages:shortage&&item.code==='C'?{people:1}:{},softTargets:{},softActual:{},questionIds:[]}));return {normalizedRequest:{...clone(body),randomSeed:'browser-seed'},candidateCount:220,unclassifiedCount:0,inventory:{},variants,feasible:variants.every(item=>item.feasible),feasibleVariantCodes:variants.filter(item=>item.feasible).map(item=>item.code),duplicateQuestionIds:[],planHash:(shortage?'b':'c').repeat(64)}},
        createCompositionBatch:async body=>{window.__paperApiCalls.push(['createCompositionBatch',clone(body)]);await new Promise(resolve=>setTimeout(resolve,80));if(window.__batchFail)throw Object.assign(new Error('数据库故障'),{status:500});const papers=body.variants.map(item=>savePaper({name:item.name,subject:body.subject,totalCount:item.totalCount,questions:[]}));return {batchId:`batch-${++batchSeq}`,papers,randomSeed:body.randomSeed,planHash:body.planHash}}
      };
      window.KGPaperReleaseApi={publishPayload:async payload=>{window.__paperReleaseCalls.push(clone(payload));return {releaseId:`${payload.paperId}-server-v1`,paperId:payload.paperId,version:1}}};
    }""")
    add_files(page, ['styles/teacher-workbench.css', 'styles/question-bank-admin.css', 'styles/admin-context-nav.css', 'styles/paper-management.css'], 'css')
    page.add_script_tag(content=(ROOT.parent / 'frontend/scripts/new-legacy-assets/paper-management-data-loader.js').read_text(encoding='utf-8'))
    add_files(page, [
        'src/01-runtime-config.js', 'src/28-app-storage.js', 'src/29-auth-core.js', 'src/34-role-permissions.js', 'src/37-subscription-plans.js', 'src/37-subscription-orders.js', 'src/37-subscription-redeem-codes.js', 'src/37-subscription-core.js', 'src/33-user-center.js', 'src/50-question-data.js', 'src/91-learning-content-core.js', 'src/95-recall-association-library.js',
        'src/teacher/shared/domain-core.js', 'src/teacher/question-bank/bank-list-controller.js', 'src/teacher/question-bank/question-list-controller.js', 'src/teacher/paper-management/paper-list-controller.js', 'src/teacher/paper-management/paper-question-picker.js', 'src/teacher/paper-management/paper-preview.js', 'src/teacher/paper-management/paper-audit-service.js', 'src/59c-active-learning-mode-policy.js', 'src/teacher/paper-management/paper-release-service.js', 'src/teacher/paper-management/paper-quota-service.js', 'src/teacher/question-bank-import-controller.js', 'src/teacher/paper-management/paper-import-controller.js', 'src/teacher/paper-management/paper-composition-controller.js', 'src/65-question-bank-admin.js'
    ], 'js')
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
    page.wait_for_timeout(600)

    # API-backed draft creation and ordered question references.
    page.locator('#qbAddPaperBtn').click(); page.wait_for_timeout(150)
    assert page.locator('[data-paper-candidate]').count() == 20
    page.locator('#qbSelectPaperCandidatesPage').check(); page.locator('#qbAddSelectedToPaperBtn').click(); page.wait_for_timeout(180)
    assert page.locator('[data-paper-preview-check]').count() == 20
    assert page.evaluate("window.__paperApiCalls.filter(row=>row[0]==='replaceQuestions').length") == 1
    page.evaluate("window.dispatchEvent(new CustomEvent('kg:paper-drafts-changed'))"); page.wait_for_timeout(160)
    assert page.locator('[data-paper-preview-check]').count() == 20

    # Publishing from the real browser page reaches the release API instead of failing on an unbound Node-style global.
    page.locator('#qbPublishPaperBtn').click(); page.wait_for_timeout(180)
    release_calls = page.evaluate('window.__paperReleaseCalls')
    assert len(release_calls) == 1, {'releaseCalls': release_calls, 'errors': errors, 'toast': page.locator('#qbToast').inner_text()}
    assert release_calls[0]['paperId'] == 'p-1'

    # Layout and anchored question preview remain intact.
    assert page.locator('#pmQuestionPickerPane').bounding_box()['width'] > 400
    before = int(page.locator('#pmPaneSplitter').get_attribute('aria-valuenow')); page.locator('#pmPaneSplitter').press('ArrowRight')
    assert int(page.locator('#pmPaneSplitter').get_attribute('aria-valuenow')) > before
    page.locator('[data-preview-source="preview"][data-question-preview="bank-p35::q1"]').dblclick(); page.wait_for_timeout(80)
    assert '题干 1' in page.locator('#qbQuestionPreviewContent').inner_text(); page.locator('#qbQuestionPreviewCloseBtn').click()

    # Question-bank and paper JSON use separate entry points. A 60-question Prep Studio bank retries through the catalog API.
    bank_package = {'id': 'bank-prep-60', 'name': 'PMP 60题', 'subject': 'PMP', 'version': '2.6', 'visibility': 'private', 'questions': [
        {'id': f'q-import-{index:03d}', 'title': f'Q{index:03d}', 'type': 'single_choice', 'subject': 'PMP', 'stemParts': [{'text': f'题干 {index}'}], 'options': [{'id': 'A', 'text': '正确', 'correct': True}, {'id': 'B', 'text': '错误', 'correct': False}], 'correctAnswer': 'A'}
        for index in range(1, 61)
    ]}
    second_bank_package = {'id': 'bank-prep-2', 'name': 'PMP 2题', 'subject': 'PMP', 'version': '2.6', 'visibility': 'private', 'questions': [
        {'id': f'q-second-{index:03d}', 'title': f'S{index:03d}', 'type': 'single_choice', 'subject': 'PMP', 'stemParts': [{'text': f'第二批题干 {index}'}], 'options': [{'id': 'A', 'text': '正确', 'correct': True}, {'id': 'B', 'text': '错误', 'correct': False}], 'correctAnswer': 'A'}
        for index in range(1, 3)
    ]}
    paper_for_wrong_entry = {'schema': 'kg-paper-package-v1', 'schemaVersion': 1, 'paper': {'id': 'wrong-entry-paper', 'name': '试卷', 'totalCount': 0, 'questions': []}}
    page.locator('#qbImportBankBtn').click()
    page.locator('#qbBankImportFile').set_input_files({'name': 'paper.json', 'mimeType': 'application/json', 'buffer': json.dumps(paper_for_wrong_entry, ensure_ascii=False).encode()})
    page.wait_for_timeout(80)
    assert '检测到试卷包 JSON' in page.locator('#qbBankImportResults').inner_text()
    assert page.evaluate('window.__bankImportCalls.length') == 0
    page.locator('#qbBankImportFile').set_input_files([
        {'name': 'valid.json', 'mimeType': 'application/json', 'buffer': json.dumps(bank_package, ensure_ascii=False).encode()},
        {'name': 'bad.json', 'mimeType': 'application/json', 'buffer': b'{bad'},
    ])
    page.wait_for_timeout(80)
    assert 'bad.json：JSON 解析失败' in page.locator('#qbBankImportResults').inner_text()
    assert page.locator('#qbBankImportConfirmBtn').is_disabled()
    assert page.evaluate('window.__bankImportCalls.length') == 0
    page.locator('#qbBankImportFile').set_input_files([
        {'name': 'PMP_60题_PrepStudio.json', 'mimeType': 'application/json', 'buffer': json.dumps(bank_package, ensure_ascii=False).encode()},
        {'name': 'PMP_2题_PrepStudio.json', 'mimeType': 'application/json', 'buffer': json.dumps(second_bank_package, ensure_ascii=False).encode()},
    ])
    page.wait_for_timeout(80)
    import_summary = page.locator('#qbBankImportResults').inner_text()
    assert '2 个文件' in import_summary; assert '2 个题库' in import_summary; assert '62 道题' in import_summary
    selected_files = page.locator('#qbBankImportFileName').inner_text()
    assert 'PMP_60题_PrepStudio.json' in selected_files; assert 'PMP_2题_PrepStudio.json' in selected_files
    page.locator('#qbBankImportConfirmBtn').click(); page.wait_for_timeout(100)
    assert '暂时不可用' in page.locator('#qbBankImportResults').inner_text(); assert page.locator('#qbBankImportRetryBtn').is_visible()
    page.locator('#qbBankImportRetryBtn').click(); page.wait_for_timeout(160)
    bank_calls = page.evaluate('window.__bankImportCalls')
    assert len(bank_calls) == 2; assert all(len(call['banks']) == 2 for call in bank_calls); assert len(bank_calls[-1]['banks'][0]['questions']) == 60
    assert [bank['id'] for bank in bank_calls[-1]['banks']] == ['bank-prep-60', 'bank-prep-2']
    assert bank_calls[-1]['banks'][0]['questions'][0]['id'] == 'q-import-001'; assert bank_calls[-1]['banks'][0]['questions'][-1]['id'] == 'q-import-060'
    assert page.locator('#qbBankImportDialog').get_attribute('open') is None, {
        'results': page.locator('#qbBankImportResults').inner_text(),
        'errors': errors,
        'calls': bank_calls,
    }

    # Import preflight shows mismatch warning/conflict strategy and submits once.
    package = {'schema': 'kg-paper-package-v1', 'schemaVersion': 1, 'paper': {'id': 'paper-import-1', 'name': 'PMP 模拟卷 04', 'subject': 'PMP', 'totalCount': 2, 'questions': [{'bankId': 'bank-p35', 'questionId': 'q1', 'order': 1}, {'bankId': 'bank-p35', 'questionId': 'q2', 'order': 2}]}}
    page.locator('#qbImportPaperBtn').click()
    page.locator('#qbPaperImportFile').set_input_files({'name': 'PMP_60题_PrepStudio.json', 'mimeType': 'application/json', 'buffer': json.dumps(bank_package, ensure_ascii=False).encode()})
    page.wait_for_timeout(80)
    assert '检测到题库 JSON' in page.locator('#qbPaperImportResults').inner_text()
    assert page.evaluate("window.__paperApiCalls.filter(row=>row[0]==='importPreflight').length") == 0
    page.locator('#qbPaperImportFile').set_input_files({'name': 'PMP 模拟卷 05.json', 'mimeType': 'application/json', 'buffer': json.dumps(package, ensure_ascii=False).encode()})
    page.wait_for_timeout(150)
    assert '暂时不可用' in page.locator('#qbPaperImportResults').inner_text(); assert page.locator('#qbPaperImportRetryBtn').is_visible()
    page.locator('#qbPaperImportRetryBtn').click(); page.wait_for_timeout(150)
    assert '以包内名称为准' in page.locator('#qbPaperImportResults').inner_text()
    assert page.locator('#qbPaperImportConflictAction option[value="create"]').get_attribute('disabled') is not None
    page.locator('#qbPaperImportConflictAction').select_option('copy'); page.evaluate("()=>{const button=document.getElementById('qbPaperImportConfirmBtn');button.click();button.click()}"); page.wait_for_timeout(220)
    assert page.evaluate("window.__paperApiCalls.filter(row=>row[0]==='importPaper').length") == 1
    assert page.locator('#qbPaperImportDialog').get_attribute('open') is None

    # Custom A/B/C counts, shortage decision and feasible-subset batch creation.
    page.locator('#qbComposePapersBtn').click(); page.locator('input[name="paperCompositionMode"][value="custom"]').check()
    page.locator('#qbPaperVariantACount').fill('60'); page.locator('#qbPaperVariantBCount').fill('50'); page.locator('#qbPaperVariantCCount').fill('40')
    page.locator('#qbPaperCompositionPreflightBtn').click(); page.wait_for_timeout(160)
    assert '不可生成' in page.locator('#qbPaperCompositionResults').inner_text(); assert page.locator('#qbPaperCompositionFeasibleBtn').is_visible()
    page.locator('#qbPaperCompositionFeasibleBtn').click(); page.wait_for_timeout(160)
    assert '全部可行' in page.locator('#qbPaperCompositionResults').inner_text()
    page.evaluate("()=>{const button=document.getElementById('qbPaperCompositionConfirmBtn');button.click();button.click()}"); page.wait_for_timeout(240)
    batches = page.evaluate("window.__paperApiCalls.filter(row=>row[0]==='createCompositionBatch')")
    assert len(batches) == 1; assert [item['totalCount'] for item in batches[0][1]['variants']] == [60, 50]
    assert page.locator('#qbPaperCompositionDialog').get_attribute('open') is None

    # Category mutation also uses API; no draft/category business key is written.
    page.evaluate("window.__prompts=['API 分类']"); page.locator('#qbAddPaperCategoryBtn').click(); page.wait_for_timeout(120)
    assert page.locator('.pm-paper-category-row').filter(has_text='API 分类').count() == 1
    forbidden = page.evaluate("window.__storageWrites.filter(key=>key.startsWith('kg_exam_papers_v1__')||key.startsWith('kg_exam_paper_categories_v1__')||key.startsWith('kg_question_banks_v1__'))")
    assert forbidden == []
    assert not errors, errors

    # Student/viewer permission denial happens before any draft API read or write.
    denied = browser.new_page(viewport={'width': 1000, 'height': 700})
    denied.set_content(f'<!doctype html><html><head><base href="http://localhost/"></head><body{attrs}>{body}</body></html>')
    denied.evaluate("""()=>{window.__deniedApiReads=0;window.KGAuthCore={currentUser:()=>({username:'student',role:'student'})};window.KGRolePermissions={applyTheme(){},decoratePermissionElements(){},can:()=>false,renderPermissionDenied(root,message){root.innerHTML=`<div id="paperPermissionDenied">${message}</div>`}};window.KGQuestionCatalogAdapter={ready:Promise.resolve(),snapshot:()=>({banks:[],questions:[]})};window.KGPaperDraftApi={ready:async()=>{window.__deniedApiReads+=1;return {papers:[],categories:[]}}};}""")
    add_files(denied, ['src/65-question-bank-admin.js'], 'js')
    denied.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))"); denied.wait_for_timeout(80)
    assert '仅限管理员' in denied.locator('#paperPermissionDenied').inner_text()
    assert denied.evaluate('window.__deniedApiReads') == 0
    denied.close()
    browser.close()

print('v90-p35-paper-management-browser-ok')
