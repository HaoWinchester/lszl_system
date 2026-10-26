"""Source gallery against the local editor renderer; isolated API/file-store boundaries.
No live account mutations. Real API persistence is covered by template-preview-browser.py.
"""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--base-url', default='http://127.0.0.1:5173')
parser.add_argument('--output', default=str(ROOT / 'artifacts/template-gallery'))
args = parser.parse_args()
out = Path(args.output)
out.mkdir(parents=True, exist_ok=True)
rows = [dict(id=str(i), name=f'学习图谱 {i}', description='治理' if i % 2 == 0 else '复习',
             category=['pmp', 'prince2', 'cspm', 'gaoxiang', 'general'][i % 5],
             categoryLabel=['PMP', 'PRINCE2', 'CSPM', '高项', '通用学习'][i % 5],
             publisherName='课程教师', version=1, listed=True, canMaintain=True)
        for i in range(20)]
requests, receipts, errors = [], {}, []
fail = {'catalog': True, 'thumbnail': True, 'load': True}

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True, channel='chrome')
    ctx = browser.new_context(viewport={'width': 1440, 'height': 1000})
    page = ctx.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))

    def route_api(route):
        request = route.request
        path = request.url.split('/api/v1/graph-templates')[1]
        requests.append((request.method, path))
        if not path:
            if fail['catalog']:
                fail['catalog'] = False
                route.fulfill(status=503, json={'detail': '目录暂时离线'})
            else:
                route.fulfill(json={'templates': rows})
        elif path.endswith('/loads'):
            payload = request.post_data_json
            receipts.setdefault(payload['requestId'], 'copy-' + str(len(receipts)))
            if fail['load']:
                fail['load'] = False
                # A lost response after server copy creation must reuse its receipt.
                route.fulfill(status=503, json={'detail': '副本响应暂时失败'})
            else:
                route.fulfill(json={'fileId': receipts[payload['requestId']], 'version': payload['version']})
        else:
            item = rows[int(path[1:])]
            if item['id'] == '0' and fail['thumbnail']:
                fail['thumbnail'] = False
                route.fulfill(status=503, json={'detail': '缩略图临时失败'})
            else:
                route.fulfill(json={'template': item, 'preview': {'version': 1, 'nodes': [
                    {'id': 'a', 'title': item['name'], 'x': 0, 'y': 0, 'width': 240, 'height': 100},
                    {'id': 'b', 'title': '应用情境', 'x': 360, 'y': 80, 'width': 200, 'height': 100},
                ], 'links': [], 'elements': [], 'strokes': []}})

    ctx.route('**/api/v1/graph-templates**', route_api)

    def setup():
        page.goto(args.base_url + '/index.html', wait_until='networkidle')
        page.wait_for_function('!!window.KGTemplatePreview && !!window.KGGraphRenderer')
        page.evaluate('''() => {
          window.KGAuthCore={currentUser:()=>({username:'fixture-teacher',role:'teacher'})};
          window.KGGraphFileEditorStoreBridge={isRemote:()=>true,fragmentSource:()=>({fileId:'source',revision:1})};
          window.galleryCurrent=localStorage.getItem('gallery-fixture-current')||'source';
          window.KGGraphFileRemoteStore={refresh:async()=>{}};
          window.KGGraphFileTabs={refresh:async()=>{},openFile:async id=>{
            window.galleryCurrent=id;localStorage.setItem('gallery-fixture-current',id)
          }};
        }''')
        page.add_style_tag(path=str(ROOT / 'new-legacy/styles/graph-template-center.css'))
        page.add_script_tag(path=str(ROOT / 'new-legacy/src/graph/template-center-controller.js'))
        page.evaluate('KGGraphTemplateCenter.open()')

    setup()
    center = page.locator('#graphTemplateCenter')
    expect(center.locator('[role=status]')).to_contain_text('目录暂时离线')
    center.get_by_role('button', name='重试加载', exact=True).click()
    expect(center.locator('article')).to_have_count(20)
    first = center.locator('[data-template-id="0"]')
    first.get_by_role('button', name='重试缩略图', exact=True).click()
    expect(first.locator('.template-thumbnail svg')).to_be_visible()
    expect(first.locator('.template-thumbnail .knowledge-card')).to_have_count(2)
    before = page.evaluate('JSON.stringify({graph:state,history:KGGraphKernel.history.getState()})')
    center.get_by_role('searchbox', name='搜索模板').fill('治理')
    center.locator('[data-template-category=prince2]').click()
    expect(center.locator('article')).to_have_count(2)
    expect(center.locator('[data-template-category=prince2]')).to_have_attribute('aria-pressed', 'true')
    expect(center.locator('.template-section-title')).to_contain_text('2 个模板')
    center.get_by_role('searchbox', name='搜索模板').fill('不存在')
    expect(center.locator('article')).to_have_count(0)
    center.get_by_role('button', name='清除搜索', exact=True).click()
    expect(center.locator('article')).to_have_count(4)
    center.locator('[data-template-category=all]').click()
    first.locator('summary').click()
    assert not any(method == 'PATCH' for method, _ in requests), 'opening maintenance cannot mutate'
    first.get_by_role('button', name='更新为新版本', exact=True).click()
    form = center.locator('.template-publication-form')
    expect(form.get_by_role('combobox', name='模板分类')).to_have_value('pmp')
    form.get_by_role('combobox', name='模板分类').select_option('cspm')
    form.get_by_role('button', name='取消编辑', exact=True).click()
    expect(form).to_have_count(0)
    assert not any(method in ('POST', 'PATCH') for method, _ in requests), 'cancelling maintenance cannot mutate'
    first.locator('summary').click()
    for width, columns in [(1440, 4), (1100, 3), (800, 2), (390, 1)]:
        page.set_viewport_size({'width': width, 'height': 1000})
        assert center.locator('.template-gallery').evaluate('(e)=>getComputedStyle(e).gridTemplateColumns.split(" ").length') == columns
        assert center.evaluate('(e)=>e.scrollWidth<=e.clientWidth+1'), 'no horizontal overflow'
        if width in (1440, 390):
            page.screenshot(path=str(out / ('desktop.png' if width == 1440 else 'narrow.png')))
    page.set_viewport_size({'width': 1440, 'height': 1000})
    first.get_by_role('button', name='预览', exact=True).click()
    preview = page.locator('.template-preview-window')
    expect(preview.locator('svg')).to_be_visible()
    view = preview.locator('svg').get_attribute('viewBox')
    preview.get_by_role('button', name='放大预览').click()
    assert preview.locator('svg').get_attribute('viewBox') != view
    page.keyboard.press('Delete')
    assert page.evaluate('JSON.stringify({graph:state,history:KGGraphKernel.history.getState()})') == before
    assert not receipts
    preview.get_by_role('button', name='关闭模板预览', exact=True).click()
    first.locator('[data-template-load]').click()
    expect(center.locator('[role=status]')).to_contain_text('副本响应暂时失败')
    center.locator('[data-template-category=prince2]').click()
    center.locator('[data-template-category=pmp]').click()
    first.locator('[data-template-load]').click()
    expect(first.locator('[data-template-result]')).to_be_visible()
    assert len(receipts) == 1, 'filter rerenders must keep the same load receipt'
    copy = first.locator('[data-template-result]').get_attribute('data-template-result')
    assert page.evaluate('galleryCurrent') == 'source', 'loading alone does not switch the current graph'
    first.locator('[data-template-result]').click()
    expect(center).to_have_count(0)
    assert page.evaluate('galleryCurrent') == copy
    setup()
    assert page.evaluate('galleryCurrent') == copy, 'fixture file store restores the chosen copy after reload'
    assert not errors, errors
    (out / 'result.json').write_text(json.dumps({'pass': True, 'apiRequests': len(requests), 'copies': len(receipts), 'pageErrors': errors}, indent=2))
    browser.close()
print('PASS source gallery: 4/3/2/1 columns, categories/search/reset, real readonly renderer, thumbnail/catalog retry, non-mutating preview, receipt reuse and fixture reload')
