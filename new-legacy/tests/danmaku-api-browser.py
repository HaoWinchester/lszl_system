#!/usr/bin/env python3
"""Real FastAPI/PostgreSQL danmaku regression; only a disposable local server.

Run via new-legacy/tests/run-danmaku-api-browser.py for DB isolation.
Successful API responses are never mocked. --source-overrides serves edited
authoritative assets without syncing or promoting a release.
"""
import argparse
import json
from helpers.practice_tools import click_tool, open_tools
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--base-url', required=True)
parser.add_argument('--output-dir', type=Path, default=ROOT/'artifacts/danmaku-image-design')
parser.add_argument('--source-overrides', action='store_true')
args = parser.parse_args()
BASE = args.base_url.rstrip('/')
assert urlparse(BASE).hostname == '127.0.0.1' and urlparse(BASE).port, 'Disposable loopback server required'
OUT = args.output_dir
OUT.mkdir(parents=True, exist_ok=True)
checks, errors, traffic = [], [], []
qid = 'ink-question-1'
comments_url = f'/api/v1/questions/{qid}/comments'


def call(ctx, method, path, body=None, status=None):
    response = getattr(ctx.request, method)(BASE+path, data=body) if body is not None else getattr(ctx.request, method)(BASE+path)
    if status is None:
        assert response.ok, (method, path, response.status, response.text())
    else:
        assert response.status == status, (method, path, response.status, response.text())
    return response.json() if response.status != 204 else None


