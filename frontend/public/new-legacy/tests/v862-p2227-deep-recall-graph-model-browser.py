from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
ARGS=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']

def text(path): return (ROOT/path).read_text(encoding='utf-8')
def body_html(path):
    source=text(path)
    match=re.search(r'<body[^>]*>([\s\S]*)</body>',source,re.I)
    return re.sub(r'<script[\s\S]*?</script>','',match.group(1),flags=re.I)
def add_style(page,*paths):
    for path in paths: page.add_style_tag(content=text(path))
def add_script(page,*paths):
    for path in paths: page.add_script_tag(content=text(path))

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=ARGS)
    page=browser.new_page(viewport={'width':1440,'height':900})
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.set_content('<meta name="viewport" content="width=device-width,initial-scale=1"><body class="knowledge-recall-page">'+body_html('knowledge-recall.html')+'</body>')
    page.evaluate("""()=>{
      const values=new Map();
      Object.defineProperty(window,'localStorage',{configurable:true,value:{
        get length(){return values.size},key:index=>[...values.keys()][index]??null,
        getItem:key=>values.has(String(key))?values.get(String(key)):null,
        setItem:(key,value)=>values.set(String(key),String(value)),
        removeItem:key=>values.delete(String(key)),clear:()=>values.clear()
      }});
      Object.defineProperty(window,'sessionStorage',{configurable:true,value:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}}});
      window.confirm=()=>true;window.alert=()=>{};
      window.KGAuthCore={currentUsername:()=> 'student-p2227',currentUser:()=>({username:'student-p2227'})};
      window.KGRolePermissions={applyTheme:()=>{},currentUser:()=>({id:'student-p2227'}),canUseDeepRecallQuestion:()=>true,renderStatus:()=>{}};
      const question={
        id:'graph-q',sourceQuestionId:'graph-q',title:'图模型重构测试',subject:'TEST',
        stemParts:[{id:'s1',text:'请分析关键线索。',clue:'root-clue'}],options:[],
        clues:[{id:'root-clue',text:'关键线索',recallNodeId:'root-node'}],concepts:[]
      };
      localStorage.setItem('kg_question_banks_v1__user__student-p2227',JSON.stringify([{id:'graph-bank',name:'图模型测试题集',subject:'TEST',questions:[question]}]));
      localStorage.setItem('kg_deep_recall_current_question_v1',JSON.stringify({question,sourceBankId:'graph-bank',sourceQuestionId:'graph-q',userId:'student-p2227',savedAt:Date.now()}));
      window.KGRecallAssociationLibrary={
        read:()=>({}),resolve:()=>null,
        asRecallNode:(subject,id,options={})=>{
          if(id==='root-node')return {title:'根知识点',prompt:'请选择同名但不同 ID 的知识点',choices:[{text:'同名知识点',next:'concept-a'},{text:'同名知识点',next:'concept-b'}],hasMore:true,nextOffset:Number(options.offset||0)+4};
          if(id==='concept-a')return {title:'同名知识点',prompt:'A 分支',choices:[]};
          if(id==='concept-b')return {title:'同名知识点',prompt:'B 分支',choices:[]};
          return null;
        }
      };
    }""")
    add_style(page,'styles/knowledge-recall.css','styles/account-menu.css','styles/learning-practice-shell.css','styles/knowledge-recall-p2223.css','styles/knowledge-recall-p2224.css','styles/knowledge-recall-p2225.css')
    add_script(page,'src/28-app-storage.js','src/86-free-mode-language.js','src/97-recall-storage.js','src/96-recall-question-source.js','src/98-recall-graph-model.js','src/86-knowledge-recall.js')
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
    page.wait_for_timeout(260)

    assert page.locator('.kr-keyword').count()==1
    page.locator('.kr-keyword').click()
    page.wait_for_timeout(140)
    assert page.locator('.kr-node').count()==1

    # A real card click counts once. Repainting the same guide or changing its choice page does not.
    page.locator('.kr-node button').first.click()
    page.wait_for_timeout(560)
    progress_key='kg_deep_recall_progress_v2__user__student-p2227__bank__graph-bank__question__graph-q'
    stored=page.evaluate("key=>JSON.parse(localStorage.getItem(key))",progress_key)
    assert stored['metrics']['nodeOpens']==1,stored
    assert page.locator('#krMoreChoicesBtn').count()==1
    page.locator('#krMoreChoicesBtn').click()
    page.wait_for_timeout(260)
    stored=page.evaluate("key=>JSON.parse(localStorage.getItem(key))",progress_key)
    assert stored['metrics']['nodeOpens']==1,stored
    page.evaluate("window.dispatchEvent(new CustomEvent('kg:question-language-mode',{detail:{mode:'bilingual'}}))")
    page.wait_for_timeout(260)
    stored=page.evaluate("key=>JSON.parse(localStorage.getItem(key))",progress_key)
    assert stored['metrics']['nodeOpens']==1,stored

    # Two preset concepts with the same title but different IDs must remain two cards.
    page.locator('.kr-guide-close').click()
    page.locator('.kr-node button').first.click();page.wait_for_timeout(360)
    page.locator('[data-choice-index="0"]').click();page.wait_for_timeout(540)
    assert page.locator('.kr-node').count()==2
    if page.locator('.kr-guide-close').count(): page.locator('.kr-guide-close').click()
    page.locator('.kr-node button').first.click();page.wait_for_timeout(360)
    page.locator('[data-choice-index="1"]').click();page.wait_for_timeout(180)
    assert page.locator('.kr-node').count()==3
    assert page.locator('.kr-node-label',has_text='同名知识点').count()==2
    assert not errors,errors
    browser.close()
print('v862-p2227-deep-recall-graph-model-browser-ok')
