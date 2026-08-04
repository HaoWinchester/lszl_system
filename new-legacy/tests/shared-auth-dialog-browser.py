#!/usr/bin/env python3
from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SHARED = ROOT / 'src/30-shared-auth-dialog.js'
WECHAT = ROOT / 'src/32-wechat-login.js'
ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
TARGETS = ('index.html', 'practice-mode.html')
VIEWPORTS = (390, 944, 1440)


def body_html(file_name):
    source = (ROOT / file_name).read_text(encoding='utf-8')
    match = re.search(r'<body([^>]*)>([\s\S]*)</body>', source, re.I)
    assert match, f'{file_name} has no body'
    body = re.sub(r'<script[\s\S]*?</script>', '', match.group(2), flags=re.I)
    return match.group(1), body


def install_harness(page, file_name, initial_username=''):
    attrs, body = body_html(file_name)
    page.set_content(f'<!doctype html><html><head><base href="http://localhost/"></head><body{attrs}>{body}</body></html>')
    page.add_style_tag(content=(ROOT / 'styles/main.css').read_text(encoding='utf-8'))
    if file_name == 'practice-mode.html':
        page.add_style_tag(content=(ROOT / 'styles/learning-skin.css').read_text(encoding='utf-8'))
    page.evaluate("""initialUsername=>{
      let user=initialUsername?{username:initialUsername,displayName:'管理员'}:null;
      const calls={login:0,register:0,logout:0};
      window.__authHarness={calls,current:()=>user};
      window.KGAuthCore={
        cleanUsername:value=>String(value||'').trim().replace(/\s+/g,'_').slice(0,32),
        currentUser:()=>user,
        currentUsername:()=>user?.username||'',
        providerStatus:()=>({remote:true,label:'测试后端'}),
        async login(username,password){
          calls.login+=1;
          await new Promise(resolve=>setTimeout(resolve,35));
          if(username!=='admin'||password!=='admin123')return {ok:false,message:'密码不正确。'};
          user={username:'admin',displayName:'管理员'};
          return {ok:true,user};
        },
        async register(username,password){
          calls.register+=1;
          await new Promise(resolve=>setTimeout(resolve,20));
          if(username==='admin')return {ok:false,message:'该用户名已存在，请直接登录。'};
          user={username,displayName:username};
          return {ok:true,user};
        },
        async logout(){calls.logout+=1;user=null;return {ok:true}},
      };
      window.fetch=async()=>({
        ok:true,
        async json(){return {authUrl:'https://open.weixin.qq.com/connect/qrconnect?appid=test-app&redirect_uri=https%3A%2F%2Fexample.com%2Fcallback&scope=snsapi_login&state=test-state'}}
      });
      window.WxLogin=function(options){
        const target=document.getElementById(options.id);
        if(target)target.innerHTML='<strong data-test-qr="true">测试二维码</strong>';
      };
    }""", initial_username)
    page.add_script_tag(content=SHARED.read_text(encoding='utf-8'))
    page.add_script_tag(content=WECHAT.read_text(encoding='utf-8'))
    page.evaluate("KGWechatLogin.ensureAuthPanel()")


def modal_signature(page):
    return page.locator('#authModal').evaluate("""modal=>({
      html:modal.querySelector('.auth-modal').innerHTML.replace(/\s+/g,' ').trim(),
      wechat:modal.querySelectorAll('.wechat-login-entry').length,
      labels:[...modal.querySelectorAll('label')].map(label=>label.textContent.trim()),
      actions:[...modal.querySelectorAll('.auth-actions button')].map(button=>button.textContent.trim())
    })""")


def visual_signature(page):
    return page.locator('.auth-modal').evaluate("""modal=>{
      const style=getComputedStyle(modal),rect=modal.getBoundingClientRect();
      const input=getComputedStyle(modal.querySelector('#authUsername'));
      const close=getComputedStyle(modal.querySelector('#authCloseBtn'));
      const primary=getComputedStyle(modal.querySelector('#authDoLoginBtn'));
      const message=modal.querySelector('#authMsg');
      message.textContent='状态';message.classList.add('ok');
      const successColor=getComputedStyle(message).color;
      message.classList.remove('ok');
      const errorColor=getComputedStyle(message).color;
      message.textContent='';
      return {
        width:Math.round(rect.width),
        background:style.backgroundColor,
        borderRadius:style.borderRadius,
        boxShadow:style.boxShadow,
        borderColor:style.borderColor,
        fontFamily:style.fontFamily,
        inputRadius:input.borderRadius,
        closeRadius:close.borderRadius,
        primaryRadius:primary.borderRadius,
        primaryTransition:primary.transition,
        successColor,
        errorColor,
        inViewport:rect.left>=0&&rect.right<=innerWidth&&rect.top>=0&&rect.bottom<=innerHeight
      };
    }""")


