#!/usr/bin/env python3
from pathlib import Path
import json,re
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
ARGS=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']


def release(release_id,version,title):
    return {
        'id':release_id,'releaseId':release_id,'paperId':'paper-p416','version':version,
        'name':'P4.1.6 发布卷','title':'P4.1.6 发布卷','subject':'PMP','status':'published','publishedAt':version*1000,
        'enabledModes':['deep_recall','multi_question_canvas','single_deep_study'],'totalCount':2,
        'questions':[{'bankId':'bank-p416','questionId':'q-shared','order':1},{'bankId':'bank-p416','questionId':'q-second','order':2}],
        'questionSnapshots':[
            {'bankId':'bank-p416','bankName':'冻结题库','bankSubject':'PMP','questionId':'q-shared','question':{
                'id':'q-shared','title':title,'type':'single_choice','subject':'PMP','stemParts':[{'text':title+'题干'}],
                'options':[{'id':'A','text':'选项 A','correct':True},{'id':'B','text':'选项 B'}],
                'clues':[{'id':'clue-1','text':'冻结','recallNodeId':'冻结'}],'concepts':[]
            }},
            {'bankId':'bank-p416','bankName':'冻结题库','bankSubject':'PMP','questionId':'q-second','question':{
                'id':'q-second','title':title+' 第二题','type':'single_choice','subject':'PMP','stemParts':[{'text':'第二题'}],
                'options':[{'id':'A','text':'选项 A','correct':True}],'clues':[],'concepts':[]
            }}
        ]
    }

CURRENT=release('release-v2',2,'新版冻结题目')
HISTORICAL=release('release-v1',1,'旧版冻结题目')


def page_parts(file):
    source=(ROOT/file).read_text(encoding='utf-8')
    match=re.search(r'<body([^>]*)>([\s\S]*)</body>',source,re.I)
    attrs=match.group(1)
    body=re.sub(r'<script[\s\S]*?</script>','',match.group(2),flags=re.I)
    scripts=re.findall(r'<script[^>]+src="([^"]+)"',source,re.I)
    return attrs,body,scripts


def install_storage(page,selection='current'):
    page.evaluate("""({current,historical,selection})=>{
      const local=new Map(),session=new Map();
      Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>local.has(String(k))?local.get(String(k)):null,setItem:(k,v)=>local.set(String(k),String(v)),removeItem:k=>local.delete(String(k)),clear:()=>local.clear(),key:i=>[...local.keys()][i]||null,get length(){return local.size}}});
      Object.defineProperty(window,'sessionStorage',{configurable:true,value:{getItem:k=>session.has(String(k))?session.get(String(k)):null,setItem:(k,v)=>session.set(String(k),String(v)),removeItem:k=>session.delete(String(k)),clear:()=>session.clear(),key:i=>[...session.keys()][i]||null,get length(){return session.size}}});
      const username='p416-user';
      localStorage.setItem('kg_local_current_user_v1',username);
      localStorage.setItem('kg_local_users_v1',JSON.stringify({[username]:{username,displayName:'P4.1.6 用户',role:'student',status:'active',subject:'PMP',salt:'x',hash:'x'}}));
      localStorage.setItem('kg_exam_papers_published_v1',JSON.stringify([current]));
      localStorage.setItem('kg_exam_paper_release_history_v1',JSON.stringify([historical]));
      if(selection==='historical'){
        localStorage.setItem('kg_exam_current_v1__user__'+username,JSON.stringify({paperId:historical.paperId,releaseId:historical.releaseId,index:0}));
        localStorage.setItem('kg_deep_recall_current_question_v1',JSON.stringify({
          question:historical.questionSnapshots[0].question,sourcePaperId:historical.paperId,sourceReleaseId:historical.releaseId,
          sourceBankId:'bank-p416',sourceQuestionId:'q-shared',sourceCollectionId:'paper-release:'+historical.releaseId,userId:username
        }));
      }
      window.alert=()=>{};window.confirm=()=>true;window.open=()=>null;
    }""",{'current':CURRENT,'historical':HISTORICAL,'selection':selection})


def load_full_page(page,file,selection='current'):
    attrs,body,scripts=page_parts(file)
    page.set_content(f'<!doctype html><html><head><base href="http://localhost/"></head><body{attrs}>{body}</body></html>')
    install_storage(page,selection)
    for script in scripts:
        page.add_script_tag(content=(ROOT/script).read_text(encoding='utf-8'))
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
    page.wait_for_timeout(700)

with sync_playwright() as p:
    launch_options={'headless':True,'args':ARGS}
    if Path('/usr/bin/chromium').exists():
        launch_options['executable_path']='/usr/bin/chromium'
    browser=p.chromium.launch(**launch_options)

    # 单题深学恢复历史 release，并在当前目录变化后保持冻结题目不变。
    page=browser.new_page(viewport={'width':1366,'height':820});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    load_full_page(page,'question-training.html','historical')
    body=page.locator('body').inner_text()
    assert '旧版冻结题目' in body and '新版冻结题目题干' not in body,body[:1200]
    assert page.locator('#qtPublishedPaperSelect').input_value()=='release-v1'
    page.evaluate("""current=>{localStorage.setItem('kg_exam_papers_published_v1',JSON.stringify([current]));window.dispatchEvent(new CustomEvent('kg:published-papers-changed'));}""",release('release-v3',3,'教师新发布题目'))
    page.wait_for_timeout(180)
    assert '旧版冻结题目' in page.locator('body').inner_text()
    assert not errors,errors
    page.close()

    # 新会话默认进入当前 release。
    page=browser.new_page(viewport={'width':1366,'height':820});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    load_full_page(page,'question-training.html','current')
    assert '新版冻结题目' in page.locator('body').inner_text()
    assert page.locator('#qtPublishedPaperSelect').input_value()=='release-v2'
    assert not errors,errors
    page.close()

    # 深度回忆恢复历史冻结快照。
    page=browser.new_page(viewport={'width':1366,'height':820});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    load_full_page(page,'knowledge-recall.html','historical')
    assert '旧版冻结题目' in page.locator('#krQuestionCard').inner_text()
    active=page.evaluate("KGLearningSession.active('deep_recall')")
    assert active and active['releaseId']=='release-v1',active
    assert not errors,errors
    page.close()

    # 多题画布恢复历史 release，随后切换当前 release，旧题目列表和瞬时状态被清理。
    page=browser.new_page(viewport={'width':1366,'height':820});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    load_full_page(page,'question-workspace.html','historical')
    assert page.locator('#qwPaperSelect').input_value()=='release-v1'
    page.locator('#qwQuestionDockBtn').click();page.wait_for_timeout(120)
    assert '旧版冻结题目' in page.locator('#qwQuestionDrawer').inner_text()
    page.locator('#qwPaperSelect').select_option('release-v2');page.wait_for_timeout(250)
    page.locator('#qwQuestionDockBtn').click();page.wait_for_timeout(100)
    drawer=page.locator('#qwQuestionDrawer').inner_text()
    assert '新版冻结题目' in drawer and '旧版冻结题目' not in drawer,drawer
    state=page.evaluate('KGMultiQuestionWorkspace.getState()')
    assert state['paperId']=='paper-p416' and state['releaseId']=='release-v2',state
    assert not errors,errors
    page.close()

    browser.close()

print('v90-p416-learning-pages-browser-ok')
