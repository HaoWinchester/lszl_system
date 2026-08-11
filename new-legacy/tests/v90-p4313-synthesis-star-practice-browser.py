#!/usr/bin/env python3
from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
ARGS=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']
MAIN='principle-main';OTHER='principle-other'

def text(path): return (ROOT/path).read_text(encoding='utf-8')
def page_parts(file):
    source=text(file);match=re.search(r'<body([^>]*)>([\s\S]*)</body>',source,re.I)
    return match.group(1),re.sub(r'<script[\s\S]*?</script>','',match.group(2),flags=re.I),re.findall(r'<script[^>]+src="([^"]+)"',source,re.I),re.findall(r'<link[^>]+href="([^"]+\.css)"',source,re.I)

def question(id,difficulty,principle):
    return {'id':id,'title':'练习题 '+id,'teacherNumber':'P4313-'+id,'type':'single_choice','subject':'PMP','difficulty':difficulty,'metadata':{'stemPrincipleIds':[],'optionPrincipleMap':{'A':[principle]},'principleIds':[principle]},'stemParts':[{'text':'题目 '+id+'：请选择正确行动。'}],'options':[{'id':'A','text':'正确行动','correct':True},{'id':'B','text':'错误行动'}],'correctAnswer':'A','answer':'A','analysis':'解析 '+id}

def questions():
    result=[question('source-1','easy',MAIN),question('source-2','easy',MAIN)]
    result += [question(f'easy-{i}','easy',MAIN) for i in range(1,4)]
    result += [question(f'medium-{i}','medium',MAIN) for i in range(1,4)]
    result += [question(f'hard-{i}','hard',MAIN) for i in range(1,4)]
    result += [question('other-hard','hard',OTHER),question('other-medium','medium',OTHER)]
    return result

def install_storage(page,items):
    page.evaluate("""({items,main,other})=>{
      const local=new Map(),session=new Map();const make=map=>({getItem:k=>map.has(String(k))?map.get(String(k)):null,setItem:(k,v)=>map.set(String(k),String(v)),removeItem:k=>map.delete(String(k)),clear:()=>map.clear(),key:i=>[...map.keys()][i]||null,get length(){return map.size}});
      Object.defineProperty(window,'localStorage',{configurable:true,value:make(local)});Object.defineProperty(window,'sessionStorage',{configurable:true,value:make(session)});
      const username='p4313-user';localStorage.setItem('kg_local_current_user_v1',username);localStorage.setItem('kg_local_users_v1',JSON.stringify({[username]:{username,displayName:'P4.3.13 User',role:'teacher',status:'active',subject:'PMP',salt:'x',hash:'x'}}));
      localStorage.setItem('kg_principle_repository_v1',JSON.stringify({schemaVersion:1,items:[{id:main,name:'先分析后行动',status:'active',confusablePrincipleIds:[other]},{id:other,name:'快速试错',status:'active',confusablePrincipleIds:[]}]}));
      localStorage.setItem('kg_synthesis_preset_repository_v1',JSON.stringify({schemaVersion:1,items:[{id:'preset-main',principleId:main,title:'原则：先分析后行动',content:'先明确目标、信息和约束，再决定行动方式。',status:'active',version:1}]}));
      const snapshots=items.map(question=>({bankId:'p4313-bank',bankName:'P4.3.13 题库',bankSubject:'PMP',questionId:question.id,question}));
      const release={id:'p4313-release',releaseId:'p4313-release',paperId:'p4313-paper',version:1,name:'P4.3.13 发布卷',title:'P4.3.13 发布卷',subject:'PMP',status:'published',publishedAt:1,enabledModes:['multi_question_canvas'],totalCount:items.length,questions:items.map((q,index)=>({bankId:'p4313-bank',questionId:q.id,order:index+1})),questionSnapshots:snapshots};
      localStorage.setItem('kg_exam_papers_published_v1',JSON.stringify([release]));localStorage.setItem('kg_question_banks_v1__user__'+username,JSON.stringify([{id:'p4313-bank',name:'P4.3.13 题库',subject:'PMP',questions:items}]));
      window.KGQuestionCatalogAdapter={ready:Promise.resolve()};
      window.alert=()=>{};window.confirm=()=>true;window.open=()=>null;
    }""",{'items':items,'main':MAIN,'other':OTHER})

def load(page,items):
    attrs,body,scripts,styles=page_parts('question-workspace.html')
    page.set_content(f'<!doctype html><html><head><base href="http://localhost/"></head><body{attrs}>{body}</body></html>');install_storage(page,items)
    for style in styles:
        target=ROOT/style
        if target.exists(): page.add_style_tag(content=target.read_text(encoding='utf-8'))
    for script in scripts:
        target=ROOT/script
        if target.exists(): page.add_script_tag(content=target.read_text(encoding='utf-8'))
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))");page.wait_for_timeout(950)

