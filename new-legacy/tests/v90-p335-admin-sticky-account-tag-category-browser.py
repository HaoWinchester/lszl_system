#!/usr/bin/env python3
from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
ARGS=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']

def body_html(file):
    text=(ROOT/file).read_text(encoding='utf-8')
    match=re.search(r'<body([^>]*)>([\s\S]*)</body>',text,re.I)
    return match.group(1),re.sub(r'<script[\s\S]*?</script>','',match.group(2),flags=re.I)

def add_files(page,files,kind):
    for file in files:
        content=(ROOT/file).read_text(encoding='utf-8')
        (page.add_style_tag if kind=='css' else page.add_script_tag)(content=content)

def mock_storage(page,user='p335-admin'):
    page.evaluate(f"""()=>{{const local=new Map(),session=new Map();Object.defineProperty(window,'localStorage',{{configurable:true,value:{{getItem:k=>local.has(k)?local.get(k):null,setItem:(k,v)=>local.set(k,String(v)),removeItem:k=>local.delete(k),clear:()=>local.clear(),key:i=>[...local.keys()][i]||null,get length(){{return local.size}}}}}});Object.defineProperty(window,'sessionStorage',{{configurable:true,value:{{getItem:k=>session.has(k)?session.get(k):null,setItem:(k,v)=>session.set(k,String(v)),removeItem:k=>session.delete(k),clear:()=>session.clear(),key:i=>[...session.keys()][i]||null,get length(){{return session.size}}}}}});const user='{user}';localStorage.setItem('kg_local_current_user_v1',user);localStorage.setItem('kg_local_users_v1',JSON.stringify({{[user]:{{username:user,displayName:'佩奇007',role:'admin',status:'active',subject:'PMP',salt:'x',hash:'x'}}}}));window.confirm=()=>true;window.alert=()=>{{}};if(!window.ResizeObserver)window.ResizeObserver=class{{observe(){{}}disconnect(){{}}}};}}""")

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=ARGS)

    # Admin overview: sticky nav + sticky account bar + admin-specific account menu.
    page=browser.new_page(viewport={'width':1440,'height':760});page.set_default_timeout(8000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    attrs,body=body_html('admin-console.html');page.set_content(f'<!doctype html><html><head></head><body{attrs}>{body}<div style="height:1800px"></div></body></html>')
    mock_storage(page)
    add_files(page,['styles/admin-console.css','styles/admin-context-nav.css','styles/user-center.css'],'css')
    add_files(page,['src/28-app-storage.js','src/29-auth-core.js','src/33-user-center.js','src/admin/49-admin-ui.js'],'js')
    page.evaluate("window.KGAdminServices={permissions:{currentUser:()=>window.KGAuthCore.currentUser()}};window.KGAdminUI.init(window.KGAdminServices)")
    assert '佩奇007' in page.locator('#adminAccount').inner_text()
    page.evaluate('window.scrollTo(0,900)');page.wait_for_timeout(120)
    nav=page.locator('.admin-context-nav').bounding_box();top=page.locator('.admin-topbar').bounding_box()
    assert nav and abs(nav['y'])<=1.5,nav
    assert top and 40<=top['y']<=44,top
    page.locator('#adminAccountTrigger').click();assert page.locator('#adminAccountPopover').is_visible()
    for text in ['用户中心','帮助中心','退出登录']:assert page.locator('#adminAccountPopover').get_by_text(text,exact=True).count()==1
    page.locator('#adminAccountHelpBtn').click();assert page.locator('#adminHelpDialog').is_visible();assert '后台帮助中心' in page.locator('#adminHelpDialog').inner_text();assert '管理后台' in page.locator('#adminHelpDialog').inner_text();page.locator('#adminHelpDoneBtn').click()
    page.locator('#adminAccountTrigger').click();page.locator('#adminAccountUserCenterBtn').click();assert page.locator('#userCenterModal').is_visible();page.locator('#userCenterCloseBtn').click()
    page.set_viewport_size({'width':390,'height':844});page.evaluate('window.scrollTo(0,1050)');page.wait_for_timeout(100)
    nav=page.locator('.admin-context-nav').bounding_box();top=page.locator('.admin-topbar').bounding_box();assert nav and abs(nav['y'])<=1.5;assert top and 40<=top['y']<=44
    page.locator('#adminAccountTrigger').click();menu=page.locator('#adminAccountPopover').bounding_box();assert menu and menu['x']>=0 and menu['x']+menu['width']<=391;assert page.locator('body').evaluate('(el)=>el.scrollWidth-el.clientWidth')<=2;page.locator('#adminAccountTrigger').click()
    assert not errors,errors
    page.close()

    # User management keeps the common nav sticky but removes duplicate back/account/module controls.
    page=browser.new_page(viewport={'width':1360,'height':700});attrs,body=body_html('user-management.html');page.set_content(f'<!doctype html><html><head></head><body{attrs}>{body}<div style="height:1600px"></div></body></html>');add_files(page,['styles/admin-context-nav.css','styles/user-management.css'],'css')
    assert page.locator('.um-back').count()==0
    assert page.locator('#authStatus').count()==0
    assert page.locator('.um-nav-btn').count()==0
    assert page.locator('#umAddUserBtn').count()==1 and page.locator('#umExportBtn').count()==1 and page.locator('#umImportBtn').count()==1
    page.evaluate('window.scrollTo(0,800)');page.wait_for_timeout(80);nav=page.locator('.admin-context-nav').bounding_box();assert nav and abs(nav['y'])<=1.5,nav
    page.close()

    # Tag manager: group and second-level category names are inline editable and persist.
    page=browser.new_page(viewport={'width':1440,'height':1000});page.set_default_timeout(8000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    attrs,body=body_html('question-bank.html');page.set_content(f'<!doctype html><html><head></head><body{attrs}>{body}</body></html>');mock_storage(page,'p335-tag-admin')
    add_files(page,['styles/teacher-workbench.css','styles/question-bank-admin.css','styles/teacher-question-workflow.css','styles/admin-context-nav.css','styles/workspace-placement.css','styles/question-classification.css'],'css')
    add_files(page,['src/01-runtime-config.js','src/28-app-storage.js','src/29-auth-core.js','src/34-role-permissions.js','src/50-question-data.js','src/91-learning-content-core.js','src/95-recall-association-library.js','question-studio/question-studio-parser.js','src/98-teacher-workflow-p2-services.js','src/65-question-bank-admin.js','src/98-question-classification.js','src/97-teacher-question-workflow.js','src/99-workspace-placement.js'],'js')
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))");page.wait_for_timeout(450)
    page.locator('[data-main-tab="base"]').click();page.locator('#qbTagPickerBtn').click();page.locator('#qbTagManageBtn').click();page.wait_for_timeout(80)
    manager=page.locator('#qbTagManagerDialog');assert manager.is_visible()
    group=manager.locator('[data-tag-manage-kind="group"][data-tag-manage-name="用途标签"]');assert group.count()==1;group.dblclick();editor=manager.locator('.qb-tag-manage-input');editor.fill('使用目的');editor.press('Enter');page.wait_for_timeout(100)
    category=manager.locator('[data-tag-manage-kind="category"][data-tag-manage-name="训练阶段"]');assert category.count()==1;category.dblclick();editor=manager.locator('.qb-tag-manage-input');editor.fill('练习阶段');editor.press('Enter');page.wait_for_timeout(100)
    config=page.evaluate("JSON.parse(localStorage.getItem('kg_question_tag_names_v1'))")
    assert config['groupNames']['usage']=='使用目的'
    assert config['categoryNames']['usage/stage']=='练习阶段'
    duplicate=manager.locator('[data-tag-manage-kind="category"][data-tag-manage-name="使用场景"]');duplicate.dblclick();editor=manager.locator('.qb-tag-manage-input');editor.fill('练习阶段');editor.press('Enter');page.wait_for_timeout(80);assert '已存在同名二级分类' in page.locator('#qbTagManagerMessage').inner_text()
    manager.locator('[value="cancel"]').last.click();page.wait_for_timeout(50)
    assert page.locator('#qbTagGroupList').get_by_text('使用目的',exact=True).count()==1
    page.get_by_role('button',name='使用目的').click();assert page.locator('#qbTagCategoryList').get_by_text('练习阶段',exact=True).count()==1
    assert not errors,errors
    browser.close()
print('v90-p335-admin-sticky-account-tag-category-browser-ok')
