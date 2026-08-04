from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
ARGS=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']

def text(path): return (ROOT/path).read_text()
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
        getItem:k=>m.has(k)?m.get(k):null,
        setItem:(k,v)=>m.set(k,String(v)),
        removeItem:k=>m.delete(k),clear:()=>m.clear()
      }});
      Object.defineProperty(window,'sessionStorage',{configurable:true,value:{
        getItem:k=>null,setItem:()=>{},removeItem:()=>{}
      }});
      window.confirm=()=>true;window.alert=()=>{};
      window.KGAuthCore={currentUsername:()=> 'student-p2224'};
      window.KGRolePermissions={
        applyTheme:()=>{},currentUser:()=>({id:'student-p2224'}),
        canUseDeepRecallQuestion:()=>true,renderStatus:()=>{}
      };
      const make=(id,num,title)=>({
        id,sourceQuestionId:id,teacherNumber:num,title,subject:'PMP',
        stemParts:[{id:'stem-1',text:'项目经理需要识别关键干系人并理解其期望。'}],
        options:[{id:'A',text:'立即升级'},{id:'B',text:'分析参与程度'}],
        clues:[{id:'clue-key',text:'关键干系人',recallNodeId:'clue-key'}],concepts:[],answer:'B'
      });
      const q1=make('recall-delete-q1','R-001','删除交互题一');
      const q2=make('recall-delete-q2','R-002','删除交互题二');
      localStorage.setItem('kg_question_banks_v1__user__student-p2224',JSON.stringify([{id:'recall-delete-bank',name:'删除测试题集',subject:'PMP',questions:[q1,q2]}]));
      localStorage.setItem('kg_deep_recall_current_question_v1',JSON.stringify({question:q1,sourceBankId:'recall-delete-bank',sourceQuestionId:q1.id}));
    }""")
    add_style(page,'styles/knowledge-recall.css','styles/account-menu.css','styles/learning-practice-shell.css','styles/knowledge-recall-p2223.css','styles/knowledge-recall-p2224.css')
    add_script(page,'src/28-app-storage.js','src/50-question-data.js','src/86-activity-schema-v1.js','src/86-free-mode-language.js','src/85-knowledge-recall-data.js','src/94-practice-navigation.js','src/95-recall-association-library.js','src/97-recall-storage.js','src/96-recall-question-source.js','src/98-recall-graph-model.js', 'src/86-knowledge-recall.js')
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
    page.wait_for_timeout(240)

def create_node(page):
    keyword=page.locator('.kr-keyword').first
    assert keyword.count()==1
    keyword.click()
    page.wait_for_timeout(100)
    assert page.locator('.kr-node').count()==1

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=ARGS)
    page=browser.new_page(viewport={'width':1440,'height':900})
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    setup(page)

    assert page.locator('#krBackBtn').is_visible()
    assert page.locator('#krTopContext').count()==0
    assert page.locator('#accountMenuExitBtn').count()==0
    assert page.locator('#krQuestionCount').inner_text().strip()=='1/2'

    nav=page.locator('.kr-question-library-nav').bounding_box()
    reset=page.locator('#krResetBtn').bounding_box()
    assert nav and reset
    assert abs(nav['y']-reset['y'])<1 and abs(nav['height']-reset['height'])<1

    keyword_metrics=page.locator('.kr-keyword').first.evaluate("""el=>{
      const range=document.createRange();range.selectNodeContents(el);
      const r=range.getBoundingClientRect(),box=el.getBoundingClientRect(),s=getComputedStyle(el);
      return {textWidth:r.width,elementWidth:box.width,paddingLeft:s.paddingLeft,paddingRight:s.paddingRight,marginLeft:s.marginLeft,marginRight:s.marginRight};
    }""")
    assert keyword_metrics['paddingLeft']=='0px' and keyword_metrics['paddingRight']=='0px'
    assert keyword_metrics['marginLeft']=='0px' and keyword_metrics['marginRight']=='0px'
    assert abs(keyword_metrics['textWidth']-keyword_metrics['elementWidth'])<0.75

    create_node(page)
    button=page.locator('.kr-node button').first
    before=button.evaluate("el=>({button:getComputedStyle(el).transform,cap:getComputedStyle(el,'::after').transform,letter:getComputedStyle(el.querySelector('span')).transform})")
    button.hover();page.wait_for_timeout(80)
    after=button.evaluate("el=>({button:getComputedStyle(el).transform,cap:getComputedStyle(el,'::after').transform,letter:getComputedStyle(el.querySelector('span')).transform})")
    assert before==after,(before,after)

    button.click();page.wait_for_timeout(340)
    assert page.locator('#krGuide').is_visible()
    page.keyboard.press('Delete')
    page.wait_for_timeout(30)
    destroying=page.locator('.kr-node.is-destroying')
    assert destroying.count()==1
    assert 'krCardDestroyCollapse' in destroying.locator('button').evaluate('el=>getComputedStyle(el).animationName')
    page.wait_for_timeout(410)
    assert page.locator('.kr-node').count()==0

    create_node(page)
    page.locator('.kr-node button').first.dblclick(delay=45)
    page.wait_for_timeout(30)
    assert page.locator('.kr-node.is-destroying').count()==1
    page.wait_for_timeout(410)
    assert page.locator('.kr-node').count()==0

    create_node(page)
    page.wait_for_timeout(220)
    progress_key='kg_deep_recall_progress_v2__user__student-p2224__bank__recall-delete-bank__question__recall-delete-q1'
    assert page.evaluate("key=>JSON.parse(localStorage.getItem(key)).nodes.length",progress_key)==1
    page.locator('#krResetBtn').click();page.wait_for_timeout(80)
    assert page.locator('.kr-node').count()==0
    assert page.evaluate("key=>localStorage.getItem(key)",progress_key) is None

    page.locator('#krZoomInBtn').click();page.wait_for_timeout(60)
    assert page.locator('#krZoomLabel').inner_text().strip()=='125%'
    vp=page.locator('#krViewport').bounding_box()
    page.mouse.move(vp['x']+vp['width']-180,vp['y']+vp['height']-150)
    page.mouse.down();page.mouse.move(vp['x']+vp['width']-320,vp['y']+vp['height']-230,steps=4);page.mouse.up()
    page.locator('#krZoomLabel').click();page.wait_for_timeout(80)
    transform=page.locator('#krWorld').evaluate('el=>el.style.transform')
    match=re.search(r'translate\(([-0-9.]+)px,\s*([-0-9.]+)px\) scale\(([-0-9.]+)\)',transform)
    assert match,transform
    x,y,scale=map(float,match.groups())
    assert abs(scale-1)<.001 and abs(x-vp['width']/2)<1 and abs(y-vp['height']/2)<1,(transform,vp)

    assert not errors,errors
    page.close();browser.close()
print('v862-p2224-deep-recall-card-delete-reset-browser-ok')
