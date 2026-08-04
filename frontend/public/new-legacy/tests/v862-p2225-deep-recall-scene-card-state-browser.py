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
        getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),clear:()=>m.clear()
      }});
      Object.defineProperty(window,'sessionStorage',{configurable:true,value:{getItem:k=>null,setItem:()=>{},removeItem:()=>{}}});
      window.confirm=()=>true;window.alert=()=>{};
      window.KGAuthCore={currentUsername:()=> 'student-p2225'};
      window.KGRolePermissions={applyTheme:()=>{},currentUser:()=>({id:'student-p2225'}),canUseDeepRecallQuestion:()=>true,renderStatus:()=>{}};
      const q={id:'recall-theme-q1',sourceQuestionId:'recall-theme-q1',teacherNumber:'R-025',title:'主题交互题',subject:'PMP',
        stemParts:[{id:'stem-1',text:'项目经理需要识别关键干系人并理解其期望。'}],
        options:[{id:'A',text:'立即升级'},{id:'B',text:'分析参与程度'}],
        clues:[{id:'clue-key',text:'关键干系人',recallNodeId:'clue-key'}],concepts:[],answer:'B'};
      localStorage.setItem('kg_question_banks_v1__user__student-p2225',JSON.stringify([{id:'recall-theme-bank',name:'主题测试题集',subject:'PMP',questions:[q]}]));
      localStorage.setItem('kg_deep_recall_current_question_v1',JSON.stringify({question:q,sourceBankId:'recall-theme-bank',sourceQuestionId:q.id}));
    }""")
    add_style(page,'styles/knowledge-recall.css','styles/account-menu.css','styles/learning-practice-shell.css','styles/knowledge-recall-p2223.css','styles/knowledge-recall-p2224.css','styles/knowledge-recall-p2225.css')
    add_script(page,'src/28-app-storage.js','src/50-question-data.js','src/86-activity-schema-v1.js','src/86-free-mode-language.js','src/85-knowledge-recall-data.js','src/94-practice-navigation.js','src/95-recall-association-library.js','src/97-recall-storage.js','src/96-recall-question-source.js','src/98-recall-graph-model.js', 'src/86-knowledge-recall.js')
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
    page.wait_for_timeout(260)

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=ARGS)
    page=browser.new_page(viewport={'width':1440,'height':900})
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    setup(page)

    # Icon-only scene entry opens on hover and applies each scene with one click.
    summary=page.locator('#krSceneMenu > summary')
    assert summary.inner_text().strip()==''
    summary.hover();page.wait_for_timeout(80)
    assert page.locator('#krSceneMenu').evaluate('el=>el.open') is True
    assert page.locator('.kr-scene-panel').is_visible()

    themes=['platform','parchment','aurora','neon','sakura','ocean','latte']
    app_backgrounds={}
    overlay_backgrounds={}
    topbar_backgrounds={}
    for theme in themes:
        summary.hover();page.wait_for_timeout(40)
        page.locator(f'.kr-scene-option[data-kr-theme="{theme}"]').click()
        page.wait_for_timeout(90)
        values=page.evaluate("""theme=>({
          appTheme:document.getElementById('krApp').dataset.theme,
          viewportTheme:document.getElementById('krViewport').dataset.theme,
          bodyTheme:document.body.dataset.krTheme,
          selectValue:document.getElementById('krThemeSelect').value,
          appBackground:getComputedStyle(document.getElementById('krApp')).backgroundImage,
          topbarBackground:getComputedStyle(document.querySelector('.kr-topbar')).backgroundColor,
          overlayBackground:getComputedStyle(document.querySelector('.kr-question-library-nav')).backgroundColor,
          optionBackground:getComputedStyle(document.querySelector('.kr-option')).backgroundColor,
          active:document.querySelector(`.kr-scene-option[data-kr-theme="${theme}"]`).classList.contains('is-active')
        })""",theme)
        assert values['appTheme']==theme and values['viewportTheme']==theme and values['bodyTheme']==theme
        assert values['selectValue']==theme and values['active'] is True
        app_backgrounds[theme]=values['appBackground']
        topbar_backgrounds[theme]=values['topbarBackground']
        overlay_backgrounds[theme]=(values['overlayBackground'],values['optionBackground'])
        assert page.locator('#krSceneMenu').evaluate('el=>el.open') is False
    assert len(set(app_backgrounds.values()))==len(themes),app_backgrounds
    assert len(set(topbar_backgrounds.values()))>=6,topbar_backgrounds
    assert len(set(overlay_backgrounds.values()))>=6,overlay_backgrounds

    # Create and select a knowledge card.
    page.locator('.kr-keyword').first.click();page.wait_for_timeout(560)
    button=page.locator('.kr-node button').first
    assert button.count()==1
    page.mouse.move(1200,760);page.wait_for_timeout(180)
    selected_rest=button.evaluate('el=>getComputedStyle(el).boxShadow')
    assert selected_rest!='none'
    button.hover();page.wait_for_timeout(180)
    selected_hover=button.evaluate('el=>getComputedStyle(el).boxShadow')
    assert selected_hover==selected_rest,(selected_rest,selected_hover)

    # Pointer-down feedback remains even while the pointer is hovering the card.
    box=button.bounding_box();assert box
    page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2)
    hover_state=button.evaluate("el=>({button:getComputedStyle(el).transform,cap:getComputedStyle(el,'::after').transform})")
    page.mouse.down();page.wait_for_timeout(40)
    pressed_state=button.evaluate("el=>({button:getComputedStyle(el).transform,cap:getComputedStyle(el,'::after').transform,shadow:getComputedStyle(el).boxShadow})")
    assert pressed_state['button']!=hover_state['button'],(hover_state,pressed_state)
    assert pressed_state['cap']!=hover_state['cap'],(hover_state,pressed_state)
    assert pressed_state['shadow']!='none'
    page.mouse.up();page.wait_for_timeout(340)
    assert page.locator('#krGuide').is_visible()

    assert not errors,errors
    page.close();browser.close()
print('v862-p2225-deep-recall-scene-card-state-browser-ok')
