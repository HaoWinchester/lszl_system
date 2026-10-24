"""Real shared renderer/styles: case left, 16:9, overflow and narrow recovery."""
from pathlib import Path
import re
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT.parent/'artifacts/recall-case-layout-20261023';OUT.mkdir(parents=True,exist_ok=True)
CASE={'material':{'id':'layout-case','title':'智能风控 SaaS 平台项目','text':('一家金融科技公司的资深项目经理，正在负责开发一款面向中小企业的智能风控SaaS平台。项目采用敏捷框架，共有6个敏捷团队并行开发不同微服务，总开发周期为12个月。\n产品负责人因健康原因休假，业务方代表临时接管需求决策。团队需要分析变更影响，并在项目治理层面协调交付。\n'*8)},'caseGroup':{'order':2,'total':3}}
CONTENT='<div class="kr-stem qw-card-question-stem">在混合开发模式下，敏捷团队的迭代节奏与预测型团队的计划进度出现偏差，项目经理应采取什么措施？</div><ol class="qw-card-options">'+''.join(f'<li class="qw-card-option"><button class="qw-card-option-key">{key}</button><span class="qw-card-option-copy">{copy}</span></li>' for key,copy in [('A','将敏捷团队也切换为预测型开发模式，统一管理节奏'),('B','取消敏捷开发，全部采用预测型管理以避免冲突'),('C','要求敏捷团队加班追赶预测型团队的进度'),('D','在项目治理层面设定协调点，调整敏捷迭代的目标，使其与预测型团队的实际可用时间对齐')])+'</ol>'
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,channel='chrome')
 for mode in ['recall','workspace']:
  for w,h in [(1920,1080),(1440,960),(1280,720),(390,844)]:
   page=browser.new_page(viewport={'width':w,'height':h},has_touch=w<1000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   page.set_content('<body class="knowledge-recall-page qw-light-canvas"><div class="kr-app" data-theme="parchment"><header class="kr-topbar"><div class="kr-brand"><h1>'+('深度回忆' if mode=='recall' else '多题归纳')+' · 案例布局样例</h1></div></header><main class="kr-viewport" data-theme="parchment"><section id="card" class="'+('kr-question-card' if mode=='recall' else 'qw-question-card')+'" data-display-mode="full"></section></main></div></body>')
   styles=re.findall(r'href="(styles/[^"?]+)',(ROOT/'knowledge-recall.html').read_text())
   for style in styles:page.add_style_tag(path=str(ROOT/style))
   page.add_style_tag(content='#card{left:50%;top:50%;transform:translate(-50%,-50%)}')
   if mode=='workspace' and w<1000:
    # Real coarse-pointer QW uses a scrolling document flow, not recall's centered world.
    page.add_style_tag(content='#card{transform:none;margin:14px;width:calc(100% - 28px)!important}.kr-viewport{overflow:auto;touch-action:pan-y}')
   page.add_script_tag(path=str(ROOT/'src/118-question-materials.js'))
   page.locator('.kr-viewport').evaluate("e=>e.addEventListener('wheel',event=>{window.canvasWheelCount=(window.canvasWheelCount||0)+1;event.preventDefault()},{passive:false})")
   def render(q,content=CONTENT):
    page.evaluate('''({q,content,mode})=>{const c=document.querySelector('#card');const material=KGQuestionMaterials.renderCardContent(q,content);c.style.width='';c.style.height='';c.innerHTML=mode==='recall'?'<span class="kr-question-order-badge"><b>3</b><small>/5</small></span>'+material+'<div class="qw-card-actions qw-card-learning-actions"><button>解析</button></div>':'<header class="qw-card-header"><b>3/5</b></header><div class="qw-card-body"><div class="qw-card-content">'+material+'</div><div class="qw-card-actions"><button>解析</button></div></div>';if(mode==='workspace'){const size=KGQuestionMaterials.caseCardSize({});c.style.width=size.width+'px';if(q.material&&size.height)c.style.height=size.height+'px'}KGQuestionMaterials.bindMedia(c)}''',{'q':q,'content':content,'mode':mode})
   render(CASE)
   boxes=page.locator('#card').evaluate("e=>Object.fromEntries(['card','.qm-card-main','.qm-card-media'].map(s=>[s,s==='card'?e.getBoundingClientRect().toJSON():e.querySelector(s).getBoundingClientRect().toJSON()]))")
   if w>=1000:
    assert boxes['.qm-card-media']['right']<=boxes['.qm-card-main']['left']+1,boxes
    assert boxes['.qm-card-media']['width']>=boxes['card']['width']*.40,boxes
    assert abs(boxes['card']['width']/boxes['card']['height']-16/9)<.02,boxes
    assert boxes['card']['top']>=70 and boxes['card']['bottom']<=h-15,boxes
   else:
    assert boxes['.qm-card-media']['bottom']<=boxes['.qm-card-main']['top']+1,boxes
   body=page.locator('.qm-case-body');assert body.evaluate('e=>e.scrollHeight>e.clientHeight'),page.locator('#card').evaluate("e=>[e,...e.querySelectorAll('.qm-card-layout,.qm-card-columns,.qm-card-media,.qm-case,.qm-case-body')].map(x=>({c:x.className,h:x.clientHeight,sh:x.scrollHeight,display:getComputedStyle(x).display,overflow:getComputedStyle(x).overflow,flex:getComputedStyle(x).flex}))")
   if w>=1000:
    body.hover();page.mouse.wheel(0,350);page.wait_for_function("document.querySelector('.qm-case-body').scrollTop>0",timeout=3000)
    assert page.evaluate('!window.canvasWheelCount'),'case reading wheel must not zoom its parent canvas'
   else:
    box=body.bounding_box();x=box['x']+box['width']/2;y=box['y']+min(box['height']-25,200)
    cdp=page.context.new_cdp_session(page)
    cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x,'y':y}]})
    for dy in [20,40,60,80,100]:cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x,'y':y-dy}]})
    cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
    page.wait_for_function("document.querySelector('.qm-case-body').scrollTop>0",timeout=3000)
    cdp.detach()
   body.evaluate('e=>e.scrollTop=e.scrollHeight');assert body.evaluate('e=>e.scrollTop')>0
   page.locator('.qm-case summary').click();assert not page.locator('.qm-case').evaluate('e=>e.open');expect(body).not_to_be_visible()
   page.locator('.qm-case summary').click();expect(body).to_be_visible()
   if w>=1000:
    render(CASE,CONTENT*5)
    main=page.locator('.qm-card-main');assert main.evaluate('e=>e.scrollHeight>e.clientHeight')
    main.evaluate('e=>e.scrollTop=e.scrollHeight');assert main.evaluate('e=>e.scrollTop')>0
   render(CASE);page.screenshot(path=str(OUT/f'{mode}-{w}x{h}.png'))
   render({});expect(page.locator('.qm-card-layout')).to_have_count(0);expect(page.locator('.qw-card-options')).to_be_visible()
   render({'images':[{'url':'/api/v1/question-assets/test','alt':'图表'}]})
   expect(page.locator('.qm-card-case-layout')).to_have_count(0)
   if w>=1000:
    main=page.locator('.qm-card-main').bounding_box();media=page.locator('.qm-card-media').bounding_box();assert media['x']+media['width']<=main['x']+1
   assert not errors,errors
   print(mode,w,h,'case-left/wide/16:9-or-stack/scroll/collapse/plain+image fallback PASS',flush=True)
   page.close()
 browser.close()
