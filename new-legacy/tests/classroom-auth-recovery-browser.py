#!/usr/bin/env python3
"""Real classroom recovery against helpers/canvas_ink_server.py --role-matrix.

Only localhost is accepted. This suite clears cookies in its own disposable
browser contexts and injects 503 writes; all successful reads/writes use FastAPI
and PostgreSQL. Start the fixture only after syncing the candidate build.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import time
from urllib.parse import urlparse
import uuid

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, expect, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/classroom-auth-recovery'
PASSWORD = 'ink-browser-test'
MODES = {
    'home': ('/index.html?mode=free', '#homeInkBtn', 'KGHomeInk'),
    'recall': ('/knowledge-recall.html?questionId=ink-question-1&bankId=ink-bank&paperId=ink-paper&releaseId=ink-release', '#krInkBtn', 'KGRecallInk'),
    'workspace': ('/question-workspace.html?paperId=ink-paper&releaseId=ink-release', '#qwInkBtn', 'KGWorkspaceInk'),
}
WRITE_METHODS = {'POST', 'PUT', 'PATCH', 'DELETE'}


def dismiss_overlays(page, *, after_login=False):
    if after_login:
        try:
            page.locator('#learningEntryDismissBtn').wait_for(state='visible', timeout=3000)
        except PlaywrightTimeoutError:
            pass  # Some pages intentionally do not offer the learning chooser.
    for selector in ['#learningEntryDismissBtn', '.tour-skip', '#hideHelpBtn']:
        item = page.locator(selector)
        if item.is_visible():
            item.click()


def prepare(page, base, mode):
    path, trigger, controller = MODES[mode]
    page.goto(base + path, wait_until='networkidle')
    dismiss_overlays(page)
    page.wait_for_function('(name)=>!!window[name]', arg=controller)
    expect(page.locator(trigger)).to_be_enabled()
    if mode == 'home':
        page.wait_for_function('window.KGGraphFileTabs && !KGGraphFileTabs.isSwitching()')
    page.locator(trigger).click()
    expect(page.locator('.canvas-ink-toolbar')).to_be_visible()
    return page.locator('.canvas-ink-toolbar')


def canvas_dom(page):
    # Exclude selection handles and transient CSS, retaining exact stroke geometry.
    return page.locator('.canvas-ink-layer [data-stroke-id]').evaluate_all('''els=>els.map(el=>({
      id:el.dataset.strokeId,tag:el.tagName,points:el.getAttribute('points'),d:el.getAttribute('d'),
      x:el.getAttribute('x'),y:el.getAttribute('y'),text:el.textContent,
      stroke:el.getAttribute('stroke'),width:el.getAttribute('stroke-width'),
      fill:el.getAttribute('fill'),font:el.getAttribute('font-size')
    })).sort((a,b)=>a.id.localeCompare(b.id))''')


def graph_identity(page, mode):
    if mode == 'home':
        return page.evaluate('({nodes:state.nodes,links:state.links})')
    if mode == 'workspace':
        return page.evaluate('''()=>{const w=KGMultiQuestionWorkspace.activeWorkspace();
          return {id:w.id,nodes:w.nodes,edges:w.edges,groups:w.groups}}''')
    return page.locator('#krQuestionCard').inner_text()


def read_strokes(context, base, mode, file_id):
    if mode == 'home':
        result = context.request.get(base + '/api/v1/files/' + file_id)
        assert result.ok, (result.status, result.text())
        return result.json()['graphData'].get('strokes', [])
    if mode == 'recall':
        result = context.request.get(base + '/api/v1/recall/session/ink-question-1?releaseId=ink-release')
        assert result.ok, (result.status, result.text())
        return result.json()['progress'].get('strokes', [])
    result = context.request.get(base + '/api/v1/workspaces')
    assert result.ok, (result.status, result.text())
    return next(w['payload'].get('strokes', []) for w in result.json()['workspaces']
                if w['payload'].get('id') == 'pmp-pattern-workspace')


def wait_persisted(page, context, base, mode, file_id, *, text=None, ids=()):
    deadline = time.monotonic() + 15
    latest = []
    while time.monotonic() < deadline:
        latest = read_strokes(context, base, mode, file_id)
        if set(ids).issubset({s['id'] for s in latest}) and (text is None or any(s.get('text') == text for s in latest)):
            return latest
        page.wait_for_timeout(100)
    raise AssertionError((mode, 'real server did not retain draft', text, ids, latest))


def fill_login(page, username):
    expect(page.locator('#authModal')).to_be_visible()
    password_login = page.get_by_role('button', name='使用账号密码登录', exact=True)
    if password_login.is_visible():
        password_login.click()
    page.locator('#authUsername').fill(username)
    page.locator('#authPassword').fill(PASSWORD)
    consent = page.locator('#authLegalConsent')
    if consent.count() and consent.is_visible():
        consent.check()
    page.locator('#authDoLoginBtn').click()


def new_text(page, toolbar, value, x=230, y=280):
    toolbar.get_by_role('button', name='文字', exact=True).click()
    page.mouse.click(x, y)
    editor = page.get_by_role('textbox', name='画布文字内容')
    expect(editor).to_be_visible()
    editor.fill(value)
    return editor


def check_classroom(browser, base, mode, checks):
    context = browser.new_context(viewport={'width': 1440, 'height': 1000})
    assert context.request.post(base + '/api/v1/auth/login', data={'username': 'ink-browser', 'password': PASSWORD}).ok
    created = context.request.post(base + '/api/v1/files', data={
        'name': '课堂恢复 ' + uuid.uuid4().hex[:8],
        'graphData': {'nodes': [{'id': 'classroom-original', 'title': '保留原课堂图谱', 'x': 500, 'y': 320}], 'links': [], 'strokes': []},
    })
    assert created.ok, created.text()
    file_id = created.json()['file']['id']
    assert context.request.put(base + '/api/v1/files/current', data={'fileId': file_id}).ok
    page = context.new_page()
    errors, responses, login_requests, navigations = [], [], [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('framenavigated', lambda frame: navigations.append(frame.url) if frame == page.main_frame else None)
    page.on('response', lambda response: responses.append({'path': urlparse(response.url).path, 'status': response.status, 'method': response.request.method, 'startedAt': response.request.timing.get('startTime', 0), 'receivedAt': time.time() * 1000}))
    page.on('request', lambda request: login_requests.append(request.url) if urlparse(request.url).path == '/api/v1/auth/login' else None)
    context.tracing.start(screenshots=True, snapshots=True)
    try:
        toolbar = prepare(page, base, mode)
        # Prior focused runs may have saved fixture ink at our input locations.
        # Reset ink through the actual UI so every rerun starts with blank ink.
        toolbar.get_by_role('button', name='橡皮擦', exact=True).dblclick()
        expect(page.locator('.canvas-ink-layer [data-stroke-id]')).to_have_count(0)
        original_url = page.url
        navigation_count = len(navigations)
        # Real pointer input creates a pen object and writes it to PostgreSQL.
        toolbar.get_by_role('button', name='画笔', exact=True).click()
        page.mouse.move(970, 570)
        page.mouse.down()
        page.mouse.move(1050, 620, steps=8)
        page.mouse.up()
        page.wait_for_function('document.querySelectorAll(".canvas-ink-layer [data-stroke-id]").length>0')
        pen_ids = [s['id'] for s in canvas_dom(page) if s['tag'].lower() != 'text']
        assert pen_ids, 'The real pen gesture must create a stroke'
        original_pen = {s['id']: s for s in wait_persisted(page, context, base, mode, file_id, ids=pen_ids) if s['id'] in pen_ids}
        original_graph = graph_identity(page, mode)

        # A temporary 503 must retain the editor without declaring logout.
        temporary = '503 仍保留 ' + mode + ' 中文\nretry exact draft'
        editor = new_text(page, toolbar, temporary)
        injected = []
        def fail_writes(route):
            path = urlparse(route.request.url).path
            if route.request.method in WRITE_METHODS and any(path.startswith(prefix) for prefix in ['/api/v1/files/', '/api/v1/recall/progress', '/api/v1/workspaces']):
                injected.append(path)
                route.fulfill(status=503, content_type='application/json', body='{"detail":"temporary classroom outage"}')
            else:
                route.continue_()
        page.route('**/api/v1/**', fail_writes)
        toolbar.get_by_role('button', name='画笔', exact=True).click()
        expect(editor).to_have_attribute('data-save-state', 'failed')
        expect(editor).to_have_value(temporary)
        assert injected, 'The 503 must hit the actual persistence request'
        assert page.evaluate('!KGAuthRecovery.isPaused()')
        assert page.evaluate('KGAuthCore.currentUsername()') == 'ink-browser'
        assert page.url == original_url
        page.unroute('**/api/v1/**', fail_writes)
        toolbar.get_by_role('button', name='文字', exact=True).click()
        expect(editor).to_have_value(temporary)
        page.mouse.click(1120, 420)
        expect(editor).to_have_count(0)
        wait_persisted(page, context, base, mode, file_id, text=temporary, ids=pen_ids)

        # Cookie loss happens only in this isolated fixture/browser context.
        draft = '课堂原账号草稿 ' + mode + ' ' + uuid.uuid4().hex[:8] + '\n第二行 mixed 中文'
        editor = new_text(page, toolbar, draft, x=230, y=390)
        editor.evaluate('el=>{el.dataset.recoveryDraftIdentity="same-original-textarea"}')
        response_start = len(responses)
        context.clear_cookies()
        toolbar.get_by_role('button', name='画笔', exact=True).click()
        expect(page.locator('#kgAuthRecoveryBanner')).to_be_visible()
        page.wait_for_function('KGAuthRecovery.isPaused()')
        expect(editor).to_have_value(draft)
        expect(editor).to_have_attribute('data-recovery-draft-identity', 'same-original-textarea')
        assert page.url == original_url
        assert graph_identity(page, mode) == original_graph
        paused_dom = canvas_dom(page)
        initial_401 = [r for r in responses[response_start:] if r['status'] == 401]
        assert initial_401, 'Use a real FastAPI 401 to enter recovery'
        assert page.evaluate('KGAuthCore.currentUsername()') == 'ink-browser'
        paused_at = time.time() * 1000
        for _ in range(3):
            toolbar.get_by_role('button', name='文字', exact=True).click()
            expect(editor).to_have_value(draft)
            toolbar.get_by_role('button', name='画笔', exact=True).click()
            assert page.evaluate('(name)=>window[name].tool', MODES[mode][2]) == 'pen'
        # Tool selection stays usable while readonly drawing cannot mutate ink.
        page.mouse.move(1180, 700)
        page.mouse.down()
        page.mouse.move(1260, 740, steps=5)
        page.mouse.up()
        # Let autosave and renewal scheduling run while the session is paused.
        page.wait_for_timeout(1700)
        repeated_401 = [r for r in responses if r['status'] == 401 and r['startedAt'] > paused_at]
        assert not repeated_401, ('Paused tool changes must not initiate more unauthorized requests', repeated_401)
        assert canvas_dom(page) == paused_dom
        assert graph_identity(page, mode) == original_graph
        page.screenshot(path=str(OUT / f'{mode}-paused.png'))

        # A valid different account must be rejected before calling the login API.
        page.locator('[data-auth-recovery-login]').click()
        login_count = len(login_requests)
        fill_login(page, 'ink-viewer')
        expect(page.locator('#authMsg')).not_to_be_empty()
        expect(page.locator('#authDoLoginBtn')).to_be_enabled()
        assert len(login_requests) == login_count, 'Different owner must not receive this draft or a login request'
        assert page.evaluate('KGAuthCore.currentUsername()') == 'ink-browser'
        expect(editor).to_have_value(draft)
        assert graph_identity(page, mode) == original_graph

        # A save503 during same-owner recovery must retain the draft and expose
        # the real banner retry, without requiring another login.
        failed_recovery_start = len(injected)
        page.route('**/api/v1/**', fail_writes)
        fill_login(page, 'ink-browser')
        page.wait_for_function('!KGAuthRecovery.isPaused() && KGAuthCore.currentUsername()==="ink-browser"')
        expect(page.locator('#authModal')).to_be_hidden()
        expect(page.locator('#kgAuthRecoveryBanner')).to_be_visible()
        assert len(injected) > failed_recovery_start, 'Recovery must attempt a real draft save'
        expect(editor).to_have_value(draft)
        assert graph_identity(page, mode) == original_graph
        page.unroute('**/api/v1/**', fail_writes)
        page.locator('[data-auth-recovery-retry]').click()
        expect(page.locator('#kgAuthRecoveryBanner')).to_be_hidden()
        assert page.url == original_url
        assert graph_identity(page, mode) == original_graph
        if editor.count():
            expect(editor).to_have_value(draft)
        final = wait_persisted(page, context, base, mode, file_id, text=draft, ids=pen_ids)
        assert {s['id']: s for s in final if s['id'] in pen_ids} == original_pen
        persisted_text = next(s for s in final if s.get('text') == draft)
        assert sum(s.get('text') == draft for s in final) == 1, 'Recovery must not duplicate the text object'
        assert len(navigations) == navigation_count, ('Recovery must not navigate or reload the classroom', navigations)
        page.screenshot(path=str(OUT / f'{mode}-recovered.png'))
        page.reload(wait_until='networkidle')
        dismiss_overlays(page)
        text_node = page.locator('.canvas-ink-layer text[data-stroke-id="' + persisted_text['id'] + '"]')
        expect(text_node).to_be_visible()
        assert text_node.locator('tspan').all_text_contents() == draft.split('\n')
        restored = read_strokes(context, base, mode, file_id)
        assert next(s for s in restored if s['id'] == persisted_text['id']) == persisted_text
        assert {s['id']: s for s in restored if s['id'] in pen_ids} == original_pen
        assert graph_identity(page, mode) == original_graph
        page.screenshot(path=str(OUT / f'{mode}-reload.png'))
        assert not errors, errors
        checks.append({'mode': mode, 'status': 'passed', 'fileId': file_id, 'textId': persisted_text['id'], 'penIds': pen_ids,
                       'first401': initial_401, '503Paths': injected, 'responses': responses})
        print('PASS ' + mode + ': 503 retention/retry, real401 pause, tool switching, owner guard, same-page login, exact DB/reload draft', flush=True)
    finally:
        context.tracing.stop(path=str(OUT / f'{mode}-trace.zip'))
        if not checks or checks[-1].get('mode') != mode:
            page.screenshot(path=str(OUT / f'{mode}-failure.png'))
            (OUT / f'{mode}-failure.json').write_text(json.dumps({'url': page.url, 'errors': errors, 'responses': responses}, ensure_ascii=False, indent=2))
        context.close()


def check_readonly(browser, base, checks):
    context = browser.new_context(viewport={'width': 1440, 'height': 1000})
    assert context.request.post(base + '/api/v1/auth/login', data={'username': 'ink-viewer', 'password': PASSWORD}).ok
    page = context.new_page()
    for mode in MODES:
        url = MODES[mode][0] + ('&workspace=viewer-workspace' if mode == 'workspace' else '')
        before_url = {
            'home': '/api/v1/files/role-graph-ink-viewer',
            'recall': '/api/v1/recall/session/ink-question-1?releaseId=ink-release',
            'workspace': '/api/v1/workspaces/viewer-workspace',
        }[mode]
        before_response = context.request.get(base + before_url)
        assert before_response.ok or (mode == 'recall' and before_response.status == 403), 'Start disposable canvas_ink_server.py with --role-matrix'
        def canvas_payload(response):
            value = response.json()
            if mode == 'home':
                return {'graphData': value['graphData'], 'learningState': value.get('learningState')}
            if mode == 'workspace':
                return value['workspace']['payload']
            if response.status == 403:
                return value
            return {key: value['progress'].get(key) for key in ['nodes', 'edges', 'strokes', 'tables', 'customNodes', 'revision']}
        before = canvas_payload(before_response)
        writes = []
        def record(request):
            if request.method in WRITE_METHODS and any(urlparse(request.url).path.startswith(p) for p in ['/api/v1/files/', '/api/v1/recall/progress', '/api/v1/workspaces']):
                writes.append(request.url)
        page.on('request', record)
        page.goto(base + url, wait_until='networkidle')
        dismiss_overlays(page)
        page.wait_for_function('window.KGAuthCore?.currentUsername?.()==="ink-viewer"')
        initial = canvas_dom(page)
        trigger = page.locator(MODES[mode][1])
        if trigger.is_visible() and trigger.is_enabled():
            trigger.click()
        pen = page.locator('.canvas-ink-toolbar [data-ink-tool=pen]')
        if pen.is_visible() and pen.is_enabled():
            pen.click()
        page.mouse.move(970, 570)
        page.mouse.down()
        page.mouse.move(1050, 620, steps=8)
        page.mouse.up()
        page.wait_for_timeout(500)
        assert canvas_dom(page) == initial
        assert not writes, (mode, 'viewer attempted mutation', writes)
        after_response = context.request.get(base + before_url)
        assert after_response.status == before_response.status
        assert canvas_payload(after_response) == before
        assert not page.locator('#authModal').is_visible(), 'A signed-in viewer is not a guest'
        page.screenshot(path=str(OUT / f'{mode}-viewer-readonly.png'))
        page.remove_listener('request', record)
        checks.append({'mode': mode, 'role': 'viewer', 'status': 'passed', 'mutations': 0})
    context.close()


def check_auth_pages(browser, base, checks):
    paths = ['/index.html?mode=free', '/workbench.html?mode=free', '/file-manager.html',
             MODES['recall'][0], MODES['workspace'][0], '/practice-mode.html?paperId=ink-paper&releaseId=ink-release']
    for index, path in enumerate(paths):
        context = browser.new_context(viewport={'width': 1440, 'height': 1000})
        page = context.new_page()
        page.goto(base + path, wait_until='networkidle')
        dismiss_overlays(page)
        if '/file-manager.html' in path:
            page.locator('#fmAvatar').click()
            page.locator('#fmAccountSessionBtn').click()
            page.wait_for_url('**/index.html')
            page.wait_for_load_state('networkidle')
            dismiss_overlays(page)
            page.locator('#authStatus').click()
            page.locator('#accountMenuSessionBtn').click()
        else:
            page.locator('#authStatus').click()
            page.locator('#accountMenuSessionBtn').click()
        expect(page.locator('#authModal')).to_be_visible()
        fill_login(page, 'ink-browser')
        page.wait_for_function('KGAuthCore.currentUsername()==="ink-browser"')
        expect(page.locator('#authModal')).to_be_hidden()
        dismiss_overlays(page, after_login=True)
        # File manager's guest entry intentionally uses the editor login. Return
        # to it to verify its own authenticated exit control independently.
        if '/file-manager.html' in path:
            page.goto(base + path, wait_until='networkidle')
            page.locator('#fmAvatar').click()
            page.locator('#fmAccountSessionBtn').click()
        else:
            page.locator('#authStatus').click()
            expect(page.locator('#accountMenuSessionBtn')).to_have_attribute('aria-label', '退出登录')
            page.locator('#accountMenuSessionBtn').click()
        page.wait_for_function('!KGAuthCore.currentUser()')
        assert context.request.get(base + '/api/v1/auth/me').status == 401
        page.screenshot(path=str(OUT / f'auth-page-{index}-logged-out.png'))
        checks.append({'authPage': path, 'status': 'passed', 'loginUi': True, 'logoutUi': True})
        print('PASS auth traversal: ' + path, flush=True)
        context.close()



def check_cross_tab(browser, base, checks):
    """One cookie jar changes owner; the other live classroom keeps its draft."""
    context = browser.new_context(viewport={'width': 1440, 'height': 1000})
    viewer = browser.new_context()
    teacher = browser.new_context()
    assert context.request.post(base + '/api/v1/auth/login', data={'username': 'ink-browser', 'password': PASSWORD}).ok
    assert viewer.request.post(base + '/api/v1/auth/login', data={'username': 'ink-viewer', 'password': PASSWORD}).ok
    viewer_before = viewer.request.get(base + '/api/v1/files/role-graph-ink-viewer').json()['graphData']
    viewer_files_before = viewer.request.get(base + '/api/v1/files').json()['files']
    created = context.request.post(base + '/api/v1/files', data={
        'name': '跨标签课堂 ' + uuid.uuid4().hex[:8],
        'graphData': {'nodes': [{'id': 'cross-tab-original', 'title': '原教师课堂', 'x': 500, 'y': 320}], 'links': [], 'strokes': []},
    })
    assert created.ok, created.text()
    file_id = created.json()['file']['id']
    assert context.request.put(base + '/api/v1/files/current', data={'fileId': file_id}).ok
    context.tracing.start(screenshots=True, snapshots=True)
    page = context.new_page()
    other = context.new_page()
    try:
        toolbar = prepare(page, base, 'home')
        original_url = page.url
        original_graph = graph_identity(page, 'home')
        identity = page.evaluate('KGAuthRecovery.capture()')
        draft = '跨标签禁止串账号 ' + uuid.uuid4().hex[:8] + '\n原教师尚未保存的课堂'
        editor = new_text(page, toolbar, draft)
        editor.evaluate('el=>{el.dataset.crossTabDraft="original"}')
        # The second page uses actual account-menu exit and credential login.
        # File manager has no second live graph editor, avoiding an unrelated
        # concurrent graph-revision update while exercising the same cookie jar.
        other.goto(base + '/file-manager.html', wait_until='networkidle')
        other.locator('#fmAvatar').click()
        other.locator('#fmAccountSessionBtn').click()
        other.wait_for_url('**/index.html')
        other.wait_for_load_state('networkidle')
        other.wait_for_function('!KGAuthCore.currentUser()')
        dismiss_overlays(other)
        other.locator('#authStatus').click()
        other.locator('#accountMenuSessionBtn').click()
        fill_login(other, 'ink-viewer')
        other.wait_for_function('KGAuthCore.currentUsername()==="ink-viewer"')
        expect(other.locator('#authModal')).to_be_hidden()
        page.wait_for_function('KGAuthRecovery.isPaused()')
        expect(page.locator('#kgAuthRecoveryBanner')).to_be_visible()
        expect(editor).to_have_value(draft)
        expect(editor).to_have_attribute('data-cross-tab-draft', 'original')
        assert page.evaluate('KGAuthCore.currentUsername()') == 'ink-browser'
        assert graph_identity(page, 'home') == original_graph
        assert page.url == original_url
        # Independently exercise the real server identity guard, bypassing the
        # already-paused UI client. The shared cookie now belongs to the viewer.
        denied = context.request.post(base + '/api/v1/files', headers={'X-KG-Login-Session-ID': identity['loginSessionId']}, data={
            'name': '不得写入另一个账号', 'graphData': {'nodes': [{'id': 'forbidden-cross-owner', 'title': draft}], 'links': []},
        })
        assert denied.status == 401, ('Stale login-session header must be rejected before role dispatch', denied.status, denied.text())
        assert context.request.get(base + '/api/v1/files/role-graph-ink-viewer').json()['graphData'] == viewer_before
        assert {f['id'] for f in context.request.get(base + '/api/v1/files').json()['files']} == {f['id'] for f in viewer_files_before}
        assert teacher.request.post(base + '/api/v1/auth/login', data={'username': 'ink-browser', 'password': PASSWORD}).ok
        before_recovery = teacher.request.get(base + '/api/v1/files/' + file_id).json()['graphData']
        assert not any(s.get('text') == draft for s in before_recovery.get('strokes', []))
        page.screenshot(path=str(OUT / 'cross-tab-owner-paused.png'))
        other.close()
        page.locator('[data-auth-recovery-login]').click()
        fill_login(page, 'ink-browser')
        page.wait_for_function('!KGAuthRecovery.isPaused() && KGAuthCore.currentUsername()==="ink-browser"')
        expect(page.locator('#kgAuthRecoveryBanner')).to_be_hidden()
        saved = wait_persisted(page, context, base, 'home', file_id, text=draft)
        assert sum(s.get('text') == draft for s in saved) == 1
        assert graph_identity(page, 'home') == original_graph
        assert viewer.request.get(base + '/api/v1/files/role-graph-ink-viewer').json()['graphData'] == viewer_before
        page.reload(wait_until='networkidle')
        dismiss_overlays(page)
        text_id = next(s['id'] for s in saved if s.get('text') == draft)
        expect(page.locator('.canvas-ink-layer text[data-stroke-id="' + text_id + '"]')).to_be_visible()
        page.screenshot(path=str(OUT / 'cross-tab-owner-recovered.png'))
        checks.append({'crossTab': True, 'status': 'passed', 'fileId': file_id, 'guardStatus': denied.status,
                       'checks': ['broadcast-pause', 'same-textarea', 'original-owner-retained', 'stale-session-header-rejected', 'viewer-data-unchanged', 'original-owner-resume-reload']})
        print('PASS cross-tab: real second-page account switch, retained original draft, server identity guard, isolated DB/reload', flush=True)
    except Exception:
        page.screenshot(path=str(OUT / 'cross-tab-failure.png'))
        details = page.evaluate('''()=>({url:location.href,paused:KGAuthRecovery.isPaused(),identity:KGAuthRecovery.capture(),banner:document.getElementById('kgAuthRecoveryBanner')?.textContent,draft:document.querySelector('.canvas-ink-text-editor')?.value})''')
        (OUT / 'cross-tab-failure.json').write_text(json.dumps(details, ensure_ascii=False, indent=2))
        raise
    finally:
        context.tracing.stop(path=str(OUT / 'cross-tab-trace.zip'))
        context.close()
        viewer.close()
        teacher.close()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', required=True)
    parser.add_argument('--only', choices=['home', 'recall', 'workspace', 'readonly', 'auth-traversal', 'cross-tab'])
    args = parser.parse_args()
    base = args.base_url.rstrip('/')
    parsed = urlparse(base)
    assert parsed.scheme == 'http' and parsed.hostname in ('127.0.0.1', 'localhost') and parsed.port, 'Only an explicitly ported local disposable fixture is allowed'
    OUT.mkdir(parents=True, exist_ok=True)
    checks = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel='chrome')
        try:
            for mode in MODES:
                if args.only in (None, mode):
                    check_classroom(browser, base, mode, checks)
            if args.only in (None, 'readonly'):
                check_readonly(browser, base, checks)
            if args.only in (None, 'auth-traversal'):
                check_auth_pages(browser, base, checks)
            if args.only in (None, 'cross-tab'):
                check_cross_tab(browser, base, checks)
        finally:
            (OUT / 'results.json').write_text(json.dumps({'baseUrl': base, 'checks': checks}, ensure_ascii=False, indent=2))
            browser.close()
    print('PASS classroom-auth-recovery-browser: ' + str(len(checks)) + ' real-page checks', flush=True)


if __name__ == '__main__':
    main()
