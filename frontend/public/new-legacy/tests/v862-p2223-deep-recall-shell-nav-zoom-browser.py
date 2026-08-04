from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
ARGS=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']
def text(path): return (ROOT/path).read_text()
def body_html(path):
    src=text(path); match=re.search(r'<body[^>]*>([\s\S]*)</body>',src,re.I)
    return re.sub(r'<script[\s\S]*?</script>','',match.group(1),flags=re.I)
def mock_storage(page):
    page.evaluate("""()=>{
      const m=new Map();Object.defineProperty(window,'localStorage',{configurable:true,value:{
        getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),clear:()=>m.clear()
      }});window.confirm=()=>true;window.alert=()=>{};
    }""")
def add_style(page,*paths):
    for path in paths: page.add_style_tag(content=text(path))
def add_script(page,*paths):
    for path in paths: page.add_script_tag(content=text(path))

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=ARGS)
    page=browser.new_page(viewport={'width':1907,'height':620})
    page.set_content('<meta name="viewport" content="width=device-width,initial-scale=1"><body class="knowledge-recall-page">'+body_html('knowledge-recall.html')+'</body>')
    mock_storage(page)
    add_style(page,'styles/knowledge-recall.css','styles/global-shortcuts.css','styles/subscription.css','styles/user-center.css','styles/account-menu.css','styles/learning-practice-shell.css','styles/knowledge-recall-p2223.css','styles/knowledge-recall-p2224.css')
    add_script(page,'src/28-app-storage.js','src/29-auth-core.js','src/34-role-permissions.js','src/33-user-center.js','src/41-account-menu.js','src/50-question-data.js')
    page.evaluate("""()=>{
      const base={
        id:'recall-base',sourceQuestionId:'recall-base',teacherNumber:'R-000',title:'回忆测试题',
        stemParts:[{id:'stem-1',text:'用于验证深度回忆导航的测试题干。'}],
        options:[
          {id:'A',text:'选项 A'},{id:'B',text:'选项 B'},
          {id:'C',text:'选项 C'},{id:'D',text:'选项 D'}
        ],
        clues:[],concepts:[],answer:'A',explanation:'测试解析'
      };
      const q1=JSON.parse(JSON.stringify(base));q1.id='recall-q1';q1.sourceQuestionId=q1.id;q1.teacherNumber='R-001';q1.title='回忆题一';
      const q2=JSON.parse(JSON.stringify(base));q2.id='recall-q2';q2.sourceQuestionId=q2.id;q2.teacherNumber='R-002';q2.title='回忆题二';
      localStorage.setItem('kg_question_banks_v1__public',JSON.stringify([{id:'recall-bank',name:'回忆测试题集',subject:'PMP',questions:[q1,q2]}]));
      localStorage.setItem('kg_deep_recall_current_question_v1',JSON.stringify({question:q1,sourceBankId:'recall-bank',sourceQuestionId:q1.id}));
    }""")
    add_script(page,'src/86-activity-schema-v1.js','src/86-free-mode-language.js','src/85-knowledge-recall-data.js','src/94-practice-navigation.js','src/95-recall-association-library.js','src/97-recall-storage.js','src/96-recall-question-source.js','src/98-recall-graph-model.js', 'src/86-knowledge-recall.js')
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
    page.wait_for_timeout(260)

    assert page.locator('#krBackBtn').is_visible()
    assert page.locator('.lp-nav-link').count()==0
    assert page.locator('#accountMenuShell').is_visible()
    page.locator('#authStatus').click(); assert page.locator('#accountMenuExitBtn').count()==0
    page.locator('#authStatus').click()

    prev_box=page.locator('#krPrevQuestionBtn').bounding_box(); center_box=page.locator('#krQuestionListBtn').bounding_box(); next_box=page.locator('#krNextQuestionBtn').bounding_box()
    assert abs(prev_box['y']-center_box['y'])<1 and abs(center_box['y']-next_box['y'])<1
    assert abs(prev_box['height']-center_box['height'])<1 and abs(center_box['height']-next_box['height'])<1
    assert page.locator('#krQuestionCount').inner_text().strip()=='1/2'
    assert '1 / 2' in page.locator('#krQuestionPosition').inner_text()

    page.locator('#krNextQuestionBtn').click(); page.wait_for_timeout(120)
    assert page.locator('#krTopContext').count()==0
    assert '2 / 2' in page.locator('#krQuestionPosition').inner_text()
    page.locator('#krPrevQuestionBtn').click(); page.wait_for_timeout(120)
    assert page.locator('#krQuestionCount').inner_text().strip()=='1/2'

    page.locator('#krQuestionListBtn').click(); page.wait_for_timeout(240)
    box=page.locator('#krQuestionDrawer').bounding_box()
    assert abs(box['x'])<1 and abs(box['y']-64)<1 and abs(box['width']-360)<1 and abs(box['height']-(620-64))<1
    assert page.locator('.kr-question-item').count()==2
    page.locator('#krCloseQuestionDrawerBtn').click(); page.wait_for_timeout(220)

    page.locator('#krZoomInBtn').click(); page.wait_for_timeout(480)
    assert page.locator('#krZoomLabel').inner_text().strip()=='125%'
    page.locator('#krZoomLabel').click(); page.wait_for_timeout(480)
    assert page.locator('#krZoomLabel').inner_text().strip()=='100%'
    assert 'scale(1)' in page.locator('#krWorld').evaluate('el=>el.style.transform')

    stats=page.locator('#krSessionStats').bounding_box()
    assert stats['y']>540
    assert abs((stats['x']+stats['width']/2)-1907/2)<2
    assert page.evaluate('document.documentElement.scrollWidth-document.documentElement.clientWidth')<=2
    page.close()

    mobile=browser.new_page(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
    mobile.set_content('<meta name="viewport" content="width=device-width,initial-scale=1"><body class="knowledge-recall-page">'+body_html('knowledge-recall.html')+'</body>')
    add_style(mobile,'styles/knowledge-recall.css','styles/global-shortcuts.css','styles/subscription.css','styles/user-center.css','styles/account-menu.css','styles/learning-practice-shell.css','styles/knowledge-recall-p2223.css','styles/knowledge-recall-p2224.css')
    assert mobile.locator('#authStatus').is_visible()
    assert mobile.locator('#krSessionStats').is_visible()
    drawer=mobile.locator('#krQuestionDrawer').bounding_box()
    assert drawer and abs(drawer['width']-360)<3 and abs(drawer['y']-64)<1
    mobile.close()
    browser.close()
print('v862-p2223-deep-recall-shell-nav-zoom-browser-ok')
