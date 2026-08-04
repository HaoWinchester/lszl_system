from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
ARGS=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']

def text(path): return (ROOT/path).read_text(encoding='utf-8')
def body_html(path):
    src=text(path)
    match=re.search(r'<body[^>]*>([\s\S]*)</body>',src,re.I)
    return re.sub(r'<script[\s\S]*?</script>','',match.group(1),flags=re.I)
def add_style(page,*paths):
    for path in paths: page.add_style_tag(content=text(path))
def add_script(page,*paths):
    for path in paths: page.add_script_tag(content=text(path))

def setup(page):
    page.set_content('<meta name="viewport" content="width=device-width,initial-scale=1"><body class="knowledge-recall-page">'+body_html('knowledge-recall.html')+'</body>')
    page.evaluate("""()=>{
      const m=new Map();
      Object.defineProperty(window,'localStorage',{configurable:true,value:{
        get length(){return m.size},key:i=>[...m.keys()][i]??null,
        getItem:k=>m.has(String(k))?m.get(String(k)):null,
        setItem:(k,v)=>m.set(String(k),String(v)),removeItem:k=>m.delete(String(k)),clear:()=>m.clear()
      }});
      Object.defineProperty(window,'sessionStorage',{configurable:true,value:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}}});
      window.confirm=()=>true;window.alert=()=>{};
      window.KGAuthCore={currentUsername:()=> 'student-p2226',currentUser:()=>({username:'student-p2226'})};
      window.KGRolePermissions={applyTheme:()=>{},currentUser:()=>({id:'student-p2226'}),canUseDeepRecallQuestion:()=>true,renderStatus:()=>{}};
      const q1={id:'generic-q',sourceQuestionId:'generic-q',teacherNumber:'R-026-A',title:'财务通用题',subject:'FIN',
        stemParts:[{id:'s1',text:'项目团队需要控制预算并提交报告。'}],options:[{id:'A',text:'提交报告'}],clues:[],concepts:[],answer:'A'};
      const q2={id:'delete-q',sourceQuestionId:'delete-q',teacherNumber:'R-026-B',title:'双击删除题',subject:'PMP',
        stemParts:[{id:'s1',text:'项目经理需要识别关键干系人。',clue:'stakeholder-clue'}],options:[{id:'A',text:'分析参与程度'}],
        clues:[{id:'stakeholder-clue',text:'关键干系人',recallNodeId:'stakeholder-clue'}],concepts:[],answer:'A'};
      localStorage.setItem('kg_question_banks_v1__user__student-p2226',JSON.stringify([{id:'p2226-bank',name:'P2.2.26 测试题集',subject:'PMP',questions:[q1,q2]}]));
      localStorage.setItem('kg_deep_recall_current_question_v1',JSON.stringify({question:q1,sourceBankId:'p2226-bank',sourceQuestionId:q1.id,userId:'student-p2226',savedAt:Date.now()}));
    }""")
    add_style(page,'styles/knowledge-recall.css','styles/account-menu.css','styles/learning-practice-shell.css','styles/knowledge-recall-p2223.css','styles/knowledge-recall-p2224.css','styles/knowledge-recall-p2225.css')
    add_script(page,'src/28-app-storage.js','src/50-question-data.js','src/86-activity-schema-v1.js','src/86-free-mode-language.js','src/85-knowledge-recall-data.js','src/94-practice-navigation.js','src/95-recall-association-library.js','src/97-recall-storage.js','src/96-recall-question-source.js','src/98-recall-graph-model.js', 'src/86-knowledge-recall.js')
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
    page.wait_for_timeout(280)

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=ARGS)
    page=browser.new_page(viewport={'width':1440,'height':900})
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    setup(page)

    # A non-PMP question must not inherit broad PMP demo keywords such as “团队”.
    assert page.locator('.kr-question-title').inner_text().strip()=='财务通用题'
    assert page.locator('.kr-keyword').count()==0
    assert '最长链' not in page.locator('#krSessionStats').inner_text()

    # Switch to a question with an explicit clue and create one card.
    page.locator('#krNextQuestionBtn').click();page.wait_for_timeout(180)
    assert page.locator('.kr-question-title').inner_text().strip()=='双击删除题'
    assert page.locator('.kr-keyword').count()==1
    page.locator('.kr-keyword').click();page.wait_for_timeout(120)
    assert page.locator('.kr-node').count()==1
    assert page.locator('#krGuide').is_hidden()

    # Double-click deletion must not execute the pending single-click guide action.
    page.locator('.kr-node button').dblclick(delay=45)
    page.wait_for_timeout(80)
    assert page.locator('#krGuide').is_hidden()
    assert page.locator('.kr-node.is-destroying').count()==1
    page.wait_for_timeout(520)
    assert page.locator('.kr-node').count()==0
    page.wait_for_timeout(230)
    progress_key='kg_deep_recall_progress_v2__user__student-p2226__bank__p2226-bank__question__delete-q'
    stored=page.evaluate("key=>JSON.parse(localStorage.getItem(key))",progress_key)
    assert stored['metrics']['nodeOpens']==0,stored

    # Account menu surfaces should follow the dark scene rather than stay white.
    page.locator('#krSceneMenu').evaluate('el=>el.open=true')
    page.locator('.kr-scene-option[data-kr-theme="neon"]').click();page.wait_for_timeout(90)
    page.locator('#accountMenu').evaluate('el=>el.hidden=false')
    menu=page.locator('#accountMenu').evaluate("el=>({bg:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color})")
    assert menu['bg'] not in ('rgb(255, 255, 255)','rgba(255, 255, 255, 0.98)'),menu
    assert not errors,errors
    page.close()

    # Touch/small-screen users must retain the scene icon.
    mobile=browser.new_page(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
    mobile.set_content('<meta name="viewport" content="width=device-width,initial-scale=1"><body class="knowledge-recall-page">'+body_html('knowledge-recall.html')+'</body>')
    add_style(mobile,'styles/knowledge-recall.css','styles/account-menu.css','styles/learning-practice-shell.css','styles/knowledge-recall-p2223.css','styles/knowledge-recall-p2224.css','styles/knowledge-recall-p2225.css')
    assert mobile.locator('#krSceneMenu').is_visible()
    mobile.locator('#krSceneMenu > summary').click()
    assert mobile.locator('.kr-scene-panel').is_visible()
    mobile.close();browser.close()
print('v862-p2226-deep-recall-correctness-browser-ok')
