"""Pointer grouping regression with in-memory API fixtures; no application writes reach server."""
import argparse
import copy
import json
import re
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--base-url', default='http://127.0.0.1:5173')
parser.add_argument('--output', default=str(ROOT / '.superpowers/sdd/2026-10-26-practice-graph-referral/groups-browser'))
parser.add_argument('--served', action='store_true', help='Verify actual release bundles without source overlays')
args = parser.parse_args()
out = Path(args.output)
out.mkdir(parents=True, exist_ok=True)
user = {'username': 'groups-fixture', 'role': 'teacher', 'status': 'active', 'displayName': '分组回归'}
graph = {'meta': {'title': '组合隔离夹具'}, 'viewport': {'x': 0, 'y': 0, 'scale': 1},
         'nodes': [{'id': key, 'title': key, 'geometry': {'x': x, 'y': 270, 'width': 128, 'height': 132}} for key, x in [('a', 170), ('b', 430), ('c', 850)]],
         'links': [{'id': 'ab', 'from': 'a', 'to': 'b', 'pathStyle': 'elbow', 'waypoints': [{'x': 350, 'y': 336}, {'x': 350, 'y': 400}, {'x': 410, 'y': 400}], 'fromPort': 'auto', 'toPort': 'auto'}]}
stored = {'graph': copy.deepcopy(graph), 'revision': 1}
writes, errors = [], []
changed = ['src/00-config-state.js', 'src/10-graph-editor.js', 'src/18-graph-user-preferences.js',
           'src/graph/graph-model.js', 'src/graph/graph-fragment.js', 'src/graph/context-menu-controller.js',
           'src/graph/node-toolbar-controller.js', 'src/graph/edge-geometry.js', 'src/graph/edge-bundle.js']
