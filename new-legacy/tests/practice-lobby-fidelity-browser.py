#!/usr/bin/env python3
"""Chrome checks the approved lobby control skin using the real page and CSS cascade.

Business responses are explicit DOM fixtures; the API-backed workflow companion is
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
setup = setup.replace('    "src/100-practice-mode.js",', '    "src/practice/lobby-dashboard.js",\n    "src/100-practice-mode.js",')
setup = setup.replace('viewport={"width": 1440, "height": 960}', 'viewport={"width": 1505, "height": 1045}')
# Read every linked stylesheet in its actual order, including the global skin.
start = setup.index('    for stylesheet in [')
end = setup.index('    for script in SCRIPTS:', start)
setup = setup[:start] + '''    for stylesheet in re.findall(r'<link[^>]+href="([^"]+\\.css)"', (ROOT / "practice-mode.html").read_text()):
        page.add_style_tag(content=(ROOT / stylesheet).read_text(encoding="utf-8"))
''' + setup[end:]
scenario = '''
    page.emulate_media(reduced_motion='reduce')
    # Preserve the real rendered DOM, isolate dashboard events for callback checks.
    page.evaluate("""()=>{
      const root=document.querySelector('.practice-main');const copy=root.cloneNode(true);root.replaceWith(copy);
      window.__actions=[];window.__fail=false;
      window.__rows=[{sessionId:'resume-1',paperName:'PMP 敏捷精讲题20题',createdAt:'2024-12-28T11:40:00Z',status:'paused',total:20,answered:8,correct:6,durationMs:1680000},
        {sessionId:'report-1',paperName:'PMP 预测精讲综合练习10题',createdAt:'2024-12-26T06:12:00Z',status:'completed',reportAvailable:true,total:10,answered:10,correct:8,durationMs:360000}];
      const api=window.KGPracticeLobbyDashboard.create({root:copy,getUser:()=> 'fixture-user',getHistory:async()=>{if(window.__fail)throw Error('offline');return window.__rows},getFavorites:async()=>({favorites:[{questionId:'favorite-1',stemText:'如何处理已识别风险？',favoritedAt:'2024-12-26T06:12:00Z'}]}),
        onResume:id=>__actions.push(['resume',id]),onReport:id=>__actions.push(['report',id]),onFavorite:id=>__actions.push(['favorite',id]),onHistory:()=>__actions.push(['history']),onFavorites:()=>__actions.push(['favorites']),onSettings:()=>{}});
      window.__dashboard=api;api.refresh();
    }""")
    expect(page.locator('#practiceRecentBody tr')).to_have_count(2)
    assert page.locator('[data-lobby-open="reports"]').count() == 0
    assert page.locator('#practiceHistoryOpenBtn').count() == 1
    page.wait_for_timeout(800)
    page.mouse.move(0,0)
    page.evaluate('scrollTo(0,0)')
    page.screenshot(path=str(OUT / ('ui-'+args.capture+'-desktop.png')), full_page=True)
    page.locator('.practice-recent').screenshot(path=str(OUT / ('ui-'+args.capture+'-recent.png')))
    def styles(selector):
        return page.locator(selector).evaluate("""e=>{const s=getComputedStyle(e);return Object.fromEntries(['borderTopWidth','borderRightWidth','borderBottomWidth','borderBottomColor','borderLeftWidth','borderRadius','boxShadow','backgroundColor','fontSize','fontFamily','fontWeight','paddingTop','paddingRight','paddingBottom','paddingLeft','transform'].map(k=>[k,s[k]]))}""")
    observed={selector:styles(selector) for selector in ['#practiceRecentHistoryTab','#practiceRecentFavoritesTab','.practice-recent-more','[data-recent-resume]','[data-recent-report]']}
    cards=page.locator('.practice-mode-card').evaluate_all('(es)=>es.map(e=>({class:e.className,height:e.getBoundingClientRect().height,y:e.getBoundingClientRect().y}))')
    (OUT / ('ui-'+args.capture+'-computed.json')).write_text(json.dumps({'controls':observed,'cards':cards},ensure_ascii=False,indent=2))
    for selector,s in observed.items():
        assert s['borderRadius']=='0px',(selector,'rounded control',s)
        assert s['boxShadow']=='none',(selector,'global button outline/shadow',s)
        assert s['borderTopWidth']==s['borderRightWidth']==s['borderLeftWidth']=='0px',(selector,s)
        assert s['backgroundColor']=='rgba(0, 0, 0, 0)',(selector,s)
        assert s['transform']=='none',(selector,s)
        assert s['fontSize']==('14px' if 'Tab' in selector else '11px'),(selector,s)
        assert s['paddingLeft']==s['paddingRight']=='0px',(selector,s)
        if 'Tab' in selector:
            assert s['borderBottomWidth']=='2px' and s['paddingTop']=='0px' and s['paddingBottom']=='10px',(selector,s)
        elif selector!='.practice-recent-more':
            assert s['borderBottomWidth']=='0px' and s['paddingTop']==s['paddingBottom']=='4px',(selector,s)
        page.locator(selector).hover()
        hover=styles(selector)
        assert hover['boxShadow']=='none' and hover['transform']=='none',(selector,'hover regression',hover)
    assert len(set(round(c['height'],2) for c in cards))==1,('mode card heights',cards)
    page.locator('#practiceRecentHistoryTab').focus()
    page.keyboard.press('ArrowRight')
    expect(page.locator('#practiceRecentFavoritesTab')).to_have_attribute('aria-selected','true')
    expect(page.locator('#practiceRecentFavoritesTab')).to_be_focused()
    expect(page.locator('#practiceRecentFavoritesTab')).to_have_css('border-bottom-color','rgb(118, 81, 238)')
    expect(page.locator('[data-recent-favorite]')).to_have_count(1)
    page.locator('[data-recent-favorite]').click()
    page.keyboard.press('Home')
    page.locator('#practiceRecentFavoritesTab').focus();page.keyboard.press('Home')
    expect(page.locator('#practiceRecentHistoryTab')).to_have_attribute('aria-selected','true')
    page.locator('[data-recent-resume]').click();page.locator('[data-recent-report]').click()
    assert page.evaluate('__actions')==[['favorite','favorite-1'],['resume','resume-1'],['report','report-1']]
    page.evaluate('__fail=true');page.locator('#practiceRecentFavoritesTab').click();page.locator('#practiceRecentHistoryTab').click()
    expect(page.locator('[data-recent-retry]')).to_be_visible();expect(page.locator('#practiceRecentBody tr')).to_have_count(0)
    page.evaluate('__fail=false');page.locator('[data-recent-retry]').click();expect(page.locator('#practiceRecentBody tr')).to_have_count(2)
    page.evaluate('__rows=[]');page.evaluate('__dashboard.refresh()');expect(page.locator('.practice-recent-table')).to_be_hidden()
    expect(page.locator('#practiceRecentStatus')).to_contain_text('完成或保存')
    page.set_viewport_size({'width':390,'height':844})
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

    assert not errors,errors
    browser.close()
print('practice lobby fidelity: 5 control computed/hover skins, 4 equal mode cards, keyboard tabs, 3 action callbacks, error/retry/empty and mobile passed')
'''
exec(compile(setup + scenario, str(Path(__file__)), 'exec'))