def main():
  items=questions()
  with sync_playwright() as p:
    launch_options={'headless':True,'args':ARGS}
    if Path('/usr/bin/chromium').exists(): launch_options['executable_path']='/usr/bin/chromium'
    browser=p.chromium.launch(**launch_options)
    page=browser.new_page(viewport={'width':1440,'height':900});errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('console',lambda m:errors.append(m.text) if m.type=='error' and 'lucide-product.svg' not in m.text else None)
    load(page,items)
    assert page.evaluate("""()=>({state:KGMultiQuestionWorkspace?.getState?.(),workspace:KGCanvasWorkspaceStore?.getActiveWorkspace?.()})""")['workspace'],errors
    page.evaluate("""items=>{KGMultiQuestionWorkspace.setViewport({x:0,y:0,zoom:1});[0,1].forEach((index)=>KGMultiQuestionWorkspace.addQuestionItem({question:items[index],bank:{id:'p4313-bank'},paper:{id:'p4313-paper',releaseId:'p4313-release'}},{x:240+index*500,y:120,width:400,height:340}));}""",items)
    page.wait_for_timeout(350)
    ids=page.evaluate("""()=>{const w=KGCanvasWorkspaceStore.getActiveWorkspace();return Object.values(w.nodes).filter(n=>['source-1','source-2'].includes(n.questionId)).map(n=>n.id)}""")
    page.evaluate("ids=>{KGMultiQuestionWorkspace.selectNodes(ids);KGMultiQuestionWorkspace.quickCreateSynthesis()}",ids);page.wait_for_timeout(650)
    workspace=page.evaluate('KGCanvasWorkspaceStore.getActiveWorkspace()')
    synth=next(node for node in workspace['nodes'].values() if node.get('nodeType')=='synthesis-card')
    assert synth['cardType']=='system' and synth['principleId']==MAIN,synth
    card=page.locator(f'[data-node-id="{synth["id"]}"]')
    assert '系统' in card.inner_text() and '先明确目标、信息和约束' in card.inner_text()
    assert card.locator('[data-qw-inline-field]').count()==0
    assert card.locator('[data-qw-action="copy-synthesis"]').count()==1

    level_button=card.locator('[data-qw-action="practice-cycle-level"]')
    assert level_button.inner_text()=='★'
    card.locator('[data-qw-action="practice"]').click(force=True);page.wait_for_timeout(850)
    workspace=page.evaluate('KGCanvasWorkspaceStore.getActiveWorkspace()')
    batch=[node for node in workspace['nodes'].values() if node.get('practiceForSynthesisId')==synth['id']]
    assert len(batch)==3,batch
    by_id={q['id']:q for q in items}
    assert all(by_id[node['questionId']]['difficulty']=='easy' and MAIN in by_id[node['questionId']]['metadata']['principleIds'] for node in batch),batch
    for node in batch:
        page.locator(f'[data-node-id="{node["id"]}"] [data-qw-option-key="A"]').click();page.wait_for_timeout(120)
    page.wait_for_timeout(300)
    card=page.locator(f'[data-node-id="{synth["id"]}"]')
    card.locator('[data-qw-action="practice-cycle-level"]').click(force=True)
    card.locator('[data-qw-action="practice-cycle-level"]').click(force=True)
    assert card.locator('[data-qw-action="practice-cycle-level"]').inner_text()=='★★★'
    card.locator('[data-qw-action="practice"]').click(force=True);page.wait_for_timeout(900)
    workspace=page.evaluate('KGCanvasWorkspaceStore.getActiveWorkspace()')
    batch=[node for node in workspace['nodes'].values() if node.get('practiceForSynthesisId')==synth['id'] and node.get('practiceRound')==2]
    assert len(batch)==3,batch
    own=sum(MAIN in by_id[node['questionId']]['metadata']['principleIds'] for node in batch);other=sum(OTHER in by_id[node['questionId']]['metadata']['principleIds'] for node in batch)
    assert own==2 and other==1,(own,other,batch)
    assert all(by_id[node['questionId']]['difficulty'] in ['medium','hard'] for node in batch)
    unbound={**question('unbound','easy',MAIN),'metadata':{'principleIds':[MAIN]}}
    page.evaluate("""item=>{KGMultiQuestionWorkspace.addQuestionItem({question:item,bank:{id:'p4313-bank'},paper:{id:'p4313-paper',releaseId:'p4313-release'}},{x:180,y:620,width:400,height:340})}""",unbound);page.wait_for_timeout(250)
    source_and_unbound=page.evaluate("""()=>{const w=KGCanvasWorkspaceStore.getActiveWorkspace();return Object.values(w.nodes).filter(n=>['source-1','unbound'].includes(n.questionId)).map(n=>n.id)}""")
    page.evaluate("""ids=>{KGMultiQuestionWorkspace.selectNodes(ids);KGMultiQuestionWorkspace.quickCreateSynthesis()}""",source_and_unbound);page.wait_for_timeout(250)
    workspace=page.evaluate('KGCanvasWorkspaceStore.getActiveWorkspace()')
    assert len([node for node in workspace['nodes'].values() if node.get('nodeType')=='synthesis-card'])==1
    card=page.locator(f'[data-node-id="{synth["id"]}"]')
    card.locator('[data-qw-action="copy-synthesis"]').click(force=True);page.wait_for_timeout(350)
    workspace=page.evaluate('KGCanvasWorkspaceStore.getActiveWorkspace()')
    copies=[node for node in workspace['nodes'].values() if node.get('nodeType')=='synthesis-card' and node.get('cardType')=='user']
    assert len(copies)==1 and copies[0]['sourcePresetId']=='preset-main',copies
    assert not errors,errors
    page.close();browser.close()
  print('v90-p4313-workspace-browser-pass system-card-star-practice')

if __name__=='__main__':main()
