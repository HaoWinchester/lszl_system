"""Report controls follow the focused question in one click and stay above review."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, channel='chrome')
    for width in (1440, 390):
        page = browser.new_page(viewport={'width': width, 'height': 844})
        page.route('**/harness', lambda r: r.fulfill(content_type='text/html', body='<html><body><main id="report"></main></body></html>'))
        page.route('**/api/v1/question-comments/counts*', lambda r: r.fulfill(json={'counts': {'q1': 1, 'q2': 1}}))
        def comments(route):
            qid = route.request.url.split('/questions/')[1].split('/')[0]
            route.fulfill(json={'comments': [{'id': 'c-'+qid, 'questionId': qid, 'content': qid+'测试弹幕', 'author': '测试', 'danmakuEligible': True}], 'nextCursor': None})
        page.route('**/api/v1/questions/*/comments', comments)
        page.goto('http://localhost/harness')
        for style in ('practice-mode.css', 'question-comments.css'):
            page.add_style_tag(content=(ROOT/'styles'/style).read_text())
        page.evaluate("window.KGAuthCore={currentUser:()=>({username:'report-test',role:'student'})}")
        for name in ('28-device-preferences.js', '119-question-comments.js', '113-practice-result-report.js'):
            page.add_script_tag(content=(ROOT/'src'/name).read_text())
        page.evaluate("""()=>KGPracticeResultReport.render(document.querySelector('#report'),{
          official:false,reportKind:'practice',wrongQuestionIds:['q1','q2'],counts:{total:2,wrong:2},domains:{}
        },{questions:['q1','q2'].map(id=>({id,stem:id+'题目',options:[],correctAnswerIds:['A'],explanation:'解析。'.repeat(200)})),
          answers:{q1:{correct:false},q2:{correct:false}},onAgain:()=>window.again=true,onLobby:()=>window.lobby=true})""")
        first = page.locator('[data-review-card=q1] [data-qc-action=danmaku-toggle]')
        second = page.locator('[data-review-card=q2] [data-qc-action=danmaku-toggle]')
        expect(first).to_be_visible()
        first.click()
        expect(first).to_have_attribute('aria-pressed', 'false')
        expect(second).to_have_attribute('aria-pressed', 'false')
        second.click()
        expect(second).to_have_attribute('aria-pressed', 'true')
        expect(page.locator('body>.q-danmaku .q-danmaku-item')).to_have_count(1)
        expect(page.locator('body>.q-danmaku')).to_contain_text('q2测试弹幕')
        second.click()
        expect(page.locator('body>.q-danmaku')).to_have_count(0)
        expect(first).to_have_attribute('aria-pressed', 'false')
        first.click()
        expect(page.locator('body>.q-danmaku')).to_contain_text('q1测试弹幕')
        actions = page.locator('.practice-report-actions')
        assert page.evaluate("document.querySelector('.practice-report-actions').compareDocumentPosition(document.querySelector('[data-review-card]')) & Node.DOCUMENT_POSITION_FOLLOWING")
        page.locator('[data-review-card=q2]').scroll_into_view_if_needed()
        box = actions.bounding_box()
        assert 0 <= box['y'] <= 70, box
        assert box['x'] >= 0 and box['x']+box['width'] <= width+1, box
        expect(actions.locator('[data-report-again]')).to_be_visible()
        actions.locator('[data-report-again]').click()
        assert page.evaluate('window.again')
        print('PASS report one-click danmaku and sticky actions', width)
        page.close()
    browser.close()
