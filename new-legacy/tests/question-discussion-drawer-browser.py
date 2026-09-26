"""Real DOM behavior tests on desktop and mobile with deterministic transport."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    for viewport in [{'width':1280,'height':900},{'width':390,'height':844}]:
        page=browser.new_page(viewport=viewport)
        page.route('**/harness',lambda r:r.fulfill(content_type='text/html',body='<div id="panel">解析</div><button id="next">下一题</button><article id="card">报告</article>'))
        comments=[dict(id='c1',questionId='q1',content='短评论',author='学员',likeCount=0,danmakuEligible=True,myLike=False,myFavorite=False,questionTitle='收藏题目',question={'title':'收藏题目','analysis':'解析文字','options':[]})]
        def api(r):
            if r.request.method=='GET': r.fulfill(json={'comments':comments[:1] if '/favorites' in r.request.url else comments,'nextCursor':None})
            else:
                c=dict(comments[0]);c.update(myLike=True,myFavorite=True)
                r.fulfill(json={'comment':c})
        page.route('**/api/**',api)
        page.goto('http://localhost/harness')
        page.add_style_tag(content=(ROOT/'styles/question-comments.css').read_text())
        page.evaluate("window.KGAuthCore={currentUser:()=>({username:'student',role:'student'})}")
        page.add_script_tag(content=(ROOT/'src/119-question-comments.js').read_text())
        page.evaluate("KGQuestionComments.mountPanel({panel:document.querySelector('#panel'),questionId:'q1'})")
        page.wait_for_selector('.q-danmaku-item')
        assert page.locator('.q-danmaku').evaluate("e=>getComputedStyle(e).position")=='fixed'
        assert page.locator('.q-danmaku').evaluate('e=>getComputedStyle(e).pointerEvents')=='none'
        page.locator('[data-qc-action="expand"]').click()
        page.wait_for_selector('.q-comments-drawer')
        page.fill('.q-composer-input','未发送草稿')
        page.locator('.q-comments-drawer [data-qc-action="toggle-like"]').click()
        page.wait_for_function("document.querySelector('.q-comments-drawer .q-comment-like').getAttribute('aria-pressed')==='true'")
        assert page.input_value('.q-composer-input')=='未发送草稿'
        page.locator('.q-comments-drawer [data-qc-action="toggle-favorite"]').click()
        page.wait_for_function("document.querySelector('.q-comments-drawer [data-qc-action=\"toggle-favorite\"]').getAttribute('aria-pressed')==='true'")
        comments.append(dict(id='reply1',questionId='q1',parentId='c1',content='展开回复内容',author='回复者',likeCount=0,danmakuEligible=True))
        page.evaluate("KGQuestionComments.mountPanel({panel:document.querySelector('#panel'),questionId:'q1'})")
        page.wait_for_selector('[data-qc-action="toggle-replies"]')
        assert page.locator('.q-comment[data-comment-id="reply1"]').count()==0
        page.locator('[data-qc-action="toggle-replies"]').click()
        assert page.locator('.q-comment[data-comment-id="reply1"]').count()==1
        page.locator('.q-comments-drawer .q-comment[data-comment-id="c1"] [data-qc-action="reply"]').click()
        assert page.locator('[data-qc-reply]').count()==1
        if viewport['width'] < 700:
            page.locator('.q-comments-drawer').evaluate('e=>e.scrollTop=0')
            handle=page.locator('[data-qc-handle]').bounding_box()
            before=page.locator('.q-comments-drawer').bounding_box()['height']
            page.mouse.move(handle['x']+10,handle['y']+2)
            page.mouse.down()
            page.mouse.move(handle['x']+10,handle['y']-80,steps=8)
            page.mouse.up()
            assert page.locator('.q-comments-drawer').bounding_box()['height'] > before
        page.locator('[data-qc-action="collapse"]').click()
        assert page.locator('.q-comments-drawer').count()==0
        assert page.locator('[data-qc-action="expand"]').evaluate('e=>e===document.activeElement')
        page.locator('#panel [data-qc-action="danmaku-toggle"]').click()
        assert page.locator('.q-danmaku').count()==0
        page.evaluate("KGQuestionComments.mountPanel({panel:document.querySelector('#panel'),questionId:'q1'})")
        page.wait_for_timeout(50)
        assert page.locator('.q-danmaku').count()==0
        page.locator('#panel [data-qc-action="danmaku-toggle"]').click()
        page.locator('.q-danmaku-item').first.dispatch_event('click')
        assert page.locator('.q-danmaku-item.is-paused').count()==1
        assert page.locator('.q-comments-drawer').count()==1
        page.locator('[data-qc-action="collapse"]').click()
        assert page.locator('.q-danmaku-item.is-paused').count()==0
        page.locator('#panel [data-qc-action="favorites"]').click()
        page.wait_for_selector('.q-comments-drawer [data-qc-action="return"]')
        page.evaluate("KGQuestionComments.teardown(document.querySelector('#panel'));KGQuestionComments.mountCard({card:document.querySelector('#card'),questionId:'q2'})")
        page.locator('#card [data-qc-action="favorites"]').click()
        page.wait_for_selector('.q-comments-drawer [data-qc-action="return"]')
        page.locator('.q-comments-drawer [data-qc-action="return"]').click()
        page.wait_for_selector('.q-favorite-question')
        assert '收藏题目' in page.locator('.q-favorite-question').inner_text()
        page.locator('[data-qc-close-question]').click()
        assert page.locator('.q-favorite-question').count()==0
        page.evaluate("window.dispatchEvent(new Event('kg-auth-session-change'))")
        assert page.locator('.q-danmaku,.q-comments-drawer').count()==0
        page.evaluate('KGQuestionComments.teardown()')
        assert page.locator('.q-danmaku,.q-comments-drawer').count()==0
        page.route('**/api/v1/questions/q-login/comments',lambda r:r.fulfill(status=401,json={'detail':'login required'}))
        page.evaluate("window.authOpened=false;window.KGSharedAuthDialog={open:()=>window.authOpened=true};window.KGAuthCore={currentUser:()=>null};KGQuestionComments.mountPanel({panel:document.querySelector('#panel'),questionId:'q-login'})")
        page.locator('#panel [data-qc-action="expand"]').click()
        page.wait_for_selector('[data-qc-action="login"]')
        page.locator('[data-qc-action="login"]').click()
        assert page.evaluate('window.authOpened')
        page.evaluate('KGQuestionComments.teardown()')
        page.close()
    browser.close()
print('desktop/mobile discussion drawer behavior passed')
