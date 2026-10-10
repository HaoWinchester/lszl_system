#!/usr/bin/env python3
"""Authenticated real-release media regression (no API mocks).

Set CANVAS_MEDIA_BASE, CANVAS_MEDIA_RELEASE, CANVAS_MEDIA_PASSWORD and optionally
CANVAS_MEDIA_USERNAME. SOURCE_OVERRIDE=1 is only for pre-deployment source testing;
leave unset for deployed acceptance. Screenshots/results go to artifacts/uat-media-fixes.
"""
import json, os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[2]
BASE=os.environ['CANVAS_MEDIA_BASE'].rstrip('/')
RELEASE=os.environ['CANVAS_MEDIA_RELEASE']
OVERRIDE=os.environ.get('SOURCE_OVERRIDE')=='1'
OUT=ROOT/'artifacts/uat-media-fixes';OUT.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch()
    context=browser.new_context(viewport={'width':1440,'height':1000})
    response=context.request.post(BASE+'/api/v1/auth/login',data={'username':os.environ.get('CANVAS_MEDIA_USERNAME','admin'),'password':os.environ['CANVAS_MEDIA_PASSWORD'],'acceptedTermsVersion':'2026-08-13-v1'})
    assert response.ok, f'Login failed: {response.status}'
    if OVERRIDE:
        def source(route):
            path=route.request.url.split(BASE+'/')[1].split('?')[0]
            route.fulfill(status=200,content_type='text/css' if path.endswith('.css') else 'application/javascript',body=(ROOT/'new-legacy'/path).read_text())
        for file in ['src/118-question-materials.js','src/86-knowledge-recall.js','src/77-multi-question-workspace.js','styles/question-materials.css']:
            context.route('**/'+file+'*',source)
    results=[]
    for name,card in [('knowledge-recall','#krQuestionCard'),('question-workspace','.qw-question-card')]:
        page=context.new_page();errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(BASE+'/'+name+'.html?releaseId='+RELEASE,wait_until='networkidle')
        page.wait_for_timeout(1500)
        if name=='question-workspace' and not page.locator(card+' .qm-image img').count():
            page.locator('#qwQuestionDockBtn').click()
            page.locator('#qwQuestionList [data-add-index]').first.click()
            page.locator('#qwQuestionDrawerClose').click()
        target=page.locator(card).filter(has=page.locator('.qm-image img')).first
        image=target.locator('.qm-image img').first
        expect(image).to_be_visible(timeout=20000)
        page.wait_for_function("[...document.querySelectorAll('.qm-image img')].some(i=>i.complete&&i.naturalWidth>0)")
        assert context.request.get(BASE+image.get_attribute('src')).ok
        page.wait_for_timeout(600)
        boxes=target.evaluate("e=>['.qm-card-main','.qm-card-media'].map(s=>e.querySelector(s).getBoundingClientRect().toJSON())")
        assert boxes[1]['x']>=boxes[0]['right']-1, boxes
        target.locator('[data-qm-zoom]').first.click()
        expect(page.locator('.qm-image-dialog')).to_be_visible()
        page.keyboard.press('Escape')
        expect(page.locator('.qm-image-dialog')).to_have_count(0)
        expect(target).to_be_visible()
        prefix=('source-' if OVERRIDE else 'uat-')+name
        page.screenshot(path=str(OUT/(prefix+'-1440.png')))
        # Narrow card layout depends on card width, even inside a zoomed canvas.
        target.evaluate("e=>{e.style.width='330px';e.style.minWidth='0'}")
        page.wait_for_timeout(300)
        boxes=target.evaluate("e=>['.qm-card-main','.qm-card-media'].map(s=>e.querySelector(s).getBoundingClientRect().toJSON())")
        assert boxes[1]['top']>=boxes[0]['bottom']-1,boxes
        assert target.locator('.qm-card-layout').evaluate('e=>e.scrollWidth<=e.clientWidth+1'), target.evaluate('e=>({w:e.clientWidth,sw:e.scrollWidth,children:[...e.querySelectorAll("*")].filter(n=>n.scrollWidth>n.clientWidth+1).map(n=>({class:n.className,w:n.clientWidth,sw:n.scrollWidth}))})')
        page.set_viewport_size({'width':390,'height':844})
        page.screenshot(path=str(OUT/(prefix+'-390.png')))
        assert not errors, errors
        results.append({'page':name,'imageLoaded':True,'rightColumn':True,'narrowStack':True,'zoomEscape':True,'pageErrors':errors,'sourceOverride':OVERRIDE})
        page.close()
    (OUT/(('source' if OVERRIDE else 'uat')+'-media-results.json')).write_text(json.dumps(results,ensure_ascii=False,indent=2))
    print(json.dumps(results,ensure_ascii=False))
    browser.close()
