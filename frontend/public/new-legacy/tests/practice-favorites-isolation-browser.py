"""Shared favorites detail works before the drawer opens; late results are discarded."""
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome');page=browser.new_page();held=[]
    page.route('http://127.0.0.1/favorites-test',lambda r:r.fulfill(content_type='text/html',body='<div id="list"></div><div id="empty"></div><div id="summary"></div><div id="detail" hidden></div><p id="toast"></p>'))
    page.route('**/api/v1/question-favorites/detail?*',lambda r:held.append(r))
    page.goto('http://127.0.0.1/favorites-test')
    page.evaluate("window.owner='A';window.KGAuthCore={currentUser:()=>({username:owner})}")
    page.add_script_tag(path=str(ROOT/'src/120-question-favorites.js'))
    page.evaluate("KGQuestionFavorites.configure({list:document.querySelector('#list'),empty:document.querySelector('#empty'),summary:document.querySelector('#summary'),detail:document.querySelector('#detail'),onToast:t=>document.querySelector('#toast').textContent=t})")
    payload={'questionId':'q1','stemParts':[{'text':'A-private-title'}],'options':[{'id':'A','text':'Yes','correct':True},{'id':'B','text':'No'}],'correctAnswer':'A','favorited':True}
    def begin():
        page.evaluate("window.pending=KGQuestionFavorites.openDetail('q1');void 0");page.wait_for_timeout(50)
    begin();assert held;held.pop().fulfill(json=payload);page.evaluate('pending');expect(page.locator('#detail')).to_be_visible();expect(page.locator('#detail')).to_contain_text('A-private-title')
    page.evaluate('KGQuestionFavorites.closeDetail()')
    begin();page.evaluate("owner='B';dispatchEvent(new CustomEvent('kg-auth-session-change'))");held.pop().fulfill(json=payload);page.evaluate('pending');expect(page.locator('#detail')).to_be_hidden();assert 'A-private-title' not in page.locator('#detail').inner_text()
    begin();page.evaluate('KGQuestionFavorites.closeDetail()');held.pop().fulfill(json=payload);page.evaluate('pending');expect(page.locator('#detail')).to_be_hidden()
    begin();held.pop().fulfill(status=503,json={'detail':'详情暂时不可用'});page.evaluate('pending');expect(page.locator('#toast')).to_contain_text('详情暂时不可用')
    browser.close()
print('favorites configure, first detail, account change, cancellation and failure passed')
