#!/usr/bin/env python3
"""Chrome checks the approved lobby control skin using the real page and CSS cascade.

Business responses are explicit drawer fixtures; the API-backed workflow companion is
practice-lobby-design-browser.py. No production or UAT data is read or written.
"""
import argparse
import json
from pathlib import Path
import re
from playwright.sync_api import expect

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / 'artifacts/graph-batch-subject-fix'
OUT.mkdir(parents=True, exist_ok=True)
parser = argparse.ArgumentParser()
parser.add_argument('--capture', choices=['before', 'after'], default='after')
args = parser.parse_args()
fixture = Path(__file__).with_name('practice-mark-show-answers-browser.py')
setup = fixture.read_text().split('    # ---------- 场景 1：')[0]
setup = setup.replace('    "src/100-practice-mode.js",', '    "src/119-question-comments.js",\n    "src/120-question-favorites.js",\n    "src/100-practice-mode.js",')
setup = setup.replace('viewport={"width": 1440, "height": 960}', 'viewport={"width": 1505, "height": 1045}')
# Read every linked stylesheet in its actual order, including the global skin.
start = setup.index('    for stylesheet in [')
end = setup.index('    for script in SCRIPTS:', start)
setup = setup[:start] + '''    for stylesheet in re.findall(r'<link[^>]+href="([^"]+\\.css)"', (ROOT / "practice-mode.html").read_text()):
        page.add_style_tag(content=(ROOT / stylesheet).read_text(encoding="utf-8"))
''' + setup[end:]
scenario = '''
    page.emulate_media(reduced_motion='reduce')
    assert page.locator('#practiceRecentPanel').count() == 0
    assert page.locator('.practice-recent').count() == 0
    assert page.locator('[data-lobby-open="reports"]').count() == 0
    for selector in ['#practiceHistoryOpenBtn', '#practiceFavoritesOpenBtn']:
        expect(page.locator(selector)).to_have_count(1)
        expect(page.locator(selector)).to_be_visible()
        expect(page.locator(selector)).to_be_enabled()
    page.evaluate("""()=>{
      KGPracticeLearningApi.listSessions=async()=>[
        {sessionId:'resume-1',paperId:'paper-1',paperName:'PMP 模拟卷',mode:'practice',createdAt:'2024-12-28T11:40:00Z',status:'paused',total:20,answered:8,correct:6},
        {sessionId:'report-1',paperId:'paper-1',paperName:'PMP 模拟卷',mode:'challenge',createdAt:'2024-12-26T06:12:00Z',status:'completed',reportAvailable:true,total:10,answered:10,correct:8}];
    }""")
    page.locator('#practiceHistoryOpenBtn').click()
    expect(page.locator('#practiceHistoryDrawer')).to_be_visible()
    expect(page.locator('.practice-history-group')).to_have_count(1)
    page.locator('.practice-history-group summary').click()
    expect(page.locator('[data-history-resume="resume-1"]')).to_be_visible()
    expect(page.locator('[data-history-session="report-1"]')).to_be_visible()
    page.keyboard.press('Escape')
    expect(page.locator('#practiceHistoryDrawer')).to_be_hidden()
    favorites={'failed':False,'rows':[{'questionId':'favorite-1','stemText':'如何处理已识别风险？','favoritedAt':'2024-12-26T06:12:00Z'}]}
    def favorite_response(route):
        route.fulfill(status=503,json={'detail':'offline'}) if favorites['failed'] else route.fulfill(json={'favorites':favorites['rows'],'nextCursor':None})
    page.route('**/api/v1/question-favorites?*',favorite_response)
    page.route('**/api/v1/question-comments/favorites*',lambda route:route.fulfill(json={'comments':[],'nextCursor':None}))
    page.locator('#practiceFavoritesOpenBtn').click()
    expect(page.locator('#practiceFavoritesDrawer')).to_be_visible()
    expect(page.locator('#practiceFavoritesList [data-favorite-item]')).to_have_count(1)
    favorites['failed']=True
    page.locator('#practiceFavoritesRetry').click()
    expect(page.locator('#practiceFavoritesList [data-favorite-item]')).to_have_count(0)
    expect(page.locator('#practiceFavoritesEmpty')).to_be_visible()
    favorites['failed']=False
    page.locator('#practiceFavoritesRetry').click()
    expect(page.locator('#practiceFavoritesList [data-favorite-item]')).to_have_count(1)
    page.locator('[data-favorites-kind="comments"]').click()
    expect(page.locator('[data-favorites-kind="comments"]')).to_have_attribute('aria-pressed','true')
    expect(page.locator('#practiceFavoritesEmpty')).to_be_visible()
    expect(page.locator('#practiceFavoritesSummary')).not_to_contain_text('失败')
    page.keyboard.press('Escape')
    expect(page.locator('#practiceFavoritesDrawer')).to_be_hidden()
    page.mouse.move(0,0)
    page.evaluate('scrollTo(0,0)')
    page.screenshot(path=str(OUT / ('ui-'+args.capture+'-desktop.png')), full_page=True)
    def styles(selector):
        return page.locator(selector).evaluate("""e=>{const s=getComputedStyle(e);return Object.fromEntries(['borderRadius','boxShadow','backgroundColor','color','opacity','pointerEvents','transform'].map(k=>[k,s[k]]))}""")
    observed={selector:styles(selector) for selector in ['#practiceHistoryOpenBtn','#practiceFavoritesOpenBtn']}
    cards=page.locator('.practice-mode-card').evaluate_all('(es)=>es.map(e=>({class:e.className,height:e.getBoundingClientRect().height,y:e.getBoundingClientRect().y}))')
    (OUT / ('ui-'+args.capture+'-computed.json')).write_text(json.dumps({'controls':observed,'cards':cards},ensure_ascii=False,indent=2))
    for selector,s in observed.items():
        assert s['opacity']=='1' and s['pointerEvents']!='none',(selector,'available navigation must not appear disabled',s)
        before=page.locator(selector).bounding_box()
        page.locator(selector).hover()
        after=page.locator(selector).bounding_box()
        assert abs(before['width']-after['width'])<.1 and abs(before['height']-after['height'])<.1,(selector,'hover must preserve control size')
        page.locator(selector).focus();expect(page.locator(selector)).to_be_focused()
    assert len(cards)==4 and len(set(round(c['height'],2) for c in cards))==1,('mode card heights',cards)
    page.set_viewport_size({'width':390,'height':844})
    # Let Chrome complete responsive layout before checking header geometry.
    page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    # Compare both rectangles in one rendered frame; separate protocol reads can straddle a resize.
    page.wait_for_function("""()=>{const trigger=document.querySelector('#authStatus');return trigger.querySelector('.account-menu-chevron').getBoundingClientRect().right<=trigger.getBoundingClientRect().right}""", timeout=5000)
    page.wait_for_function('document.documentElement.scrollWidth<=innerWidth', timeout=5000)
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.screenshot(path=str(OUT / ('ui-'+args.capture+'-mobile.png')),full_page=True)
    # Every mobile header action must be reachable through native horizontal scroll.
    for width in [320, 390, 768]:
        page.set_viewport_size({'width':width,'height':844})
        page.evaluate("document.querySelector('.practice-sidebar-nav').scrollLeft=0")
        for action in page.locator('.practice-sidebar-nav button').all():
            action.scroll_into_view_if_needed()
            box=action.bounding_box()
            assert box and box['x']>=0 and box['x']+box['width']<=width, ('unreachable header action',width,action.get_attribute('id'),box)

    # The compact account entry remains usable, including before auth label hydration.
    page.add_script_tag(content=(ROOT / 'src/41-account-menu.js').read_text())
    page.locator('#authStatus').click()
    expect(page.locator('#accountMenu')).to_be_visible()
    page.keyboard.press('Escape')
    expect(page.locator('#accountMenu')).to_be_hidden()
    assert not errors,errors
    browser.close()
print('practice lobby fidelity: no duplicate panel, sidebar history/favorites/comment category, error/retry/empty, 4 equal mode cards and mobile navigation passed')
'''
exec(compile(setup + scenario, str(Path(__file__)), 'exec'))
