#!/usr/bin/env python3
from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
ARGS=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']
CSS=['styles/teacher-workbench.css','styles/question-bank-admin.css','styles/teacher-question-workflow.css','styles/admin-context-nav.css','styles/workspace-placement.css','styles/question-classification.css']
JS=['src/01-runtime-config.js','src/28-app-storage.js','src/29-auth-core.js','src/34-role-permissions.js','src/50-question-data.js','src/91-learning-content-core.js','src/95-recall-association-library.js','question-studio/question-studio-parser.js','src/98-teacher-workflow-p2-services.js','src/teacher/shared/domain-core.js','src/teacher/shared/difficulty-service.js','src/principles/principle-repository.js','src/principles/synthesis-preset-repository.js','src/practice/practice-selection-service.js','src/teacher/question-bank/batch-operation-service.js','src/teacher/question-bank/safe-delete-service.js','src/teacher/paper-management/paper-category-service.js','src/teacher/paper-management/paper-audit-service.js','src/teacher/paper-management/paper-release-service.js','src/teacher/paper-management/paper-question-picker.js','src/teacher/training-config/training-config-service.js','src/teacher/training-config/workspace-layout.js','src/65-question-bank-admin.js','src/98-question-classification.js','src/97-teacher-question-workflow.js','src/99-workspace-placement.js','src/teacher/training-config/principle-preset-controller.js']

def body_html(step):
    text=(ROOT/'question-bank.html').read_text(encoding='utf-8')
    match=re.search(r'<body([^>]*)>([\s\S]*)</body>',text,re.I)
    attrs=match.group(1)+f' data-qb-workflow-mode="simple" data-qb-workflow-step="{step}"'
    return attrs,re.sub(r'<script[\s\S]*?</script>','',match.group(2),flags=re.I)

def add_files(page,files,kind):
    for file in files:
        content=(ROOT/file).read_text(encoding='utf-8')
        (page.add_style_tag if kind=='css' else page.add_script_tag)(content=content)

def seed(page):
    page.evaluate("""()=>{
      const local=new Map(),session=new Map();
      const make=map=>({getItem:k=>map.has(String(k))?map.get(String(k)):null,setItem:(k,v)=>map.set(String(k),String(v)),removeItem:k=>map.delete(String(k)),clear:()=>map.clear(),key:i=>[...map.keys()][i]||null,get length(){return map.size}});
      Object.defineProperty(window,'localStorage',{configurable:true,value:make(local)});Object.defineProperty(window,'sessionStorage',{configurable:true,value:make(session)});
      const user='p4313-teacher',scope='user__'+encodeURIComponent(user);
      localStorage.setItem('kg_local_current_user_v1',user);localStorage.setItem('kg_local_users_v1',JSON.stringify({[user]:{username:user,displayName:'P4.3.13 教师',role:'admin',status:'active',subject:'PMP',salt:'x',hash:'x'}}));
      localStorage.setItem('kg_question_bank_demo_suppressed_v1__'+scope,'1');
      const q=(id,difficulty,tags)=>({id,teacherNumber:'P4313-'+id,title:'题目 '+id,type:'single_choice',subject:'PMP',difficulty,tags,stemParts:[{text:'题干 '+id}],options:[{id:'A',text:'正确',correct:true},{id:'B',text:'错误'}],correctAnswer:'A',analysis:'解析',metadata:{knowledge:{primaryNodeId:null}},status:{contentReady:true}});
      localStorage.setItem('kg_question_banks_v1__'+scope,JSON.stringify([{id:'bank-p4313',name:'P4.3.13 题库',subject:'PMP',visibility:'private',questions:[q('q1','基础',['原则：先分析后行动']),q('q2','重点',[]),q('q3','中等',[])]}]));
      window.confirm=()=>true;window.alert=()=>{};window.open=()=>({});if(!window.ResizeObserver)window.ResizeObserver=class{observe(){}disconnect(){}};
    }""")

def load(browser,step):
    page=browser.new_page(viewport={'width':1500,'height':980});page.set_default_timeout(10000);errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    attrs,body=body_html(step);page.set_content(f'<!doctype html><html><head><base href="http://localhost/"></head><body{attrs}>{body}</body></html>')
    seed(page);add_files(page,CSS,'css');add_files(page,JS,'js');page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))");page.wait_for_timeout(700)
    return page,errors

def main():
  with sync_playwright() as p:
    launch_options={'headless':True,'args':ARGS}
    if Path('/usr/bin/chromium').exists(): launch_options['executable_path']='/usr/bin/chromium'
    browser=p.chromium.launch(**launch_options)
    page,errors=load(browser,'questions')
    page.locator('[data-main-tab="base"]').click();page.wait_for_timeout(120)
    assert page.locator('#questionDifficultyStars').is_visible()
    assert page.locator('#questionDifficultyStars [data-difficulty="easy"]').get_attribute('aria-checked')=='true'
    page.locator('#questionDifficultyStars [data-difficulty="hard"]').click();page.locator('#qbSaveQuestionBtn').click();page.wait_for_timeout(220)
    current=page.evaluate('KGQuestionBankAdminAPI.getCurrentQuestion()')
    assert current['difficulty']=='hard',current
    all_questions=page.evaluate('KGQuestionBankAdminAPI.getAllQuestions({includeDeleted:true})')
    legacy=next(item for item in all_questions if item['id']=='q2')
    assert legacy['difficulty']=='' and '重点' in legacy['tags'],legacy
    assert not errors,errors
    page.close()

    page,errors=load(browser,'training')
    tabs=page.locator('.qb-annotation-tabs')
    assert tabs.is_visible()
    principle_tab=page.locator('[data-annotation-tab="principles"]')
    assert principle_tab.is_visible();principle_tab.click();page.wait_for_timeout(150)
    assert page.locator('#qbPrincipleAnnotationPanel').is_visible()
    page.locator('#tqNewPrincipleBtn').click();page.locator('#tqPrincipleName').fill('识别约束')
    page.locator('#tqPresetTitle').fill('原则：识别约束');page.locator('#tqPresetContent').fill('先识别限制条件，再比较可行动方案。');page.locator('#tqPresetStatus').select_option('active')
    page.locator('#tqSavePrincipleBtn').click();page.wait_for_timeout(250)
    saved=page.evaluate("""()=>{const p=KGPrincipleRepository.findByName('识别约束');return {p,preset:p&&KGSynthesisPresetRepository.getByPrincipleId(p.id,{activeOnly:true})}}""")
    assert saved['p'] and saved['preset'],saved
    assert saved['preset']['content']=='先识别限制条件，再比较可行动方案。',saved
    assert saved['preset']['status']=='active',saved
    # Legacy principle-tagged question is counted without a destructive migration.
    row=page.locator('#tqPrincipleList [data-principle-id="principle-先分析后行动"]')
    if row.count(): assert '题目 1' in row.inner_text()
    assert not errors,errors
    page.close();browser.close()
  print('v90-p4313-teacher-browser-pass principle-config')

if __name__=='__main__':main()
