"""Personal graph menu permissions; optional real API persistence on disposable fixture.

Standalone: python3 new-legacy/tests/graph-file-import-permissions-browser.py
API: start helpers/canvas_ink_server.py --role-matrix, then pass --base-url.
"""
import argparse
import json
import re
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect, TimeoutError as PlaywrightTimeout

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'new-legacy'
MENU = 'src/18-graph-user-preferences.js'


def click_import(page):
    page.locator('#graphPrefsBtn').click()
    page.locator('[data-meta-submenu="file"]').click()
    expect(page.locator('[data-meta-file-action="import"]')).to_be_visible()
    page.locator('[data-meta-file-action="import"]').click()


def chooser(page, label, out):
    try:
        with page.expect_file_chooser(timeout=2000) as chosen:
            click_import(page)
        page.screenshot(path=str(out / (label + '.png')))
        return chosen.value
    except PlaywrightTimeout:
        page.screenshot(path=str(out / (label + '-FAILED.png')))
        (out / (label + '-FAILED.html')).write_text(page.content())
        raise AssertionError(label + ': actual 文件 → 导入 click must open a file chooser')


def denied(page, guest=False):
    events = []
    on_chooser = lambda chosen: events.append(chosen)
    page.on('filechooser', on_chooser)
    click_import(page)
    if guest:
        expect(page.locator('#authModal')).to_have_class(re.compile('show'))
    else:
        expect(page.locator('#status')).to_contain_text('权限')
    assert not events, 'read-only or anonymous identity must not open an import chooser'
    page.remove_listener('filechooser', on_chooser)


def standalone(browser, out):
    # Render the actual index launcher, production menu, permission matrix and auth
    # guard. Only unrelated editor callbacks and the identity provider are fixtures.
    button = re.search(r'<button\b[^>]*id="graphPrefsBtn"[^>]*>.*?</button>',
                       (SOURCE / 'index.html').read_text(), re.S).group()
    for label, role in [('free-student', 'student'), ('paid-student', 'student'),
                        ('teacher', 'teacher'), ('admin', 'admin'),
                        ('viewer', 'viewer'), ('guest', None)]:
        page = browser.new_page(viewport={'width': 1440, 'height': 900})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.set_content('<style>#authModal{display:none}#authModal.show{display:block}</style>'
                         + button + '<input id="importFile" type="file" hidden>'
                         '<div id="status"></div><div id="authModal"><p id="authReason"></p>'
                         '<p id="authMsg"></p></div>')
        for css in ['styles/graph-file-tabs.css', 'styles/graph-user-preferences.css']:
            page.add_style_tag(content=(SOURCE / css).read_text())
        page.evaluate('''role=>{
          const user=role?{username:'menu-fixture',role,status:'active'}:null;
          window.KGAuthCore={currentUser:()=>user,currentUsername:()=>user?.username||''};
          window.$=id=>document.getElementById(id);
          window.showStatus=text=>document.getElementById('status').textContent=text;
          for(const name of ['openNodeModal','createNodeAt','activateLinkSource','openLinkModal',
            'deleteNode','applyNodeSize','applyLineStyle','applyLineColor'])window[name]=()=>{};
        }''', role)
        for script in ['src/34-role-permissions.js', 'src/30-auth-guards.js', MENU]:
            page.add_script_tag(content=(SOURCE / script).read_text())
        if role in ('student', 'teacher', 'admin'):
            chooser(page, label, out)
        else:
            denied(page, guest=role is None)
            page.screenshot(path=str(out / (label + '.png')))
        if role == 'student':
            assert page.evaluate('!KGRolePermissions.can("importData")')
            assert page.evaluate('authRequire("", "importData")') is False
        assert not errors, errors
        print('PASS source menu:', label, flush=True)
        page.close()


def ready(page):
    page.wait_for_function('!!window.KGGraphFileTabs && !KGGraphFileTabs.isSwitching()')
    for selector in ['#learningEntryDismissBtn', '.tour-skip', '#hideHelpBtn']:
        if page.locator(selector).is_visible():
            page.locator(selector).click()


