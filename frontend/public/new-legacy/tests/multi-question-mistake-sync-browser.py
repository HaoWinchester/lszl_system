#!/usr/bin/env python3

from pathlib import Path
import re
import shutil
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']


def text(path):
    return (ROOT / path).read_text(encoding='utf-8')


def page_parts(path):
    source = text(path)
    match = re.search(r'<body([^>]*)>([\s\S]*)</body>', source, re.I)
    body = re.sub(r'<script[\s\S]*?</script>', '', match.group(2), flags=re.I)
    scripts = re.findall(r'<script[^>]+src="([^"]+)"', source, re.I)
    styles = re.findall(r'<link[^>]+href="([^"]+\.css)"', source, re.I)
    return match.group(1), body, scripts, styles


def install_storage_and_apis(page):
    page.evaluate("""()=>{
      const local=new Map(),session=new Map();
      const storage=map=>({
        getItem:key=>map.has(String(key))?map.get(String(key)):null,
        setItem:(key,value)=>map.set(String(key),String(value)),
        removeItem:key=>map.delete(String(key)),clear:()=>map.clear(),
        key:index=>[...map.keys()][index]||null,get length(){return map.size}
      });
      Object.defineProperty(window,'localStorage',{configurable:true,value:storage(local)});
      Object.defineProperty(window,'sessionStorage',{configurable:true,value:storage(session)});
      const username='mistake-sync-user';
      localStorage.setItem('kg_local_current_user_v1',username);
      localStorage.setItem('kg_local_users_v1',JSON.stringify({
        [username]:{username,displayName:'错题同步测试',role:'teacher',status:'active',subject:'PMP',salt:'x',hash:'x'}
      }));
      const question={
        id:'q-sync-1',title:'服务端判题测试',difficulty:'easy',
        stemParts:[{text:'请选择服务端认定的正确选项。'}],
        options:[{id:'A',text:'正确答案',correct:true},{id:'B',text:'错误答案'}],
        correctAnswer:'A',answer:'A',analysis:'测试解析'
      };
      const bank={id:'bank-sync',name:'同步题库',subject:'PMP',questions:[question]};
      const release={
        id:'release-sync',releaseId:'release-sync',paperId:'paper-sync',version:3,name:'同步测试卷',title:'同步测试卷',
        subject:'PMP',status:'published',publishedAt:1,enabledModes:['multi_question_canvas'],totalCount:1,
        questions:[{bankId:'bank-sync',questionId:'q-sync-1',order:1}],
        questionSnapshots:[{bankId:'bank-sync',bankName:'同步题库',bankSubject:'PMP',questionId:'q-sync-1',question}]
      };
      localStorage.setItem('kg_question_banks_v1__user__'+username,JSON.stringify([bank]));
      localStorage.setItem('kg_exam_papers_published_v1',JSON.stringify([release]));
      window.alert=()=>{};window.confirm=()=>true;window.open=()=>null;
      window.KGQuestionCatalogAdapter={ready:Promise.resolve()};
      window._answerCalls=[];window._answerMode='pending';window._answerResolve=null;
      window.KGPracticeLearningApi={
        refresh:async()=>({mistakes:[],stats:{active:0,mastered:0}}),
        snapshot:()=>({mistakes:[],stats:{active:0,mastered:0}}),
        answer(input){
          window._answerCalls.push(JSON.parse(JSON.stringify(input)));
          if(window._answerMode==='fail')return Promise.reject(new Error('模拟网络错误'));
          if(window._answerMode==='correct')return Promise.resolve({correct:true,mistake:{status:'mastered'}});
          if(window._answerMode==='wrong')return Promise.resolve({correct:false,mistake:{status:'pending'}});
          return new Promise(resolve=>{window._answerResolve=resolve});
        }
      };
      window.KGPersonalSynthesisCardApi={refresh:async()=>({active:[],archived:[]}),snapshot:()=>({active:[],archived:[]})};
    }""")


