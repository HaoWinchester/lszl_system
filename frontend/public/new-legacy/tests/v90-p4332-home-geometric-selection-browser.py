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
      const username='p4332-user';localStorage.setItem('kg_local_current_user_v1',username);localStorage.setItem('kg_local_users_v1',JSON.stringify({[username]:{username,displayName:'P4332',role:'teacher',status:'active',subject:'PMP',salt:'x',hash:'x'}}));
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
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))");page.wait_for_timeout(1100)

def computed(locator):
    return locator.evaluate("el=>{const s=getComputedStyle(el);return{display:s.display,visibility:s.visibility,borderTopWidth:s.borderTopWidth,borderTopColor:s.borderTopColor,borderRadius:s.borderRadius,background:s.backgroundColor,opacity:s.opacity,width:s.width,height:s.height}}")

def marquee(page,boxes,pad=14):
    left=min(b['x'] for b in boxes)-pad;top=min(b['y'] for b in boxes)-pad
    right=max(b['x']+b['width'] for b in boxes)+pad;bottom=max(b['y']+b['height'] for b in boxes)+pad
    page.mouse.move(left,top);page.mouse.down();page.mouse.move(right,bottom,steps=10);page.mouse.up();page.wait_for_timeout(300)

def case(page):
    page.evaluate("""()=>{
      KGHomeInteractionModes.setMode('professional',{announce:false});
      state.nodes=state.nodes.slice(0,4);state.links=[];state.elements=[];
      const styles=['circle','triangle','rectangle','rounded'];
      const positions=[[380,270,210,210],[690,280,180,180],[980,290,280,150],[690,560,300,150]];
      state.nodes.forEach((node,index)=>{const p=positions[index];KGGraphModel.updateGeometry(node,{x:p[0],y:p[1],width:p[2],height:p[3]});KGGraphModel.updateAppearance(node,{cardStyle:styles[index]})});
      state.viewport={x:0,y:0,scale:1};
      const text=KGGraphTextElements.createAt(520,760,{text:'几何边界文本框',width:360,height:82,manualSize:true,edit:false});
      clearSelection();render();window.__P4332={textId:text.id,nodeIds:state.nodes.map(n=>n.id)};
    }""")
    page.wait_for_timeout(350)

    # Single selection: rectangular geometry frame, fixed 1px border, four visible square corners.
    circle=page.locator(f'.knowledge-card[data-node-id="{page.evaluate("__P4332.nodeIds[0]")}"]')
    circle.click();page.wait_for_timeout(180)
    layer=circle.locator('.graph-node-resize-layer');ls=computed(layer)
    assert ls['borderTopWidth']=='1px' and ls['borderRadius']=='0px',ls
    corners=circle.locator('.graph-element-resize-handle.handle-nw,.graph-element-resize-handle.handle-ne,.graph-element-resize-handle.handle-se,.graph-element-resize-handle.handle-sw')
    assert corners.count()==4
    for i in range(4):
        style=computed(corners.nth(i));assert style['display']!='none' and style['borderRadius']=='1px' and style['background'] in ('rgb(255, 255, 255)','rgba(255, 255, 255, 1)'),style
    side=circle.locator('.graph-element-resize-handle.handle-e');ss=computed(side)
    assert ss['display']!='none' and float(ss['opacity'])==0,ss

    # Fixed screen size remains 1px / 8px after zoom.
    page.evaluate("state.viewport.scale=.5;applyTransform();")
    page.wait_for_timeout(120)
    ls2=computed(layer);corner_box=corners.first.bounding_box()
    assert ls2['borderTopWidth']=='2px',ls2  # world CSS width doubles, screen result remains 1px under .5 transform
    assert 7.0 <= corner_box['width'] <= 9.5,corner_box
    page.evaluate("state.viewport.scale=1;applyTransform();")
    page.wait_for_timeout(100)

    # Text: four visible corners; side line is an invisible full-edge resize hit zone.
    text_el=page.locator(f'.graph-text-element[data-text-element-id="{page.evaluate("__P4332.textId")}"]')
    page.evaluate("id=>{clearMultiSelection();selectedTextElementIds=new Set([id]);state.selectedNodeId=null;state.selectedLinkId=null;state.linkSourceId=null;state.selectedElementId=id;refreshSelectionUI()}",page.evaluate("__P4332.textId"));page.wait_for_timeout(160)
    tcorner=text_el.locator('.handle-nw');assert computed(tcorner)['display']!='none'
    east=text_el.locator('.handle-e');east_style=computed(east);eb=east.bounding_box();tb=text_el.bounding_box()
    assert east_style['display']!='none' and float(east_style['opacity'])==0,east_style
    debug=page.evaluate("id=>({viewport:{...state.viewport},geometry:KGGraphModel.textElementGeometryOf(textElementById(id)),scroll:[scrollX,scrollY],world:getComputedStyle(world).transform})",page.evaluate("__P4332.textId"))
    assert eb['height']>=tb['height']-2,(eb,tb,debug)
    old_width=page.evaluate("id=>KGGraphModel.textElementGeometryOf(textElementById(id)).width",page.evaluate("__P4332.textId"))
    page.mouse.move(eb['x']+eb['width']/2,eb['y']+eb['height']/2);page.mouse.down();page.mouse.move(eb['x']+eb['width']/2+75,eb['y']+eb['height']/2,steps=7);page.mouse.up();page.wait_for_timeout(180)
    new_width=page.evaluate("id=>KGGraphModel.textElementGeometryOf(textElementById(id)).width",page.evaluate("__P4332.textId"))
    assert new_width>old_width+45,(old_width,new_width)

    # Mixed multi-selection: every element has its own 1px frame, all per-item handles are hidden.
    page.evaluate("clearSelection();state.viewport={x:0,y:0,scale:1};render()")
    page.wait_for_timeout(160)
    circle=page.locator(f'.knowledge-card[data-node-id="{page.evaluate("__P4332.nodeIds[0]")}"]')
    rect=page.locator(f'.knowledge-card[data-node-id="{page.evaluate("__P4332.nodeIds[2]")}"]')
    text_el=page.locator(f'.graph-text-element[data-text-element-id="{page.evaluate("__P4332.textId")}"]')
    marquee(page,[circle.bounding_box(),rect.bounding_box(),text_el.bounding_box()],16)
    selected=page.evaluate("()=>({nodes:[...selectedNodeIds],texts:[...selectedTextElementIds]})")
    assert len(selected['nodes'])>=2 and len(selected['texts'])==1,selected
    for locator in [circle,rect,text_el]:
        assert 'multi-selected' in (locator.get_attribute('class') or ''),locator.get_attribute('class')
        layer=locator.locator('.graph-element-resize-layer');assert computed(layer)['borderTopWidth']=='1px'
        for i in range(locator.locator('.graph-element-resize-handle').count()):
            assert computed(locator.locator('.graph-element-resize-handle').nth(i))['display']=='none'
    bounds=page.locator('.uc-selection-bounds:not([hidden])');assert bounds.is_visible()
    assert bounds.locator('i').count()==4
    for i in range(4): assert computed(bounds.locator('i').nth(i))['display']=='none'

    # Efficient mode keeps selection and direct resizing available.
    page.evaluate("KGHomeInteractionModes.setMode('efficient',{announce:false});clearSelection();render()")
    page.wait_for_timeout(220)
    assert page.evaluate("KGHomeInteractionModes.can('nodeResize')") is True
    circle=page.locator(f'.knowledge-card[data-node-id="{page.evaluate("__P4332.nodeIds[0]")}"]');circle.click();page.wait_for_timeout(120)
    se=circle.locator('.handle-se');assert computed(se)['display']!='none'
    before=page.evaluate("id=>KGGraphModel.geometryOf(nodeById(id))",page.evaluate("__P4332.nodeIds[0]"));sb=se.bounding_box()
    page.mouse.move(sb['x']+sb['width']/2,sb['y']+sb['height']/2);page.mouse.down();page.mouse.move(sb['x']+sb['width']/2+50,sb['y']+sb['height']/2+50,steps=6);page.mouse.up();page.wait_for_timeout(180)
    after=page.evaluate("id=>KGGraphModel.geometryOf(nodeById(id))",page.evaluate("__P4332.nodeIds[0]"))
    assert after['width']>before['width']+30 and after['height']>before['height']+30,(before,after)

def main():
  with sync_playwright() as p:
    launch_options={'headless':True,'args':ARGS}
    if Path('/usr/bin/chromium').exists(): launch_options['executable_path']='/usr/bin/chromium'
    browser=p.chromium.launch(**launch_options)
    page=browser.new_page(viewport={'width':1600,'height':1000});errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)));page.on('console',lambda m:errors.append(m.text) if m.type=='error' else None)
    load(page);case(page);assert not errors,errors
    page.close();browser.close()
  print('v90-p4332-browser-pass home-geometric-selection')
if __name__=='__main__':main()
