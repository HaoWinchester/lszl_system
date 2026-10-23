"""Case material survives real publication and student entry in both canvas modes."""
import argparse
import uuid
from urllib.parse import urlencode
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--base-url', required=True)
base = parser.parse_args().base_url

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, channel='chrome')
    teacher = browser.new_context()
    assert teacher.request.post(base+'/api/v1/auth/login', data={'username': 'ink-browser', 'password': 'ink-browser-test'}).ok
    material_response = teacher.request.post(base+'/api/v1/question-materials', data={'title': '跨模式案例材料', 'text': '客户提出变更，团队需要共同分析影响后再决策。'})
    assert material_response.ok, material_response.text()
    material = material_response.json()['material']
    snapshots = []
    for order in (1, 2, 3):
        response = teacher.request.post(base+'/api/v1/banks/ink-bank/questions', data={
            'type': 'single_choice', 'title': f'案例跨模式小题{order}', 'scope': 'public', 'subject': 'PMP',
            'stemParts': [{'text': f'第{order}小题，应如何处理变更？'}],
            'options': [{'id': 'A', 'text': '分析影响', 'correct': True}, {'id': 'B', 'text': '直接执行'}],
            'correctAnswer': 'A', 'analysis': '先评估，再按流程处理。',
            'material': material, 'caseGroup': {'id': material['id'], 'order': order, 'total': 3}})
        assert response.ok, response.text()
        q = response.json()['question']
        snapshots.append({'questionId': q['id'], 'bankId': 'ink-bank', 'question': q, 'order': order})
    response = teacher.request.post(base+'/api/v1/paper-releases/publish-payload', data={
        'releaseId': 'case-release-'+uuid.uuid4().hex, 'paperId': 'case-paper-'+uuid.uuid4().hex,
        'name': '案例跨模式验证卷', 'subject': 'PMP', 'paperType': 'mixed',
        'publishedBy': 'ink-browser',
        'enabledModes': ['practice_mode', 'multi_question_canvas', 'deep_recall'],
        'allowedRoles': ['teacher', 'student'], 'questions': snapshots, 'questionSnapshots': snapshots})
    assert response.ok, response.text()
    release = response.json()['release']
    student = browser.new_context(viewport={'width': 1440, 'height': 1000})
    assert student.request.post(base+'/api/v1/auth/login', data={'username': 'ink-student', 'password': 'ink-browser-test'}).ok
    page = student.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    query = urlencode({'paperId': release['paperId'], 'releaseId': release['releaseId'], 'questionId': snapshots[0]['questionId'], 'bankId': 'ink-bank'})
    for filename in ('knowledge-recall.html', 'question-workspace.html'):
        page.goto(base+'/'+filename+'?'+query, wait_until='networkidle')
        if filename == 'question-workspace.html' and not page.locator('.qm-case').count():
            page.locator('#qwQuestionDockBtn').click()
            page.locator('#qwQuestionList [data-add-index]').first.click()
            page.locator('#qwQuestionDrawerClose').click()
        expect(page.locator('.qm-case').first).to_be_visible(timeout=30000)
        expect(page.locator('.qm-case').first).to_contain_text('客户提出变更，团队需要共同分析影响后再决策。')
        assert page.locator('.qm-case').first.get_attribute('data-case-id') == material['id']
        page.reload(wait_until='networkidle')
        expect(page.locator('.qm-case').first).to_be_visible(timeout=30000)
        assert not errors, errors
        print('PASS real student case publication/entry/material/refresh', filename)
    browser.close()
