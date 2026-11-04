"""Lobby fits a fixed page shell; responsive regions keep every control reachable."""
from pathlib import Path
import json,re
from playwright.sync_api import expect
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT.parent/'artifacts/practice-lobby-viewport';OUT.mkdir(parents=True,exist_ok=True)
fixture=Path(__file__).with_name('practice-mark-show-answers-browser.py')
setup=fixture.read_text().split('    # ---------- 场景 1：')[0]
start=setup.index('    for stylesheet in [');end=setup.index('    for script in SCRIPTS:',start)
setup=setup[:start]+'''    for stylesheet in re.findall(r'<link[^>]+href="([^"]+\\.css)"',(ROOT/'practice-mode.html').read_text()):
        page.add_style_tag(content=(ROOT/stylesheet).read_text())
'''+setup[end:]
scenario='''
    page.emulate_media(reduced_motion='reduce')
    page.locator('#practiceCoverageRetry').evaluate('e=>e.hidden=true')
    page.locator('#practiceSelectedPaperName').evaluate("e=>e.textContent='PMP 12月新题·多选题专题卷'")
    page.locator('#practicePaperMeta').evaluate("e=>e.textContent='PMP · v2 · 可练习10题 · 免费'")
    rows=[]
    for resumed in (False,True):
        page.locator('#practiceExpPanel').evaluate('(e,visible)=>e.hidden=!visible',True)
        page.locator('#practiceExpTotal').evaluate("e=>e.textContent='179'")
        page.locator('#practiceExpWeek').evaluate("e=>e.textContent='10'")
        for mode in ('practice','revenge'):
            page.locator('[data-practice-new="'+mode+'"]').evaluate('(e,visible)=>e.hidden=!visible',resumed)
        for width,height in [(1504,801),(1440,900),(1366,768),(1280,768),(1280,720),(1024,768),(768,844),(390,844),(320,568),(390,480)]:
            page.set_viewport_size({'width':width,'height':height})
            page.locator('#practiceExpPanel').evaluate('(e,visible)=>e.hidden=!visible',width>900)
            page.evaluate('()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
            metrics=page.evaluate("""()=>{const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height}},lobby=document.querySelector('#practiceLobby'),root=document.scrollingElement;return {width:innerWidth,height:innerHeight,documentWidth:root.scrollWidth,documentHeight:root.scrollHeight,scrollY,regionHeight:lobby.clientHeight,regionContent:lobby.scrollHeight,count:rect('.practice-count-options'),order:rect('.practice-order-options'),start:rect('[data-practice-start="practice"]')}}""")
            assert metrics['documentHeight']<=height+1 and metrics['documentWidth']<=width+1,('lobby must not scroll the page',resumed,metrics)
            if width>=1181:
                assert max(metrics[k]['top'] for k in ('count','order','start'))-min(metrics[k]['top'] for k in ('count','order','start'))<1,('aligned controls including resumed state',resumed,metrics)
                if height>=768:assert metrics['regionContent']<=metrics['regionHeight']+1,('desktop lobby fits one screen',resumed,metrics)
            elif width>480:
                assert abs(metrics['order']['top']-metrics['start']['top'])<1,('two-column controls align',resumed,metrics)
            last=page.locator('[data-practice-start="revenge"]');last.scroll_into_view_if_needed()
            bounds=last.bounding_box();assert bounds['y']>=0 and bounds['y']+bounds['height']<=height,('last action reachable',resumed,metrics,bounds)
            assert page.evaluate('scrollY')==0,('only regions may scroll',resumed,metrics)
            rows.append({'resumed':resumed,**metrics})
            page.locator('#practiceLobby').evaluate('e=>e.scrollTop=0')
            if width==1504:page.screenshot(path=str(OUT/f'lobby-1504-resumed-{resumed}.png'))
    # The existing long-answer/report reading behavior must remain outside the lobby scope.
    page.set_viewport_size({'width':1280,'height':720})
    for view,selector in [('game','#practiceGame'),('result','#practiceResult')]:
        page.evaluate("""({view,selector})=>{document.body.dataset.practiceView=view;document.querySelector('#practiceLobby').hidden=true;document.querySelector('#practiceGame').hidden=true;document.querySelector('#practiceResult').hidden=true;const target=document.querySelector(selector);target.hidden=false;const long=document.createElement('div');long.style.height='1600px';long.textContent='长题目或报告';target.append(long);scrollTo(0,0)}""",{'view':view,'selector':selector})
        assert page.evaluate('document.scrollingElement.scrollHeight>innerHeight'),(view,'long content must remain readable')
        page.mouse.move(500,300);page.mouse.wheel(0,450);page.wait_for_function('scrollY>0')
    (OUT/'viewport-metrics.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2))
    assert not errors,errors
    browser.close()
print('PASS fixed lobby page, one-screen desktop, natural/resumed control baselines, reachable narrow regions, long game/report scrolling preserved')
'''
exec(compile(setup+scenario,str(Path(__file__)),'exec'))
