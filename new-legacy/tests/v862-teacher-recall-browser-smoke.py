from pathlib import Path
import re, json
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
ARGS=['--no-sandbox','--disable-dev-shm-usage','--in-process-gpu','--disable-gpu-sandbox','--use-gl=swiftshader','--disable-crash-reporter','--disable-breakpad','--noerrdialogs']
def text(path): return (ROOT/path).read_text()
def body_html(path):
    source=text(path);match=re.search(r'<body[^>]*>([\s\S]*)</body>',source,re.I)
    return re.sub(r'<script[\s\S]*?</script>','',match.group(1),flags=re.I)
def install_storage(page,role='student'):
    page.evaluate("""role=>{const local=new Map(),session=new Map();Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>local.has(k)?local.get(k):null,setItem:(k,v)=>local.set(k,String(v)),removeItem:k=>local.delete(k),clear:()=>local.clear()}});Object.defineProperty(window,'sessionStorage',{configurable:true,value:{getItem:k=>session.has(k)?session.get(k):null,setItem:(k,v)=>session.set(k,String(v)),removeItem:k=>session.delete(k),clear:()=>session.clear()}});const username='browser-test';localStorage.setItem('kg_local_current_user_v1',username);localStorage.setItem('kg_local_users_v1',JSON.stringify({[username]:{username,displayName:'测试用户',role,status:'active',subject:'PMP',salt:'x',hash:'x'}}));window.confirm=()=>true;window.alert=()=>{};window.open=()=>({});}""",role)
def add_scripts(page,paths):
    for path in paths: page.add_script_tag(content=text(path))

def test_learning_entries(browser):
    page=browser.new_page(viewport={'width':1440,'height':900});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content('''<body><div id="status"></div><button id="glStageSwitch"><small id="glStageIndex"></small><strong id="glStageTitle"></strong><span id="glStageDescription"></span></button><input id="glDefaultMode" type="checkbox"><div id="glPathParts"></div><button id="glCurrentNodeBtn"><span></span></button><button id="glResetBtn"></button><div id="glStagePicker"><button id="glStagePickerClose"></button><div id="glStageList"></div></div><div id="glPlacementChoice"><button id="glPlacementClose"></button><h3 id="glPlacementPartTitle"></h3><p id="glPlacementPartDescription"></p><div id="glPlacementRequirements"></div><p id="glPlacementHistory"></p><button id="glPlacementNormalBtn"></button><button id="glPlacementTestBtn"></button></div></body>''')
    install_storage(page);page.add_style_tag(content=text('styles/guided-learning-path.css'))
    add_scripts(page,['src/86-activity-schema-v1.js','src/87-guided-learning-data.js','src/88-guided-learning-store.js','src/89-guided-learning-icon-registry.js','src/94-practice-navigation.js','src/89-guided-learning-app.js'])
    page.evaluate('KGGuidedLearningApp.init()');page.wait_for_timeout(120)
    assert page.locator('.gl-practice-entry').count()==6 # 当前阶段 3 部分，每部分 2 个
    hrefs=page.locator('.gl-practice-entry').evaluate_all('(els)=>els.map(el=>el.getAttribute("href"))')
    assert all(href in ('knowledge-recall.html','question-workspace.html') for href in hrefs)
    assert page.locator('.gl-practice-entry.is-deep_recall').count()==3
    assert page.locator('.gl-practice-entry.is-multi_question_canvas').count()==3
    overlaps=page.evaluate("""()=>{const result=[];document.querySelectorAll('.gl-part').forEach(part=>{const cards=[...part.querySelectorAll('.gl-practice-entry')].map(el=>({el,r:el.getBoundingClientRect()}));const nodes=[...part.querySelectorAll('.gl-path-node')].map(el=>({el,r:el.getBoundingClientRect()}));cards.forEach(card=>nodes.forEach(node=>{const a=card.r,b=node.r;if(a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top)result.push([card.el.dataset.glPracticeEntry,node.el.dataset.nodeWrap])}))});return result}""")
    assert not overlaps,overlaps
    for width,height in [(1366,768),(1440,900),(1920,1080)]:
        for zoom in [1,1.25,1.5]:
            page.set_viewport_size({'width':width,'height':height});page.evaluate('(z)=>document.documentElement.style.zoom=String(z)',zoom);page.wait_for_timeout(25)
            result=page.evaluate("""()=>{const overlaps=[];document.querySelectorAll('.gl-part').forEach(part=>{const cards=[...part.querySelectorAll('.gl-practice-entry')].map(el=>({el,r:el.getBoundingClientRect()}));const nodes=[...part.querySelectorAll('.gl-path-node')].map(el=>({el,r:el.getBoundingClientRect()}));cards.forEach(card=>nodes.forEach(node=>{const a=card.r,b=node.r;if(a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top)overlaps.push([card.el.dataset.glPracticeEntry,node.el.dataset.nodeWrap])}))});return {overlaps,bodyOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth}}""")
            assert not result['overlaps'],(width,height,zoom,result['overlaps'])
            assert result['bodyOverflow']<=2,(width,height,zoom,result['bodyOverflow'])
    assert not errors,errors;page.close()

