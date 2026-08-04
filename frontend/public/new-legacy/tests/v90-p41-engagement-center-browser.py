#!/usr/bin/env python3
from pathlib import Path
import json,re
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
ARGS=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']
USERS={'student':{'username':'student','displayName':'测试学员','role':'student','status':'active','salt':'x','hash':'x'},'admin':{'username':'admin','displayName':'测试管理员','role':'admin','status':'active','salt':'x','hash':'x'}}

def parts(file):
    source=(ROOT/file).read_text(encoding='utf-8')
    m=re.search(r'<body([^>]*)>([\s\S]*)</body>',source,re.I)
    body=re.sub(r'<script[\s\S]*?</script>','',m.group(2),flags=re.I)
    scripts=re.findall(r'<script[^>]+src="([^"]+)"',source,re.I)
    return m.group(1),body,scripts

def install_storage(page,values):
    page.evaluate("""values=>{
      const data=new Map(Object.entries(values).map(([k,v])=>[k,String(v)]));
      Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>data.has(String(k))?data.get(String(k)):null,setItem:(k,v)=>data.set(String(k),String(v)),removeItem:k=>data.delete(String(k)),clear:()=>data.clear(),key:i=>[...data.keys()][i]||null,get length(){return data.size},__dump:()=>Object.fromEntries(data)}});
      window.confirm=()=>true;window.alert=()=>{};
    }""",values)

def load(page,file,values,only=None):
    attrs,body,scripts=parts(file)
    page.set_content(f'<!doctype html><html><head><base href="http://app.local/"></head><body{attrs}>{body}</body></html>')
    install_storage(page,values)
    if file=='index.html':
        page.add_style_tag(content=(ROOT/'styles/support-center.css').read_text(encoding='utf-8'))
    for script in scripts:
        if only is None or script in only:
            page.add_script_tag(content=(ROOT/script).read_text(encoding='utf-8'))
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
    page.wait_for_timeout(220)

