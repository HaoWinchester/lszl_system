#!/usr/bin/env python3
"""Chrome raster comparison using actual three-page CSS and controlled Chinese text.
No persisted graph mutation. Outputs screenshots, hit tests and frame timing evidence.
"""
import json, os, sys
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/canvas-m0-m1/text-clarity';OUT.mkdir(parents=True,exist_ok=True)
BASE=os.environ.get('CANVAS_CLARITY_BASE','http://127.0.0.1:5189')
SCALES=[.01,.1,.2,.5,1,2,4,1]
rows=[]
with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome')
    for dpr in [1,2]:
        context=browser.new_context(viewport={'width':1440,'height':1000},device_scale_factor=dpr)
        response=context.request.post(BASE+'/api/v1/auth/login',data={'username':'ink-browser','password':'ink-browser-test','acceptedTermsVersion':'2026-08-13-v1'})
        assert response.ok,response.status
        for name,cls in [('index','world'),('question-workspace','qw-world'),('knowledge-recall','kr-world')]:
            page=context.new_page();page.goto(BASE+'/'+name+'.html',wait_until='networkidle');page.evaluate('document.fonts.ready')
            # Isolate raster effects from server content/layout/animation while retaining page CSS.
            page.evaluate('''cls=>{document.body.innerHTML='<button id="full">fullscreen</button><div id="clarity-stage" style="position:fixed;inset:50px 0 0;background:white;overflow:hidden"><div id="clarity-world" class="'+cls+'" style="transform-origin:0 0;width:400px;height:200px"><button id="sample" style="font:24px sans-serif;color:#111;background:white;border:0;white-space:nowrap">知识图谱：项目管理与学习回忆</button></div></div>';document.querySelector('#full').onclick=()=>document.querySelector('#clarity-stage').requestFullscreen()}''',cls)
            if '--verify-idle' in sys.argv:
                assert page.locator('#clarity-world').evaluate("e=>getComputedStyle(e).willChange")=='auto',name+' keeps text layer composited at rest'
            for fullscreen in [False,True]:
                if fullscreen:page.locator('#full').click();page.wait_for_function('!!document.fullscreenElement')
                for variant in ['baseline','interaction-only','2d']:
                    for index,scale in enumerate(SCALES):
                        result=page.evaluate('''({variant,scale})=>{let w=document.querySelector('#clarity-world');w.style.willChange=variant==='baseline'?'transform':'auto';w.style.transform=(variant==='2d'?'translate(180px, 180px)':'translate3d(180px,180px,0)')+' scale('+scale+')';let e=document.querySelector('#sample'),r=e.getBoundingClientRect();return {dpr:devicePixelRatio,font:getComputedStyle(e).fontFamily,willChange:getComputedStyle(w).willChange,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e,rect:r.toJSON()}}''',{'variant':variant,'scale':scale})
                        page.wait_for_timeout(60)
                        filename=f'{name}-dpr{dpr}-full{int(fullscreen)}-{variant}-{index}-{scale}.png'
                        page.screenshot(path=str(OUT/filename))
                        assert result['hit'],result
                        rows.append(dict(page=name,fullscreen=fullscreen,variant=variant,scale=scale,screenshot=filename,**result))
                    perf=page.evaluate('''async variant=>{let w=document.querySelector('#clarity-world'),times=[],prev=performance.now();for(let i=0;i<60;i++){await new Promise(requestAnimationFrame);let now=performance.now();times.push(now-prev);prev=now;w.style.transform=(variant==='2d'?'translate(180px,180px)':'translate3d(180px,180px,0)')+' scale('+(1+i/60)+')'}return times.sort((a,b)=>a-b)[57]}''',variant)
                    rows.append(dict(page=name,dpr=dpr,fullscreen=fullscreen,variant=variant,frameP95=perf))
                if fullscreen:page.evaluate('document.exitFullscreen()');page.wait_for_function('!document.fullscreenElement')
            page.close()
        context.close()
    browser.close()
(OUT/'results.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2))
print(f'{len(rows)} measurements passed; screenshots: {OUT}')
