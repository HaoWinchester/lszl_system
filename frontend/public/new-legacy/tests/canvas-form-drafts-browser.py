#!/usr/bin/env python3
"""Unsubmitted canvas forms survive real local cookie expiry and owner login.

Run against helpers/canvas_ink_server.py --role-matrix after syncing the build.
All successful persistence uses real FastAPI/PostgreSQL; no business store or
successful request is mocked. Forms require their actual Save/Generate button.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import time
from urllib.parse import urlparse
import uuid

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/canvas-form-drafts'
spec = importlib.util.spec_from_file_location('classroom_auth_helpers', Path(__file__).with_name('classroom-auth-recovery-browser.py'))
helpers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helpers)
PASSWORD = helpers.PASSWORD


def login(context, base):
    response = context.request.post(base + '/api/v1/auth/login', data={'username': 'ink-browser', 'password': PASSWORD})
    assert response.ok, response.text()


def wait_api(page, read, matches, message):
    deadline = time.monotonic() + 15
    value = None
    while time.monotonic() < deadline:
        response = read()
        assert response.ok, (response.status, response.text())
        value = response.json()
        if matches(value):
            return value
        page.wait_for_timeout(100)
    raise AssertionError((message, value))


def mark_fields(page, fields):
    for selector, value in fields.items():
        field = page.locator(selector)
        expect(field).to_be_visible()
        field.fill(value)
        field.evaluate('(el)=>{el.dataset.formDraftIdentity="original-input"}')


def assert_fields(page, fields):
    for selector, value in fields.items():
        expect(page.locator(selector)).to_be_visible()
        expect(page.locator(selector)).to_have_value(value)
        expect(page.locator(selector)).to_have_attribute('data-form-draft-identity', 'original-input')


def assert_unload_blocked(page):
    dialogs = []
    def dismiss(dialog):
        dialogs.append(dialog.type)
        dialog.dismiss()
    page.on('dialog', dismiss)
    try:
        with page.expect_event('dialog', timeout=5000):
            page.close(run_before_unload=True)
        assert dialogs == ['beforeunload'], dialogs
        assert not page.is_closed(), 'Dismissed unload must retain the original live classroom'
    finally:
        page.remove_listener('dialog', dismiss)


def pause_and_recover(page, context, fields, events, mode, paused_action=None):
    original_url = page.url
    assert page.evaluate('KGAuthRecovery.hasUnsavedChanges()'), 'Typed form must be considered unsaved'
    # Exercise the actual logout boundary while the form overlays the menu.
    logout_count = len([r for r in events if r['path'] == '/api/v1/auth/logout'])
    result = page.evaluate('KGAuthCore.logout({source:"canvas-form-draft-browser"})')
    assert result.get('ok') is False, result
    assert len([r for r in events if r['path'] == '/api/v1/auth/logout']) == logout_count
    assert_fields(page, fields)
    assert page.evaluate('KGAuthCore.currentUsername()') == 'ink-browser'
    assert_unload_blocked(page)
    assert_fields(page, fields)

    context.clear_cookies()
    status = page.evaluate('''async()=>{const response=await fetch('/api/v1/auth/me',{credentials:'include'});return response.status}''')
    assert status == 401
    page.wait_for_function('KGAuthRecovery.isPaused()')
    expect(page.locator('#kgAuthRecoveryBanner')).to_be_visible()
    assert_fields(page, fields)
    assert page.url == original_url
    if paused_action:
        paused_action()
        assert_fields(page, fields)
    assert_unload_blocked(page)
    page.screenshot(path=str(OUT / f'{mode}-paused.png'))

    page.locator('[data-auth-recovery-login]').click()
    logins = len([r for r in events if r['path'] == '/api/v1/auth/login'])
    helpers.fill_login(page, 'ink-viewer')
    expect(page.locator('#authMsg')).not_to_be_empty()
    expect(page.locator('#authDoLoginBtn')).to_be_enabled()
    assert len([r for r in events if r['path'] == '/api/v1/auth/login']) == logins
    assert_fields(page, fields)
    assert page.evaluate('KGAuthCore.currentUsername()') == 'ink-browser'

    helpers.fill_login(page, 'ink-browser')
    page.wait_for_function('!KGAuthRecovery.isPaused() && KGAuthCore.currentUsername()==="ink-browser"')
    expect(page.locator('#authModal')).to_be_hidden()
    assert_fields(page, fields)
    assert page.url == original_url
    assert page.evaluate('KGAuthRecovery.hasUnsavedChanges()'), 'Login must not implicitly submit a user form'
    page.screenshot(path=str(OUT / f'{mode}-login-fields-retained.png'))


def home(page, context, base, events):
    original_title = '表单原课堂'
    graph = {'nodes': [{'id': 'form-original-node', 'title': original_title, 'summary': '原说明', 'geometry': {'x': 200, 'y': 250, 'width': 260, 'height': 110}}], 'links': [], 'strokes': []}
    created = context.request.post(base + '/api/v1/files', data={'name': '表单恢复 ' + uuid.uuid4().hex[:8], 'graphData': graph})
    assert created.ok, created.text()
    file_id = created.json()['file']['id']
    assert context.request.put(base + '/api/v1/files/current', data={'fileId': file_id}).ok
    page.goto(base + '/index.html?mode=free', wait_until='networkidle')
    helpers.dismiss_overlays(page)
    page.wait_for_function('window.KGGraphFileTabs && !KGGraphFileTabs.isSwitching()')
    page.locator('.graph-mode-trigger').click()
    page.locator('[data-graph-mode-option="professional"]').click()
    page.locator('.knowledge-card[data-node-id="form-original-node"]').click()
    page.locator('#detailActionsToggle').click()
    page.locator('#editFromDetailBtn').click()
    expect(page.locator('#nodeModal')).to_be_visible()
    # openNodeModal schedules its initial title focus. Let that real focus
    # arrive before filling another field, so it cannot steal a fill mid-input.
    expect(page.locator('#nTitle')).to_be_focused()
    title = '原账号节点草稿 ' + uuid.uuid4().hex[:8]
    summary = '未按保存的详细内容\n第二行 mixed 中文'
    fields = {'#nTitle': title, '#nSummary': summary}
    mark_fields(page, fields)
    pause_and_recover(page, context, fields, events, 'home')
    before_save = context.request.get(base + '/api/v1/files/' + file_id).json()['graphData']
    assert not any(n.get('title') == title or n.get('content', {}).get('title') == title for n in before_save['nodes'])
    page.locator('#saveNodeBtn').click()
    expect(page.locator('#nodeModal')).to_be_hidden()
    def saved(value):
        nodes = value['graphData']['nodes']
        return any(n.get('id') == 'form-original-node' and (n.get('title') == title or n.get('content', {}).get('title') == title)
                   and (n.get('summary') == summary or n.get('content', {}).get('description') == summary) for n in nodes)
    persisted = wait_api(page, lambda: context.request.get(base + '/api/v1/files/' + file_id), saved, 'Node form save must reach PostgreSQL')
    page.wait_for_function('!KGAuthRecovery.hasUnsavedChanges()')
    page.reload(wait_until='networkidle')
    helpers.dismiss_overlays(page)
    expect(page.locator('.knowledge-card[data-node-id="form-original-node"]')).to_contain_text(title)
    node = page.evaluate('KGGraphModel.view(state.nodes.find(n=>n.id==="form-original-node"))')
    assert node['content']['title'] == title
    assert node['content']['description'] == summary
    assert saved(context.request.get(base + '/api/v1/files/' + file_id).json())
    return {'mode': 'home', 'fileId': file_id, 'nodeCount': len(persisted['graphData']['nodes']), 'status': 'passed'}


def workspace(page, context, base, events):
    workspace_id = 'form-workspace-' + uuid.uuid4().hex[:10]
    created = context.request.post(base + '/api/v1/workspaces', data={
        'id': workspace_id, 'title': '表单归纳画布', 'schemaVersion': 10,
        'payload': {'id': workspace_id, 'title': '表单归纳画布', 'schemaVersion': 10, 'nodes': {}, 'edges': [], 'groups': [], 'strokes': []},
    })
    assert created.ok, created.text()
    page.goto(base + helpers.MODES['workspace'][0] + '&workspace=' + workspace_id, wait_until='networkidle')
    helpers.dismiss_overlays(page)
    page.wait_for_function('(id)=>window.KGMultiQuestionWorkspace?.activeWorkspaceId()===id', arg=workspace_id)
    page.locator('#qwNewSynthesisBtn').click()
    expect(page.locator('#qwSynthesisModal')).to_be_visible()
    title = '未提交归纳 ' + uuid.uuid4().hex[:8]
    content = '保留结构表单正文\n第二行 mixed 中文'
    fields = {'#qwSynthesisTitle': title, '#qwSynthesisContent': content}
    mark_fields(page, fields)
    pause_and_recover(page, context, fields, events, 'workspace')
    cards = context.request.get(base + '/api/v1/learning/personal-cards?query=' + title).json()['cards']
    assert not any(card['title'] == title for card in cards), 'Login must not create an unsubmitted synthesis card'
    before = context.request.get(base + '/api/v1/workspaces/' + workspace_id).json()['workspace']['payload']
    assert not any(n.get('title') == title for n in before.get('nodes', {}).values())
    page.locator('#qwSaveSynthesisBtn').click()
    expect(page.locator('#qwSynthesisModal')).to_be_hidden()
    cards = wait_api(page, lambda: context.request.get(base + '/api/v1/learning/personal-cards?query=' + title),
                     lambda value: any(card['title'] == title and card['content'] == content for card in value['cards']),
                     'Explicit synthesis Save must persist the personal card')
    card = next(card for card in cards['cards'] if card['title'] == title)
    def saved(value):
        return any(node.get('personalCardId') == card['id'] and node.get('title') == title and node.get('content') == content
                   for node in value['workspace']['payload'].get('nodes', {}).values())
    wait_api(page, lambda: context.request.get(base + '/api/v1/workspaces/' + workspace_id), saved, 'Explicit synthesis Save must persist its canvas node')
    page.wait_for_function('!KGAuthRecovery.hasUnsavedChanges()')
    page.reload(wait_until='networkidle')
    helpers.dismiss_overlays(page)
    page.wait_for_function('(title)=>Object.values(KGMultiQuestionWorkspace.activeWorkspace()?.nodes||{}).some(node=>node.title===title)', arg=title)
    assert saved(context.request.get(base + '/api/v1/workspaces/' + workspace_id).json())
    return {'mode': 'workspace', 'workspaceId': workspace_id, 'personalCardId': card['id'], 'status': 'passed'}


def recall(page, context, base, events):
    page.goto(base + helpers.MODES['recall'][0], wait_until='networkidle')
    helpers.dismiss_overlays(page)
    page.wait_for_function('window.KGRecallInk')
    # Reuse a real root if the disposable fixture has prior progress; otherwise
    # reveal the question's actual keyword and activate its real root card.
    if not page.locator('.kr-node button').count():
        reveal = page.locator('#krRevealKeywordsBtn')
        if reveal.is_enabled():
            reveal.click()
        page.locator('.kr-keyword-token').first.click()
    expect(page.locator('.kr-node button').first).to_be_visible()
    page.locator('.kr-node button').first.click()
    expect(page.locator('#krCustomInput')).to_be_visible()
    # Root activation is a real asynchronous mutation. A fresh fixture may
    # still have zero saved nodes when its new root is already visible; await
    # that root's acknowledgement before measuring an unsubmitted child.
    root_id = page.locator('.kr-node').first.get_attribute('data-instance-id')
    before = wait_api(page, lambda: context.request.get(base + '/api/v1/recall/session/ink-question-1?releaseId=ink-release'),
                      lambda value: any(node.get('instanceId') == root_id for node in value['progress'].get('nodes', [])),
                      'Root preparation must be acknowledged before the draft baseline')['progress']
    title = '保留未生成' + uuid.uuid4().hex[:8]
    fields = {'#krCustomInput': title}
    mark_fields(page, fields)
    def paused_pen_switch():
        page.locator('#krInkBtn').click()
        page.locator('.canvas-ink-toolbar').get_by_role('button', name='画笔', exact=True).click()
    pause_and_recover(page, context, fields, events, 'recall', paused_action=paused_pen_switch)
    # Opening/switching the pen invokes closeGuide; unsubmitted child input must
    # survive until the learner explicitly generates or clears it.
    toolbar = page.locator('.canvas-ink-toolbar')
    toolbar.locator('[data-ink-tool=select]').click()
    toolbar.get_by_role('button', name='画笔', exact=True).click()
    assert_fields(page, fields)
    assert page.evaluate('KGAuthRecovery.hasUnsavedChanges()')
    assert_unload_blocked(page)
    current = context.request.get(base + '/api/v1/recall/session/ink-question-1?releaseId=ink-release').json()['progress']
    assert not any(node.get('title') == title for node in current.get('nodes', []))
    assert not any(value.get('title') == title for value in current.get('customNodes', {}).values())
    assert len(current.get('nodes', [])) == len(before.get('nodes', [])), 'Login/tool switching must not auto-generate the child'
    page.locator('#krCustomSaveBtn').click()
    def generated(value):
        progress = value['progress']
        return any(node.get('title') == title for node in progress.get('nodes', []))
    wait_api(page, lambda: context.request.get(base + '/api/v1/recall/session/ink-question-1?releaseId=ink-release'), generated,
             'Explicit Generate must persist the child')
    page.wait_for_function('!KGAuthRecovery.hasUnsavedChanges()')
    page.reload(wait_until='networkidle')
    helpers.dismiss_overlays(page)
    expect(page.locator('.kr-node').filter(has_text=title)).to_be_visible()
    assert generated(context.request.get(base + '/api/v1/recall/session/ink-question-1?releaseId=ink-release').json())
    return {'mode': 'recall', 'generatedTitle': title, 'status': 'passed'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', required=True)
    parser.add_argument('--only', choices=['home', 'workspace', 'recall'])
    args = parser.parse_args()
    base = args.base_url.rstrip('/')
    parsed = urlparse(base)
    assert parsed.scheme == 'http' and parsed.hostname in ('localhost', '127.0.0.1') and parsed.port, 'Only an explicitly ported disposable local fixture is allowed'
    OUT.mkdir(parents=True, exist_ok=True)
    results = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel='chrome')
        try:
            for name, action in [('home', home), ('workspace', workspace), ('recall', recall)]:
                if args.only not in (None, name):
                    continue
                context = browser.new_context(viewport={'width': 1440, 'height': 1000})
                login(context, base)
                page = context.new_page()
                events, errors = [], []
                page.on('request', lambda request: events.append({'path': urlparse(request.url).path, 'method': request.method}))
                page.on('pageerror', lambda error: errors.append(str(error)))
                context.tracing.start(screenshots=True, snapshots=True)
                try:
                    results.append(action(page, context, base, events))
                    assert not errors, errors
                    page.screenshot(path=str(OUT / f'{name}-saved-reload.png'))
                    print('PASS ' + name + ': same form DOM, guarded logout/unload/owner, cookie401, original-owner login, explicit Save/Generate, DB/reload', flush=True)
                except Exception:
                    page.screenshot(path=str(OUT / f'{name}-failure.png'))
                    (OUT / f'{name}-failure.json').write_text(json.dumps({'url': page.url, 'errors': errors, 'events': events}, ensure_ascii=False, indent=2))
                    raise
                finally:
                    context.tracing.stop(path=str(OUT / f'{name}-trace.zip'))
                    context.close()
        finally:
            (OUT / 'results.json').write_text(json.dumps({'baseUrl': base, 'checks': results}, ensure_ascii=False, indent=2))
            browser.close()
    print(f'PASS canvas-form-drafts-browser: {len(results)} real-page checks', flush=True)


if __name__ == '__main__':
    main()