def test_teacher_quick_config(browser):
    page=browser.new_page(viewport={'width':1440,'height':1000});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content('<body>'+body_html('question-bank.html')+'</body>');install_storage(page,'teacher');page.add_style_tag(content=text('styles/question-bank-admin.css'))
    add_scripts(page,['src/28-app-storage.js','src/29-auth-core.js','src/34-role-permissions.js','src/50-question-data.js','src/95-recall-association-library.js','src/98-teacher-workflow-p2-services.js','src/65-question-bank-admin.js'])
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))");page.wait_for_timeout(220)
    page.locator('[data-layout-nav="base"]').dispatch_event('click');page.wait_for_timeout(30)
    page.locator('#questionStemInput').fill('项目经理发现一位关键干系人对项目目标存在误解。')
    page.locator('#qbSaveQuestionBtn').dispatch_event('click');page.wait_for_timeout(60)
    page.locator('[data-layout-nav="recall"]').dispatch_event('click');page.wait_for_timeout(40)
    assert page.locator('#qbRecallAnnotationPanel').is_visible()
    page.locator('#qbRecallKeywordsInput').fill('关键干系人\n项目章程')
    page.locator('#qbRecallBindingsInput').fill('关键干系人 -> 关键干系人\n项目章程 -> 项目章程')
    page.locator('#qbRecallLibraryText').fill('关键干系人 -> 项目章程 | 识别干系人 | 开工大会 | 干系人参与计划 | 沟通管理计划')
    page.locator('#qbSaveRecallLibraryBtn').dispatch_event('click');page.wait_for_timeout(60)
    assert '已保存' in page.locator('#qbRecallLibraryReport').inner_text()
    page.locator('#qbSyncRecallConfigBtn').dispatch_event('click');page.wait_for_timeout(80)
    status=page.locator('#qbRecallConfigStatus').inner_text()
    assert '关键干系人' in status and '题干 1 处' in status
    assert '项目章程' not in status or '未在题干' not in status # 未找到词不会写入配置
    page.evaluate("""()=>{document.getElementById('bankVisibility').value='published';document.getElementById('qbSaveBankBtn').click()}""");page.wait_for_timeout(80)
    published=page.evaluate("""()=>JSON.parse(localStorage.getItem('kg_question_banks_published_v1')||'[]')""")
    assert published and published[0]['visibility']=='published' and published[0]['questions']
    assert not errors,errors;page.close()

def test_deep_recall(browser):
    page=browser.new_page(viewport={'width':1440,'height':900});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content('<body class="knowledge-recall-page">'+body_html('knowledge-recall.html')+'</body>');install_storage(page,'student');page.add_style_tag(content=text('styles/knowledge-recall.css'))
    question={'id':'q1','title':'关键干系人题','subject':'PMP','stemParts':[{'text':'项目经理发现一位关键干系人对项目目标存在误解。'}],'options':[{'id':'A','text':'立即升级'},{'id':'B','text':'评估参与程度'}],'clues':[{'id':'clue-key','text':'关键干系人','recallNodeId':'关键干系人'}],'concepts':[]}
    release=[{'id':'release-test','releaseId':'release-test','paperId':'paper-test','version':1,'name':'PMP测试试卷','subject':'PMP','enabledModes':['deep_recall'],'questions':[{'bankId':'bank-test','questionId':'q1','order':1}],'questionSnapshots':[{'bankId':'bank-test','bankName':'PMP测试题库','questionId':'q1','question':question}]}]
    page.evaluate("""data=>{localStorage.setItem('kg_exam_papers_published_v1',JSON.stringify(data.release));sessionStorage.setItem('kg_guided_practice_return_v1',JSON.stringify({source:'guided-learning',returnUrl:'learning-path.html?stage=method&part=environment',savedAt:Date.now()}));}""",{'release':release})
    add_scripts(page,['src/28-app-storage.js','src/29-auth-core.js','src/34-role-permissions.js','src/50-question-data.js','src/86-free-mode-language.js','src/86-question-language-ui.js','src/85-knowledge-recall-data.js','src/94-practice-navigation.js','src/95-recall-association-library.js','src/97-recall-storage.js','src/59-published-paper-repository.js','src/96-recall-question-source.js'])
    page.evaluate("""()=>KGRecallAssociationLibrary.saveText('PMP','关键干系人 -> 项目章程 | 识别干系人 | 开工大会 | 干系人参与计划 | 沟通管理计划',{mode:'replace'})""")
    page.add_script_tag(content=text('src/98-recall-graph-model.js'));page.add_script_tag(content=text('src/86-knowledge-recall.js'));page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))");page.wait_for_timeout(180)
    assert not page.locator('[data-practice-only]').is_hidden()
    assert page.locator('.kr-keyword').count()>=1
    page.locator('.kr-keyword').first.dispatch_event('click');page.wait_for_timeout(80)
    assert page.locator('.kr-node').count()==1
    assert '知识点' in page.locator('#krSessionStats').inner_text()
    page.locator('.kr-node button').first.dispatch_event('click');page.wait_for_timeout(340)
    assert page.locator('[data-choice-index]').count()==4
    assert page.locator('#krMoreChoicesBtn').count()==1
    page.locator('#krQuestionListBtn').dispatch_event('click');page.wait_for_timeout(50)
    assert page.locator('.kr-question-drawer.open').count()==1 and page.locator('.kr-question-item').count()==1
    assert not errors,errors;page.close()

def test_practice_back(browser):
    page=browser.new_page();page.set_content('<body><a data-practice-back href="question-training.html">返回</a><span data-practice-only hidden>自由练习 · 不计成绩</span></body>');install_storage(page)
    page.evaluate("sessionStorage.setItem('kg_guided_practice_return_v1',JSON.stringify({source:'guided-learning',returnUrl:'learning-path.html?stage=method&part=environment',savedAt:Date.now()}))")
    page.add_script_tag(content=text('src/94-practice-navigation.js'));page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
    assert not page.locator('[data-practice-only]').is_hidden();page.close()

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=ARGS)
    test_learning_entries(browser);test_teacher_quick_config(browser);test_deep_recall(browser);test_practice_back(browser);browser.close()
print('v862-teacher-recall-browser-smoke-ok')
