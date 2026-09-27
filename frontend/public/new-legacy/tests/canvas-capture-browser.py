"""Visible viewport PNG export through a real browser, including clipped ink and images."""
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT.parent/'artifacts/canvas-tools';OUT.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
 b=p.chromium.launch();page=b.new_page(viewport={'width':800,'height':600},device_scale_factor=1)
 page.set_content('''<style>#view{position:relative;width:400px;height:280px;background:rgb(240,245,250);overflow:hidden}#world{position:absolute;transform-origin:0 0;transform:translate(40px,20px) scale(1.5)}.card{width:180px;height:100px;background:white;color:rgb(20,30,40);font:20px sans-serif}.outside{position:absolute;left:400px;top:0;width:100px;height:100px;background:magenta}svg{position:absolute;left:0;top:0;overflow:visible}</style><button id="capture">截图</button><div id="view"><div id="world"><div class="card">中文题目与知识图谱</div><img style="position:absolute;left:0;top:120px;width:40px;height:40px" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Crect width='40' height='40' fill='red'/%3E%3C/svg%3E"><div class="outside"></div><svg width="1" height="1"><path d="M 0 70 L 160 70" stroke="#00bb00" stroke-width="5"/></svg></div><div data-canvas-ui style="position:absolute;right:0;top:0;width:60px;height:60px;background:blue">工具</div></div>''')
 module=ROOT/'src/canvas/96-canvas-capture.js'
 if module.exists():page.add_script_tag(content=module.read_text())
 assert page.evaluate('typeof KGCanvasCapture')=='object','Shared current-viewport capture module is required'
 page.evaluate("window.errors=[];KGCanvasCapture.bind(document.querySelector('#capture'),document.querySelector('#view'),{filename:'当前画布',onError:message=>errors.push(message)})")
 with page.expect_download() as pending:page.locator('#capture').click()
 download=pending.value;assert download.suggested_filename.startswith('当前画布');download.save_as(OUT/'capture-fixture.png');im=Image.open(OUT/'capture-fixture.png').convert('RGB');assert im.size==(400,280),im.size
 colors=im.getdata();assert sum(r>200 and g<70 and b<70 for r,g,b in colors)>1000,'image missing';assert sum(g>130 and r<50 and b<70 for r,g,b in colors)>400,'ink missing';assert sum(r<30 and g<30 and b>230 for r,g,b in colors)==0,'UI must be excluded';assert sum(r>230 and b>230 and g<30 for r,g,b in colors)==0,'offscreen must be clipped';assert sum(max(r,g,b)<100 for r,g,b in colors)>100,'text missing'
 expect(page.locator('#capture')).to_be_enabled();assert page.evaluate('errors')==[]
 page.evaluate("const img=document.createElement('img');img.src='https://invalid.invalid/offscreen.png';img.style.cssText='position:absolute;left:5000px;top:5000px;width:100px;height:100px';document.querySelector('#world').append(img)")
 page.route('https://invalid.invalid/**',lambda route:route.abort())
 with page.expect_download():page.locator('#capture').click()
 assert page.evaluate('errors')==[], 'invisible missing asset must not block visible capture'
 held=[]
 page.route('https://capture.test/slow.svg',lambda route:held.append(route))
 page.evaluate("document.querySelector('img').src='https://capture.test/slow.svg'")
 with page.expect_download():
  page.locator('#capture').click()
  expect(page.locator('#capture')).to_be_disabled()
  page.locator('#capture').evaluate('el=>{el.click();el.click()}')
  for _ in range(100):
   if len(held)>=2:break
   page.wait_for_timeout(10)
  assert len(held)==2, 'exactly the live image request and one export request'
  for route in held:route.fulfill(status=200,content_type='image/svg+xml',headers={'Access-Control-Allow-Origin':'*'},body='<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="red"/></svg>')
 expect(page.locator('#capture')).to_be_enabled()
 page.evaluate("document.querySelector('img').src='https://invalid.invalid/missing.png'")
 page.route('https://invalid.invalid/**',lambda route:route.abort())
 page.locator('#capture').click();page.wait_for_function('errors.length>0');expect(page.locator('#capture')).to_be_enabled()
 assert page.evaluate("document.querySelector('#view').style.visibility")=='','failure must not hide live canvas'
 b.close()
print('canvas-capture-browser: dimensions, text/image/ink, clipping, UI exclusion and failed asset recovery passed')
