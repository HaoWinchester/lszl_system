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

BATCH='''【题干-中文】\n批次默认分类测试题一，团队如何处理变化？\n【A-中文】拒绝变化\n【B-中文】持续评估并调整\n【C-中文】忽略相关方\n【D-中文】停止项目\n【答案】B\n【解析-中文】测试解析一\n\n===== 下一题 =====\n\n【知识点】项目需求管理\n【标签】易错题\n【题干-中文】批次模板覆盖测试题二，应如何规划需求？\n【A-中文】不做规划\n【B-中文】规划需求管理\n【C-中文】删除需求\n【D-中文】跳过分析\n【答案】B\n【解析-中文】测试解析二'''

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=ARGS)
    page=browser.new_page(viewport={'width':1440,'height':1000});page.set_default_timeout(7000)
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    attrs,body=body_html('question-bank.html')
    page.set_content(f'<!doctype html><html><head></head><body{attrs}>{body}</body></html>')
    page.evaluate("""()=>{const local=new Map(),session=new Map();Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>local.has(k)?local.get(k):null,setItem:(k,v)=>local.set(k,String(v)),removeItem:k=>local.delete(k),clear:()=>local.clear(),key:i=>[...local.keys()][i]||null,get length(){return local.size}}});Object.defineProperty(window,'sessionStorage',{configurable:true,value:{getItem:k=>session.has(k)?session.get(k):null,setItem:(k,v)=>session.set(k,String(v)),removeItem:k=>session.delete(k),clear:()=>session.clear(),key:i=>[...session.keys()][i]||null,get length(){return session.size}}});const user='p334-teacher';localStorage.setItem('kg_local_current_user_v1',user);localStorage.setItem('kg_local_users_v1',JSON.stringify({[user]:{username:user,displayName:'P3.3.4 教师',role:'admin',status:'active',subject:'PMP',salt:'x',hash:'x'}}));window.confirm=()=>true;window.alert=()=>{};window.open=()=>({});if(!window.ResizeObserver)window.ResizeObserver=class{observe(){}disconnect(){}};}""")
    add_files(page,['styles/teacher-workbench.css','styles/question-bank-admin.css','styles/teacher-question-workflow.css','styles/admin-context-nav.css','styles/workspace-placement.css','styles/question-classification.css'],'css')
    add_files(page,['src/01-runtime-config.js','src/28-app-storage.js','src/29-auth-core.js','src/34-role-permissions.js','src/50-question-data.js','src/91-learning-content-core.js','src/95-recall-association-library.js','question-studio/question-studio-parser.js','src/98-teacher-workflow-p2-services.js','src/65-question-bank-admin.js','src/98-question-classification.js','src/97-teacher-question-workflow.js','src/99-workspace-placement.js'],'js')
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))");page.wait_for_timeout(500)

    page.locator('[data-main-tab="base"]').click();page.locator('[data-tq-paste-mode="batch"]').click();page.wait_for_timeout(100)
    assert page.locator('#tqBatchOptions').is_visible()
    assert 'PMP' in page.locator('#tqBatchDefaultSubject').inner_text()

    page.locator('#tqBatchDefaultEditBtn').click();page.wait_for_timeout(100)
    assert page.locator('#tqBatchClassificationDialog').is_visible()
    page.locator('#tqBatchKnowledgeSearch').fill('敏捷方法');page.wait_for_timeout(80)
    page.locator('[data-tq-batch-search-node="kp-pmp-agile"]').click();page.locator('[data-tq-batch-class-tab="tags"]').click();page.wait_for_timeout(50)
    page.locator('[data-tq-batch-tag-group="usage"]').click();page.locator('[data-tq-batch-tag-category="stage"]').click();page.get_by_text('阶段测试',exact=True).last.click()
    page.locator('#tqBatchClassificationApplyBtn').click();page.wait_for_timeout(100)
    assert '敏捷方法' in page.locator('#tqBatchDefaultKnowledgeLabel').inner_text()
    assert '阶段测试' in page.locator('#tqBatchDefaultTagsLabel').inner_text()

    page.locator('#tqPasteInput').fill(BATCH);page.locator('#tqParseBtn').click();page.wait_for_timeout(160)
    items=page.locator('.tq-batch-item');assert items.count()==2
    first=items.nth(0).locator('.tq-classification-preview').inner_text();second=items.nth(1).locator('.tq-classification-preview').inner_text()
    assert '敏捷方法' in first and '知识点：批次默认' in first and '标签：批次默认' in first
    assert '项目需求管理' in second and '知识点：模板' in second and '标签：模板' in second

    # Per-question override only the first question; it must not affect the second.
    items.nth(0).locator('[data-tq-batch-edit]').click();page.wait_for_timeout(80)
    page.locator('#tqBatchKnowledgeSearch').fill('预测型方法');page.wait_for_timeout(80)
    page.locator('[data-tq-batch-search-node="kp-pmp-predictive"]').click();page.locator('[data-tq-batch-class-tab="tags"]').click();
    page.locator('[data-tq-batch-tag-group="quality"]').click();page.locator('[data-tq-batch-tag-category="feature"]').click();page.get_by_text('核心题',exact=True).last.click();page.locator('#tqBatchClassificationApplyBtn').click();page.wait_for_timeout(100)
    first=page.locator('.tq-batch-item').nth(0).locator('.tq-classification-preview').inner_text();second=page.locator('.tq-batch-item').nth(1).locator('.tq-classification-preview').inner_text()
    assert '预测型方法' in first and '知识点：单题覆盖' in first
    assert '项目需求管理' in second and '知识点：模板' in second

    page.locator('#tqApplyParsedBtn').click();page.wait_for_timeout(300)
    questions=page.evaluate("KGQuestionBankAdminAPI.getAllQuestions().filter(q=>q.title.includes('批次默认分类测试题一')||q.title.includes('批次模板覆盖测试题二'))")
    assert len(questions)==2
    q1=next(q for q in questions if '批次默认分类测试题一' in q['title'])
    q2=next(q for q in questions if '批次模板覆盖测试题二' in q['title'])
    assert q1['metadata']['knowledge']['primaryNodeId']=='kp-pmp-predictive'
    assert '阶段测试' in q1['tags'] and '核心题' in q1['tags']
    assert q2['metadata']['knowledge']['primaryNodeId']=='kp-pmp-requirements'
    assert q2['tags']==['易错题']

    page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(100)
    page.locator('[data-main-tab="base"]').click();page.locator('[data-tq-entry-mode="paste"]').click();page.locator('[data-tq-paste-mode="batch"]').click();page.locator('#tqBatchDefaultEditBtn').click();page.wait_for_timeout(80)
    box=page.locator('#tqBatchClassificationDialog').bounding_box();assert box and box['x']>=0 and box['x']+box['width']<=391
    assert not errors,errors
    browser.close()
print('v90-p3331-batch-default-classification-browser-ok')
