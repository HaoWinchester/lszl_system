#!/usr/bin/env python3
from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
ARGS=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']

def mount(page,filename):
    html=(ROOT/filename).read_text(encoding='utf-8')
    match=re.search(r'<body([^>]*)>([\s\S]*)</body>',html,re.I)
    body=re.sub(r'<script[\s\S]*?</script>','',match.group(2),flags=re.I)
    page.set_content(f'<!doctype html><html><head></head><body{match.group(1)}>{body}</body></html>')
    for href in re.findall(r'<link[^>]+href=["\']([^"\']+\.css)["\']',html,re.I):
        css=ROOT/href
        if css.exists(): page.add_style_tag(content=css.read_text(encoding='utf-8'))
    page.add_script_tag(content=(ROOT/'src/admin/48-admin-context-nav.js').read_text(encoding='utf-8'))
    page.wait_for_timeout(60)

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=ARGS)

    page=browser.new_page(viewport={'width':1440,'height':960});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    mount(page,'teacher-workbench.html')
    assert page.locator('.admin-context-nav [data-admin-nav]').count()==9
    assert page.locator('.admin-context-nav [data-admin-nav].active').get_attribute('data-admin-nav')=='teacher'
    assert page.locator('.tw-tabs a').count()==4
    assert page.locator('.tw-tabs a').nth(3).inner_text()=='试卷管理'
    assert page.locator('.tw-workflow .tw-step').nth(2).inner_text().endswith('管理试卷')
    # Mock storage and content service, then verify workbench summaries are paper-based.
    page.evaluate("""()=>{
      const data=new Map();
      Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>data.has(k)?data.get(k):null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)}});
      localStorage.setItem('kg_local_current_user_v1','teacher-a');
      localStorage.setItem('kg_question_banks_v1__user__teacher-a',JSON.stringify([{id:'b1',questions:[{id:'q1',clues:[{text:'关键词',recallNodeId:'n1'}],lifecycle:{status:'active'}}]}]));
      localStorage.setItem('kg_exam_papers_v1__user__teacher-a',JSON.stringify([{id:'p1',status:'draft',publishedVersion:0},{id:'p2',status:'published',publishedVersion:2},{id:'p3',status:'archived',publishedVersion:1}]));
      window.KGAuthCore={currentUsername:()=> 'teacher-a'};
      window.KGLearningContent={currentUser:()=>({name:'周老师',role:'teacher'})};
    }""")
    page.add_script_tag(content=(ROOT/'src/91-teacher-workbench-app.js').read_text(encoding='utf-8'))
    page.evaluate("()=>document.dispatchEvent(new Event('DOMContentLoaded'))")
    page.wait_for_timeout(50)
    assert page.locator('#wbQuestionCount').inner_text()=='1'
    assert page.locator('#wbPaperDraftCount').inner_text()=='1'
    assert page.locator('#wbPublishedPaperCount').inner_text()=='1'
    assert page.locator('#wbNextAction').get_attribute('href')=='paper-management.html'
    assert not errors,errors
    page.close()

    page=browser.new_page(viewport={'width':1440,'height':960});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    mount(page,'paper-management.html')
    assert page.locator('.admin-context-nav [data-admin-nav].active').get_attribute('data-admin-nav')=='teacher'
    assert page.locator('.tw-tabs a.active').inner_text()=='试卷管理'
    assert page.locator('.tw-workflow .tw-step.active').inner_text().endswith('管理试卷')
    assert not errors,errors
    page.close()

    page=browser.new_page(viewport={'width':1440,'height':960});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    mount(page,'course-admin.html')
    assert page.locator('.admin-context-nav [data-admin-nav].active').get_attribute('data-admin-nav')=='courses'
    assert page.locator('.tw-topbar').count()==0
    assert page.locator('.tw-workflow').count()==0
    assert page.locator('.tw-command-title h1').inner_text()=='课程与任务'
    assert page.locator('[data-config-view="papers"]').count()==0
    assert page.locator('[data-config-panel="papers"]').count()==0
    assert not errors,errors
    page.close()

    browser.close()
print('v90-p358-teacher-workbench-navigation-browser-ok')
