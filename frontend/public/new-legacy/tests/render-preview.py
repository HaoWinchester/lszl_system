from pathlib import Path
import re
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]

def clean_html(name):
    text=(ROOT/name).read_text()
    text=re.sub(r'<script[^>]+src="[^"]+"[^>]*></script>','',text)
    text=re.sub(r'<link[^>]+rel="stylesheet"[^>]*>','',text)
    return text

def install(page):
    page.evaluate("""()=>{const m=new Map();Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),clear:()=>m.clear()}});window.KGAuthCore={currentUsername:()=> 'preview'};window.KGLearningEventRepository={append(){}};window.confirm=()=>true;}""")

def add(page,name): page.add_script_tag(content=(ROOT/name).read_text())

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page(viewport={'width':1365,'height':1100},device_scale_factor=1)
    page.set_content(clean_html('learning-path.html'))
    install(page)
    page.add_style_tag(content=(ROOT/'styles/guided-learning-path.css').read_text())
    add(page,'src/86-activity-schema-v1.js');add(page,'src/87-guided-learning-data.js');add(page,'src/88-guided-learning-store.js');add(page,'src/89-guided-learning-icon-registry.js');add(page,'src/89-guided-learning-app.js')
    page.evaluate('KGGuidedLearningApp.init()')
    page.screenshot(path='/tmp/kg-path-preview.png',full_page=True)
    page.close()

    page=browser.new_page(viewport={'width':1000,'height':900},device_scale_factor=1)
    page.set_content(clean_html('guided-learning-node.html'))
    install(page)
    page.add_style_tag(content=(ROOT/'styles/guided-learning-node.css').read_text())
    add(page,'src/86-activity-schema-v1.js');add(page,'src/87-guided-learning-data.js');add(page,'src/88-guided-learning-store.js');add(page,'src/89-guided-learning-activity-registry.js');add(page,'src/89-guided-learning-deep-recall.js');add(page,'src/90-guided-learning-node-app.js')
    page.evaluate("KGGuidedLearningNodeApp.init('awareness-keywords')")
    page.screenshot(path='/tmp/kg-node-preview.png',full_page=True)
    page.close();browser.close()
print('render-preview-ok')