def api(browser, base, out):
    evidence = {}
    ctx = browser.new_context(viewport={'width': 1440, 'height': 1000})
    ctx.tracing.start(screenshots=True, snapshots=True, sources=True)
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    try:
        assert ctx.request.post(base + '/api/v1/auth/login', data={
            'username': 'ink-student', 'password': 'ink-browser-test'}).ok
        subscription = ctx.request.get(base + '/api/v1/subscriptions/me').json()
        assert subscription['subscription']['planId'] == 'free', subscription
        evidence['freeSubscription'] = subscription
        assert ctx.request.post(base + '/api/v1/banks/import',
                                data={'banks': []}).status == 403
        original_id = 'role-graph-ink-student'
        assert ctx.request.put(base + '/api/v1/files/current', data={'fileId': original_id}).ok
        page.goto(base + '/index.html', wait_until='networkidle')
        ready(page)
        page.wait_for_function('KGRolePermissions.currentRole()==="student" && state.nodes.some(n=>n.id==="role-a")')
        assert page.evaluate('KGRolePermissions.can("editGraph") && !KGRolePermissions.can("importData")')
        original = ctx.request.get(base + '/api/v1/files/' + original_id).json()['graphData']
        before_count = ctx.request.get(base + '/api/v1/files').json()['total']
        graph = {'meta': {'title': '免费学员个人图谱导入回归'}, 'nodes': [
            {'id': 'free-import-a', 'title': '免费学员保留知识点', 'x': 350, 'y': 250,
             'summary': 'JSON 导入后重新打开仍然保留'},
            {'id': 'free-import-b', 'title': '独立第二节点', 'x': 750, 'y': 300}],
            'links': [{'id': 'free-import-edge', 'from': 'free-import-a', 'to': 'free-import-b'}],
            'viewport': {'x': 0, 'y': 0, 'scale': 1}}
        # Supply a file ONLY through the FileChooser created by the actual menu.
        selected = chooser(page, 'api-free-student-menu', out)
        selected.set_files({'name': 'free-personal-graph.json', 'mimeType': 'application/json',
                            'buffer': json.dumps(graph, ensure_ascii=False).encode()})
        page.wait_for_function('state.nodes.some(n=>n.id==="free-import-a") && !KGGraphFileTabs.isSwitching()')
        page.wait_for_function('''async original=>{
          const response=await fetch('/api/v1/files/current');
          const current=response.ok && (await response.json()).fileId;
          return current && current!==original;
        }''', arg=original_id)
        current = ctx.request.get(base + '/api/v1/files/current').json()['fileId']
        assert current and current != original_id, {'current': current, 'expectedNewFile': True}
        assert ctx.request.get(base + '/api/v1/files').json()['total'] == before_count + 1
        imported = ctx.request.get(base + '/api/v1/files/' + current).json()['graphData']
        assert [n['title'] for n in imported['nodes']] == ['免费学员保留知识点', '独立第二节点']
        assert imported['nodes'][0]['summary'] == 'JSON 导入后重新打开仍然保留'
        assert imported['links'][0]['from'] == 'free-import-a'
        assert ctx.request.get(base + '/api/v1/files/' + original_id).json()['graphData'] == original
        page.reload(wait_until='networkidle')
        ready(page)
        page.wait_for_function('state.nodes.some(n=>n.id==="free-import-a") && !KGGraphFileTabs.isSwitching()')
        assert page.evaluate('state.nodes.map(n=>n.title)') == ['免费学员保留知识点', '独立第二节点']
        assert ctx.request.get(base + '/api/v1/files/' + current).json()['graphData'] == imported
        assert ctx.request.get(base + '/api/v1/files/' + original_id).json()['graphData'] == original
        assert ctx.request.get(base + '/api/v1/subscriptions/me').json()['subscription']['planId'] == 'free'
        evidence.update({'originalId': original_id, 'importedId': current,
                         'beforeCount': before_count, 'afterCount': before_count + 1,
                         'originalUnchanged': True, 'importedGraph': imported})
        page.screenshot(path=str(out / 'api-free-student-reopened.png'))
        print('PASS API: confirmed free plan; menu chooser; new persisted JSON graph; reload; original unchanged', flush=True)
        # Use only this disposable fixture's admin account to turn the same student
        # into a lifetime member and check that membership keeps the same boundary.
        admin = browser.new_context()
        assert admin.request.post(base + '/api/v1/auth/login', data={
            'username': 'ink-admin', 'password': 'ink-browser-test'}).ok
        assert admin.request.put(base + '/api/v1/subscriptions/admin/ink-student',
                                 data={'planId': 'lifetime', 'status': 'active'}).ok
        admin.close()
        page.reload(wait_until='networkidle')
        ready(page)
        assert ctx.request.get(base + '/api/v1/subscriptions/me').json()['subscription']['planId'] == 'lifetime'
        chooser(page, 'api-paid-student-menu', out)
        assert page.evaluate('!KGRolePermissions.can("importData")')
        assert ctx.request.post(base + '/api/v1/banks/import', data={'banks': []}).status == 403
        for username in ['ink-browser', 'ink-admin', 'ink-viewer']:
            assert ctx.request.post(base + '/api/v1/auth/login', data={
                'username': username, 'password': 'ink-browser-test'}).ok
            page.goto(base + '/index.html', wait_until='networkidle')
            ready(page)
            if username == 'ink-viewer':
                page.wait_for_function('KGRolePermissions.currentRole()==="viewer"')
                denied(page)
                assert ctx.request.post(base + '/api/v1/files', data={
                    'name': 'must-not-write', 'graphData': graph}).status == 403
            else:
                chooser(page, 'api-' + username + '-menu', out)
            print('PASS API menu:', username, flush=True)
        assert ctx.request.post(base + '/api/v1/auth/logout').ok
        page.goto(base + '/index.html', wait_until='networkidle')
        ready(page)
        denied(page, guest=True)
        assert not errors, errors
        evidence['errors'] = errors
        (out / 'api-result.json').write_text(json.dumps(evidence, ensure_ascii=False, indent=2))
    except Exception:
        page.screenshot(path=str(out / 'api-FAILED.png'))
        (out / 'api-FAILED.json').write_text(json.dumps({
            'errors': errors, 'url': page.url,
            'current': ctx.request.get(base + '/api/v1/files/current').json(),
            'files': ctx.request.get(base + '/api/v1/files').json(),
            'editor': page.evaluate('''()=>({
              storeCurrent:KGGraphFileStore.getCurrentFileId(),
              remoteCurrent:KGGraphFileRemoteStore.getCurrentFileId(),
              acknowledged:KGGraphFileRemoteAdapter.getCurrentFileMeta(),
              nodes:state.nodes,status:document.getElementById('status').textContent})''')},
            ensure_ascii=False, indent=2))
        raise
    finally:
        ctx.tracing.stop(path=str(out / 'api-trace.zip'))
        ctx.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url')
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'artifacts/free-graph-import-20261020/browser')
    args = parser.parse_args()
    out = args.output_dir.resolve()
    out.mkdir(parents=True, exist_ok=True)
    if args.base_url:
        assert urlparse(args.base_url).hostname in ('localhost', '127.0.0.1')
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        try:
            if args.base_url:
                api(browser, args.base_url.rstrip('/'), out)
            else:
                standalone(browser, out)
        finally:
            browser.close()


if __name__ == '__main__':
    main()
