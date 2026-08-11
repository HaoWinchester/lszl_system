#!/usr/bin/env python3
from pathlib import Path
import re
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
ARGS=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']

def body(file):
    source=(ROOT/file).read_text(encoding='utf-8')
    match=re.search(r'<body([^>]*)>([\s\S]*)</body>',source,re.I)
    return match.group(1),re.sub(r'<script[\s\S]*?</script>','',match.group(2),flags=re.I)

def add(page,files,kind):
    for file in files:
        content=(ROOT/file).read_text(encoding='utf-8')
        (page.add_style_tag if kind=='css' else page.add_script_tag)(content=content)

with sync_playwright() as p:
    launch_options={'headless':True,'args':ARGS}
    if Path('/usr/bin/chromium').exists(): launch_options['executable_path']='/usr/bin/chromium'
    browser=p.chromium.launch(**launch_options)
    page=browser.new_page(viewport={'width':1440,'height':1000});page.set_default_timeout(10000)
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    attrs,markup=body('feedback-management.html')
    page.set_content(f'<!doctype html><html><head><base href="http://app.local/"></head><body{attrs}>{markup}</body></html>')
    page.evaluate("""()=>{const data=new Map();Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>data.has(String(k))?data.get(String(k)):null,setItem:(k,v)=>data.set(String(k),String(v)),removeItem:k=>data.delete(String(k)),clear:()=>data.clear(),key:i=>[...data.keys()][i]||null,get length(){return data.size}}})}""")
    add(page,['styles/admin-console.css','styles/engagement-admin.css','styles/resizable-region.css'],'css')
    add(page,['src/28-app-storage.js','src/admin/resizable-region.js'],'js')
    page.wait_for_timeout(120)
    grid=page.locator('.engagement-admin-grid')
    handle=page.locator('[data-kg-resizable-for="feedback-workspace"]')
    assert handle.is_visible()
    assert page.locator('.engagement-admin-main').evaluate("e=>getComputedStyle(e).rowGap")=='20px'
    initial=grid.bounding_box()['height'];assert 610<=initial<=630,initial
    handle.press('ArrowDown');page.wait_for_timeout(80)
    grown=grid.bounding_box()['height'];assert grown>initial,(initial,grown)
    stored=page.evaluate("JSON.parse(localStorage.getItem('kg_ui_resizable_region_v1__feedback-workspace')||'{}')")
    assert stored.get('height',0)>initial,stored
    handle.dblclick();page.wait_for_timeout(80)
    reset=grid.bounding_box()['height'];assert 610<=reset<=630,reset
    assert grid.locator('.engagement-admin-card').first.evaluate("e=>getComputedStyle(e).display")=='flex'
    assert page.locator('#feedbackAdminList').evaluate("e=>getComputedStyle(e).overflowY")=='auto'
    assert not errors,errors
    browser.close()
print('v90-p420-layout-resizable-restoration-browser-ok')
