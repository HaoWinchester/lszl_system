#!/usr/bin/env python3
from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
PAGES={
 'admin-console.html':'overview',
 'admin-subjects.html':'subjects',
 'admin-operations.html':'operations',
 'admin-settings.html':'settings',
 'teacher-workbench.html':'teacher',
 'question-bank.html':'teacher',
 'paper-management.html':'teacher',
 'course-admin.html':'courses',
 'user-management.html':'users',
 'system-settings.html':'settings',
}
ARGS=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']

def mount(page, filename):
    html=(ROOT/filename).read_text(encoding='utf-8')
    body_match=re.search(r'<body([^>]*)>([\s\S]*)</body>',html,re.I)
    body=re.sub(r'<script[\s\S]*?</script>','',body_match.group(2),flags=re.I)
    page.set_content(f'<!doctype html><html><head></head><body{body_match.group(1)}>{body}</body></html>')
    for href in re.findall(r'<link[^>]+href=["\']([^"\']+\.css)["\']',html,re.I):
        css_path=ROOT/href
        if css_path.exists():
            page.add_style_tag(content=css_path.read_text(encoding='utf-8'))
    if 'data-admin-page=' in body_match.group(1):
        page.add_script_tag(content=(ROOT/'src/admin/49-admin-ui.js').read_text(encoding='utf-8'))
        page.evaluate('()=>KGAdminUI.markNavigation()')
    else:
        page.add_script_tag(content=(ROOT/'src/admin/48-admin-context-nav.js').read_text(encoding='utf-8'))
    page.wait_for_timeout(80)

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=ARGS)
    for viewport in ({'width':1440,'height':1000},{'width':390,'height':844}):
        for filename,active in PAGES.items():
            page=browser.new_page(viewport=viewport)
            errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            mount(page,filename)
            nav=page.locator('.admin-context-nav')
            assert nav.count()==1,(filename,'missing nav')
            assert nav.locator('[data-admin-nav]').count()==7,(filename,'wrong nav count')
            box=nav.bounding_box();assert box and abs(box['y'])<1 and box['width']>=viewport['width']-1,(filename,viewport,box)
            assert page.locator('.admin-context-nav [data-admin-nav].active').get_attribute('data-admin-nav')==active,(filename,'wrong active link')
            assert page.locator('aside.admin-sidebar').count()==0,(filename,'legacy primary sidebar remains')
            if viewport['width']<700:
                metrics=page.evaluate("""()=>{const n=document.querySelector('.admin-context-nav');return {client:n.clientWidth,scroll:n.scrollWidth,wrap:getComputedStyle(n).whiteSpace}}""")
                assert metrics['scroll']>=metrics['client'] and metrics['wrap']=='nowrap',(filename,metrics)
            assert not errors,(filename,errors)
            page.close()
    browser.close()
print('v90-p311-admin-top-navigation-browser-ok')