def load_workspace(page):
    attrs, body, scripts, styles = page_parts('question-workspace.html')
    page.set_content(f'<!doctype html><html><head><base href="http://localhost/"></head><body{attrs}>{body}</body></html>')
    install_storage_and_apis(page)
    for style in styles:
        target = ROOT / style
        if target.exists():
            page.add_style_tag(content=target.read_text(encoding='utf-8'))
    delayed = []
    for script in scripts:
        target = ROOT / script
        if not target.exists():
            continue
        if script.endswith('77-multi-question-workspace.js') or script.endswith('108-multi-question-learning-assets.js'):
            delayed.append(target)
        else:
            page.add_script_tag(content=target.read_text(encoding='utf-8'))
    for target in delayed:
        page.add_script_tag(content=target.read_text(encoding='utf-8'))
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
    page.wait_for_timeout(650)


with sync_playwright() as p:
    candidates = [shutil.which('chromium'), shutil.which('google-chrome'), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', p.chromium.executable_path]
    executable = next((item for item in candidates if item and Path(item).exists()), None)
    browser = p.chromium.launch(headless=True, executable_path=executable, args=ARGS)
    page = browser.new_page(viewport={'width': 1440, 'height': 900})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    load_workspace(page)

    question = {
        'id': 'q-sync-1', 'title': '服务端判题测试', 'difficulty': 'easy',
        'stemParts': [{'text': '请选择服务端认定的正确选项。'}],
        'options': [{'id': 'A', 'text': '正确答案', 'correct': True}, {'id': 'B', 'text': '错误答案'}],
        'correctAnswer': 'A', 'answer': 'A', 'analysis': '测试解析'
    }
    page.evaluate("""question=>KGMultiQuestionWorkspace.addQuestionItem({
      question,bank:{id:'bank-sync'},paper:{id:'paper-sync',releaseId:'release-sync',name:'同步测试卷',version:3}
    },{x:300,y:180,width:430,height:420})""", question)
    page.wait_for_timeout(120)
    card = page.locator('[data-node-id]').filter(has=page.locator('[data-qw-option-key="A"]')).first
    option_b = card.locator('[data-qw-option-key="B"]')

    # Two rapid clicks are one user action after debounce and create one pending request.
    option_b.click(); option_b.click(); page.wait_for_timeout(290)
    assert page.evaluate('window._answerCalls.length') == 1
    assert card.locator('[data-qw-option-key]:disabled').count() == 2
    payload = page.evaluate('window._answerCalls[0]')
    assert payload['questionId'] == 'q-sync-1' and payload['bankId'] == 'bank-sync'
    assert payload['paperId'] == 'paper-sync' and payload['releaseId'] == 'release-sync'
    assert payload['selectedAnswer'] == 'B' and 'correct' not in payload
    page.evaluate("window._answerResolve({correct:false,mistake:{status:'pending'}})")
    page.wait_for_timeout(80)
    assert card.locator('[data-qw-option-key="B"]').evaluate("el=>el.classList.contains('is-wrong-flash')")

    # A failed answer retains selection and retries the exact same stable payload.
    page.evaluate("window._answerMode='fail'")
    card.locator('[data-qw-option-key="A"]').click(); page.wait_for_timeout(310)
    error_row = card.locator('[data-qw-option-sync-error]')
    assert error_row.is_visible() and '作答尚未保存' in error_row.inner_text()
    assert card.locator('[data-qw-option-key="A"]').evaluate("el=>el.classList.contains('is-answer-selected')")
    failed_payload = page.evaluate('window._answerCalls[1]')
    page.evaluate("window._answerMode='correct'")
    error_row.locator('[data-qw-option-retry]').click(); page.wait_for_timeout(90)
    retried_payload = page.evaluate('window._answerCalls[2]')
    assert retried_payload == failed_payload
    assert card.locator('[data-qw-option-key="A"]').evaluate("el=>el.classList.contains('is-correct-flash')")
    assert card.locator('[data-qw-option-sync-error]').count() == 0
    assert not errors, errors
    browser.close()

print('multi-question-mistake-sync-browser-ok')
