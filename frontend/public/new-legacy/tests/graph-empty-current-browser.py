"""Real editor rendering/autosave with API-boundary fixtures; never mutate live data."""
import argparse
import json
import re
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--base-url', default='http://127.0.0.1:5173')
parser.add_argument('--output', default=str(ROOT / 'artifacts/template-gallery/empty-current-fixed'))
parser.add_argument('--source-overlay', action='store_true')
args = parser.parse_args()
out = Path(args.output)
out.mkdir(parents=True, exist_ok=True)
USER = {'username': 'empty-fixture', 'role': 'teacher', 'status': 'active', 'displayName': '空白回归'}
results = []
with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True, channel='chrome')
    for scenario in ('initial-null', 'recovered-library-null', 'account-switch', 'login', 'personal-restore', 'failed-init', 'guest'):
        ctx = browser.new_context(viewport={'width': 1440, 'height': 1000})
        session = {'authenticated': scenario not in ('login', 'guest'),
                   'current': 'personal' if scenario in ('account-switch', 'personal-restore') else None,
                   'fail': scenario == 'failed-init'}
        writes, errors = [], []
        graph = {'meta': {'title': '自己的个人图谱'}, 'nodes': [{'id': 'personal-node', 'title': '个人卡片', 'x': 0, 'y': 0}], 'links': []}
        def api(route):
            req = route.request
            path = urlsplit(req.url).path
            if req.method not in ('GET', 'HEAD'):
                writes.append({'path': path, 'method': req.method, 'body': req.post_data_json})
            if path == '/api/v1/auth/me':
                route.fulfill(json={'user': USER if session['authenticated'] else None})
            elif path == '/api/v1/files/current':
                if req.method == 'PUT':
                    session['current'] = req.post_data_json['fileId']
                route.fulfill(status=503 if session['fail'] else 200, json={'fileId': session['current']})
            elif path == '/api/v1/files' and req.method == 'POST':
                route.fulfill(json={'file': {'id': 'created', 'revision': 1, 'name': req.post_data_json['name']}})
            elif path in ('/api/v1/files/personal', '/api/v1/files/created'):
                route.fulfill(json={'meta': {'id': session['current'], 'name': graph['meta']['title'], 'revision': 1},
                                    'graphData': graph, 'learningState': {},
                                    'file': {'id': session['current'], 'revision': 2}})
            else:
                route.fulfill(json={'files': [], 'folders': [], 'tags': [], 'templates': [], 'settings': {}})
        ctx.route('**/api/v1/**', api)
        def document(route):
            response = route.fetch()
            text = response.text()
            text = re.sub(r'window\.__KG_DIRECT_BOOTSTRAP__=\{.*?\};',
                lambda _: 'window.__KG_DIRECT_BOOTSTRAP__='+json.dumps({'schemaVersion': 1, 'authenticated': session['authenticated'], 'authUser': USER if session['authenticated'] else None, 'username': USER['username'] if session['authenticated'] else None, 'graphFilesApiCutoverEnabled': True})+';', text)
            route.fulfill(response=response, body=text)
        ctx.route('**/index.html*', document)
        if args.source_overlay:
            def bundle(route):
                response = route.fetch()
                text = response.text()
                prefix, payload = text.split('\n})(', 1)
                sources = json.loads(payload.strip()[:-2])
                for row in sources:
                    if row[0] in ('src/00-config-state.js', 'src/23-graph-file-remote-adapter.js', 'src/30-auth-guards.js', 'src/90-bootstrap.js'):
                        row[1] = (ROOT / 'new-legacy' / row[0]).read_text()+'\n//# sourceURL='+row[0]
                route.fulfill(response=response, body=prefix+'\n})('+json.dumps(sources)+');\n')
            ctx.route('**/bundles/home-graph.js*', bundle)
        page = ctx.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(args.base_url+'/index.html', wait_until='networkidle')
        page.wait_for_function('window.KGHomepageLoader?.state("graph")==="ready"')
        if scenario in ('account-switch', 'login'):
            session.update(authenticated=True, current=None)
            page.evaluate('''() => {
              window.dispatchEvent(new CustomEvent('kg:auth-session-changed',{detail:{authenticated:true}}));
            }''')
            page.wait_for_function('KGGraphFileRemoteAdapter.isInitialized() && !KGGraphFileRemoteAdapter.getCurrentFileMeta()')
            page.evaluate('authLoadCurrentSpace()')
        count = 1 if scenario == 'personal-restore' else 11 if scenario in ('failed-init', 'guest') else 0
        expect(page.locator('#cardsLayer .knowledge-card')).to_have_count(count)
        assert page.evaluate('state.nodes.length') == count
        assert not writes, writes
        if count == 0:
            assert page.evaluate('state.links.length') == 0
            page.evaluate('state.viewport.x+=60; state.viewport.scale=1.2; render(); saveNow({force:true})')
            page.wait_for_timeout(300)
            assert not writes, writes
            skip = page.get_by_role('button', name='跳过', exact=True)
            if skip.is_visible():
                skip.click()
            page.screenshot(path=str(out / (scenario+'.png')))
            page.evaluate("state.nodes.push(makeNode('首次新建卡片',0,0,'#64748b'));render();save();")
            page.wait_for_function('!!KGGraphFileRemoteAdapter.getCurrentFileMeta()')
            page.evaluate('saveNow()')
            creates = [w for w in writes if w['path'] == '/api/v1/files' and w['method'] == 'POST']
            assert len(creates) == 1, writes
            assert [n['title'] for n in creates[0]['body']['graphData']['nodes']] == ['首次新建卡片']
            assert creates[0]['body']['graphData']['links'] == []
            assert len([w for w in writes if w['path'].endswith('/current')]) == 1
        assert not errors, errors
        results.append({'scenario': scenario, 'nodes': count, 'writes': len(writes), 'pageErrors': errors})
        ctx.close()
    browser.close()
(out / 'result.json').write_text(json.dumps({'pass': True, 'scenarios': results}, ensure_ascii=False, indent=2))
print('PASS empty current: real blank DOM, restored personal, failed/guest behavior, no pan/zoom writes, blank-origin first autosave')