def exercise_dialog(page):
    page.evaluate("KGSharedAuthDialog.open()")
    assert page.locator('#authModal').get_attribute('aria-hidden') == 'false'
    assert page.locator('#authUsername').evaluate('element=>element===document.activeElement')

    page.locator('#authCloseBtn').click()
    assert page.locator('#authModal').get_attribute('aria-hidden') == 'true'
    page.evaluate("KGSharedAuthDialog.open()")
    page.keyboard.press('Escape')
    assert page.locator('#authModal').get_attribute('aria-hidden') == 'true'
    page.evaluate("KGSharedAuthDialog.open()")
    page.locator('#authModal').evaluate('modal=>modal.click()')
    assert page.locator('#authModal').get_attribute('aria-hidden') == 'true'

    page.evaluate("KGSharedAuthDialog.open()")
    page.locator('#authDoLoginBtn').click()
    assert '请输入用户名和密码' in page.locator('#authMsg').inner_text()

    page.locator('#authUsername').fill('admin')
    page.locator('#authPassword').fill('wrong')
    page.locator('#authDoLoginBtn').click()
    page.locator('#authMsg').get_by_text('密码不正确。').wait_for()
    assert not page.locator('#authDoLoginBtn').is_disabled()

    page.locator('#authPassword').fill('admin123')
    page.evaluate("""()=>{
      document.getElementById('authDoLoginBtn').click();
      document.getElementById('authDoLoginBtn').click();
    }""")
    page.wait_for_function("!document.getElementById('authModal').classList.contains('show')")
    assert page.evaluate('__authHarness.calls.login') == 2
    assert page.evaluate('__authHarness.current().username') == 'admin'

    page.evaluate("KGSharedAuthDialog.logout()")
    page.wait_for_function("__authHarness.current()===null")
    page.evaluate("KGSharedAuthDialog.open()")
    page.locator('#authUsername').fill('a')
    page.locator('#authPassword').fill('1234')
    page.locator('#authRegisterBtn').click()
    assert '用户名至少需要 2 个字符' in page.locator('#authMsg').inner_text()
    page.locator('#authUsername').fill('new_student')
    page.locator('#authPassword').fill('123')
    page.locator('#authRegisterBtn').click()
    assert '密码至少需要 4 个字符' in page.locator('#authMsg').inner_text()
    page.locator('#authPassword').fill('1234')
    page.locator('#authRegisterBtn').click()
    page.wait_for_function("!document.getElementById('authModal').classList.contains('show')")
    assert page.evaluate('__authHarness.current().username') == 'new_student'

    page.evaluate("KGSharedAuthDialog.logout()")
    page.evaluate("KGSharedAuthDialog.open()")
    page.locator('#authUsername').fill('admin')
    page.locator('#authPassword').fill('admin123')
    page.locator('#authPassword').press('Enter')
    page.wait_for_function("!document.getElementById('authModal').classList.contains('show')")
    assert page.evaluate('__authHarness.current().username') == 'admin'

    page.evaluate("KGSharedAuthDialog.logout()")
    page.evaluate("KGSharedAuthDialog.open()")
    page.locator('.wechat-login-entry').click()
    page.locator('[data-test-qr="true"]').wait_for()
    assert 'wechat-login-mode' in (page.locator('#authModal').get_attribute('class') or '')
    page.locator('.wechat-login-back').click()
    assert 'wechat-login-mode' not in (page.locator('#authModal').get_attribute('class') or '')

    page.evaluate("""()=>{
      document.getElementById('authDialogRoot').innerHTML='';
      KGSharedAuthDialog.mount();
      KGSharedAuthDialog.open();
    }""")
    page.locator('#authCloseBtn').click()
    assert page.locator('#authModal').get_attribute('aria-hidden') == 'true'


assert SHARED.exists(), 'src/30-shared-auth-dialog.js must exist before browser behavior can pass'

with sync_playwright() as playwright:
    launch_options = {'headless': True, 'args': ARGS}
    if Path('/usr/bin/chromium').exists():
        launch_options['executable_path'] = '/usr/bin/chromium'
    browser = playwright.chromium.launch(**launch_options)

    errors = []
    signatures = {}
    for file_name in TARGETS:
        page = browser.new_page(viewport={'width': 944, 'height': 900})
        page.set_default_timeout(10000)
        page.on('pageerror', lambda error, name=file_name: errors.append(f'{name}: {error}'))
        install_harness(page, file_name)
        signatures[file_name] = modal_signature(page)
        exercise_dialog(page)
        page.close()
    assert signatures['index.html'] == signatures['practice-mode.html'], signatures

    initial_page = browser.new_page(viewport={'width': 944, 'height': 900})
    initial_page.set_default_timeout(10000)
    install_harness(initial_page, 'practice-mode.html', 'admin')
    assert initial_page.locator('#authStatus .account-menu-trigger-label').inner_text() == '管理员'
    initial_page.close()

    for width in VIEWPORTS:
        visuals = {}
        for file_name in TARGETS:
            page = browser.new_page(viewport={'width': width, 'height': 900})
            page.set_default_timeout(10000)
            page.on('pageerror', lambda error, name=file_name: errors.append(f'{name}@{width}: {error}'))
            install_harness(page, file_name)
            page.evaluate("KGSharedAuthDialog.open()")
            visuals[file_name] = visual_signature(page)
            assert visuals[file_name]['inViewport'], (file_name, width, visuals[file_name])
            page.close()
        assert visuals['index.html'] == visuals['practice-mode.html'], (width, visuals)

    assert not errors, errors
    browser.close()

print('shared-auth-dialog-browser-ok')
