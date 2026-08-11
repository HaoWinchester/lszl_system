#!/usr/bin/env python3
from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
ARGS=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']

def text(path): return (ROOT/path).read_text(encoding='utf-8')
def parts():
    source=text('index.html');match=re.search(r'<body([^>]*)>([\s\S]*)</body>',source,re.I)
    attrs=match.group(1);body=re.sub(r'<script[\s\S]*?</script>','',match.group(2),flags=re.I)
    scripts=re.findall(r'<script[^>]+src="([^"]+)"',source,re.I)
    styles=re.findall(r'<link[^>]+href="([^"]+\.css)"',source,re.I)
    return attrs,body,scripts,styles

def install_storage(page):
    page.evaluate("""()=>{
      const local=new Map(),session=new Map();const make=map=>({getItem:k=>map.has(String(k))?map.get(String(k)):null,setItem:(k,v)=>map.set(String(k),String(v)),removeItem:k=>map.delete(String(k)),clear:()=>map.clear(),key:i=>[...map.keys()][i]||null,get length(){return map.size}});
      Object.defineProperty(window,'localStorage',{configurable:true,value:make(local)});Object.defineProperty(window,'sessionStorage',{configurable:true,value:make(session)});
      const username='p4330-user';localStorage.setItem('kg_local_current_user_v1',username);localStorage.setItem('kg_local_users_v1',JSON.stringify({[username]:{username,displayName:'P4330',role:'teacher',status:'active',subject:'PMP',salt:'x',hash:'x'}}));
      window.alert=()=>{};window.confirm=()=>true;window.open=()=>null;
    }""")

def load(page):
    attrs,body,scripts,styles=parts();page.set_content(f'<!doctype html><html><head><base href="http://localhost/"></head><body{attrs}>{body}</body></html>');install_storage(page)
    for style in styles:
        target=ROOT/style
        if target.exists(): page.add_style_tag(content=target.read_text(encoding='utf-8'))
    for script in scripts:
        target=ROOT/script
        if target.exists(): page.add_script_tag(content=target.read_text(encoding='utf-8'))
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))");page.wait_for_timeout(1000)

def marquee(page,boxes,pad=12):
    left=min(b['x'] for b in boxes)-pad;top=min(b['y'] for b in boxes)-pad
    right=max(b['x']+b['width'] for b in boxes)+pad;bottom=max(b['y']+b['height'] for b in boxes)+pad
    page.mouse.move(left,top);page.mouse.down();page.mouse.move(right,bottom,steps=8);page.mouse.up();page.wait_for_timeout(250)

def case(page):
    assert page.evaluate("KGHomeInteractionModes.getMode()")=='efficient'
    assert page.locator('body').get_attribute('data-graph-interaction-mode')=='efficient'
    assert page.locator('#stage').evaluate("el=>el.classList.contains('flow-mode')")
    assert page.locator('#graphModeSwitcher').count()==1
    assert page.evaluate("document.getElementById('home-graph-canvasMinimapDock').firstElementChild.id")=='graphModeSwitcher'
    assert page.locator('#addBtn').count()==1
    assert page.locator('#sizeMenuBtn').count()==0
    caps=page.evaluate("()=>({box:KGHomeInteractionModes.can('boxSelect'),multi:KGHomeInteractionModes.can('multiSelect'),edgeMove:KGHomeInteractionModes.can('edgeMove')})")
    assert caps=={'box':True,'multi':True,'edgeMove':False},caps

    page.evaluate("""()=>{
      state.nodes=state.nodes.slice(0,2);state.links=[];state.elements=[];
      KGGraphModel.updateGeometry(state.nodes[0],{x:430,y:360,width:210,height:130});
      KGGraphModel.updateGeometry(state.nodes[1],{x:820,y:520,width:210,height:130});
      state.viewport={x:0,y:0,scale:1};clearSelection();render();
    }""")
    cards=page.locator('.knowledge-card')
    first=cards.nth(0);second=cards.nth(1)
    first.hover();page.wait_for_timeout(120)
    assert page.locator('.node-growth-handle').count()==4
    handle=page.locator('.node-growth-handle.node-growth-right');hb=handle.bounding_box();tb=second.bounding_box()
    page.mouse.move(hb['x']+hb['width']/2,hb['y']+hb['height']/2);page.mouse.down()
    page.mouse.move(tb['x']+tb['width']/2,tb['y']+tb['height']/2,steps=10);page.mouse.up();page.wait_for_timeout(320)
    assert page.evaluate("state.links.length")==1
    page.mouse.move(1200,180);page.wait_for_timeout(220)
    assert page.locator('.node-growth-handle').count()==0

    page.evaluate("clearSelection()");page.wait_for_timeout(80)
    marquee(page,[first.bounding_box(),second.bounding_box()])
    selected=page.evaluate("()=>[...selectedNodeIds]")
    assert len(selected)==2,selected

    page.evaluate("KGHomeInteractionModes.setMode('reading',{announce:false})");page.wait_for_timeout(300)
    assert page.evaluate("KGHomeInteractionModes.getMode()")=='reading'
    assert page.locator('#addBtn').count()==0
    assert page.locator('#focusBtn').count()==1
    assert page.evaluate("KGHomeInteractionModes.can('boxSelect')") is False
    assert page.locator('#stage').evaluate("el=>el.classList.contains('flow-mode')")
    first.hover();page.wait_for_timeout(150)
    assert page.locator('.node-growth-handle').count()==0
    vp0=page.evaluate("()=>({...state.viewport})")
    stage=page.locator('#stage').bounding_box();sx=stage['x']+stage['width']*.58;sy=stage['y']+stage['height']*.22
    page.mouse.move(sx,sy);page.mouse.down();page.mouse.move(sx+70,sy+45,steps=6);page.mouse.up();page.wait_for_timeout(150)
    vp1=page.evaluate("()=>({...state.viewport})")
    assert abs(vp1['x']-vp0['x'])>20 and abs(vp1['y']-vp0['y'])>15,(vp0,vp1)

    page.evaluate("KGHomeInteractionModes.setMode('professional',{announce:false})");page.wait_for_timeout(300)
    assert page.locator('#sizeMenuBtn').count()==1
    assert page.evaluate("KGHomeInteractionModes.can('edgeMove')") is True
    first.hover();page.wait_for_timeout(120)
    assert page.locator('.node-growth-handle').count()==4

    page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(420)
    assert page.evaluate("KGHomeInteractionModes.getMode()")=='reading'
    assert page.locator('#graphModeSwitcher').evaluate("el=>getComputedStyle(el).display")=='none'
    page.set_viewport_size({'width':1500,'height':950});page.wait_for_timeout(420)
    assert page.evaluate("KGHomeInteractionModes.getMode()")=='professional'

def main():
  with sync_playwright() as p:
    launch_options={'headless':True,'args':ARGS}
    if Path('/usr/bin/chromium').exists(): launch_options['executable_path']='/usr/bin/chromium'
    browser=p.chromium.launch(**launch_options)
    page=browser.new_page(viewport={'width':1500,'height':950});errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)));page.on('console',lambda m:errors.append(m.text) if m.type=='error' else None)
    load(page);case(page);assert not errors,errors
    page.close();browser.close()
  print('v90-p4330-browser-pass home-interaction-modes')
if __name__=='__main__':main()
