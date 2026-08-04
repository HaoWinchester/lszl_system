#!/usr/bin/env python3
from pathlib import Path
import json,re
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
ARGS=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']

RELEASES=[{
    'id':'release-p403','releaseId':'release-p403','paperId':'paper-p403','version':2,
    'name':'PMP 正式发布卷','title':'PMP 正式发布卷','subject':'PMP','status':'published',
    'enabledModes':['deep_recall','multi_question_canvas','single_deep_study'],'totalCount':3,
    'questions':[
        {'bankId':'bank-p403','questionId':'q1','order':1},
        {'bankId':'bank-p403','questionId':'q2','order':2},
        {'bankId':'bank-p403','questionId':'missing','order':3}
    ],
    'questionSnapshots':[
        {'bankId':'bank-p403','bankName':'冻结题库','bankSubject':'PMP','questionId':'q1','question':{
            'id':'q1','title':'冻结题目一','type':'single_choice','subject':'PMP','stemParts':[{'text':'冻结题干一'}],
            'options':[{'id':'A','text':'选项 A','correct':True},{'id':'B','text':'选项 B'}],
            'clues':[{'id':'clue-1','text':'冻结','recallNodeId':'冻结'}], 'concepts':[]
        }},
        {'bankId':'bank-p403','bankName':'冻结题库','bankSubject':'PMP','questionId':'q2','question':{
            'id':'q2','title':'冻结题目二','type':'single_choice','subject':'PMP','stemParts':[{'text':'冻结题干二'}],
            'options':[{'id':'A','text':'选项 A','correct':True},{'id':'B','text':'选项 B'}],
            'clues':[], 'concepts':[]
        }}
    ]
}]

def page_parts(file):
    source=(ROOT/file).read_text(encoding='utf-8')
    match=re.search(r'<body([^>]*)>([\s\S]*)</body>',source,re.I)
    attrs=match.group(1)
    body=re.sub(r'<script[\s\S]*?</script>','',match.group(2),flags=re.I)
    scripts=re.findall(r'<script[^>]+src="([^"]+)"',source,re.I)
    return attrs,body,scripts

def install_storage(page,role='student'):
    page.evaluate("""({releases,role})=>{
      const local=new Map(),session=new Map();
      Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>local.has(String(k))?local.get(String(k)):null,setItem:(k,v)=>local.set(String(k),String(v)),removeItem:k=>local.delete(String(k)),clear:()=>local.clear(),key:i=>[...local.keys()][i]||null,get length(){return local.size}}});
      Object.defineProperty(window,'sessionStorage',{configurable:true,value:{getItem:k=>session.has(String(k))?session.get(String(k)):null,setItem:(k,v)=>session.set(String(k),String(v)),removeItem:k=>session.delete(String(k)),clear:()=>session.clear(),key:i=>[...session.keys()][i]||null,get length(){return session.size}}});
      const username='p403-user';
      localStorage.setItem('kg_local_current_user_v1',username);
      localStorage.setItem('kg_local_users_v1',JSON.stringify({[username]:{username,displayName:'P4.0.3 用户',role,status:'active',subject:'PMP',salt:'x',hash:'x'}}));
      localStorage.setItem('kg_exam_papers_published_v1',JSON.stringify(releases));
      localStorage.setItem('kg_question_banks_v1__user__'+username,JSON.stringify([{id:'private-bank',name:'私人题库',questions:[{id:'private-q',title:'私人题目不应显示'}]}]));
      localStorage.setItem('kg_question_banks_published_v1',JSON.stringify([{id:'public-bank',name:'公共题库',questions:[{id:'public-q',title:'公共题目不应显示'}]}]));
      window.alert=()=>{};window.confirm=()=>true;window.open=url=>{window.__openedUrl=String(url);return null};
    }""",{'releases':RELEASES,'role':role})

def load_full_page(page,file,role='student'):
    attrs,body,scripts=page_parts(file)
    page.set_content(f'<!doctype html><html><head><base href="http://localhost/"></head><body{attrs}>{body}</body></html>')
    install_storage(page,role)
    for script in scripts:
        page.add_script_tag(content=(ROOT/script).read_text(encoding='utf-8'))
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
    page.wait_for_timeout(650)

