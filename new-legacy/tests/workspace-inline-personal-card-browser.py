#!/usr/bin/env python3
"""Disposable localhost: inline personal-card text survives real API failures/recovery."""
import argparse,json,time,uuid
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[2];parser=argparse.ArgumentParser();parser.add_argument('--base-url',required=True);BASE=parser.parse_args().base_url.rstrip('/')
parsed=urlparse(BASE);assert parsed.hostname in ('127.0.0.1','localhost') and parsed.port
OUT=ROOT/'artifacts/workspace-inline-recovery';OUT.mkdir(parents=True,exist_ok=True);PASSWORD='ink-browser-test'
def dismiss(page):
    for selector in ['#learningEntryDismissBtn','.tour-skip','#hideHelpBtn']:
        if page.locator(selector).is_visible():page.locator(selector).click()
def login(context,user):
    result=context.request.post(BASE+'/api/v1/auth/login',data={'username':user,'password':PASSWORD});assert result.ok,(result.status,result.text())
def finish_login(page,user):
    expect(page.locator('#authModal')).to_be_visible()
    button=page.get_by_role('button',name='使用账号密码登录',exact=True)
    if button.is_visible():button.click()
    page.locator('#authUsername').fill(user);page.locator('#authPassword').fill(PASSWORD)
    consent=page.locator('#authLegalConsent')
    if consent.is_visible():consent.check()
    page.locator('#authDoLoginBtn').click()
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='chrome');admin=browser.new_context();login(admin,'ink-admin')
    user='inline-'+uuid.uuid4().hex[:12];created=admin.request.post(BASE+'/api/v1/users',data={'username':user,'password':PASSWORD,'role':'teacher'})
    assert created.ok,(created.status,created.text())
    context=browser.new_context(viewport={'width':1440,'height':1000});login(context,user)
    page=context.new_page();page.set_default_timeout(10000);errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    page.goto(BASE+'/question-workspace.html?paperId=ink-paper&releaseId=ink-release',wait_until='networkidle');dismiss(page)
    page.wait_for_function('window.KGMultiQuestionWorkspace?.activeWorkspace() && document.body.dataset.qwReadonly==="0"')
    card=page.evaluate("KGPersonalSynthesisCardApi.create({title:'原始个人归纳标题',content:'原始个人归纳内容',synthesisType:'principle'})")
    result=page.evaluate('''async card=>{const result=await KGMultiQuestionWorkspace.insertPersonalCard(card,{x:100,y:100,width:420,height:280});await KGCanvasWorkspaceAdapter.flush({throwOnError:true});return result}''',card)
    assert result['created'],result;node_id=result['node']['id'];card_id=card['id'];workspace_id=result['workspace']['id']
    page.evaluate('(id)=>KGMultiQuestionWorkspace.focusNode(id,{zoom:1})',node_id)
    selector=f'[data-node-id="{node_id}"] '
    title=page.locator(selector+'[data-qw-inline-field=title]');content=page.locator(selector+'[data-qw-inline-field=content]')
    title.dblclick();expect(title).to_have_attribute('contenteditable','true');title.fill('503 失败仍保留的标题')
    title.evaluate('e=>window.inlineOriginalElement=e')
    def offline(route):
        if route.request.method=='PUT':route.fulfill(status=503,content_type='application/json',body='{"detail":"offline"}')
        else:route.continue_()
    page.route('**/api/v1/learning/personal-cards/'+card_id,offline)
    title.press('Enter');expect(title).to_have_attribute('data-save-state','failed');expect(title).to_have_text('503 失败仍保留的标题')
    assert title.evaluate('e=>e===inlineOriginalElement && e.isContentEditable')
    assert page.evaluate('KGAuthRecovery.hasUnsavedChanges()')
    page.unroute('**/api/v1/learning/personal-cards/'+card_id,offline);title.press('Enter')
    expect(title).not_to_have_attribute('contenteditable','true')
    assert context.request.get(BASE+'/api/v1/learning/personal-cards/'+card_id).json()['card']['title']=='503 失败仍保留的标题'
    # Hold a real PUT, then type more while its authoritative response/list event arrives.
    held=[]
    def hold(route):
        if route.request.method=='PUT':held.append(route)
        else:route.continue_()
    page.route('**/api/v1/learning/personal-cards/'+card_id,hold)
    title.dblclick();title.fill('请求中的第一版');title.press('Enter')
    deadline=time.monotonic()+5
    while not held and time.monotonic()<deadline:page.wait_for_timeout(30)
    assert len(held)==1
    title.fill('等待保存时继续输入的新标题');title.evaluate('e=>window.inlineOriginalElement=e')
    response=held[0].fetch();assert response.ok,(response.status,response.text());held[0].fulfill(response=response)
    expect(title).to_have_attribute('data-save-state','draft');expect(title).to_have_text('等待保存时继续输入的新标题')
    assert title.evaluate('e=>e===inlineOriginalElement && e.isContentEditable')
    page.unroute('**/api/v1/learning/personal-cards/'+card_id,hold);title.press('Enter');expect(title).not_to_have_attribute('contenteditable','true')
    assert context.request.get(BASE+'/api/v1/learning/personal-cards/'+card_id).json()['card']['title']=='等待保存时继续输入的新标题'
    # Expire the real cookie while editing content, then recover without replacing its DOM.
    content.dblclick();content.fill('401后保留的个人归纳内容\n第二行仍在');typed=content.inner_text();content.evaluate('e=>window.inlineOriginalElement=e')
    context.clear_cookies();content.press('Control+Enter')
    expect(content).to_have_attribute('data-save-state','failed');assert content.inner_text()==typed
    assert content.evaluate('e=>e===inlineOriginalElement && e.isContentEditable')
    page.wait_for_function('KGAuthRecovery.isPaused()')
    page.locator('[data-auth-recovery-login]').click()
    finish_login(page,user);expect(page.locator('#authModal')).to_be_hidden();dismiss(page)
    expect(content).not_to_have_attribute('contenteditable','true')
    saved=context.request.get(BASE+'/api/v1/learning/personal-cards/'+card_id).json()['card'];assert saved['content']==typed.strip(),saved
    assert saved['title']=='等待保存时继续输入的新标题'
    page.evaluate('KGCanvasWorkspaceAdapter.flush({throwOnError:true})')
    workspaces=context.request.get(BASE+'/api/v1/workspaces').json()['workspaces']
    payload=next(item['payload'] for item in workspaces if item['payload'].get('id')==workspace_id);assert payload['nodes'][node_id]['content']==typed.strip()
    page.reload(wait_until='networkidle');dismiss(page)
    expect(page.locator(selector+'[data-qw-inline-field=content]')).to_contain_text('401后保留的个人归纳内容')
    assert not errors,errors;page.screenshot(path=str(OUT/'inline-recovered-reload.png'))
    (OUT/'results.json').write_text(json.dumps({'username':user,'workspaceId':workspace_id,'nodeId':node_id,'cardId':card_id,'checks':['503-title-same-DOM-retry','pending-write-new-input','personal-library-no-repaint','real401-content-retention','same-page-login-recovery','DB-reload']},ensure_ascii=False,indent=2))
    print('PASS workspace inline personal card: 503 retention/retry, pending newer input, real401 same-page recovery, exact DB/reload text',flush=True)
    context.close();admin.close();browser.close()