def source_asset(route):
    asset = (ROOT/'new-legacy'/urlparse(route.request.url).path.lstrip('/')).resolve()
    if asset.is_relative_to(ROOT/'new-legacy') and asset.is_file():
        route.fulfill(path=asset)
    else:
        route.continue_()


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True)
    ctx = browser.new_context(viewport={'width':1440,'height':1000}, timezone_id='Asia/Shanghai')
    writer = browser.new_context()
    guest = browser.new_context()
    call(ctx, 'post', '/api/v1/auth/login', {'username':'ink-browser','password':'ink-browser-test'})
    call(writer, 'post', '/api/v1/auth/login', {'username':'ink-viewer','password':'ink-browser-test'})
    # Distinct real authors make the other-user priority and permissions meaningful.
    token = uuid4().hex[:7]
    seeded = [call(writer, 'post', comments_url, {'content':f'先分析影响再处理 {token}-{i}'})['comment'] for i in range(9)]
    long_comment = call(writer, 'post', comments_url, {'content':'这个讨论应当在完整分析项目风险和相关干系人影响之后再决定是否采取下一步行动。'})['comment']
    own = call(ctx, 'post', comments_url, {'content':'我也会先分析影响 '+token})['comment']
    second = call(writer, 'post', '/api/v1/questions/ink-question-2/comments', {'content':'第二题独立弹幕 '+token})['comment']
    target = seeded[-1]
    target_path = comments_url+'/'+target['id']
    page = ctx.new_page()
    page.set_default_timeout(12000)
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('response', lambda response: traffic.append({'method':response.request.method,'path':urlparse(response.url).path,'status':response.status}) if '/api/v1/' in response.url else None)
    if args.source_overrides:
        for pattern in ['**/src/**','**/styles/**','**/assets/icons/**']:
            page.route(pattern, source_asset)

    def state():
        return next(c for c in call(ctx, 'get', comments_url)['comments'] if c['id'] == target['id'])

    def open_chip(comment_id=target['id']):
        chip = page.locator(f'[data-danmaku-comment-id="{comment_id}"]')
        expect(chip).to_have_count(1)
        # Freeze only motion for repeatable browser clicks; real DOM/CSS/actions remain.
        chip.evaluate("e=>{e.style.animation='none';e.style.position='fixed';e.style.transform='none';e.style.left='min(120px,10vw)';e.style.top='160px'}")
        chip.click()
        expect(page.locator('[data-danmaku-pop]')).to_be_visible()

    def pop_action(action, suffix=None, method=None):
        if suffix:
            with page.expect_response(lambda response: response.url.endswith(target_path+suffix) and response.request.method == method) as result:
                page.locator(f'[data-qc-pop-action="{action}"]').click()
            assert result.value.ok, (action,result.value.status)
        else:
            page.locator(f'[data-qc-pop-action="{action}"]').click()

    def remount_question():
        page.locator('#practiceNextBtn').click()
        page.wait_for_function('KGPracticeMode.snapshot().index===1')
        expect(page.locator('[data-danmaku-pop],.q-danmaku-item')).to_have_count(0)
        expect(page.locator('#practiceExplanationPanel')).to_be_hidden()
        page.locator('#practicePrevBtn').click()
        page.wait_for_function('KGPracticeMode.snapshot().index===0')
        expect(page.locator(f'[data-danmaku-comment-id="{target["id"]}"]')).to_have_count(1)

    try:
        page.goto(BASE+'/practice-mode.html', wait_until='networkidle')
        page.locator('#practicePaperLibrary [data-paper-id="ink-paper"]').click()
        page.locator('[data-practice-start="practice"]').click()
        page.wait_for_function('KGPracticeMode.snapshot().active')
        assert page.evaluate('KGPracticeMode.snapshot().questionCount') == 2
        expect(page.locator('.q-danmaku')).to_have_count(0)
        click_tool(page, '#practiceCommentBtn')
        expect(page.locator('.q-comments-drawer .q-comment')).to_have_count(11)
        expect(page.locator('.q-danmaku')).to_have_count(0)
        page.locator('.q-comments-drawer [data-qc-action="collapse"]').click()
        checks.append('actual practice: unanswered question and pre-answer discussion suppress danmaku')

        # Enable the existing real UI explanation preference, then answer.
        page.locator('#practiceAutoExplain').check()
        page.locator('#practiceOptions [data-option-id="A"]').click()
        expect(page.locator('#practiceExplanationPanel')).to_be_visible()
        expect(page.locator('.q-danmaku-item')).to_have_count(8)
        visible = page.locator('.q-danmaku-item').evaluate_all('els=>els.map(e=>e.dataset.danmakuCommentId)')
        assert own['id'] not in visible and long_comment['id'] not in visible
        assert set(visible).issubset({c['id'] for c in seeded})
        checks.append('real API short-comment eligibility, other-author priority and eight-item cap')

        open_chip()
        pop_action('like', '/like', 'POST')
        expect(page.locator('[data-qc-pop-action="like"]')).to_have_attribute('aria-pressed','true')
        assert state()['myLike'] and state()['likeCount'] == 1
        page.keyboard.press('Escape')
        remount_question()
        open_chip()
        expect(page.locator('[data-qc-pop-action="like"]')).to_have_attribute('aria-pressed','true')
        pop_action('like', '/like', 'DELETE')
        expect(page.locator('[data-qc-pop-action="like"]')).to_have_attribute('aria-pressed','false')
        assert not state()['myLike'] and state()['likeCount'] == 0
        checks.append('real like persists through question teardown/remount; unlike persists on server')

        pop_action('more')
        pop_action('favorite','/favorite','PUT')
        expect(page.locator('[data-qc-pop-action="favorite"]')).to_have_attribute('aria-pressed','true')
        assert state()['myFavorite']
        assert target['id'] in {c['id'] for c in call(ctx,'get','/api/v1/question-comments/favorites')['comments']}
        page.keyboard.press('Escape')
        remount_question()
        open_chip()
        pop_action('more')
        expect(page.locator('[data-qc-pop-action="favorite"]')).to_have_attribute('aria-pressed','true')
        page.screenshot(path=str(OUT/'api-desktop-favorite.png'))
        pop_action('favorite','/favorite','DELETE')
        expect(page.locator('[data-qc-pop-action="favorite"]')).to_have_attribute('aria-pressed','false')
        assert not state()['myFavorite']
        assert target['id'] not in {c['id'] for c in call(ctx,'get','/api/v1/question-comments/favorites')['comments']}
        checks.append('real favorite/unfavorite, private favorites API and remount persistence')

        # Exactly one real HTTP failure; success retry must reach FastAPI/PostgreSQL.
        failure_count = []
        def fail_once(route):
            failure_count.append(route.request.method)
            route.fulfill(status=503, json={'detail':'intentional disposable browser failure'})
        page.route('**'+target_path+'/like', fail_once, times=1)
        with page.expect_response(lambda response: response.url.endswith(target_path+'/like') and response.status == 503):
            pop_action('like')
        expect(page.locator('[data-qc-pop-action="like"]')).to_have_attribute('aria-pressed','false')
        assert not state()['myLike']
        pop_action('like','/like','POST')
        expect(page.locator('[data-qc-pop-action="like"]')).to_have_attribute('aria-pressed','true')
        assert state()['myLike'] and failure_count == ['POST']
        pop_action('like','/like','DELETE')
        checks.append('one injected 503 leaves persisted state unchanged; next click recovers via real API')

        pop_action('reply')
        expect(page.locator('.q-comments-drawer [data-qc-reply]')).to_be_visible()
        reply_text = '认可这个处理顺序 '+token
        page.locator('.q-comments-drawer .q-composer-input').fill(reply_text)
        with page.expect_response(lambda response: response.url.endswith(comments_url) and response.request.method=='POST') as sent:
            page.locator('.q-comments-drawer [data-qc-action="send"]').click()
        assert sent.value.status == 201
        reply = sent.value.json()['comment']
        assert reply['parentId'] == target['id'] and reply['content'] == reply_text
        expect(page.locator(f'.q-comments-drawer [data-comment-id="{reply["id"]}"]')).to_be_visible()
        assert any(c['id']==reply['id'] and c['parentId']==target['id'] for c in call(ctx,'get',comments_url)['comments'])
        page.locator('.q-comments-drawer [data-qc-action="collapse"]').click()
        checks.append('popover reply focuses actual drawer and persists correct parentId through real POST')

        click_tool(page, '#practiceDanmakuToggle')
        expect(page.locator('.q-danmaku')).to_have_count(0)
        assert page.evaluate('KGQuestionComments.danmakuEnabled()') is False
        click_tool(page, '#practiceDanmakuToggle')
        expect(page.locator('.q-danmaku-item')).to_have_count(8)
        open_chip()
        pop_action('dislike')
        expect(page.locator(f'[data-danmaku-comment-id="{target["id"]}"]')).to_have_count(0)
        assert target['id'] in page.evaluate("KGDevicePreferences.getString('kg_question_danmaku_hidden_v1__ink-browser')")
        assert any(c['id']==target['id'] for c in call(ctx,'get',comments_url)['comments'])
        click_tool(page, '#practiceDanmakuToggle')
        # A full page reload must preserve device toggle + hidden IDs; server has no hide mutation.
        page.reload(wait_until='networkidle')
        assert page.evaluate('KGQuestionComments.danmakuEnabled()') is False
        assert target['id'] in page.evaluate("KGDevicePreferences.getString('kg_question_danmaku_hidden_v1__ink-browser')")
        page.locator('[data-practice-start="practice"]').click()
        page.wait_for_function('KGPracticeMode.snapshot().active&&KGPracticeMode.snapshot().index===0')
        expect(page.locator('#practiceExplanationPanel')).to_be_visible()
        expect(page.locator('.q-danmaku')).to_have_count(0)
        click_tool(page, '#practiceDanmakuToggle')
        expect(page.locator('.q-danmaku-item')).to_have_count(8)
        expect(page.locator(f'[data-danmaku-comment-id="{target["id"]}"]')).to_have_count(0)
        checks.append('actual toggle and local dislike persist across reload without deleting shared comment')

        click_tool(page, '#practiceExitBtn')
        page.locator('#practiceExitCancel').click()
        expect(page.locator('.q-danmaku-item')).to_have_count(8)
        click_tool(page, '#practiceExitBtn')
        page.route('**/sessions/*/pause', lambda route: route.fulfill(status=503, json={'detail':'intentional pause failure'}), times=1)
        with page.expect_response(lambda response: response.url.endswith('/pause') and response.status==503):
            page.locator('#practiceSaveExitBtn').click()
        expect(page.locator('#practiceSaveExitBtn')).to_be_enabled()
        assert page.evaluate('document.body.dataset.practiceView')=='game'
        expect(page.locator('.q-danmaku-item')).to_have_count(8)
        with page.expect_response(lambda response: response.url.endswith('/pause') and response.ok):
            page.locator('#practiceSaveExitBtn').click()
        page.wait_for_function("document.body.dataset.practiceView==='lobby'")
        expect(page.locator('.q-danmaku')).to_have_count(0)
        expect(page.locator('.q-comments-standalone-host')).to_have_count(0)
        page.locator('[data-practice-start="practice"]').click()
        page.wait_for_function('KGPracticeMode.snapshot().active&&KGPracticeMode.snapshot().index===0')
        expect(page.locator('.q-danmaku-item')).to_have_count(8)
        checks.append('cancel/failed pause retain comments; successful real pause clears overlays and resume restores them')

        # Reloaded actual practice resumes the answered question with refreshed API data.
        page.locator('#practiceNextBtn').click()
        page.wait_for_function('KGPracticeMode.snapshot().index===1')
        expect(page.locator('.q-danmaku-item')).to_have_count(0)
        expect(page.locator('#practiceExplanationPanel')).to_be_hidden()
        page.locator('#practicePrevBtn').click()
        page.wait_for_function('KGPracticeMode.snapshot().index===0')
        expect(page.locator('.q-danmaku-item')).to_have_count(8)
        page.set_viewport_size({'width':390,'height':844})
        open_chip(seeded[-2]['id'])
        pop_action('more')
        box=page.locator('[data-danmaku-pop]').bounding_box()
        assert 8 <= box['x'] and box['x']+box['width'] <= 382, box
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        page.screenshot(path=str(OUT/'api-mobile-more.png'))
        checks.append('question change removes previous comments; actual 390px popover with more stays inside viewport')

        # Backend permission checks cannot be replaced by UI visibility checks.
        call(writer,'delete',comments_url+'/'+own['id'],status=403)
        private_bank=call(ctx,'post','/api/v1/banks',{'name':'弹幕私有权限 '+token,'subject':'PMP','visibility':'private'})['bank']
        private=call(ctx,'post',f'/api/v1/banks/{private_bank["id"]}/questions',{'title':'弹幕权限题','subject':'PMP','type':'single_choice','stemParts':[{'text':'私有题'}],'options':[{'id':'A','text':'选项'}],'correctAnswer':'A'})['question']
        private_url=f'/api/v1/questions/{private["id"]}/comments'
        call(writer,'get',private_url,status=403)
        call(writer,'post',private_url,{'content':'不可写入'},status=403)
        call(guest,'get',comments_url,status=401)
        call(guest,'post',comments_url,{'content':'不可匿名写入'},status=401)
        call(guest,'post',target_path+'/like',{},status=401)
        call(guest,'put',target_path+'/favorite',{},status=401)
        checks.append('real 403 for other-author deletion and inaccessible private question; guest read/write/like/favorite 401')

        # Account switch clears every live popover, chip, and drawer via the real auth event.
        page.set_viewport_size({'width':1440,'height':1000})
        page.locator('#authStatus').click()
        page.locator('#accountMenuSessionBtn').click()
        page.wait_for_function('!KGAuthCore.currentUser()')
        expect(page.locator('.q-danmaku,.q-comments-drawer')).to_have_count(0)
        page.evaluate("KGQuestionComments.openPanel({questionId:'ink-question-1'})")
        expect(page.locator('.q-composer-login')).to_be_visible()
        page.locator('.q-composer-login').click()
        expect(page.locator('#authModal')).to_be_visible()
        checks.append('real account logout tears down live components; guest discussion offers working login dialog')
        assert not errors, errors
    except Exception:
        page.screenshot(path=str(OUT/'api-failure.png'),full_page=True)
        (OUT/'api-failure-dom.html').write_text(page.content())
        raise
    finally:
        (OUT/'api-browser-results.json').write_text(json.dumps({'baseUrl':BASE,'sourceOverrides':args.source_overrides,'successfulApiMocks':False,'failureInjection':'one POST like responds 503; all successful requests hit real FastAPI/PostgreSQL','checks':checks,'pageErrors':errors,'browserApiTraffic':traffic},ensure_ascii=False,indent=2))
        browser.close()
print(json.dumps({'passed':len(checks),'checks':checks},ensure_ascii=False))
