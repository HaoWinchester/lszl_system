"""Real CSS layout regression for shared popovers inside a 320px canvas host."""
from pathlib import Path
import argparse,json
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--base-url');args=parser.parse_args()
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

if args.base_url:
 out=ROOT.parent/'artifacts/toolbar-placement';out.mkdir(parents=True,exist_ok=True)
 with sync_playwright() as pw:
  browser=pw.chromium.launch(channel='chrome');context=browser.new_context(viewport={'width':1440,'height':900})
  assert context.request.post(args.base_url+'/api/v1/auth/login',data={'username':'ink-browser','password':'ink-browser-test'}).ok
  page=context.new_page();page.goto(args.base_url+'/graph',wait_until='networkidle')
  for selector in ['#learningEntryDismissBtn','.tour-skip','#hideHelpBtn']:
   if page.locator(selector).is_visible():page.locator(selector).click()
  page.locator('.graph-mode-trigger').click();page.locator('[data-graph-mode-option=professional]').click()
  results=[]
  def inspect(menu):
   return page.locator('#'+menu+'Shell').evaluate('''shell=>{const panel=shell.querySelector('.floating-submenu'),toolbar=document.querySelector('#floatingToolbox'),trigger=shell.querySelector('button'),rect=el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};return {panel:rect(panel),toolbar:rect(toolbar),trigger:rect(trigger),host:rect(document.querySelector('#stage')),global:rect(document.querySelector("#kgGlobalShortcuts")),placement:shell.dataset.panelPlacement,clickable:[...panel.querySelectorAll('button')].every(button=>{const r=button.getBoundingClientRect();return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest('button')===button})}}''')
  def verify(menu):
   page.locator('#'+menu).click();page.wait_for_timeout(180);data=inspect(menu);results.append(data)
   (out/'menus.json').write_text(json.dumps(results,ensure_ascii=False,indent=2));p,t,h=data['panel'],data['toolbar'],data['host']
   page.screenshot(path=str(out/('menu-'+menu+'.png')))
   assert p['left']>=h['left']+7 and p['right']<=h['right']-7 and p['top']>=h['top']+7 and p['bottom']<=h['bottom']-7,data
   assert p['left']>=t['right']+6 or p['right']<=t['left']-6,'menu must open alongside toolbar: '+str(data)
   assert abs((p['top']+p['bottom']-data['trigger']['top']-data['trigger']['bottom'])/2)<=p['height']/2,data
   assert data['clickable'],data
   page.locator('#'+menu).press('Escape');assert page.locator('#'+menu).get_attribute('aria-expanded')=='false'
  def move_toolbar(x,y):
   r=page.locator('#floatingToolboxHandle').bounding_box();page.mouse.move(r['x']+r['width']/2,r['y']+r['height']/2);page.mouse.down();page.mouse.move(x,y,steps=8);page.mouse.up()
  for width,height in [(1440,900),(1280,720),(1024,768)]:
   page.set_viewport_size({'width':width,'height':height})
   for x,y in [(60,155),(width-65,155),(60,height-350),(width-65,height-350)]:
    move_toolbar(x,y)
    for menu in ['relationViewMenuBtn','sizeMenuBtn','lineStyleMenuBtn']:verify(menu)
  # Keep an open menu attached and bounded when resize moves the toolbar itself.
  page.set_viewport_size({'width':1440,'height':900});move_toolbar(1375,500);page.locator('#relationViewMenuBtn').click();page.set_viewport_size({'width':1024,'height':640});page.wait_for_timeout(180)
  data=inspect('relationViewMenuBtn');assert data['panel']['right']<=data['host']['right']-7 and data['panel']['bottom']<=data['host']['bottom']-7,data
  page.locator('#relationViewMenuBtn').press('Escape')
  original=page.evaluate('largeGraphOverviewEnabled')
  page.locator('#relationViewMenuBtn').click();page.locator('#largeGraphLinesBtn').click();assert page.evaluate('largeGraphOverviewEnabled') is not original
  assert page.locator('#relationViewMenuBtn').get_attribute('aria-expanded')=='false'
  page.locator('#relationViewMenuBtn').click();page.locator('#largeGraphLinesBtn').click();assert page.evaluate('largeGraphOverviewEnabled') is original
  page.locator('#canvasFullscreenBtn').click();page.wait_for_function('document.fullscreenElement?.id==="stage"')
  verify('relationViewMenuBtn');page.locator('#canvasFullscreenBtn').click();page.wait_for_function('!document.fullscreenElement')
  page.set_viewport_size({'width':1440,'height':900});move_toolbar(60,155);page.locator('#relationViewMenuBtn').click();page.wait_for_timeout(180);page.screenshot(path=str(out/'relation-after.png'))
  page.locator('#relationViewMenuBtn').press('Escape');page.locator('#cardsLayer .knowledge-card').first.click();page.wait_for_timeout(200)
  h=page.locator('#detailPanel .detail-top').bounding_box();page.mouse.move(h['x']+h['width']/2,h['y']+20);page.mouse.down();page.mouse.move(1230,740,steps=8);page.mouse.up()
  for width,height in [(1024,640),(800,600),(390,600),(1440,900)]:
   page.set_viewport_size({'width':width,'height':height});page.wait_for_timeout(200)
   r=page.locator('#detailPanel').bounding_box();assert r['x']>=0 and r['y']>=0 and r['x']+r['width']<=width and r['y']+r['height']<=height,r
   assert page.locator('#closeDetailBtn').evaluate('b=>{const r=b.getBoundingClientRect();return b.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))}')
  page.locator('#closeDetailBtn').click();assert not page.locator('#detailPanel').is_visible()
  page.locator('#graphSearchBtn').click();field=page.locator('#graphSearchInput');r=field.bounding_box();field.click(position={'x':15,'y':r['height']/2});field.fill('知识')
  assert field.evaluate('e=>document.activeElement===e');page.locator('#graphSearchCloseBtn').click();assert not page.locator('#graphSearchPanel').is_visible()
  page.set_viewport_size({'width':800,'height':600});page.locator('#graphPrefsBtn').click();page.locator('[data-meta-submenu=preferences]').click();prefs=page.locator('#graphPrefsMenu');page.wait_for_timeout(150)
  r=prefs.bounding_box();assert r['x']>=8 and r['x']+r['width']<=792,r
  assert prefs.locator('.graph-prefs-close').evaluate('b=>{const r=b.getBoundingClientRect();return b.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))}')
  prefs.locator('.graph-prefs-close').click();assert not prefs.is_visible()
  browser.close();print('PASS actual home relation/size/line menus: three viewports, four toolbar corners, real drag, hit testing, Escape, open-menu resize, actual toggle/restore and fullscreen')
