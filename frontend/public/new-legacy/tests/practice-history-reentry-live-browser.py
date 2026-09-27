#!/usr/bin/env python3
"""Opt-in UAT lifecycle regression with isolated papers and real HTTP persistence.

Pass --candidate-controller only before deployment; omit it for release verification.
Credentials stay in an ignored file and are never written to the result artifact.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import uuid

from playwright.sync_api import sync_playwright

BASE = "https://uat.aihuanpu.com"
parser = argparse.ArgumentParser()
parser.add_argument('--accounts', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--candidate-controller', type=Path)
args = parser.parse_args()
accounts = json.loads(args.accounts.read_text())
assert all(accounts[role]['username'] != 'admin' for role in ['teacher', 'student'])
args.output.mkdir(parents=True, exist_ok=True)
result = {'base': BASE, 'apiMocks': False, 'sourceOverrides': [], 'checks': [], 'entries': [], 'pageErrors': []}
if args.candidate_controller:
    candidate = args.candidate_controller.read_bytes()
    result['sourceOverrides'] = [{'path': 'src/100-practice-mode.js', 'sha256': hashlib.sha256(candidate).hexdigest()}]


def check(name, value=True):
    assert value, name
    result['checks'].append(name)


with sync_playwright() as p:
    teacher = p.request.new_context(base_url=BASE)

    def call(method, path, payload):
        response = getattr(teacher, method)(path, data=payload)
        assert response.ok, f'{method} {path}: HTTP {response.status}'
        return response.json()

    call('post', '/api/v1/auth/login', {**accounts['teacher'], 'acceptedTermsVersion': '2026-08-13-v1'})
    token = uuid.uuid4().hex[:8]
    bank = call('post', '/api/v1/banks', {'name': '[UAT自动自检] 重进回归题库 '+token, 'subject': 'PMP', 'visibility': 'private'})['bank']
    fixtures = []
    for count in [3, 10]:
        question_ids = []
        name = f'[UAT自动自检] 重进回归{count}题 {token}'
        for i in range(count):
            stem = f'重进回归第{i+1}题：如何处理风险？'
            q = call('post', f'/api/v1/banks/{bank["id"]}/questions', {
                'title': stem, 'subject': 'PMP', 'type': 'single_choice', 'stemParts': [{'text': stem}],
                'options': [{'id': 'A', 'text': '分析并采取措施'}, {'id': 'B', 'text': '忽略风险'}],
                'correctAnswer': 'A', 'analysis': '先分析风险再采取措施。',
                'metadata': {'subjectFacets': [{'dimensionId': 'exam-domain', 'valueId': 'process'}]}})['question']
            question_ids.append(q['id'])
        paper = call('post', '/api/v1/papers', {'name': name, 'subject': 'PMP', 'totalCount': count,
            'questions': [{'bankId': bank['id'], 'questionId': qid, 'order': i+1, 'score': 1} for i, qid in enumerate(question_ids)]})['paper']
        release = call('post', f'/api/v1/paper-releases/papers/{paper["id"]}/publish', {
            'revision': paper['revision'], 'accessLevel': 'free', 'enabledModes': ['practice_mode'],
            'allowedRoles': ['student', 'teacher', 'admin'], 'metadata': {'uatSelfCheck': token}})['release']
        fixtures.append({'name': name, 'count': count, 'paperId': paper['id'], 'releaseId': release['id'], 'questionIds': question_ids})
    result['fixtures'] = {'bankId': bank['id'], 'papers': fixtures}
    teacher.dispose()

    executable = next(path for path in [shutil.which('chromium'), shutil.which('google-chrome'),
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', p.chromium.executable_path] if path and Path(path).exists())
    browser = p.chromium.launch(headless=True, executable_path=executable)
    context = browser.new_context(viewport={'width': 1440, 'height': 1100})
    if args.candidate_controller:
        context.route('**/src/100-practice-mode.js*', lambda route: route.fulfill(content_type='application/javascript', body=candidate))
    page = context.new_page()
    page.set_default_timeout(20000)
    page.on('pageerror', lambda error: result['pageErrors'].append(str(error)))

    def select_paper(fixture):
        target = page.locator(f'#practicePaperLibrary [data-paper-id="{fixture["paperId"]}"]')
        if not target.count():
            page.locator('#practiceLibraryMoreBtn').click()
            target = page.locator(f'#practicePaperDrawerLibrary [data-paper-id="{fixture["paperId"]}"]')
        target.click()
        page.wait_for_function('name=>document.querySelector("#practiceSelectedPaperName").textContent===name', arg=fixture['name'])

    def enter(action, fixture, mode):
        with page.expect_response(lambda r: r.url.endswith('/learning/practice/sessions/enter') and r.request.method == 'POST') as pending:
            action()
        response = pending.value
        request = response.request.post_data_json
        result['entries'].append({'request': request, 'status': response.status})
        assert request == {'paperId': fixture['paperId'], 'releaseId': fixture['releaseId'], 'mode': mode, 'count': fixture['count'], 'order': 'paper'}, request
        assert response.status == 200, response.text()
        page.locator('#practiceGame').wait_for(state='visible')
        return response.json()

    def history_enter(fixture):
        page.locator('#practiceHistoryOpenBtn').click()
        return enter(lambda: page.locator(f'[data-history-practice="{fixture["paperId"]}"]').click(), fixture, 'practice')

    try:
        page.goto(BASE+'/practice-mode.html')
        page.locator('#authStatus').click()
        page.locator('#accountMenuSessionBtn').click()
        page.locator('#authUsername').fill(accounts['student']['username'])
        page.locator('#authPassword').fill(accounts['student']['password'])
        page.locator('#authLegalConsent').check()
        page.locator('#authDoLoginBtn').click()
        page.wait_for_function('username=>KGAuthCore.currentUser()?.username===username', arg=accounts['student']['username'])
        page.wait_for_selector('.practice-paper-card')
        check('real student UI login')
        short, large = fixtures
        select_paper(large)
        enter(lambda: page.locator('[data-practice-start="challenge"]').click(), large, 'challenge')
        page.locator('#practiceExitBtn').click()
        page.locator('#practiceAbandonBtn').click()
        page.locator('#practiceLobby').wait_for(state='visible')
        check('entered preceding 10-question paper and exited through UI')
        select_paper(short)
        started = enter(lambda: page.locator('[data-practice-start="challenge"]').click(), short, 'challenge')
        sid = started['session']['id']
        for index in range(3):
            page.wait_for_function('index=>{const s=KGPracticeMode.snapshot();return s.index===index&&!s.locked}', arg=index)
            page.locator('#practiceOptions [data-option-id="A"]').click()
        page.locator('#practiceResult').wait_for(state='visible')
        check('completed all 3 questions through answer UI')
        report_url = BASE+f'/api/v1/learning/practice/sessions/{sid}/report'
        report = page.request.get(report_url).json()['report']
        check('frozen report has all 3 answers', report['counts']['total'] == 3 and report['counts']['correct'] == 3)
        page.locator('[data-review-filter="all"]').click()
        page.locator('[data-review-card]').first.locator('[data-qc-action="expand"]').click()
        message = '完成后评论再进入回归 '+token
        page.locator('.q-comments-drawer .q-composer-input').fill(message)
        with page.expect_response(lambda r: '/comments' in r.url and r.request.method == 'POST') as pending:
            page.locator('.q-comments-drawer [data-qc-action="send"]').click()
        posted = pending.value
        assert posted.status == 201, posted.text()
        comment = posted.json()['comment']
        page.locator(f'[data-comment-id="{comment["id"]}"]').wait_for(state='visible')
        check('posted real comment through completed-report UI')
        page.locator('.q-comments-drawer [data-qc-action="collapse"]').click()
        page.locator('[data-report-lobby]').click()
        page.locator('#practiceLobby').wait_for(state='visible')
        check('report exit removes comment drawer', page.locator('.q-comments-drawer').count() == 0)
        select_paper(large)
        reopened = history_enter(short)
        check('history reentry creates separate ordinary practice', not reopened['resumed'] and reopened['session']['id'] != sid)
        page.screenshot(path=str(args.output/'reentered-after-comment.png'))
        page.reload()
        page.locator('#practiceLobby').wait_for(state='visible')
        page.wait_for_selector('.practice-paper-card')
        select_paper(large)
        resumed = history_enter(short)
        check('actual browser refresh then history reentry resumes same session', resumed['resumed'] and resumed['session']['id'] == reopened['session']['id'])
        check('frozen challenge report unchanged', page.request.get(report_url).json()['report'] == report)
        comments = page.request.get(BASE+f'/api/v1/questions/{short["questionIds"][0]}/comments').json()['comments']
        check('comment survives full UI lifecycle and refresh', any(c['id'] == comment['id'] and c['content'] == message for c in comments))
        page.screenshot(path=str(args.output/'refreshed-history-reentry.png'))
        check('no application page errors', not result['pageErrors'])
        result['passed'] = True
    except Exception as error:
        result['passed'] = False
        result['failure'] = str(error)
        page.screenshot(path=str(args.output/'failure.png'))
        raise
    finally:
        (args.output/'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2))
        browser.close()
print('practice-history-reentry-live-browser-ok')