def assert_no_private_or_demo(text):
    assert '私人题目不应显示' not in text,text
    assert '公共题目不应显示' not in text,text
    assert 'PMP 示例' not in text,text

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=ARGS)

    # 深度回忆：返回图谱首页，只显示发布试卷冻结题目。
    page=browser.new_page(viewport={'width':1366,'height':820});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    load_full_page(page,'knowledge-recall.html','student')
    assert page.locator('#krBackBtn').get_attribute('href')=='index.html'
    assert '冻结题目一' in page.locator('#krQuestionCard').inner_text()
    page.locator('#krQuestionListBtn').click();page.wait_for_timeout(100)
    options=page.locator('#krBankSelect option').all_inner_texts()
    assert options==['PMP 正式发布卷 · v2（可用 2/3 题）'],options
    assert page.locator('#krQuestionList .kr-question-item').count()==2
    drawer_text=page.locator('#krQuestionDrawer').inner_text()
    assert '冻结题目一' in drawer_text and '冻结题目二' in drawer_text
    assert '快照不可用' in page.locator('#krQuestionDrawerMeta').inner_text()
    assert_no_private_or_demo(drawer_text)
    assert not errors,errors
    page.close()

    # 多题画布：同一发布版本、可用/配置数量一致，并把 releaseId 写入题目卡引用。
    page=browser.new_page(viewport={'width':1366,'height':820});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    load_full_page(page,'question-workspace.html','student')
    options=page.locator('#qwPaperSelect option').all_inner_texts()
    assert options==['PMP 正式发布卷 · v2（可用 2/3 题）'],options
    page.locator('#qwQuestionDockBtn').click();page.wait_for_timeout(100)
    assert page.locator('#qwQuestionList .qw-question-item').count()==2
    drawer_text=page.locator('#qwQuestionDrawer').inner_text()
    assert_no_private_or_demo(drawer_text)
    page.locator('#qwQuestionList [data-add-index="0"]').click();page.wait_for_timeout(180)
    node=page.evaluate("KGMultiQuestionWorkspace.preferredQuestionNodeForSingleDeep()")
    assert node and node['questionId']=='q1' and node['paperId']=='paper-p403' and node.get('releaseId')=='release-p403',node
    assert not errors,errors
    page.close()

    # 单题深学：不再跳转做题模式，题库选择和题目正文来自同一冻结版本。
    page=browser.new_page(viewport={'width':1366,'height':820});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    load_full_page(page,'question-training.html','student')
    options=page.locator('#qtPublishedPaperSelect option').all_inner_texts()
    assert options==['PMP 正式发布卷 · v2（可用 2/3 题）'],options
    body_text=page.locator('body').inner_text()
    assert '冻结题目一' in body_text and '冻结题干一' in body_text
    assert_no_private_or_demo(body_text)
    assert 'practice-mode.html' not in page.url
    assert not errors,errors
    page.close()

    # 图谱画布缩放和移动开始时关闭临时工具菜单。
    page=browser.new_page(viewport={'width':1366,'height':820});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    load_full_page(page,'index.html','admin')
    page.locator('#sizeMenuBtn').click();page.wait_for_timeout(40)
    assert page.locator('#sizeMenuBtnShell').evaluate("el=>el.classList.contains('menu-open')")
    page.locator('#stage').dispatch_event('wheel',{'deltaY':-100,'clientX':1000,'clientY':700});page.wait_for_timeout(40)
    assert not page.locator('#sizeMenuBtnShell').evaluate("el=>el.classList.contains('menu-open')")
    page.locator('#lineStyleMenuBtn').click();page.wait_for_timeout(40)
    assert page.locator('#lineStyleMenuBtnShell').evaluate("el=>el.classList.contains('menu-open')")
    page.locator('#stage').dispatch_event('pointerdown',{'button':0,'buttons':1,'clientX':1100,'clientY':720,'pointerId':9,'pointerType':'mouse'});page.wait_for_timeout(40)
    assert not page.locator('#lineStyleMenuBtnShell').evaluate("el=>el.classList.contains('menu-open')")
    assert not errors,errors
    page.close()

    browser.close()
print('v90-p403-published-paper-learning-pages-browser-ok')
