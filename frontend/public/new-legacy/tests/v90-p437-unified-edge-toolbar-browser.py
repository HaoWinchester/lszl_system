#!/usr/bin/env python3
from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
ARGS=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']

def text(path): return (ROOT/path).read_text(encoding='utf-8')
def page_parts(file):
    source=text(file);match=re.search(r'<body([^>]*)>([\s\S]*)</body>',source,re.I)
    attrs=match.group(1);body=re.sub(r'<script[\s\S]*?</script>','',match.group(2),flags=re.I)
    return attrs,body,re.findall(r'<script[^>]+src="([^"]+)"',source,re.I),re.findall(r'<link[^>]+href="([^"]+\.css)"',source,re.I)
def install_storage(page):
    page.evaluate("""()=>{
      const local=new Map(),session=new Map();
      const make=map=>({getItem:k=>map.has(String(k))?map.get(String(k)):null,setItem:(k,v)=>map.set(String(k),String(v)),removeItem:k=>map.delete(String(k)),clear:()=>map.clear(),key:i=>[...map.keys()][i]||null,get length(){return map.size}});
      Object.defineProperty(window,'localStorage',{configurable:true,value:make(local)});Object.defineProperty(window,'sessionStorage',{configurable:true,value:make(session)});
      const username='p437-user';localStorage.setItem('kg_local_current_user_v1',username);localStorage.setItem('kg_local_users_v1',JSON.stringify({[username]:{username,displayName:'P4.3.7 User',role:'teacher',status:'active',subject:'PMP',salt:'x',hash:'x'}}));
      window.alert=()=>{};window.confirm=()=>true;window.open=()=>null;
    }""")
def load(page,file='index.html'):
    attrs,body,scripts,styles=page_parts(file)
    page.set_content(f'<!doctype html><html><head><base href="http://localhost/"></head><body{attrs}>{body}</body></html>')
    install_storage(page)
    for style in styles:
        target=ROOT/style
        if target.exists(): page.add_style_tag(content=target.read_text(encoding='utf-8'))
    for script in scripts:
        target=ROOT/script
        if target.exists(): page.add_script_tag(content=target.read_text(encoding='utf-8'))
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
    page.wait_for_timeout(900)

def center(box): return (box['x']+box['width']/2,box['y']+box['height']/2)

