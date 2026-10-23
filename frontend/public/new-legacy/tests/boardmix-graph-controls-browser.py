"""Graph toolbar polish, shared new text and target avoidance on a disposable DB."""
import argparse,re,uuid
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
p=argparse.ArgumentParser();p.add_argument('--base-url',required=True);base=p.parse_args().base_url.rstrip('/');assert base.startswith('http://127.0.0.1:')
out=Path(__file__).resolve().parents[2]/'artifacts/boardmix-interaction-polish/task-2';out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as pw:
 browser=pw.chromium.launch(channel='chrome');ctx=browser.new_context(viewport={'width':1440,'height':1000})
 assert ctx.request.post(base+'/api/v1/auth/login',data={'username':'ink-browser','password':'ink-browser-test'}).ok
 graph={'nodes':[{'id':'a','title':'学习计划','x':400,'y':220},{'id':'b','title':'理解知识','x':780,'y':520}], 'links':[{'id':'ab','from':'a','to':'b','pathStyle':'curve'}], 'elements':[{'id':'old','elementType':'text','text':'历史文字','x':820,'y':120,'width':180,'height':80,'fontSize':20,'manualSize':True}], 'viewport':{'x':0,'y':0,'scale':1}}
 r=ctx.request.post(base+'/api/v1/files',data={'name':'控件回归'+uuid.uuid4().hex[:8],'graphData':graph});assert r.ok;fid=r.json()['file']['id'];assert ctx.request.put(base+'/api/v1/files/current',data={'fileId':fid}).ok
 page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 def ready():
  page.wait_for_function('!!window.KGHomeInk&&!KGGraphFileTabs.isSwitching()')
  for s in ['#learningEntryDismissBtn','.tour-skip','#hideHelpBtn']:
   if page.locator(s).is_visible():page.locator(s).click()
 def mode(value):
  page.locator('.graph-mode-trigger').click();page.locator('[data-graph-mode-option="'+value+'"]').click()
 page.goto(base+'/index.html',wait_until='networkidle');ready();mode('professional')
 expect(page.locator('#upgradeMemberBtn')).to_be_hidden()
 page.evaluate('()=>{state.viewport={x:0,y:0,scale:1};applyTransform();state.selectedNodeId="a";selectedNodeIds.add("a");refreshSelectionUI()}')
 # Visible text entry must activate the same shared editor, not create a native element.
 page.locator('#addTextElementBtn').click();expect(page.locator('.canvas-ink-toolbar')).to_be_visible();expect(page.locator('button[data-ink-tool=text]')).to_have_attribute('aria-pressed','true')
 assert page.evaluate('state.selectedNodeId') is None
 page.mouse.click(300,720);editor=page.locator('.canvas-ink-text-editor');expect(editor).to_be_focused();editor.fill('左栏文字');page.mouse.click(1100,720);expect(editor).to_have_count(0)
 assert page.evaluate('state.elements.length')==1
 page.locator('button[data-ink-tool=text]').click();page.mouse.click(500,720);expect(editor).to_be_focused();editor.fill('画笔文字');page.mouse.click(1100,720);expect(editor).to_have_count(0)
 assert page.evaluate('state.strokes.filter(s=>s.tool==="text").map(s=>s.text)')==['左栏文字','画笔文字']
 page.locator('#addTextElementBtn').click();page.mouse.click(650,720);editor.fill('取消草稿');page.keyboard.press('Escape');expect(editor).to_have_count(0);assert page.evaluate('state.strokes.length')==2
 page.evaluate('KGHomeInk.setOpen(false)');assert page.evaluate('persistCurrentGraphNow()')
 page.reload(wait_until='networkidle');ready();mode('professional');assert page.evaluate('state.strokes.length')==2
 assert page.evaluate('startTextElementInlineEdit("old")');old=page.locator('[data-node-inline-editor=true]');old.fill('历史仍可编辑');page.mouse.click(1100,720);expect(old).to_have_count(0)
 assert page.evaluate('KGGraphFileAutosave.saveAcknowledged({force:true})')
 assert ctx.request.get(base+'/api/v1/files/'+fid).json()['graphData']['elements'][0]['text']=='历史仍可编辑'
 # Deferred initial caret placement must not replace a selection the user already made.
 page.evaluate("()=>{const raf=requestAnimationFrame;window.initialCaretFrames=[];window.requestAnimationFrame=cb=>{initialCaretFrames.push(cb);return 0};try{startTextElementInlineEdit('old')}finally{window.requestAnimationFrame=raf}}")
 old=page.locator('[data-node-inline-editor=true]');old.focus()
 page.evaluate("()=>{const e=document.querySelector('[data-node-inline-editor=true]'),r=document.createRange();r.selectNodeContents(e);getSelection().removeAllRanges();getSelection().addRange(r)}")
 selected=page.evaluate('getSelection().toString()');assert selected=='历史仍可编辑'
 page.evaluate('()=>{for(const callback of initialCaretFrames)callback(performance.now());initialCaretFrames=[]}')
 assert page.evaluate('getSelection().toString()')==selected, 'Initial caret callback replaced the user selection'
 page.keyboard.press('Escape')
 # Entering shared text preserves failed and IME-composing historical drafts.
 def fail(route):
  if route.request.method in ('POST','PUT','PATCH','DELETE'):route.fulfill(status=503,content_type='application/json',body='{"detail":"offline"}')
  else:route.continue_()
 for scenario in ['failed','composing']:
  assert page.evaluate('startTextElementInlineEdit("old")');old.fill('历史未完成'+scenario)
  if scenario=='failed':page.route('**/api/v1/files/**',fail)
  else:old.dispatch_event('compositionstart')
  page.locator('#addTextElementBtn').click();expect(old).to_have_text('历史未完成'+scenario);expect(old).to_have_attribute('contenteditable','plaintext-only')
  if scenario=='failed':expect(old).to_have_attribute('data-save-state','failed');page.unroute('**/api/v1/files/**',fail)
  else:old.dispatch_event('compositionend')
  page.evaluate('nodeInlineTextEditorController.commit()');expect(old).to_have_count(0);page.evaluate('KGHomeInk.setOpen(false)')
 # Main toolbar retains original direct entries and two-column layout.
 page.locator('#stage').focus();page.keyboard.press('2');assert page.evaluate('state.defaults.nodeSize')=='big'
 expect(page.locator('#toolbarFormatBtn')).to_have_count(0);expect(page.locator('#toolbarFormatPanel')).to_have_count(0)
 rail=page.locator('#floatingToolbox')
 direct=['templateBtn','addBtn','addTextElementBtn','focusBtn','flashcardBtn','graphQuestionBatchBtn','homeInkBtn','homeCaptureBtn','mindmapBtn','sizeMenuBtn','lineStyleMenuBtn','lineColorPicker','pointerModeBtn','flowModeBtn','relationViewMenuBtn']
 for id in direct:
  control=page.locator('#'+id)
  if id=='lineColorPicker':control=control.locator('..')
  expect(control).to_be_visible()
  assert control.evaluate('(e)=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}'),id
 grid=rail.locator('.floating-toolbox-grid');assert grid.evaluate('(e)=>getComputedStyle(e).gridTemplateColumns').split()==['40px','40px']
 # Absolute secondary menus can extend scrollHeight even while closed. Check
 # the actual main entries, which must fit and were hit-tested above.
 assert grid.evaluate('''e=>{const r=e.getBoundingClientRect();return [...e.children].filter(c=>c.getBoundingClientRect().width).every(c=>{const q=c.getBoundingClientRect();return q.left>=r.left-1&&q.right<=r.right+1&&q.top>=r.top-1&&q.bottom<=r.bottom+1})}'''),'all main entries fit without hidden scrolling'
 page.locator('#addTextElementBtn').hover();expect(page.locator('.home-toolbar-hint')).to_have_text('文本');page.mouse.move(1100,720)
 page.locator('#sizeMenuBtn').click();page.locator('#sizeSmallBtn').click();assert page.evaluate('state.defaults.nodeSize')=='small'
 page.locator('#lineStyleMenuBtn').click();page.locator('#lineDashedBtn').click();assert page.evaluate('state.defaults.linkStyle')=='dashed'
 page.locator('#lineColorPicker').locator('..').click();picker=page.locator('.graph-floating-color-window');expect(picker).to_be_visible();swatch=picker.locator('[data-picker-swatch]').first;color=swatch.get_attribute('data-picker-swatch');swatch.click();assert page.evaluate('currentCanvasColor()').lower()==color.lower();page.keyboard.press('Escape')
 page.locator('#homeInkBtn').click();expect(page.locator('.canvas-ink-toolbar')).to_be_visible();page.locator('#homeInkBtn').click()
 page.screenshot(path=str(out/'main-toolbar-restored.png'))
 page.locator('#mindmapBtn').click();mindmap=page.locator('[data-formal-mindmap-panel]');expect(mindmap).to_be_visible();assert mindmap.bounding_box()['height']<70;page.screenshot(path=str(out/'mindmap-settings-preserved.png'));mindmap.get_by_role('button',name='关闭布局与主题').click()
 # Names/current states and visible primary versus discoverable auxiliary controls.
 page.evaluate('()=>{clearSelection();selectLink("ab")}')
 primary=page.locator('[data-edge-control-kind=curve-midpoint]');aux=page.locator('[data-edge-control-kind=curve-control]').first
 expect(primary).to_have_attribute('data-edge-control-index','2');expect(aux).to_have_attribute('tabindex','0')
 assert float(aux.locator('.edge-control-dot').evaluate('(e)=>getComputedStyle(e).opacity'))<1
 aux.focus();page.wait_for_timeout(200);assert float(aux.locator('.edge-control-dot').evaluate('(e)=>getComputedStyle(e).opacity'))==1
 line=page.locator('[data-uc-edge-panel=line]');line.click();expect(page.locator('[data-uc-edge-popover=line]').get_by_role('button',name='曲线',exact=True)).to_have_attribute('aria-pressed','true')
 page.locator('[data-uc-edge-popover=line]').get_by_role('button',name='折线',exact=True).click();expect(line).to_have_attribute('aria-label','线条类型：折线')
 line.click();page.locator('[data-uc-edge-popover=line]').get_by_role('button',name='曲线',exact=True).click()
 # A real grip drag keeps its dock after panning and a double-click resets it.
 grip=page.locator('#edgeQuickStylePanel [data-uc-toolbar-drag]');box=grip.bounding_box();page.mouse.move(box['x']+15,box['y']+15);page.mouse.down();page.mouse.move(box['x']+75,box['y']+65,steps=8);page.mouse.up();assert page.evaluate('selectedEdgeQuickStyleToolbarController.isManual()')
 dock=page.locator('#edgeQuickStylePanel').bounding_box();page.evaluate('()=>{state.viewport.x+=20;applyTransform()}');after=page.locator('#edgeQuickStylePanel').bounding_box();assert abs(dock['x']-after['x'])<2 and abs(dock['y']-after['y'])<2
 grip.dblclick();assert not page.evaluate('selectedEdgeQuickStyleToolbarController.isManual()');page.evaluate('()=>{state.viewport.x=0;applyTransform()}')
 # Approved update: secondary panels stay below their own trigger, including near selected curves.
 for scale in [1,.5,2]:
  page.evaluate('(scale)=>{state.viewport.scale=scale;applyTransform();selectedEdgeQuickStyleToolbarController.setPosition(500,260)}',scale)
  for name in ['color','line','ports']:
   trigger=page.locator('[data-uc-edge-panel='+name+']');trigger.click();panel=page.locator('[data-uc-edge-popover='+name+']');expect(panel).to_be_visible();page.wait_for_timeout(170)
   result=panel.evaluate('''e=>{const p=e.getBoundingClientRect(),s=stage.getBoundingClientRect(),rects=selectedEdgePopoverAvoidRects();return {bounded:p.left>=s.left&&p.right<=s.right&&p.top>=s.top&&p.bottom<=s.bottom,overlap:rects.some(r=>p.left<r.right&&p.right>r.left&&p.top<r.bottom&&p.bottom>r.top)}}''')
   assert page.evaluate('stage.scrollLeft===0&&stage.scrollTop===0'),page.evaluate('({x:stage.scrollLeft,y:stage.scrollTop})')
   t=trigger.bounding_box();p=panel.bounding_box()
   assert result['bounded'] and abs(p['y']-(t['y']+t['height']+8))<2,(scale,name,result,p,t)
   page.screenshot(path=str(out/f'edge-{scale}-{name}.png'));page.keyboard.press('Escape')
 page.evaluate('()=>{state.viewport.scale=1;applyTransform()}');page.evaluate('selectedEdgeQuickStyleToolbarController.closePanels()');page.wait_for_timeout(180);page.screenshot(path=str(out/'desktop.png'))
 # Fullscreen retains real edge panel hit testing and bounded placement.
 page.evaluate('()=>{const b=document.createElement("button");b.id="task2-fullscreen";b.style.cssText="position:fixed;top:100px;right:30px;z-index:99999";b.textContent="fullscreen";b.onclick=()=>stage.requestFullscreen();document.body.append(b)}');page.locator('#task2-fullscreen').click();page.wait_for_function('!!document.fullscreenElement')
 line.click();popover=page.locator('[data-uc-edge-popover=line]');expect(popover).to_be_visible();page.wait_for_timeout(180)
 assert popover.evaluate('(e)=>{const r=e.getBoundingClientRect(),s=stage.getBoundingClientRect();return r.left>=s.left&&r.right<=s.right&&r.top>=s.top&&r.bottom<=s.bottom}')
 page.screenshot(path=str(out/'fullscreen-edge.png'));page.evaluate('document.exitFullscreen()');page.wait_for_function('!document.fullscreenElement');page.evaluate('document.getElementById("task2-fullscreen").remove()')
 mode('reading');expect(page.locator('#addTextElementBtn')).to_have_count(0);expect(page.locator('#toolbarFormatBtn')).to_have_count(0)
 mode('efficient');expect(page.locator('#addTextElementBtn')).to_be_visible();expect(page.locator('#toolbarFormatBtn')).to_have_count(0)
 page.evaluate('document.body.classList.add("auth-readonly")');assert page.evaluate('KGHomeInk.activateText()') is False;page.evaluate('document.body.classList.remove("auth-readonly")')
 page.set_viewport_size({'width':900,'height':640});mode('professional');assert rail.bounding_box()['y']+rail.bounding_box()['height']<=page.locator('#stage').bounding_box()['y']+page.locator('#stage').bounding_box()['height']-50

 page.locator('#sizeMenuBtn').click();expect(page.locator('#sizeSmallBtn')).to_be_visible();page.wait_for_timeout(180);page.screenshot(path=str(out/'short-viewport.png'));page.locator('#sizeDefaultBtn').click();assert page.evaluate('state.defaults.nodeSize')==''
 # A manually pinned colour window must remain usable when the viewport shrinks.
 page.set_viewport_size({'width':1280,'height':720})
 page.evaluate('''()=>{clearSelection();const n=nodeById('a');Object.assign(n,{x:650,y:240});Object.assign(n.geometry,{x:650,y:240});state.viewport={x:0,y:0,scale:1};render()}''')
 page.locator('.knowledge-card[data-node-id="a"]').click();page.locator('[data-node-toolbar-panel="fill"]').click();page.locator('[data-node-style-panel="fill"] .node-custom-color-btn').click()
 picker=page.locator('.graph-floating-color-window:not([hidden])');expect(picker).to_be_visible()
 # Opening positions the window in an animation frame. Let Playwright confirm
 # the actual header is stable and receives pointer events before a raw drag.
 header=picker.locator('[data-color-window-drag]');header.hover();head=header.bounding_box()
 page.mouse.move(head['x']+40,head['y']+14);page.mouse.down();page.mouse.move(1100,400,steps=8);page.mouse.up();expect(picker).to_have_class(re.compile('manual-close'))
 page.set_viewport_size({'width':1024,'height':640});page.wait_for_timeout(180)
 assert picker.evaluate('''e=>{const r=e.getBoundingClientRect(),s=stage.getBoundingClientRect();return r.left>=s.left+7&&r.right<=s.right-7&&r.top>=s.top+7&&r.bottom<=s.bottom-7&&[...e.querySelectorAll('button,input')].filter(b=>!b.disabled&&b.getBoundingClientRect().width).every(b=>{const q=b.getBoundingClientRect();return b.contains(document.elementFromPoint(q.x+q.width/2,q.y+q.height/2))})}''')
 page.keyboard.press('Escape');expect(picker).to_be_hidden()
 # A bottom-edge context menu fits, but its taller layer submenu also needs
 # independent vertical bounds. Exercise real right clicks and every action hit.
 minimap=page.locator('.uc-minimap-toggle');minimap_was_open=minimap.get_attribute('aria-expanded')=='true'
 if minimap_was_open:minimap.click()
 for width,height in [(1440,900),(1280,720),(1024,640),(800,600)]:
  page.set_viewport_size({'width':width,'height':height})
  if not page.evaluate('graphModeAllows("contextMenuAdvanced")'):continue
  for corner,(x,y) in enumerate([(150,90),(width-290,90),(150,height-240),(width-290,height-240)]):
   page.evaluate('''([x,y])=>{clearSelection();state.viewport={x:0,y:0,scale:1};const n=nodeById('a');Object.assign(n,{x,y});Object.assign(n.geometry,{x,y});render()}''',[x,y-38])
   card=page.locator('.knowledge-card[data-node-id="a"]');card.click(button='right',position={'x':75,'y':90})
   menu=page.locator('.graph-context-menu');expect(menu).to_be_visible();menu.locator('[data-graph-context-action="layer"]').hover();page.wait_for_timeout(160)
   submenu=menu.locator('.graph-context-submenu')
   result=submenu.evaluate('''e=>{const r=e.getBoundingClientRect(),s=stage.getBoundingClientRect();return {bounded:r.left>=s.left+7&&r.right<=s.right-7&&r.top>=s.top+7&&r.bottom<=s.bottom-7,hits:[...e.querySelectorAll('button')].every(b=>{const r=b.getBoundingClientRect();return b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})}}''')
   assert result['bounded'] and result['hits'],(width,height,corner,result)
   # Alternate destinations so every real click must change the node ordering.
   destination='back' if page.evaluate('state.nodes.at(-1).id==="a"') else 'front'
   menu.locator('[data-graph-context-action="layer:'+destination+'"]').click();expect(menu).to_be_hidden();assert page.evaluate('side=>state.nodes.at(side==="front"?-1:0).id',destination)=='a'
   if page.locator('#closeDetailBtn').is_visible():page.locator('#closeDetailBtn').click()
   card.click(button='right',position={'x':75,'y':90});menu.locator('[data-graph-context-action="layer"]').hover();page.keyboard.press('Escape');expect(menu).to_be_hidden()
 if minimap_was_open:minimap.click()
 assert not errors,errors;ctx.request.delete(base+'/api/v1/files/'+fid);browser.close()
print('PASS restored direct main toolbar, original two columns, shared text/modes, handles and target-avoiding popovers')
