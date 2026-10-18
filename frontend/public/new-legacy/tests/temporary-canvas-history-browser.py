"""Source integration: one chronological temporary history for cards and ink."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[1]

def setup(browser, readonly=False):
    page=browser.new_page(viewport={'width':1200,'height':800})
    page.set_content('<style>body{margin:0}.related-canvas-body{position:relative;height:650px}.related-canvas-viewport{position:absolute;inset:0;overflow:hidden}.related-canvas-stage{position:absolute;transform-origin:0 0}.related-canvas-info{position:absolute;width:180px;pointer-events:none}.related-canvas-card{position:absolute;width:100px;height:80px;background:#ddd}.related-canvas-edges{position:absolute}.related-canvas-header{height:50px}</style>')
    page.add_style_tag(content=(ROOT/'styles/canvas-ink.css').read_text())
    for name in ['graph/graph-model.js','graph/history-controller.js','graph/graph-session.js','graph/selection-controller.js','graph/connection-controller.js','graph/graph-renderer.js','graph/mindmap-layout.js','graph/node-detail-view.js','canvas/dom-interaction.js','canvas/text-box-geometry.js','canvas/text-edit-session.js','canvas/94-canvas-ink.js','graph/related-canvas-controller.js']:
        page.add_script_tag(content=(ROOT/'src'/name).read_text())
    page.evaluate('''readonly=>{window.original={nodes:[KGGraphModel.normalizeNode({id:'a',title:'a',x:0,y:0})],links:[]};window.originalJSON=JSON.stringify(original);window.seq=0;window.openTemporary=()=>{window.session=KGGraphSession.create({kind:'temporary',graph:original});window.controller=KGRelatedCanvasController.create({session,readOnly:readonly,nodeDims:()=>({w:100,h:80}),idFactory:()=> 'node-'+(++seq),ensureMarkers:()=>{},renderRelation:()=>null,renderCard:n=>{const el=document.createElement('div');el.dataset.nodeId=n.id;el.textContent=n.content.title;const g=KGGraphModel.geometryOf(n);el.style.left=g.x+'px';el.style.top=g.y+'px';return el},onClose:()=>controller.close()})};openTemporary()}''',readonly)
    return page

def counts(page,nodes,paths):
    expect(page.locator('.related-canvas-card')).to_have_count(nodes)
    expect(page.locator('.canvas-ink-layer path')).to_have_count(paths)
    assert page.evaluate('JSON.stringify(original)===originalJSON')

def draw(page,y):
    page.locator('button[data-ink-tool=pen]').click()
    page.mouse.move(350,y);page.mouse.down();page.mouse.move(450,y,steps=5);page.mouse.up()

def history(browser):
    page=setup(browser);page.locator('[data-action=ink]').click();page.locator('button[data-ink-tool=select]').click()
    page.locator('[data-action=add]').click();counts(page,2,0)
    assert page.evaluate('session.history.getState().canUndo')
    page.keyboard.press('Control+z');counts(page,1,0)
    # A stroke, a card, and another stroke must share the same chronological stack.
    draw(page,250);counts(page,1,1)
    first=page.locator('.canvas-ink-layer path').first.get_attribute('d')
    page.locator('[data-action=add]').click();counts(page,2,1)
    draw(page,350);counts(page,2,2)
    page.keyboard.press('Control+z');counts(page,2,1)
    page.locator('[data-ink-action=undo]').click();counts(page,1,1)
    page.locator('[data-action=undo]').click();counts(page,1,0)
    page.locator('[data-action=redo]').click();counts(page,1,1)
    assert page.locator('.canvas-ink-layer path').first.get_attribute('d')==first
    page.locator('[data-ink-action=redo]').click();counts(page,2,1)
    page.keyboard.press('Control+Shift+z');counts(page,2,2)
    # Toolbar closed: keyboard/header still traverse exactly the same timeline.
    page.locator('[data-ink-close]').click()
    page.keyboard.press('Control+z');counts(page,2,1)
    page.locator('[data-action=undo]').click();counts(page,1,1)
    page.keyboard.press('Control+z');counts(page,1,0)
    for expected in [(1,1),(2,1),(2,2)]:
        page.keyboard.press('Control+Shift+z');counts(page,*expected)
    page.locator('[data-action=ink]').click()
    # A canceled erase remains transient, without a history entry.
    page.locator('button[data-ink-tool=eraser]').click();before=page.evaluate('session.history.getState().undoCount')
    midpoint=page.locator('.canvas-ink-layer path').first.evaluate('(el)=>{const p=el.getPointAtLength(el.getTotalLength()/2),s=new DOMPoint(p.x,p.y).matrixTransform(el.getScreenCTM());return {x:s.x,y:s.y}}')
    page.mouse.move(midpoint['x'],midpoint['y']);page.mouse.down();page.keyboard.press('Escape');page.mouse.up();counts(page,2,2)
    assert page.evaluate('session.history.getState().undoCount')==before
    page.locator('[data-action=close]').click();page.evaluate('openTemporary()')
    page.locator('[data-action=ink]').click();counts(page,1,0)
    assert page.evaluate('session.history.getState().undoCount')==0
    page.close()

def readonly(browser):
    page=setup(browser,True)
    page.keyboard.press('Delete');page.keyboard.press('Backspace');page.keyboard.press('Control+z');page.keyboard.press('Control+Shift+z')
    counts(page,1,0);assert page.evaluate('session.history.getState().undoCount')==0
    expect(page.locator('[data-action=ink]')).to_have_count(0);page.close()

with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='chrome')
    history(browser);print('PASS temporary chronological history: empty ink/card undo; mixed keyboard/header/ink controls; closed toolbar; cancel; fresh reopen')
    readonly(browser);print('PASS temporary readonly: no mutation or history')
    browser.close()