def centers(page,button_selector,icon_selector):
    return page.evaluate("""([buttonSelector,iconSelector])=>{
      const button=document.querySelector(buttonSelector),icon=document.querySelector(iconSelector);
      const b=button.getBoundingClientRect(),i=icon.getBoundingClientRect();
      return {dx:Math.abs((b.left+b.width/2)-(i.left+i.width/2)),dy:Math.abs((b.top+b.height/2)-(i.top+i.height/2))};
    }""",[button_selector,icon_selector])

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=ARGS)
    base_values={'kg_local_users_v1':json.dumps(USERS,ensure_ascii=False),'kg_local_current_user_v1':'student'}

    page=browser.new_page(viewport={'width':1440,'height':900});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    load(page,'index.html',base_values,{'src/01-runtime-config.js','src/28-app-storage.js','src/29-auth-core.js','src/34-role-permissions.js','src/101-engagement-repository.js','src/103-support-center.js'})
    metric=centers(page,'#supportCenterBtn','#supportCenterBtn svg')
    assert metric['dx']<0.6 and metric['dy']<0.6,metric
    page.locator('#supportCenterBtn').click();page.locator('[data-support-action="feedback"]').click()
    close_metric=centers(page,'#engagementDialogClose','#engagementDialogClose svg')
    assert close_metric['dx']<0.6 and close_metric['dy']<0.6,close_metric
    page.locator('#feedbackTitle').fill('浏览器反馈测试');page.locator('#feedbackDetail').fill('请检查反馈管理闭环。');page.locator('#feedbackForm button[type="submit"]').click();page.wait_for_timeout(180)
    feedback=page.evaluate("JSON.parse(localStorage.getItem('kg_user_feedback_v1')||'[]')")
    assert len(feedback)==1 and feedback[0]['submittedBy']['username']=='student'
    feedback_raw=page.evaluate("localStorage.getItem('kg_user_feedback_v1')")
    assert not errors,errors
    page.close()

    admin_values={**base_values,'kg_local_current_user_v1':'admin','kg_user_feedback_v1':feedback_raw}
    page=browser.new_page(viewport={'width':1440,'height':900});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    load(page,'feedback-management.html',admin_values)
    assert page.locator('[data-feedback-id]').count()==1
    page.locator('[data-feedback-id]').click();page.locator('#feedbackDetailStatus').select_option('resolved');page.locator('#feedbackReplyText').fill('已经收到并处理。');page.locator('#feedbackHandleForm button[type="submit"]').click();page.wait_for_timeout(180)
    feedback=page.evaluate("JSON.parse(localStorage.getItem('kg_user_feedback_v1')||'[]')")
    assert feedback[0]['status']=='resolved' and feedback[0]['replies'][0]['message']=='已经收到并处理。'
    feedback_raw=page.evaluate("localStorage.getItem('kg_user_feedback_v1')")
    assert not errors,errors
    page.close()

    page=browser.new_page(viewport={'width':1440,'height':900});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    load(page,'index.html',{**base_values,'kg_user_feedback_v1':feedback_raw},{'src/01-runtime-config.js','src/28-app-storage.js','src/29-auth-core.js','src/34-role-permissions.js','src/101-engagement-repository.js','src/103-support-center.js'})
    assert page.locator('#supportCenterBadge').inner_text()=='1'
    page.locator('#supportCenterBtn').click()
    assert page.locator('#supportFeedbackMenuBadge').inner_text()=='1'
    page.locator('[data-support-action="feedback"]').click()
    assert page.locator('#feedbackTabBadge').inner_text()=='1'
    page.locator('[data-feedback-tab="mine"]').click();page.wait_for_timeout(160)
    assert '管理员新回复 1' in page.locator('#feedbackTabContent').inner_text()
    assert page.locator('#supportCenterBadge').is_hidden()
    feedback_reads=page.evaluate("Object.entries(localStorage.__dump()).find(([key])=>key.startsWith('kg_user_feedback_reply_reads_v1__'))?.[1]||''")
    assert feedback_reads
    assert not errors,errors
    page.close()

    page=browser.new_page(viewport={'width':1440,'height':900});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    load(page,'message-management.html',admin_values)
    page.locator('#messageTitle').fill('发布测试消息');page.locator('#messageBody').fill('这是一条给全部用户的通知。');page.locator('#messagePublishBtn').click();page.wait_for_timeout(200)
    messages_raw=page.evaluate("localStorage.getItem('kg_announcements_v1')")
    messages=json.loads(messages_raw)
    assert len(messages)==1 and messages[0]['status']=='published'
    assert not errors,errors
    page.close()

    read_key='kg_user_feedback_reply_reads_v1__student'
    page=browser.new_page(viewport={'width':1440,'height':900});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    load(page,'index.html',{**base_values,'kg_user_feedback_v1':feedback_raw,read_key:feedback_reads,'kg_announcements_v1':messages_raw},{'src/01-runtime-config.js','src/28-app-storage.js','src/29-auth-core.js','src/34-role-permissions.js','src/101-engagement-repository.js','src/103-support-center.js'})
    assert page.locator('#supportCenterBadge').inner_text()=='1'
    page.locator('#supportCenterBtn').click();page.locator('[data-support-action="messages"]').click();page.wait_for_timeout(100)
    assert '发布测试消息' in page.locator('#engagementDialogBody').inner_text()
    page.locator('[data-message-read]').click();page.wait_for_timeout(100)
    assert page.locator('#supportCenterBadge').is_hidden()
    assert not errors,errors
    page.close()

    page=browser.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    load(page,'help-center.html',{},None)
    page.locator('[data-help-id="practice"]').click();page.wait_for_timeout(30)
    assert page.locator('#helpContent h1').inner_text()=='做题模式'
    assert not errors,errors
    page.close();browser.close()
print('v90-p41-engagement-center-browser-ok')
