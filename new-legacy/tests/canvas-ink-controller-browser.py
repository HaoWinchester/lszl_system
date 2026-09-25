"""Real pointer/DOM tests for the shared ink controller, independent of page data."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT = Path(__file__).resolve().parents[1]

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True, executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    page = browser.new_page(viewport={'width': 1100, 'height': 780})
    errors=[]
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.set_content('''<style>#view{position:relative;width:1000px;height:680px;overflow:hidden;background:#f8fafc}#world{position:absolute;transform-origin:0 0;transform:translate(100px,100px) scale(2)}#card{position:absolute;width:160px;height:90px;background:white;border:1px solid #ccc}</style><div id="view"><div id="world"><button id="card">卡片选项</button></div></div>''')
    page.add_style_tag(content=(ROOT/'styles/canvas-ink.css').read_text())
    for name in ['83-canvas-history-controller.js','94-canvas-ink.js']:
        page.add_script_tag(content=(ROOT/'src/canvas'/name).read_text())
    page.evaluate('''() => {
      window.strokes=[];window.locked=false;window.cardClicks=0;window.errors=[];window.panStarts=0;
      document.querySelector('#card').onclick=()=>window.cardClicks++;
      document.querySelector('#view').addEventListener('pointerdown',()=>window.panStarts++);
      window.ink=KGCanvasInk.create({viewport:document.querySelector('#view'),world:document.querySelector('#world'),getViewport:()=>({x:100,y:100,scale:2}),getStrokes:()=>window.strokes,setStrokes:s=>{window.strokes=s},isReadonly:()=>window.locked,onError:message=>window.errors.push(message)});
    }''')
    pen=page.get_by_role('button',name='画笔',exact=True)
    pen.click()
    page.evaluate('''() => {
      window.overlayClicks=0;
      for(const [index,attribute] of ['class="qw-analysis-panel"','data-canvas-ui','data-stage-ui'].entries()){
        const overlay=document.createElement('aside');
        overlay.innerHTML=`<div ${attribute}><button id="overlay-${index}">关闭面板</button></div>`;
        Object.assign(overlay.style,{position:'absolute',left:'220px',top:(index*50)+'px'});
        overlay.querySelector('button').onclick=()=>window.overlayClicks++;
        document.querySelector('#world').append(overlay);
      }
    }''')
    for index in range(3):
        page.locator(f'#overlay-{index}').click()
    assert page.evaluate('overlayClicks')==3
    assert page.evaluate('strokes.length')==0
    page.evaluate('panStarts=0')
    page.mouse.move(148,158);page.mouse.down();page.mouse.move(220,190,steps=10);page.mouse.up()
    assert page.evaluate('strokes.length')==1
    assert page.evaluate('strokes[0].points[0]')==[20,25]
    assert page.evaluate('cardClicks')==0 and page.evaluate('panStarts')==0
    assert page.locator('.canvas-ink-layer path').get_attribute('stroke-width')=='3'
    page.get_by_role('button',name='荧光笔',exact=True).click()
    page.get_by_role('button',name='红色',exact=True).click()
    page.get_by_role('slider',name='笔迹粗细').fill('24')
    page.mouse.move(148,220);page.mouse.down();page.mouse.move(230,220,steps=6);page.mouse.up()
    assert page.evaluate('strokes[1].color')=='#ef4444' and page.evaluate('strokes[1].width')==24
    assert page.locator('.canvas-ink-layer path').nth(1).get_attribute('opacity')=='0.3'
    page.get_by_role('button',name='撤销笔迹',exact=True).click();assert page.evaluate('strokes.length')==1
    page.get_by_role('button',name='重做笔迹',exact=True).click();assert page.evaluate('strokes.length')==2
    page.once('dialog',lambda dialog:dialog.dismiss());page.get_by_role('button',name='清空笔迹',exact=True).click();assert page.evaluate('strokes.length')==2
    page.once('dialog',lambda dialog:dialog.accept());page.get_by_role('button',name='清空笔迹',exact=True).click();assert page.evaluate('strokes.length')==0
    page.get_by_role('button',name='撤销笔迹',exact=True).click();assert page.evaluate('strokes.length')==2
    page.mouse.move(500,200);page.mouse.down();page.mouse.move(550,250)
    page.evaluate("document.querySelector('#view').dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,bubbles:true}))")
    page.mouse.up();assert page.evaluate('strokes.length')==2
    page.keyboard.press('Escape');page.wait_for_timeout(450);page.locator('#card').click();assert page.evaluate('cardClicks')==1
    pen.click();page.keyboard.down('Space');page.mouse.click(600,300);page.keyboard.up('Space');assert page.evaluate('panStarts')>=1
    page.evaluate('locked=true;ink.render()');expect(pen).to_be_disabled();assert page.evaluate('ink.tool')=='select'
    page.evaluate('locked=false;strokes=[];ink.reset()');expect(page.get_by_role('button',name='撤销笔迹',exact=True)).to_be_disabled()
    # Actual touch pointer lifecycle through DOM Pointer Events, including cancellation.
    pen.click()
    page.evaluate('''() => {const el=document.querySelector('#view');for(const [type,x] of [['pointerdown',500],['pointermove',540],['pointerup',560]])el.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:7,pointerType:'touch',isPrimary:true,button:0,clientX:x,clientY:200}));}''')
    # Synthetic pointer capture is unavailable: controller cancels safely rather than leaving half a stroke.
    assert page.evaluate('strokes.length')==0
    assert errors==[],errors
    page.evaluate('ink.destroy()');assert page.locator('.canvas-ink-toolbar').count()==0
    browser.close()
print('canvas-ink-controller-browser: all interaction checks passed')
