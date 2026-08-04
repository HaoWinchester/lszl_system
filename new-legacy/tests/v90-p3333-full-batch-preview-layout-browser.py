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

def question(n):
    long_tail=f'这是第 {n} 道题用于验证批量预览必须显示完整题干而不是只保留前一百个字符。' + ('完整信息验证' * 12)
    return f'''【科目】PMP
【标签】阶段测试、核心题
【题干-中文】
批量完整预览测试题 {n}。{long_tail}
【题干-English】
Full batch preview question {n} with complete bilingual stem.
【A-中文】
选项A-{n}
【A-English】
Option A-{n}
【B-中文】
选项B-{n}
【B-English】
Option B-{n}
【C-中文】
选项C-{n}
【C-English】
Option C-{n}
【D-中文】
选项D-{n}
【D-English】
Option D-{n}
【答案】
B
【解析-中文】
这是第 {n} 道题的完整中文解析，必须与单题预览一样显示。
【解析-English】
This is the complete English analysis for question {n}.
【关键词】
风险 | risk'''

BATCH='\n\n===== 下一题 =====\n\n'.join(question(i) for i in range(1,4))

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=ARGS)
    page=browser.new_page(viewport={'width':1920,'height':1080});page.set_default_timeout(8000)
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    attrs,body=body_html('question-bank.html')
    page.set_content(f'<!doctype html><html><head></head><body{attrs}>{body}</body></html>')
    page.evaluate("""()=>{const local=new Map(),session=new Map();Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>local.has(k)?local.get(k):null,setItem:(k,v)=>local.set(k,String(v)),removeItem:k=>local.delete(k),clear:()=>local.clear(),key:i=>[...local.keys()][i]||null,get length(){return local.size}}});Object.defineProperty(window,'sessionStorage',{configurable:true,value:{getItem:k=>session.has(k)?session.get(k):null,setItem:(k,v)=>session.set(k,String(v)),removeItem:k=>session.delete(k),clear:()=>session.clear(),key:i=>[...session.keys()][i]||null,get length(){return session.size}}});const user='p3333-teacher';localStorage.setItem('kg_local_current_user_v1',user);localStorage.setItem('kg_local_users_v1',JSON.stringify({[user]:{username:user,displayName:'P3.3.3.3 教师',role:'admin',status:'active',subject:'PMP',salt:'x',hash:'x'}}));window.confirm=()=>true;window.alert=()=>{};window.open=()=>({});if(!window.ResizeObserver)window.ResizeObserver=class{observe(){}disconnect(){}};}""")
    add_files(page,['styles/teacher-workbench.css','styles/question-bank-admin.css','styles/teacher-question-workflow.css','styles/admin-context-nav.css','styles/workspace-placement.css','styles/question-classification.css'],'css')
    add_files(page,['src/01-runtime-config.js','src/28-app-storage.js','src/29-auth-core.js','src/34-role-permissions.js','src/50-question-data.js','src/91-learning-content-core.js','src/95-recall-association-library.js','question-studio/question-studio-parser.js','src/98-teacher-workflow-p2-services.js','src/65-question-bank-admin.js','src/98-question-classification.js','src/97-teacher-question-workflow.js','src/99-workspace-placement.js'],'js')
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))");page.wait_for_timeout(500)

    layout=page.locator('.qb-layout').bounding_box()
    assert layout and layout['width'] >= 1880, layout
    assert page.locator('body').evaluate('(el)=>el.scrollWidth-el.clientWidth') <= 2

    page.locator('[data-main-tab="base"]').click();page.locator('[data-tq-paste-mode="batch"]').click();page.locator('#tqPasteInput').fill(BATCH);page.locator('#tqParseBtn').click();page.wait_for_timeout(180)
    assert '共 3 道' in page.locator('#tqParseSummary').inner_text()
    visible=page.locator('.tq-batch-item:visible')
    text=visible.inner_text()
    for label in ['语言','题干','选项','正确答案','解析','分类']:
        assert label in text,(label,text)
    for opt in ['选项A-1','选项B-1','选项C-1','选项D-1']:
        assert opt in text,opt
    assert '完整信息验证完整信息验证完整信息验证' in text, '长题干尾部应保留而非截断'
    assert '完整中文解析' in text
    assert 'complete English analysis' in text
    assert '关键词' in text

    page.locator('[data-tq-batch-next]').click();page.wait_for_timeout(50)
    assert '批量完整预览测试题 2' in page.locator('.tq-batch-item:visible').inner_text()

    page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(100)
    assert page.locator('body').evaluate('(el)=>el.scrollWidth-el.clientWidth') <= 2
    assert page.locator('.qb-layout').bounding_box()['width'] >= 388
    assert '批量完整预览测试题 2' in page.locator('.tq-batch-item:visible').inner_text()
    assert not errors,errors
    browser.close()
print('v90-p3333-full-batch-preview-layout-browser-ok')
