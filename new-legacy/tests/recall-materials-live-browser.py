#!/usr/bin/env python3
"""Real local student image regression; source-only UI overrides, no API mocks."""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
BASE=os.environ.get('RECALL_IMAGE_TEST_BASE','http://127.0.0.1:5187')
RELEASE=os.environ.get('RECALL_IMAGE_TEST_RELEASE','pr_50d27e4ed0114137b076e7c6e8a72727')
OUT=ROOT.parent/'artifacts'/'teacher-assistant';OUT.mkdir(parents=True,exist_ok=True)

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    context=browser.new_context(viewport={'width':1440,'height':1000})
    response=context.request.post(BASE+'/api/v1/auth/login',data={'username':'学生','password':'111111'})
    assert response.ok, '真实学生账号登录失败'
    def recall_html(route):
        response=route.fetch();html=response.text()
        if 'src/118-question-materials.js' not in html: html=html.replace('<script defer src="src/86-knowledge-recall.js','<script defer src="src/118-question-materials.js"></script><script defer src="src/86-knowledge-recall.js')
        if 'styles/question-materials.css' not in html: html=html.replace('</head>','<link rel="stylesheet" href="styles/question-materials.css"/></head>')
        route.fulfill(response=response,body=html)
    source_override=os.environ.get('RECALL_IMAGE_TEST_SOURCE_OVERRIDE','1')!='0'
    if source_override: context.route('**/knowledge-recall.html?*',recall_html)
    def override_file(filename):
        def handler(route):
            route.fulfill(status=200,content_type='text/css' if filename.endswith('.css') else 'application/javascript',body=(ROOT/filename).read_text())
        return handler
    for filename in ('src/86-knowledge-recall.js','src/118-question-materials.js','styles/knowledge-recall.css'):
        if source_override: context.route('**/'+filename+'*',override_file(filename))
    page=context.new_page();results=[];network=[]
    page.on('requestfinished',lambda request:network.append({'url':request.url,'method':request.method,'status':request.response().status if request.response() else None}))
    page.on('requestfailed',lambda request:network.append({'url':request.url,'method':request.method,'failure':request.failure}))
    page.on('pageerror',lambda error:print('PAGEERROR',error,flush=True))
    page.on('response',lambda response:print('HTTPERROR',response.status,response.url,flush=True) if response.status>=400 else None)
    for filename,card in [('knowledge-recall.html','#krQuestionCard'),('question-workspace.html','.qw-question-card')]:
        page.goto(BASE+'/'+filename+'?releaseId='+RELEASE)
        if filename=='question-workspace.html':
            page.wait_for_timeout(3000)
            if not page.locator('.qm-image img').count():
                page.locator('#qwQuestionDockBtn').click()
                add=page.locator('#qwQuestionList [data-add-index]').first
                expect(add).to_be_visible()
                add.click()
                page.locator('#qwQuestionDrawerClose').click()
        image=page.locator('.qm-image img').first
        try:
            expect(image).to_be_visible(timeout=30000)
        except Exception:
            page.screenshot(path=str(OUT/('student-material-failure-'+filename+'.png')))
            (OUT/('student-material-failure-'+filename+'.html')).write_text(page.content())
            (OUT/'student-material-failure-network.json').write_text(json.dumps(network,ensure_ascii=False,indent=2))
            print('DIAGNOSTIC',page.evaluate('({url:location.href,username:window.KGAuthCore?.currentUser?.()?.username,role:window.KGAuthCore?.currentUser?.()?.role,bootstrap:window.__KG_DIRECT_BOOTSTRAP__?.authenticated,materials:!!window.KGQuestionMaterials,recall:window.KGKnowledgeRecall?.snapshot?.(),loading:document.querySelector("[data-learning-loading]")?.hidden})'),flush=True)
            print(page.locator('body').inner_text()[-3000:],flush=True)
            raise
        page.wait_for_function("() => [...document.querySelectorAll('.qm-image img')].some(img=>img.complete&&img.naturalWidth>0)")
        url=image.get_attribute('src')
        assert url.startswith('/api/v1/question-assets/')
        assert context.request.get(BASE+url).ok,'学生必须有权访问实际发布图片'
        assert page.locator('.q-danmaku,.q-comments-drawer,.q-comments').count()==0
        page.locator('[data-qm-zoom]').first.click()
        expect(page.locator('.qm-image-dialog')).to_be_visible()
        assert page.locator('.qm-image-dialog img').get_attribute('src')==url
        page.get_by_role('button',name='关闭图表',exact=True).click()
        expect(page.locator('.qm-image-dialog')).to_have_count(0)
        assert page.locator('.q-danmaku,.q-comments-drawer,.q-comments').count()==0
        page.screenshot(path=str(OUT/('student-material-'+filename+'.png')))
        results.append({'page':filename,'image':url,'loaded':True,'zoom':True,'danmaku':0,'sourceOverride':source_override})
    (OUT/'student-material-result.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
    print(json.dumps(results,ensure_ascii=False))
    context.close();browser.close()
