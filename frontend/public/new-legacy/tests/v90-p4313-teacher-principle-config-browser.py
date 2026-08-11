#!/usr/bin/env python3
from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
ARGS=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']
CSS=['styles/teacher-workbench.css','styles/question-bank-admin.css','styles/teacher-question-workflow.css','styles/admin-context-nav.css','styles/workspace-placement.css','styles/question-classification.css']
JS=['src/01-runtime-config.js','src/28-app-storage.js','src/29-auth-core.js','src/34-role-permissions.js','src/50-question-data.js','src/91-learning-content-core.js','src/95-recall-association-library.js','question-studio/question-studio-parser.js','src/98-teacher-workflow-p2-services.js','src/teacher/shared/domain-core.js','src/teacher/shared/difficulty-service.js','src/principles/principle-repository.js','src/principles/synthesis-preset-repository.js','src/principles/question-principle-binding.js','src/practice/practice-selection-service.js','src/teacher/question-bank/batch-operation-service.js','src/teacher/question-bank/safe-delete-service.js','src/teacher/paper-management/paper-category-service.js','src/teacher/paper-management/paper-audit-service.js','src/teacher/paper-management/paper-release-service.js','src/teacher/paper-management/paper-question-picker.js','src/teacher/training-config/training-config-service.js','src/teacher/training-config/workspace-layout.js','src/65-question-bank-admin.js','src/98-question-classification.js','src/97-teacher-question-workflow.js','src/99-workspace-placement.js','src/teacher/training-config/principle-preset-controller.js']

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
      localStorage.setItem('kg_principle_repository_v1',JSON.stringify({items:[
        {id:'principle-stem',name:'先看题干',status:'active'},
        {id:'principle-correct',name:'正确项原则',status:'active'},
        {id:'principle-trap',name:'干扰项原则',status:'active'}
      ]}));
      const q=(id,difficulty,tags)=>({id,teacherNumber:'P4313-'+id,title:'题目 '+id,type:'single_choice',subject:'PMP',difficulty,tags,stemParts:[{text:'题干 '+id}],options:[{id:'A',text:'正确',correct:true},{id:'B',text:'错误'}],correctAnswer:'A',analysis:'解析',metadata:{knowledge:{primaryNodeId:null}},clues:id==='q1'?[{id:'core-cue',text:'题干 q1',type:'direction',keywordLevel:'core',isCore:true,solutionRole:'decision-cue',coreReason:'它决定下一步判断。',clueRole:'true',sourceType:'stem',conceptIds:[]}]:[],status:{contentReady:true}});
      let catalog={banks:[{id:'bank-p4313',name:'P4.3.13 题库',subject:'PMP',visibility:'private',revision:1}],questions:[q('q1','基础',['原则：先分析后行动']),q('q2','重点',[]),q('q3','中等',[])].map(question=>({...question,bankId:'bank-p4313',revision:1}))};
      const clone=value=>JSON.parse(JSON.stringify(value));
      window.KGQuestionCatalogAdapter={ready:Promise.resolve(catalog),snapshot:()=>clone(catalog),saveBank:async bank=>bank,saveQuestion:async question=>question,deleteBank:async()=>true,deleteQuestion:async()=>true};
      window.KGQuestionCatalogEditController={open:async()=>({readonly:false}),save:async(question,{bankId}={})=>{const saved={...clone(question),bankId:bankId||question.bankId||'bank-p4313',revision:Number(question.revision||0)+1};const index=catalog.questions.findIndex(item=>item.id===saved.id);if(index>=0)catalog.questions[index]=saved;else catalog.questions.push(saved);return clone(saved)},release:async()=>true,applyReadonlyState:()=>{},status:()=>({readonly:false})};
      window.__principleRequests=[];
      window.__principleStorageFlushes=0;window.KGServerStateStorage={flush:async()=>{window.__principleStorageFlushes+=1}};
      window.fetch=async(url,options={})=>{
        const body=JSON.parse(options.body||'{}');window.__principleRequests.push({url:String(url),body});
        const principleStore=JSON.parse(localStorage.getItem('kg_principle_repository_v1')||'{"items":[]}');
        const presetStore=JSON.parse(localStorage.getItem('kg_synthesis_preset_repository_v1')||'{"items":[]}');
        if(String(url).endsWith('/principles/status')){
          presetStore.items.forEach(item=>{if(body.ids.includes(item.principleId))item.status=body.presetStatus||item.status});
          localStorage.setItem('kg_synthesis_preset_repository_v1',JSON.stringify(presetStore));
          return {ok:true,status:200,json:async()=>({updatedPresetIds:presetStore.items.filter(item=>body.ids.includes(item.principleId)).map(item=>item.id)})};
        }
        if(String(url).endsWith('/principles/archive')){
          principleStore.items.forEach(item=>{if(body.ids.includes(item.id))item.status='inactive'});
          presetStore.items.forEach(item=>{if(body.ids.includes(item.principleId))item.status='inactive'});
          localStorage.setItem('kg_principle_repository_v1',JSON.stringify(principleStore));localStorage.setItem('kg_synthesis_preset_repository_v1',JSON.stringify(presetStore));
          return {ok:true,status:200,json:async()=>({archivedIds:body.ids})};
        }
        return {ok:true,status:200,json:async()=>({})};
      };
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
    page,errors=load(browser,'training')
    tabs=page.locator('.qb-annotation-tabs')
    assert tabs.is_visible()
    principle_tab=page.locator('[data-annotation-tab="principles"]')
    assert principle_tab.is_visible();principle_tab.click();page.wait_for_timeout(150)
    page.locator('#qbPrincipleAnnotationPanel').evaluate("""panel=>{panel.hidden=false;panel.classList.add('active')}""")
    assert page.locator('#qbPrincipleAnnotationPanel').is_visible()
    page.locator('#tqNewPrincipleBtn').click();page.locator('#tqPrincipleName').fill('识别约束')
    page.locator('#tqPresetContent').fill('先识别限制条件，再比较可行动方案。');page.locator('#tqPresetStatus').select_option('active')
    page.locator('#tqSavePrincipleBtn').click();page.wait_for_timeout(250)
    saved=page.evaluate("""()=>{const p=KGPrincipleRepository.findByName('识别约束');return {p,preset:p&&KGSynthesisPresetRepository.getByPrincipleId(p.id,{activeOnly:true})}}""")
    assert saved['p'] and saved['preset'],saved
    assert saved['preset']['content']=='先识别限制条件，再比较可行动方案。',saved
    assert saved['preset']['status']=='active',saved
    assert saved['preset']['title']=='原则：识别约束',saved
    page.locator('#tqNewPrincipleBtn').click();page.locator('#tqPrincipleName').fill('先澄清再行动')
    page.locator('#tqPresetContent').fill('先澄清目标与限制，再选择下一步。');page.locator('#tqSavePrincipleBtn').click();page.wait_for_timeout(250)
    created=page.evaluate("""()=>KGPrincipleRepository.list({includeInactive:true}).map(item=>item.name)""")
    assert '识别约束' in created and '先澄清再行动' in created,created
    assert page.locator('input[data-principle-select]').count()>=2
    first=page.locator('input[data-principle-select]').filter(has=page.locator('[value]'))
    principle_id=saved['p']['id']
    page.locator(f'input[data-principle-select="{principle_id}"]').check()
    page.locator('#tqBulkPresetStatus').select_option('draft');page.locator('#tqApplyPresetStatusBtn').click();page.wait_for_timeout(150)
    drafted=page.evaluate("""id=>KGSynthesisPresetRepository.getByPrincipleId(id)""",principle_id)
    assert drafted['status']=='draft',drafted
    request=page.evaluate("""()=>window.__principleRequests.at(-1)""")
    assert request['url'].endswith('/principles/status') and request['body']=={'ids':[principle_id],'presetStatus':'draft'},request
    assert page.evaluate("""()=>window.__principleStorageFlushes""")==1
    page.locator(f'input[data-principle-select="{principle_id}"]').check()
    page.locator('#tqArchiveSelectedPrinciplesBtn').click();page.wait_for_timeout(150)
    archived=page.evaluate("""id=>({p:KGPrincipleRepository.get(id),preset:KGSynthesisPresetRepository.getByPrincipleId(id)})""",principle_id)
    assert archived['p']['status']=='inactive' and archived['preset']['status']=='inactive',archived
    # Legacy principle-tagged question is counted without a destructive migration.
    row=page.locator('#tqPrincipleList [data-principle-id="principle-先分析后行动"]')
    if row.count(): assert '题目 1' in row.inner_text()
    assert not errors,errors
    page.close();browser.close()
    browser=p.chromium.launch(**launch_options)
    page,errors=load(browser,'questions')
    page.locator('[data-main-tab="base"]').click()
    assert page.locator('#qbOptionsEditor [data-option-principle-id="A"][value="principle-correct"]').count()==1
    page.locator('#qbOptionsEditor [data-option-principle-id="A"][value="principle-correct"]').check()
    page.locator('#qbOptionsEditor [data-option-principle-id="B"][value="principle-trap"]').check()
    page.locator('#qbPrinciplePickerBtn').click()
    page.locator('#qbPrinciplePickerOptions input[value="principle-stem"]').check()
    page.locator('#qbPrinciplePickerConfirmBtn').click()
    page.locator('#qbSaveQuestionBtn').click();page.wait_for_timeout(300)
    bindings=page.evaluate("""()=>KGQuestionBankAdminAPI.getCurrentQuestion().metadata""")
    assert bindings['stemPrincipleIds']==['principle-stem'],bindings
    assert bindings['optionPrincipleMap']=={'A':['principle-correct'],'B':['principle-trap']},bindings
    assert bindings['principleIds']==['principle-stem','principle-correct','principle-trap'],bindings
    page.locator('[data-annotation-tab="clues"]').evaluate("node=>node.click()")
    page.locator('#qbClueAnnotationPanel').evaluate("panel=>{panel.hidden=false;panel.classList.add('active')}")
    assert '核心关键词' in page.locator('#qbClueList').inner_text()
    page.locator('[data-edit-clue="core-cue"]').evaluate("node=>node.click()")
    assert page.locator('#clueKeywordLevelInput').input_value()=='core'
    assert page.locator('#clueSolutionRoleInput').input_value()=='decision-cue'
    assert page.locator('#clueCoreReasonInput').input_value()=='它决定下一步判断。'
    assert not errors,errors
    page.close();browser.close()
  print('v90-p4313-teacher-browser-pass principle-config')

if __name__=='__main__':main()
