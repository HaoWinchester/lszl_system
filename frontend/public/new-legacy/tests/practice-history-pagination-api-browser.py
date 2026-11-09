"""Click every history page against real PostgreSQL/API data on desktop and mobile."""
import argparse
import json
from pathlib import Path
import re
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import sync_playwright, expect
from helpers.practice_tools import click_tool

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/practice-history-pagination'
OUT.mkdir(parents=True, exist_ok=True)
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--base-url', default='http://127.0.0.1:5198')
base = parser.parse_args().base_url.rstrip('/')
assert base.startswith('http://127.0.0.1:')
PATH = '/api/v1/learning/practice/sessions'
ALLOWED = {'sessionId', 'releaseId', 'paperId', 'paperName', 'mode', 'status', 'total',
           'answered', 'correct', 'experience', 'durationMs', 'reportAvailable', 'createdAt', 'eventId'}
metrics = []
errors = []


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True)
    for width, owner, other in ((1440, 'history-desktop', 'history-mobile'),
                                (390, 'history-mobile', 'history-desktop')):
        context = browser.new_context(viewport={'width': width, 'height': 900})
        login = context.request.post(base+'/api/v1/auth/login', data={
            'username': owner, 'password': 'practice-session-pass'})
        assert login.ok, login.text()
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        calls = []
        page.on('request', lambda request: calls.append(request.url)
                if request.method == 'GET' and urlparse(request.url).path == PATH else None)
        page.goto(base+'/practice-mode.html', wait_until='networkidle')
        assert not any('practice-history.js' in url for url in page.evaluate(
            'performance.getEntriesByType("resource").map(r=>r.name)'))
        assert all(parse_qs(urlparse(url).query).get('limit') == ['5'] for url in calls), calls
        before = len(calls)
        page.locator('#practiceHistoryOpenBtn').click()
        expect(page.locator('#practiceHistorySummary')).to_contain_text(re.compile(r'20\s*/\s*共?\s*124|20.*124'))
        expect(page.locator('.practice-history-attempt')).to_have_count(20)
        assert len(calls) == before+1 and parse_qs(urlparse(calls[-1]).query)['limit'] == ['20']
        summary_response = context.request.get(base+PATH+'?limit=20')
        payload = summary_response.json()
        assert summary_response.ok and set(payload) == {'sessions', 'total', 'nextCursor'}
        assert payload['total'] == 124 and len(payload['sessions']) == 20
        assert len(summary_response.body()) < 14000
        assert all(set(row) <= ALLOWED for row in payload['sessions'])
        assert any(row['sessionId'] == owner+'-revenge' for row in payload['sessions'])
        assert context.request.get(base+PATH+'?cursor=invalid').status == 422
        initial_group = page.locator('[data-history-paper="history-paper"] details')
        initial_group.locator('summary').click()
        expect(initial_group).to_have_attribute('open', '')
        # One transport failure must retain the first page and its expanded details.
        failed = {'done': False}

        def fail_one_page(route):
            if 'cursor' in parse_qs(urlparse(route.request.url).query) and not failed['done']:
                failed['done'] = True
                route.abort('failed')
            else:
                route.continue_()

        page.route('**/api/v1/learning/practice/sessions?*', fail_one_page)
        page.locator('#practiceHistoryLoadMore').click()
        expect(page.locator('#practiceHistoryPageStatus')).to_contain_text(re.compile('失败|无法|重试'))
        expect(page.locator('.practice-history-attempt')).to_have_count(20)
        expect(initial_group).to_have_attribute('open', '')
        page.locator('#practiceHistoryLoadMore').click()
        expect(page.locator('.practice-history-attempt')).to_have_count(40)
        expect(initial_group).to_have_attribute('open', '')
        while page.locator('.practice-history-attempt').count() < 124:
            count = page.locator('.practice-history-attempt').count()
            page.locator('#practiceHistoryLoadMore').click()
            expect(page.locator('.practice-history-attempt')).to_have_count(min(124, count+20))
        expect(page.locator('#practiceHistorySummary')).to_contain_text(re.compile('124.*124'))
        expect(page.locator('#practiceHistoryLoadMore')).to_be_hidden()
        expect(page.locator('#practiceHistoryPageStatus')).to_contain_text('全部')
        expect(page.locator('[data-history-paper="history-old-paper"]')).to_contain_text('历史最早旧卷')
        assert not page.locator('[data-history-paper="history-old-paper"] details').get_attribute('open')
        page.locator('[data-history-paper="history-old-paper"] summary').click()
        page.screenshot(path=str(OUT/f'history-all-{width}.png'))
        page.locator(f'[data-history-session="{owner}-000"]').click()
        expect(page.locator('#practiceResult')).to_be_visible()
        expect(page.locator('.practice-report-meta')).to_contain_text(owner+'-000')
        page.locator('[data-report-lobby]').click()
        page.reload(wait_until='networkidle')
        page.locator('#practiceHistoryOpenBtn').click()
        expect(page.locator('.practice-history-attempt')).to_have_count(20)
        expect(page.locator('#practiceHistorySummary')).to_contain_text('124')
        page.locator('[data-history-paper="history-paper"] summary').click()
        page.locator(f'[data-history-resume="{owner}-paused"]').click()
        expect(page.locator('#practiceGame')).to_be_visible()
        assert page.evaluate('KGPracticeMode.snapshot().sessionId') == owner+'-paused'
        click_tool(page, '#practiceExitBtn')
        page.locator('#practiceSaveExitBtn').click()
        expect(page.locator('#practiceLobby')).to_be_visible()
        page.locator('#practiceHistoryOpenBtn').click()
        expect(page.locator('.practice-history-attempt')).to_have_count(20)
        page.locator('#practiceClearHistoryBtn').click()
        expect(page.locator('#practiceHistoryEmpty')).to_have_text('暂无练习记录')
        expect(page.locator('.practice-history-attempt')).to_have_count(0)
        cleared = context.request.get(base+PATH+'?limit=20').json()
        assert cleared == {'sessions': [], 'total': 0, 'nextCursor': None}
        expect(page.locator('#practiceHistoryLoadMore')).to_be_hidden()
        page.reload(wait_until='networkidle')
        page.locator('#practiceHistoryOpenBtn').click()
        expect(page.locator('#practiceHistoryEmpty')).to_have_text('暂无练习记录')
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth+1')
        other_context = browser.new_context()
        assert other_context.request.post(base+'/api/v1/auth/login', data={
            'username': other, 'password': 'practice-session-pass'}).ok
        other_payload = other_context.request.get(base+PATH+'?limit=1').json()
        assert other_payload['total'] == (124 if width == 1440 else 0), other_payload
        assert other_context.request.get(base+PATH+'/'+owner+'-000').status == 404
        other_context.close()
        metrics.append({'width': width, 'total': 124, 'pageSize': 20, 'allPagesReachable': True,
                        'summaryBytes': len(summary_response.body()), 'apiCalls': len(calls),
                        'retryPreservedFirstPage': True, 'oldReport': True, 'resume': True,
                        'clearPersisted': True, 'ownerIsolation': True})
        context.close()
    browser.close()
assert not errors, errors
(OUT/'api-browser-results.json').write_text(json.dumps(metrics, ensure_ascii=False, indent=2))
print('PASS real history paging API/browser, desktop + 390px', json.dumps(metrics))
