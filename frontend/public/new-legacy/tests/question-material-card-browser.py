#!/usr/bin/env python3
"""Shared canvas question/media layout, real image decoding and zoom/retry behavior."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT = Path(__file__).resolve().parents[1]
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    page.route('http://materials.test/**', lambda route: route.fulfill(status=200, content_type='text/html', body='<main id="card"></main>'))
    attempts = []
    def asset(route):
        attempts.append(route.request.url)
        route.fulfill(status=200, content_type='image/svg+xml', body='<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="skyblue"/></svg>')
    page.route('**/api/v1/question-assets/*', asset)
    page.goto('http://materials.test/')
    page.add_style_tag(path=str(ROOT/'styles/question-materials.css'))
    page.add_style_tag(content='#card{width:720px;padding:24px;border:1px solid;box-sizing:border-box} .stem{line-height:1.8}')
    page.add_script_tag(path=str(ROOT/'src/118-question-materials.js'))
    def render(question):
        page.evaluate('''q=>{const card=document.querySelector('#card');card.innerHTML=KGQuestionMaterials.renderCardContent(q,'<p class="stem">带有图表的题干与选项</p><button class="option">选项 A</button>');KGQuestionMaterials.bindMedia(card)}''', question)
    image={'url':'/api/v1/question-assets/test-image','alt':'回归图表'}
    for question in [{'images':[image]}, {'metadata':{'_mixedContent':{'images':[image]}}}, {'material':{'id':'m1','title':'案例','text':'材料文本','images':[image]}}]:
        render(question)
        expect(page.locator('.qm-image img')).to_be_visible()
        page.wait_for_function("document.querySelector('.qm-image img').naturalWidth===600")
        rects=page.evaluate('''()=>['.qm-card-main','.qm-card-media'].map(s=>document.querySelector(s).getBoundingClientRect().toJSON())''')
        assert rects[1]['x'] >= rects[0]['right'], rects
        page.get_by_role('button',name='放大图表：回归图表').click()
        expect(page.locator('.qm-image-dialog')).to_be_visible()
        page.keyboard.press('Escape')
        expect(page.locator('.qm-image-dialog')).to_have_count(0)
        page.locator('#card').evaluate("e=>e.style.width='300px'")
        rects=page.evaluate('''()=>['.qm-card-main','.qm-card-media'].map(s=>document.querySelector(s).getBoundingClientRect().toJSON())''')
        assert rects[1]['top'] >= rects[0]['bottom'], rects
        assert page.locator('#card').evaluate('e=>e.scrollWidth<=e.clientWidth'), 'card overflow'
        page.locator('#card').evaluate("e=>e.style.width='720px'")
    render({})
    expect(page.locator('.qm-card-media')).to_have_count(0)
    expect(page.locator('.option')).to_be_visible()
    render({'images':[{'url':'javascript:alert(1)'},image]})
    expect(page.locator('.qm-image')).to_have_count(1)
    page.route('**/api/v1/question-assets/test-image', lambda route: route.fulfill(status=503,body='unavailable'))
    render({'images':[image]})
    expect(page.locator('[data-qm-retry]')).to_be_visible()
    page.unroute('**/api/v1/question-assets/test-image')
    page.locator('[data-qm-retry]').click()
    page.wait_for_function("document.querySelector('.qm-image img').naturalWidth===600")
    expect(page.locator('[data-qm-retry]')).to_be_hidden()
    browser.close()
print('PASS: top-level/frozen media; right column; narrow stack; no-media; zoom; safe URLs; retry')
