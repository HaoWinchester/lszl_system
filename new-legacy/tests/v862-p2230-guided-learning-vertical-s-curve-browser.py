from pathlib import Path
import re
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
ARGS=['--no-sandbox','--disable-dev-shm-usage','--in-process-gpu','--disable-gpu-sandbox','--use-gl=swiftshader']
def text(path): return (ROOT/path).read_text()
def body_html(path):
    src=text(path);m=re.search(r'<body[^>]*>([\s\S]*)</body>',src,re.I)
    return re.sub(r'<script[\s\S]*?</script>','',m.group(1),flags=re.I)
def prepare(page):
    page.set_content('<body class="guided-learning-page">'+body_html('learning-path.html')+'</body>')
    page.add_style_tag(content=text('styles/main.css'))
    page.add_style_tag(content=text('styles/guided-learning-path.css'))
    page.evaluate("""()=>{const m=new Map();Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),clear:()=>m.clear()}});Object.defineProperty(window,'sessionStorage',{configurable:true,value:{getItem:k=>m.has('s:'+k)?m.get('s:'+k):null,setItem:(k,v)=>m.set('s:'+k,String(v)),removeItem:k=>m.delete('s:'+k)}});window.confirm=()=>true;}""")
    for file in ['src/28-app-storage.js','src/29-auth-core.js','src/34-role-permissions.js','src/63-learning-event-repository.js','src/86-activity-schema-v1.js','src/87-guided-learning-data.js','src/94-practice-navigation.js','src/88-guided-learning-store.js','src/89-guided-learning-icon-registry.js','src/89-guided-learning-path-layout.js','src/89-guided-learning-app.js']:
        page.add_script_tag(content=text(file))
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
    page.wait_for_timeout(180)
def test_view(browser,width,height):
    page=browser.new_page(viewport={'width':width,'height':height})
    errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    prepare(page)
    assert not errors,errors
    assert page.locator('.gl-part').count()==3
    assert page.locator('.gl-path-node').count()==36
    assert page.locator('.gl-practice-entry').count()==6
    scroller=page.locator('#glStagePathScroll')
    metrics=scroller.evaluate("e=>({scrollHeight:e.scrollHeight,clientHeight:e.clientHeight,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth,overflowX:getComputedStyle(e).overflowX,overflowY:getComputedStyle(e).overflowY,touch:getComputedStyle(e).touchAction})")
    assert metrics['scrollHeight']>metrics['clientHeight']*6,metrics
    assert metrics['scrollWidth']<=metrics['clientWidth']+1,metrics
    assert metrics['overflowX']=='hidden' and metrics['overflowY']=='auto' and metrics['touch']=='pan-y',metrics
    first_part=page.locator('.gl-part').first
    entries=first_part.locator('.gl-practice-entry')
    assert entries.nth(0).get_attribute('data-gl-practice-anchor')=='4'
    assert entries.nth(1).get_attribute('data-gl-practice-anchor')=='10'
    pair=first_part.evaluate("""part=>{const entries=[...part.querySelectorAll('.gl-practice-entry')];const nodes=[...part.querySelectorAll('.gl-path-node')];return entries.map((entry,index)=>{const anchor=Number(entry.dataset.glPracticeAnchor);const er=entry.getBoundingClientRect();const nr=nodes[anchor-1].getBoundingClientRect();return {entryY:er.top+er.height/2,nodeY:nr.top+nr.height/2,entryX:er.left+er.width/2,nodeX:nr.left+nr.width/2,side:entry.className};});}""")
    assert abs(pair[0]['entryY']-pair[0]['nodeY'])<1,pair
    assert abs(pair[1]['entryY']-pair[1]['nodeY'])<1,pair
    assert pair[0]['entryX']>pair[0]['nodeX'] and 'is-right-lane' in pair[0]['side'],pair
    assert pair[1]['entryX']<pair[1]['nodeX'] and 'is-left-lane' in pair[1]['side'],pair
    before=scroller.evaluate('e=>e.scrollTop')
    scroller.evaluate('e=>{e.style.scrollBehavior="auto";e.scrollTop=480}');page.wait_for_timeout(120)
    after=scroller.evaluate('e=>e.scrollTop')
    assert after>before+50,(before,after)
    assert page.evaluate('document.documentElement.scrollWidth-document.documentElement.clientWidth')<=1
    page.close()
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=ARGS)
    test_view(browser,1366,768)
    test_view(browser,390,844)
    browser.close()
print('v862-p2230-guided-learning-vertical-s-curve-browser-ok')