def main():
  with sync_playwright() as p:
    launch_options={'headless':True,'args':ARGS}
    if Path('/usr/bin/chromium').exists(): launch_options['executable_path']='/usr/bin/chromium'
    browser=p.chromium.launch(**launch_options)
    page=browser.new_page(viewport={'width':1500,'height':940});errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('console',lambda m:errors.append(m.text) if m.type=='error' else None)
    load(page)
    page.evaluate("""()=>{
      KGHomeInteractionModes.setMode('professional',{announce:false});
      const nodes=state.nodes.slice(0,4);if(nodes.length<4)throw new Error('need four nodes');
      const [a,b,c,d]=nodes;
      Object.assign(a,{x:120,y:150});Object.assign(b,{x:760,y:120});Object.assign(c,{x:770,y:430});Object.assign(d,{x:260,y:570});
      state.links=[
        {id:'p437-straight',from:a.id,to:b.id,type:'直线',lineStyle:'solid',pathStyle:'straight',color:'#64748b',strokeWidth:3,arrowStyle:'none'},
        {id:'p437-elbow',from:a.id,to:c.id,type:'折线',lineStyle:'dashed',pathStyle:'elbow',color:'#64748b',strokeWidth:4,arrowStyle:'end'},
        {id:'p437-curve',from:d.id,to:b.id,type:'曲线',lineStyle:'dotted',pathStyle:'curve',color:'#64748b',strokeWidth:2,arrowStyle:'both'}
      ];
      state.viewport={x:0,y:0,scale:1};clearSelection();render();
      document.querySelectorAll('.help-card,.help-overlay').forEach(el=>el.remove());
      window.__p437={node:a.id,edges:state.links.map(link=>link.id)};
    }""")
    page.wait_for_timeout(160)

    # Node and edge toolbars expose the same shell, main frame, drag grip and button geometry.
    page.evaluate("id=>handleNodeTap(id)",page.evaluate('__p437.node'));page.wait_for_timeout(120)
    node_toolbar=page.locator('#nodeStyleToolbar');assert node_toolbar.is_visible()
    node_style=node_toolbar.evaluate("""el=>{const main=el.querySelector('.uc-toolbar-main'),btn=el.querySelector('.uc-toolbar-btn');const ms=getComputedStyle(main),bs=getComputedStyle(btn);return{shell:el.classList.contains('uc-toolbar-shell'),grip:!!el.querySelector('.uc-toolbar-grip'),radius:ms.borderRadius,shadow:ms.boxShadow,w:bs.width,h:bs.height}}""")
    assert node_style['shell'] and node_style['grip']

    page.evaluate("""()=>{clearSelection();selectLink(__p437.edges[0],{clientX:520,clientY:260,ctrlKey:false,metaKey:false,shiftKey:false})}""");page.wait_for_timeout(160)
    toolbar=page.locator('#edgeQuickStylePanel');assert toolbar.is_visible()
    edge_style=toolbar.evaluate("""el=>{const main=el.querySelector('.uc-toolbar-main'),btn=el.querySelector('.uc-toolbar-btn');const ms=getComputedStyle(main),bs=getComputedStyle(btn);return{shell:el.classList.contains('uc-toolbar-shell'),grip:!!el.querySelector('.uc-toolbar-grip'),radius:ms.borderRadius,shadow:ms.boxShadow,w:bs.width,h:bs.height,legacy:el.classList.contains('edge-quick-style-panel')}}""")
    assert edge_style['shell'] and edge_style['grip'] and not edge_style['legacy']
    assert (edge_style['radius'],edge_style['shadow'],edge_style['w'],edge_style['h'])==(node_style['radius'],node_style['shadow'],node_style['w'],node_style['h'])

    actions=toolbar.locator('.uc-edge-toolbar-main > button').evaluate_all("els=>els.map(el=>el.hasAttribute('data-uc-toolbar-drag')?'drag':el.dataset.ucEdgeAction||el.dataset.ucEdgePanel||'')")
    assert actions==['drag','color','line','label'],actions
    assert toolbar.locator('[data-uc-edge-panel]').count()==2
    assert toolbar.locator('[data-uc-edge-popover]').count()==2

    # Hover opens the consolidated panel; it uses opacity/scaleY animation and remains inside the stage.
    trigger=toolbar.locator('[data-uc-edge-panel="line"]');trigger.hover();page.wait_for_timeout(240)
    panel=toolbar.locator('[data-uc-edge-popover="line"]');assert panel.is_visible()
    motion=panel.evaluate("el=>({opacity:Number(getComputedStyle(el).opacity),transform:getComputedStyle(el).transform,origin:getComputedStyle(el).transformOrigin,transition:getComputedStyle(el).transitionProperty})")
    assert 0 < motion['opacity'] <= 1 and motion['transform']!='none'
    assert 'opacity' in motion['transition'] and 'transform' in motion['transition']
    assert panel.locator('[data-uc-edge-path]').count()==3
    assert panel.locator('[data-uc-edge-line]').count()==3
    assert panel.locator('[data-uc-edge-width]').count()==1
    assert panel.locator('[data-uc-edge-arrow]').count()==3
    stage_box=page.locator('#stage').bounding_box();panel_box=panel.bounding_box();assert stage_box and panel_box
    assert panel_box['x']>=stage_box['x']-1 and panel_box['x']+panel_box['width']<=stage_box['x']+stage_box['width']+1
    panel.locator('.uc-toolbar-panel-title').first.click();page.wait_for_timeout(40)
    assert panel.is_visible() and page.evaluate('selectedEditableLinkIds()')==['p437-straight']

    # Straight, elbow and curve are all selectable through the same secondary menu.
    for path_style in ['curve','elbow','straight']:
        if not panel.is_visible(): trigger.evaluate('el=>el.click()');page.wait_for_timeout(180)
        panel.locator(f'[data-uc-edge-path="{path_style}"]').click();page.wait_for_timeout(130)
        assert page.evaluate("([id,value])=>linkById(id).pathStyle===value",['p437-straight',path_style])
        assert page.evaluate('selectedEditableLinkIds()')==['p437-straight']
        toolbar=page.locator('#edgeQuickStylePanel');assert toolbar.is_visible();trigger=toolbar.locator('[data-uc-edge-panel="line"]');panel=toolbar.locator('[data-uc-edge-popover="line"]')

    # Style, width and arrow changes use the same panel and retain selection.
    trigger.evaluate('el=>el.click()');page.wait_for_timeout(180);panel.locator('[data-uc-edge-line="dashed"]').click();page.wait_for_timeout(110)
    assert page.evaluate("linkById('p437-straight').lineStyle")=='dashed'
    trigger.evaluate('el=>el.click()');page.wait_for_timeout(180)
    panel.locator('[data-uc-edge-width]').evaluate("el=>{el.value='6';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))}");page.wait_for_timeout(110)
    assert page.evaluate("Number(linkById('p437-straight').strokeWidth)")==6
    trigger.evaluate('el=>el.click()');page.wait_for_timeout(180);panel.locator('[data-uc-edge-arrow="both"]').click();page.wait_for_timeout(110)
    assert page.evaluate("linkById('p437-straight').arrowStyle")=='both'
    assert page.evaluate('selectedEditableLinkIds()')==['p437-straight']

    # Automatic position follows zoom and pan while staying within the host.
    page.evaluate("stage.scrollLeft=0;stage.scrollTop=0")
    before=toolbar.bounding_box()
    page.evaluate("()=>{state.viewport={x:115,y:70,scale:1.35};applyTransform();stage.scrollLeft=0;stage.scrollTop=0}");page.wait_for_timeout(100)
    after_zoom=toolbar.bounding_box();assert before and after_zoom and (abs(before['x']-after_zoom['x'])>2 or abs(before['y']-after_zoom['y'])>2)
    page.evaluate("()=>{state.viewport.x-=170;state.viewport.y+=95;applyTransform();stage.scrollLeft=0;stage.scrollTop=0}");page.wait_for_timeout(100)
    after_pan=toolbar.bounding_box();assert after_pan and (abs(after_zoom['x']-after_pan['x'])>2 or abs(after_zoom['y']-after_pan['y'])>2)
    toolbar_debug=page.evaluate("()=>{const el=document.getElementById('edgeQuickStylePanel'),stage=document.getElementById('stage'),s=getComputedStyle(el);return{style:[el.style.left,el.style.top],computed:[s.left,s.top],rect:el.getBoundingClientRect().toJSON(),position:s.position,transform:s.transform,translate:s.translate,margin:[s.marginLeft,s.marginTop],offset:[el.offsetLeft,el.offsetTop],offsetParent:el.offsetParent&&el.offsetParent.id,parent:el.parentElement&&el.parentElement.id,stage:stage.getBoundingClientRect().toJSON(),stageTransform:getComputedStyle(stage).transform,appTransform:getComputedStyle(document.querySelector('.app')).transform}}")
    assert after_pan['x']>=stage_box['x']-1 and after_pan['y']>=stage_box['y']-1,(stage_box,after_pan,toolbar_debug)

    # The toolbar is draggable; manual placement survives viewport changes and double-click restores docking.
    grip=toolbar.locator('[data-uc-toolbar-drag]');gb=grip.bounding_box();sx,sy=center(gb)
    page.mouse.move(sx,sy);page.mouse.down();page.mouse.move(sx+92,sy+58,steps=8);page.mouse.up();page.wait_for_timeout(80)
    manual_box=toolbar.bounding_box();assert toolbar.evaluate("el=>el.classList.contains('manual-position')") and page.evaluate('selectedEditableLinkIds()')==['p437-straight']
    page.evaluate("()=>{state.viewport.x+=140;state.viewport.y-=60;state.viewport.scale=.9;applyTransform()}");page.wait_for_timeout(90)
    manual_after=toolbar.bounding_box();assert abs(manual_box['x']-manual_after['x'])<1.5 and abs(manual_box['y']-manual_after['y'])<1.5
    grip.dblclick();page.wait_for_timeout(100)
    assert not toolbar.evaluate("el=>el.classList.contains('manual-position')")
    docked=toolbar.bounding_box();assert abs(docked['x']-manual_after['x'])>2 or abs(docked['y']-manual_after['y'])>2

    # Multiple relations remain selected while the menu is open; text is disabled and batch path changes are atomic.
    page.evaluate("""()=>{
      clearSelection();selectLink(__p437.edges[0],{clientX:500,clientY:300,ctrlKey:false,metaKey:false,shiftKey:false});
      selectLink(__p437.edges[1],{clientX:530,clientY:340,ctrlKey:true,metaKey:false,shiftKey:false});
      selectLink(__p437.edges[2],{clientX:560,clientY:380,ctrlKey:true,metaKey:false,shiftKey:false});
    }""");page.wait_for_timeout(150)
    toolbar=page.locator('#edgeQuickStylePanel');assert toolbar.is_visible()
    assert page.evaluate('selectedEditableLinkIds().length')==3
    assert toolbar.locator('[data-uc-edge-action="label"]').is_disabled()
    trigger=toolbar.locator('[data-uc-edge-panel="line"]');trigger.evaluate('el=>el.click()');page.wait_for_timeout(180)
    assert page.evaluate('selectedEditableLinkIds().length')==3
    toolbar.locator('[data-uc-edge-popover="line"] [data-uc-edge-path="curve"]').click();page.wait_for_timeout(140)
    assert page.evaluate("ids=>ids.every(id=>linkById(id).pathStyle==='curve')",page.evaluate('__p437.edges'))
    assert page.evaluate('selectedEditableLinkIds().length')==3

    # Closing is the reverse opacity/scale animation, not a height transition.
    trigger=toolbar.locator('[data-uc-edge-panel="line"]');trigger.hover();page.wait_for_timeout(310)
    panel=toolbar.locator('[data-uc-edge-popover="line"]');assert panel.is_visible()
    page.mouse.move(stage_box['x']+8,stage_box['y']+8);page.wait_for_timeout(265)
    closing=panel.evaluate("el=>({hidden:el.hidden,closing:el.classList.contains('is-closing'),transition:getComputedStyle(el).transitionProperty})")
    assert closing['closing'] and not closing['hidden'] and 'height' not in closing['transition']
    page.wait_for_timeout(170);assert not panel.is_visible()

    assert not errors,errors
    page.close();browser.close()
  print('v90-p437-unified-edge-toolbar-browser-ok')

if __name__=='__main__':main()
