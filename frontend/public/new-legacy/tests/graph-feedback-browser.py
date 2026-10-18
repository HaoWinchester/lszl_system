"""Source-only toolbar hit testing and viewport cost comparison, no API/database writes."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/learning-tool-feedback/graph';OUT.mkdir(parents=True,exist_ok=True)
with sync_playwright() as pw:
 browser=pw.chromium.launch(channel='chrome');page=browser.new_page(viewport={'width':1440,'height':1000})
 page.set_content('<div id="stage" class="stage home-selection-interaction-locked" style="position:fixed;inset:0"><div class="uc-selection-bounds" style="left:100px;top:100px;width:700px;height:400px"></div><div class="node-style-toolbar uc-floating-toolbar show" style="left:120px;top:120px"><button id="probe">背景填充</button></div></div>')
 for name in ['unified-canvas-runtime.css','home-graph-components.css','home-canvas-performance.css','home-selection-p4326.css','home-selection-geometry-p4332.css']:page.add_style_tag(content=(ROOT/'new-legacy/styles'/name).read_text())
 hit=page.locator('#probe').evaluate('(e)=>{const r=e.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e}')
 (OUT/'hit.json').write_text(json.dumps({'toolbarReceivesClick':hit}));assert hit,'blue group selection intercepts toolbar'
 browser.close()
print('PASS toolbar hit test')

# Same cards, same 120 pan/zoom frames; count actual DOM queries/writes and mutations.
import subprocess
with sync_playwright() as pw:
 browser=pw.chromium.launch(channel='chrome');metrics={}
 for variant,script in [('before',subprocess.check_output(['git','show','a55c06bdf560a78f5f8ae5cc5274e1ffc414b23a:new-legacy/src/graph/viewport-controller.js'],cwd=ROOT,text=True)),('after',(ROOT/'new-legacy/src/graph/viewport-controller.js').read_text())]:
  page=browser.new_page(viewport={'width':1440,'height':1000});page.set_content('<div id="stage"><div id="world"></div></div>')
  page.add_script_tag(content=script)
  metrics[variant]=page.evaluate('''async()=>{
   const world=document.querySelector('#world');world.style.cssText='transform-origin:0 0;position:absolute';
   for(let i=0;i<300;i++){const c=document.createElement('div');c.className='knowledge-card'+(i<10?' active':'');c.textContent='学习知识点 '+i;c.style.cssText=`position:absolute;left:${i%20*130}px;top:${Math.floor(i/20)*80}px;width:120px;height:70px;background:#eff6ff;font:16px sans-serif`;world.append(c)}
   let queries=0,writes=0,cardMutations=0;const query=world.querySelectorAll.bind(world);world.querySelectorAll=(...args)=>{queries++;return query(...args)};
   query('.active').forEach(c=>{const set=c.style.setProperty.bind(c.style);c.style.setProperty=(...args)=>{writes++;return set(...args)}});
   const observer=new MutationObserver(records=>cardMutations+=records.filter(r=>r.type==='childList').length);observer.observe(world,{childList:true,subtree:true});
   const controller=KGGraphViewportController.create({world}),frames=[];let previous=performance.now();
   for(let i=0;i<120;i++){await new Promise(requestAnimationFrame);let now=performance.now();frames.push(now-previous);previous=now;controller.apply({x:i,y:i/2,scale:i<60?1:1+(i-60)/120})}
   await new Promise(requestAnimationFrame);observer.disconnect();frames.sort((a,b)=>a-b);return{cards:world.children.length,queries,writes,cardMutations,frameP95:frames[113],frameMedian:frames[60]};
  }''');page.close()
 assert metrics['after']['queries']<metrics['before']['queries'],metrics
 assert metrics['after']['writes']<metrics['before']['writes'],metrics
 assert metrics['after']['cardMutations']==0,metrics
 (OUT/'viewport-comparison.json').write_text(json.dumps(metrics,indent=2));browser.close()
print('PASS real Chrome same-data viewport metrics:',json.dumps(metrics))
