"""Real CSS layout regression for shared popovers inside a 320px canvas host."""
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
with sync_playwright() as pw:
 browser=pw.chromium.launch(channel='chrome');page=browser.new_page(viewport={'width':800,'height':600})
 page.set_content('''<div id="host" style="position:relative;width:320px;height:480px;overflow:clip"><div id="toolbar" class="uc-toolbar-shell" style="position:absolute;left:130px;top:190px"><div class="uc-toolbar-main"><button id="trigger">字号</button></div><div class="uc-toolbar-panels"><section id="panel" class="uc-toolbar-popover node-style-popover node-style-font-size-panel show"><div class="font-size-grid numeric">'''+''.join('<button class="node-style-option">'+str(n)+'</button>' for n in [12,14,16,18,20,24,28])+'''</div></section></div></div></div>''')
 for style in ['styles/main.css','styles/unified-canvas-runtime.css','styles/home-graph-components.css']:
  page.add_style_tag(content=(ROOT/style).read_text())
 page.add_script_tag(content=(ROOT/'src/canvas/89-canvas-runtime.js').read_text())
 def place():
  return page.evaluate('''()=>{const host=document.getElementById('host'),toolbar=document.getElementById('toolbar'),panel=document.getElementById('panel'),trigger=document.getElementById('trigger');KGCanvasFloatingToolbarController.positionPopoverPanel({host,root:toolbar,panel,trigger});const h=host.getBoundingClientRect(),p=panel.getBoundingClientRect();return{host:{left:h.left,right:h.right,top:h.top,bottom:h.bottom},panel:{left:p.left,right:p.right,top:p.top,bottom:p.bottom,width:p.width},minWidth:getComputedStyle(panel).minWidth}}''')
 def bounded(result):
  h,p=result['host'],result['panel'];assert p['left']>=h['left']+7.5 and p['right']<=h['right']-7.5,result
  assert p['top']>=h['top']+7.5 and p['bottom']<=h['bottom']-7.5,result
 narrow=place();bounded(narrow);assert narrow['panel']['width']<=304,narrow
 # A later wider host must recover its original CSS minimum, not stay at 304.
 page.evaluate('host.style.width="700px"');wide=place();assert wide['panel']['width']>=316,wide
 page.evaluate('host.style.width="320px"');bounded(place())
 # Inline minimum and content-box consumers obey the same external bounds.
 page.evaluate('''()=>{const next=panel.cloneNode(true);panel.remove();next.id='panel';next.style.cssText='min-width:340px;box-sizing:content-box';document.getElementById('toolbar').querySelector('.uc-toolbar-panels').append(next)}''')
 bounded(place())
 print('PASS real 320px DOM popover bounds, width restoration and inline/content-box minima')
 browser.close()
