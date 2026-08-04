#!/usr/bin/env python3
from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
ARGS=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']
PAGES={
    'teacher-workbench.html':'teacher',
    'question-bank.html':'teacher',
    'paper-management.html':'teacher',
}

def mount(page,filename):
    html=(ROOT/filename).read_text(encoding='utf-8')
    body_match=re.search(r'<body([^>]*)>([\s\S]*)</body>',html,re.I)
    body=re.sub(r'<script[\s\S]*?</script>','',body_match.group(2),flags=re.I)
    page.set_content(f'<!doctype html><html><head></head><body{body_match.group(1)}>{body}</body></html>')
    for href in re.findall(r'<link[^>]+href=["\']([^"\']+\.css)["\']',html,re.I):
        css_path=ROOT/href
        if css_path.exists():
            page.add_style_tag(content=css_path.read_text(encoding='utf-8'))
    page.add_script_tag(content=(ROOT/'src/admin/48-admin-context-nav.js').read_text(encoding='utf-8'))
    page.wait_for_timeout(100)

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=ARGS)
    for viewport in ({'width':1440,'height':900},{'width':390,'height':844}):
        for filename,active in PAGES.items():
            page=browser.new_page(viewport=viewport)
            errors=[]
            page.on('pageerror',lambda e: errors.append(str(e)))
            mount(page,filename)
            nav=page.locator('.admin-context-nav')
            assert nav.count()==1,(filename,'missing admin nav')
            assert nav.locator('[data-admin-nav]').count()==7,(filename,'wrong admin nav count')
            assert nav.locator('[data-admin-nav].active').get_attribute('data-admin-nav')==active,(filename,'wrong active admin link')
            tabs=page.locator('.tw-tabs').first
            assert tabs.locator('a').count()==4,(filename,'teacher tab count')
            assert tabs.get_by_text('管理端',exact=True).count()==0,(filename,'duplicate admin entry')
            top_box=nav.bounding_box()
            assert top_box and abs(top_box['y'])<1,(filename,viewport,'nav not at top',top_box)
            # Add guaranteed scroll space, then verify both bars remain visible without overlap.
            page.evaluate("""()=>{const s=document.createElement('div');s.id='sticky-test-space';s.style.height='1800px';document.body.appendChild(s);scrollTo(0,700)}""")
            page.wait_for_timeout(120)
            nav_box=nav.bounding_box()
            assert nav_box and abs(nav_box['y'])<1,(filename,viewport,'nav hidden after scroll',nav_box)
            topbar=page.locator('.tw-topbar').first
            topbar_box=topbar.bounding_box()
            if viewport['width']>680:
                assert topbar_box and topbar_box['y']>=41 and topbar_box['y']<44,(filename,viewport,'topbar overlaps nav',topbar_box)
            if viewport['width']<700:
                metrics=page.evaluate("""()=>{const n=document.querySelector('.admin-context-nav');return {client:n.clientWidth,scroll:n.scrollWidth,wrap:getComputedStyle(n).whiteSpace}}""")
                assert metrics['scroll']>=metrics['client'] and metrics['wrap']=='nowrap',(filename,metrics)
            assert not errors,(filename,errors)
            page.close()
    # 课程与任务保持独立，不复用教师工作台二级导航和三步流程。
    page=browser.new_page(viewport={'width':1440,'height':900});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    mount(page,'course-admin.html')
    assert page.locator('.admin-context-nav [data-admin-nav]').count()==7
    assert page.locator('.admin-context-nav [data-admin-nav].active').get_attribute('data-admin-nav')=='courses'
    assert page.locator('.tw-topbar').count()==0
    assert page.locator('.tw-workflow').count()==0
    assert page.locator('.tw-command-title h1').inner_text()=='课程与任务'
    assert page.locator('[data-config-view="courses"]').count()==1 and page.locator('[data-config-view="tasks"]').count()==1
    assert page.locator('[data-config-view="papers"]').count()==0 and page.locator('[data-config-panel="papers"]').count()==0
    assert not errors,errors;page.close()
    browser.close()
print('v90-p331-navigation-shell-fix-browser-ok')
