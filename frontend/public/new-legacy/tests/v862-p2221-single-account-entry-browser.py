from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
def text(p): return (ROOT/p).read_text()
def body_html(p):
    s=text(p);m=re.search(r'<body[^>]*>([\s\S]*)</body>',s,re.I)
    return re.sub(r'<script[\s\S]*?</script>','',m.group(1),flags=re.I)

with sync_playwright() as p:
    b=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'])
    page=b.new_page(viewport={'width':1200,'height':760})
    page.set_content('<body class="question-training-page">'+body_html('question-training.html')+'</body>')
    page.locator('html').evaluate("el=>el.classList.add('qt-canvas-initial-pending')")
    for st in ['styles/question-training.css','styles/dual-canvas.css','styles/learning-practice-shell.css','styles/user-center.css','styles/account-menu.css','styles/question-training-p2220.css','styles/question-training-p2221.css']:
        page.add_style_tag(content=text(st))

    # Standalone login/logout controls are hidden; account capsule is the only visible session entry.
    assert page.locator('#accountMenuShell').count()==1
    assert page.locator('#authLogoutBtn').is_hidden()
    assert page.locator('.auth-logout-btn').count()==0

    page.evaluate("""()=>{
      window.KGAuthRuntime={isLoggedIn:()=>true,logout:()=>{window._logoutCalled=true}};
      window.KGAuthCore={currentUser:()=>({username:'demo'})};
    }""")
    page.add_script_tag(content=text('src/41-account-menu.js'))
    page.wait_for_timeout(30)
    page.locator('#authStatus').click()
    assert page.locator('#accountMenu').is_visible()
    assert page.locator('#accountMenuSessionBtn').inner_text().strip()=='退出登录'
    page.locator('#accountMenuSessionBtn').click()
    assert page.evaluate("window._logoutCalled===true")

    # First paint is masked until Step 1 focus settles.
    world=page.locator('#qtCanvasWorld')
    assert float(world.evaluate("el=>getComputedStyle(el).opacity"))==0
    page.locator('html').evaluate("el=>el.classList.remove('qt-canvas-initial-pending')")
    page.locator('body').evaluate("el=>el.classList.add('qt-canvas-entry-settled')")
    page.wait_for_timeout(230)
    assert float(world.evaluate("el=>getComputedStyle(el).opacity"))>.95

    assert page.evaluate("document.documentElement.scrollWidth-document.documentElement.clientWidth")<=4
    page.close();b.close()

print('v862-p2221-single-account-entry-browser-ok')