with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True, channel='chrome')
    ctx = browser.new_context(viewport={'width': 1440, 'height': 1000})
    def api(route):
        req = route.request
        path = urlsplit(req.url).path
        if req.method not in ('GET', 'HEAD'):
            writes.append({'method': req.method, 'path': path})
        meta = {'id': 'groups-fixture', 'name': '组合隔离夹具', 'revision': stored['revision']}
        if path == '/api/v1/auth/me':
            route.fulfill(json={'user': user})
        elif path == '/api/v1/files/current':
            route.fulfill(json={'fileId': 'groups-fixture'})
        elif path == '/api/v1/files/groups-fixture':
            if req.method in ('PUT', 'PATCH'):
                body = req.post_data_json
                if 'graphData' in body:
                    stored['graph'] = copy.deepcopy(body['graphData'])
                    stored['revision'] += 1
                route.fulfill(json={'file': {**meta, 'revision': stored['revision']}})
            else:
                route.fulfill(json={'meta': meta, 'graphData': stored['graph'], 'learningState': {}})
        else:
            route.fulfill(json={'files': [meta] if path == '/api/v1/files' else [], 'folders': [], 'tags': [], 'templates': [], 'settings': {}})
    ctx.route('**/api/v1/**', api)
    def document(route):
        response = route.fetch()
        text = re.sub(r'window\.__KG_DIRECT_BOOTSTRAP__=\{.*?\};', lambda _: 'window.__KG_DIRECT_BOOTSTRAP__='+json.dumps({'schemaVersion': 1, 'authenticated': True, 'authUser': user, 'username': user['username'], 'graphFilesApiCutoverEnabled': True})+';', response.text())
        route.fulfill(response=response, body=text)
    ctx.route('**/index.html*', document)
    def bundle(route):
        response = route.fetch()
        prefix, payload = response.text().split('\n})(', 1)
        rows = json.loads(payload.strip()[:-2])
        for row in rows:
            if row[0] in changed:
                row[1] = (ROOT / 'new-legacy' / row[0]).read_text()+'\n//# sourceURL='+row[0]
        name = 'src/graph/group-controller.js'
        if not any(row[0] == name for row in rows):
            rows.insert(0, [name, (ROOT / 'new-legacy' / name).read_text()+'\n//# sourceURL='+name])
        route.fulfill(response=response, body=prefix+'\n})('+json.dumps(rows)+');\n')
    if not args.served:
        ctx.route('**/bundles/home-graph.js*', bundle)
    def css(route):
        response = route.fetch()
        route.fulfill(response=response, body=response.text()+'\n'+(ROOT / 'new-legacy/styles/home-graph-components.css').read_text())
    if not args.served:
        ctx.route('**/bundles/home-shell.css*', css)
    page = ctx.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    def ready():
        page.wait_for_function('window.KGHomepageLoader?.state("graph")==="ready" && window.KGGraphFileRemoteAdapter?.getCurrentFileMeta()?.id==="groups-fixture"')
        expect(page.locator('#cardsLayer .knowledge-card')).to_have_count(3)
        for selector in ['#learningEntryDismissBtn', '.tour-skip', '#hideHelpBtn']:
            if page.locator(selector).is_visible():
                page.locator(selector).click()
    def card(key):
        return page.locator('.knowledge-card[data-node-id="'+key+'"]')
    def state():
        return page.evaluate('JSON.parse(JSON.stringify({nodes:state.nodes.map(n=>({id:n.id,x:n.x,y:n.y,groupId:n.groupId})),waypoints:state.links[0].waypoints}))')
    def drag(key, dx, dy):
        box = card(key).bounding_box()
        x, y = box['x']+box['width']/2, box['y']+box['height']*.75
        page.mouse.move(x, y)
        page.mouse.down()
        original = state()
        page.mouse.move(x+2, y+2)
        assert state() == original, "Sub-threshold pointer move must not mutate graph or routes"
        page.mouse.move(x+dx, y+dy, steps=16)
        page.mouse.up()
        page.wait_for_timeout(180)
    page.goto(args.base_url+'/index.html?mode=free', wait_until='networkidle')
    ready()
    # Marquee selection must never open the primary card's content, even for one card.
    card('a').click(position={'x': 45, 'y': 90})
    expect(page.locator('#detailPanel')).to_have_class(re.compile(r'\bshow\b'))
    for last, count in [('a', 1), ('b', 2)]:
        a, end = card('a').bounding_box(), card(last).bounding_box()
        page.mouse.move(a['x']-14, a['y']-14)
        page.mouse.down()
        assert not page.locator('#detailPanel').evaluate('(panel)=>panel.classList.contains("show")'), 'starting a marquee must hide existing detail'
        page.mouse.move(end['x']+end['width']+14, end['y']+end['height']+14, steps=16)
        page.mouse.up()
        assert page.evaluate('selectedNodeIds.size') == count
        page.evaluate('refreshSelectionUI()')
        assert not page.locator('#detailPanel').evaluate('(panel)=>panel.classList.contains("show")'), 'marquee details must stay hidden after refresh'
        page.evaluate('clearSelection();refreshSelectionUI()')
    card('b').click(position={'x': 45, 'y': 90})
    expect(page.locator('#detailPanel')).to_have_class(re.compile(r'\bshow\b'))
    page.evaluate('clearSelection();refreshSelectionUI()')
    # Actual modifier clicks, toolbar action and member drag.
    card('a').click(position={'x': 45, 'y': 90}, modifiers=['Control'])
    card('b').click(position={'x': 45, 'y': 90}, modifiers=['Control'])
    assert page.evaluate('selectedNodeIds.size') == 2
    assert not page.locator('#detailPanel').evaluate('(panel)=>panel.classList.contains("show")')
    group = page.locator('[data-node-toolbar-action="group"]')
    expect(group).to_be_visible()
    group.click()
    before = state()
    assert before['nodes'][0]['groupId'] == before['nodes'][1]['groupId']
    assert 'groupId' not in before['nodes'][2]
    drag('a', 60, 50)
    moved = state()
    dx = moved['nodes'][0]['x']-before['nodes'][0]['x']
    dy = moved['nodes'][0]['y']-before['nodes'][0]['y']
    assert dx or dy
    for index in [0, 1]:
        assert moved['nodes'][index]['x']-before['nodes'][index]['x'] == dx
        assert moved['nodes'][index]['y']-before['nodes'][index]['y'] == dy
    assert moved['nodes'][2] == before['nodes'][2]
    for old, new in zip(before['waypoints'], moved['waypoints']):
        assert new['x']-old['x'] == dx and new['y']-old['y'] == dy
    page.keyboard.press('ControlOrMeta+z')
    assert state() == before, (before, state())
    page.keyboard.press('ControlOrMeta+Shift+z')
    assert state() == moved
    # Persistence uses real editor save plumbing, with the API response isolated above.
    page.evaluate('saveNow({force:true})')
    page.wait_for_function('!KGGraphFileAutosave.status().dirty && !KGGraphFileAutosave.status().saving')
    assert stored['graph']['nodes'][0]['groupId'] == before['nodes'][0]['groupId']
    page.reload(wait_until='networkidle')
    ready()
    assert state() == moved
    card('b').click(position={'x': 45, 'y': 90})
    page.locator('[data-node-toolbar-action="ungroup"]').click()
    assert all('groupId' not in n for n in state()['nodes'])
    page.keyboard.press('ControlOrMeta+z')
    assert state()['nodes'][0]['groupId'] == before['nodes'][0]['groupId']
    # Locked member and readonly capability reject both regroup and ungroup.
    page.evaluate('KGGraphModel.updateInteraction(nodeById("b"),{locked:true});refreshSelectionUI()')
    locked = state()
    page.keyboard.press('ControlOrMeta+Shift+g')
    assert state() == locked
    drag('a', 45, 30)
    assert state() == locked
    page.evaluate('KGGraphModel.updateInteraction(nodeById("b"),{locked:false});document.body.classList.add("auth-readonly")')
    readonly = state()
    page.keyboard.press('ControlOrMeta+Shift+g')
    assert state() == readonly
    assert page.evaluate('KGGraphCardGroups.ungroup()') is False
    page.evaluate('document.body.classList.remove("auth-readonly")')
    # A single unrelated card has neither group action visibly exposed.
    card('c').click(position={'x': 45, 'y': 90})
    expect(group).to_be_hidden()
    expect(page.locator('[data-node-toolbar-action="ungroup"]')).to_be_hidden()
    page.screenshot(path=str(out / 'groups.png'))
    assert not errors, errors
    (out / 'result.json').write_text(json.dumps({'pass': True, 'pointerDelta': {'x': dx, 'y': dy}, 'mockedWrites': writes, 'pageErrors': errors, 'checks': ['ctrl multiselect', 'toolbar group', 'member drag', 'unrelated stationary', 'internal waypoints translated', 'undo redo', 'save reload', 'ungroup undo', 'locked reject', 'readonly reject', 'single-card action visibility']}, ensure_ascii=False, indent=2))
    browser.close()
print('PASS graph groups: real pointer selection/drag, routes, history, mocked persistence, lock/readonly and UI visibility')
