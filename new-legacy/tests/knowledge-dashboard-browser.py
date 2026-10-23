"""Exercise the real scene and dashboard with API-shaped, isolated account fixtures."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/star-original-restore-20261020/ui'
OUT.mkdir(parents=True, exist_ok=True)
checks = []
with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True, channel='chrome')
    context=browser.new_context(viewport={'width':1440,'height':960},reduced_motion='reduce',has_touch=True)
    page=context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.set_content('<!doctype html><html lang="zh"><body><button id="open" data-knowledge-dashboard-open>星空知识网络</button></body></html>')
    page.add_style_tag(path=str(ROOT/'new-legacy/styles/knowledge-dashboard.css'))
    page.evaluate('''() => {
      window.owner='A'; window.KGAuthCore={currentUser:()=>owner?{username:owner}:null};
      window.mode='ready'; window.calls=[];
      window.nodes=Array.from({length:81},(_,i)=>({id:'topic-'+i,title:i===0?'风险管理 <安全>':i===1?'<img src=x onerror="window.injected=true">':'项目考点 '+(i+1),subject:i<30?'PMP':'产品管理',taxonomyId:i<30?'risk':'<分类>',path:['项目',i<30?'风险':'<分类>'],attemptCount:i+3,brightness:.2+(i%9)/10,lastPracticedAt:'2026-10-17T00:00:00Z'}));
      window.KGDomainApi={request: async options => {
        calls.push(options.path); if(mode==='error')throw Error('offline');
        if(mode==='401')throw Object.assign(Error('unauthorized'),{status:401});
        if(mode==='pending')return new Promise(resolve=>window.resolveOld=resolve);
        if(mode==='empty')return {nodes:[],topicCount:0,attemptCount:0};
        if(mode==='unknown')return {nodes:[],topicCount:0,attemptCount:7,unknownAttemptCount:7};
        return {nodes,topicCount:81,attemptCount:200,recentAttemptCount:12,unknownAttemptCount:1};
      }};
    }''')
    page.add_script_tag(path=str(ROOT/'new-legacy/src/practice/knowledge-space-scene.js'))
    # Instrument only ownership; all rendering, picking and camera work use the real module.
    page.evaluate('''() => { const real=KGKnowledgeSpaceScene; window.scenes=[];
      window.KGKnowledgeSpaceScene={...real,mount:options=>{const scene=real.mount(options);if(scene)scenes.push(scene);return scene}};
    }''')
    page.add_script_tag(path=str(ROOT/'new-legacy/src/practice/knowledge-dashboard.js'))
    page.locator('#open').click()
    dialog = page.get_by_role('dialog', name='星空知识网络')
    expect(dialog).to_be_visible()
    expect(page.locator('[data-knowledge-close]')).to_be_focused()
    expect(page.locator('[data-knowledge-network] canvas')).to_have_count(1)
    assert page.locator('[data-knowledge-search],[data-knowledge-unpracticed],[data-knowledge-questions]').count()==0
    page.wait_for_function('scenes.at(-1).snapshot().settled && !scenes.at(-1).snapshot().running')
    snap=lambda:page.evaluate('scenes.at(-1).snapshot()')
    assert len(snap()['positions'])==81 and len(set(p['depth'] for p in snap()['positions']))>10
    expect(page.locator('[data-knowledge-detail-title]')).to_have_text('风险管理 <安全>')
    expect(page.locator('[data-knowledge-page-count]')).to_have_text('全目录 81 个节点')
    expect(page.locator('[data-knowledge-summary]')).to_contain_text('81 个目录节点')
    assert page.evaluate('calls')==['/api/v1/learning/practice/knowledge-universe']
    expect(page.locator('[data-knowledge-groups]')).not_to_contain_text('risk')
    expect(page.locator('[data-knowledge-group]').nth(1)).to_contain_text('PMP · 项目')
    calls=page.evaluate('calls.length')
    page.locator('.kg-knowledge-detail summary').click()
    page.locator('.kg-knowledge-detail').evaluate('(e)=>e.open=true');page.locator('[data-knowledge-list-toggle]').click()
    buttons=page.locator('[data-knowledge-list] button')
    expect(buttons).to_have_count(81)
    buttons.nth(1).focus();page.keyboard.press('Enter')
    expect(page.locator('[data-knowledge-detail-title]')).to_have_text('<img src=x onerror="window.injected=true">')
    assert snap()['selected']==1 and page.locator('dialog img').count()==0 and not page.evaluate('!!window.injected')
    expect(buttons.nth(1)).to_have_attribute('aria-pressed','true')
    page.locator('[data-knowledge-node-next]').click();assert snap()['selected']==2
    page.locator('[data-knowledge-node-prev]').click();assert snap()['selected']==1
    page.locator('[data-knowledge-group]').nth(2).click()
    state=snap();assert state['group']=='["产品管理","<分类>","项目"]' and state['selected']==30
    assert sum(p['visible'] for p in state['positions'])==51
    expect(page.locator('[data-knowledge-detail-subject]')).to_have_text('产品管理')
    assert page.locator('[data-knowledge-list] button:visible').count()==51
    page.locator('[data-knowledge-node-prev]').click();assert snap()['selected']==80
    page.locator('[data-knowledge-reset]').click();assert snap()['group']==''
    zoom=snap()['camera']['zoom'];page.locator('[data-knowledge-zoom-out]').click();assert snap()['camera']['zoom']<zoom
    page.locator('[data-knowledge-zoom-in]').click();assert abs(snap()['camera']['zoom']-zoom)<.001
    yaw=snap()['camera']['yaw'];page.locator('[data-knowledge-rotate-left]').focus();page.keyboard.press('Enter');assert snap()['camera']['yaw']!=yaw
    page.locator('[data-knowledge-reset]').click();assert snap()['camera']['yaw']==.24
    page.locator('.kg-knowledge-detail').evaluate('(e)=>e.open=true');page.locator('[data-knowledge-list-toggle]').click()
    page.wait_for_function('!scenes.at(-1).snapshot().running')
    page.evaluate('scenes.at(-1).zoomBy(1.5)');page.wait_for_function('!scenes.at(-1).snapshot().running')
    state=snap();point=state['positions'][15];box=page.locator('canvas').bounding_box()
    page.mouse.click(box['x']+point['x'],box['y']+point['y'])
    chosen=snap()['selected'];assert chosen!=80
    expect(page.locator('[data-knowledge-detail-title]')).to_have_text(page.evaluate('nodes[scenes.at(-1).snapshot().selected].title'))
    assert page.evaluate('calls.length')==calls, 'selection, group and camera must never refetch'
    checks.append('real 3D projection, safe labels, semantic list keyboard selection, pointer/detail sync, group traversal and camera controls')
    checks.append('whole catalog API contract retains all 81 nodes without pagination')
    # Native modal containment covers forward/backward Tab and Escape return focus.
    page.locator('[data-knowledge-close]').focus();page.keyboard.press('Shift+Tab')
    assert page.evaluate('document.querySelector("dialog").contains(document.activeElement)')
    page.keyboard.press('Escape');expect(dialog).not_to_be_visible();expect(page.locator('#open')).to_be_focused()
    assert snap()['destroyed'] and page.locator('canvas').count()==0
    checks.append('native dialog focus containment, Escape restoration and scene destruction')
    page.evaluate("mode='error'");page.locator('#open').click();expect(page.locator('[data-knowledge-retry]')).to_be_visible()
    assert page.locator('[data-knowledge-list] li').count()==0 and page.locator('canvas').count()==0
    expect(page.locator('[data-knowledge-detail-title]')).to_have_text('选择一个考点')
    page.evaluate("mode='ready'");page.locator('[data-knowledge-retry]').click();expect(page.locator('[data-knowledge-list] li')).to_have_count(81)
    checks.append('network error clears rows/details/canvas and retry recovers')
    page.evaluate("mode='pending';void KGKnowledgeDashboard.open()")
    page.wait_for_function('!!window.resolveOld')
    assert snap()['destroyed'] and page.locator('canvas').count()==0
    expect(page.locator('[data-knowledge-detail-title]')).to_have_text('选择一个考点')
    page.evaluate("owner='B';mode='empty';dispatchEvent(new Event('kg-auth-session-change'))")
    expect(page.locator('[data-knowledge-status]')).to_contain_text('暂无已发布')
    page.evaluate("resolveOld({nodes:[{title:'A private'}],topicCount:1})")
    expect(page.locator('[data-knowledge-list] li')).to_have_count(0)
    assert 'A private' not in dialog.inner_text() and page.locator('canvas').count()==0
    page.evaluate("mode='unknown';void KGKnowledgeDashboard.open()")
    expect(page.locator('[data-knowledge-status]')).to_contain_text('尚未保存可识别')
    assert page.locator('canvas').count()==0
    page.evaluate("mode='401';void KGKnowledgeDashboard.open()")
    expect(page.locator('[data-knowledge-status]')).to_contain_text('登录后')
    assert page.locator('canvas').count()==0
    prior_calls=page.evaluate('calls.length')
    page.evaluate("owner='';dispatchEvent(new Event('kg-auth-session-change'))")
    expect(page.locator('[data-knowledge-status]')).to_contain_text('登录后')
    assert page.evaluate('calls.length')==prior_calls
    page.keyboard.press('Escape');page.locator('#open').click()
    expect(page.locator('[data-knowledge-status]')).to_contain_text('登录后')
    assert page.evaluate('calls.length')==prior_calls
    checks.append('account switch invalidates delayed owner data; unknown/empty/401 show no fake nodes; guests make no requests')
    page.evaluate("owner='B';mode='ready';dispatchEvent(new Event('kg-auth-session-change'))")
    expect(page.locator('[data-knowledge-list] li')).to_have_count(81)
    page.wait_for_function('scenes.at(-1).snapshot().settled && !scenes.at(-1).snapshot().running')
    cdp=context.new_cdp_session(page)
    for width,height in ((1440,960),(1440,650),(390,844),(320,568)):
        page.locator('.kg-knowledge-detail').evaluate('(e)=>e.open=true')
        page.set_viewport_size({'width':width,'height':height})
        page.wait_for_timeout(150)
        page.locator('dialog').evaluate('(e)=>{e.scrollTop=0;e.querySelector(".kg-knowledge-shell").scrollTop=0}')
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        assert dialog.evaluate('(e)=>e.scrollWidth<=e.clientWidth&&e.querySelector(".kg-knowledge-shell").scrollWidth<=e.querySelector(".kg-knowledge-shell").clientWidth'), f'{width}: dialog overflow'
        box=dialog.bounding_box();assert box['x']>=0 and box['x']+box['width']<=width
        assert dialog.evaluate('e=>[...e.querySelectorAll("button")].filter(b=>b.getClientRects().length).every(b=>b.getBoundingClientRect().height>=44)'), f'{width}: button touch height'
        shell=page.locator('.kg-knowledge-shell');shell.evaluate('e=>e.scrollTop=0')
        canvas=page.locator('canvas');canvas.scroll_into_view_if_needed();page.wait_for_timeout(150)
        cb=canvas.bounding_box();sb=shell.bounding_box();x=cb['x']+cb['width']/2;y=(max(cb['y'],sb['y'])+min(cb['y']+cb['height'],sb['y']+sb['height']))/2
        before=shell.evaluate('e=>e.scrollTop');camera=snap()['camera'];background=page.evaluate('scrollY')
        page.mouse.move(x,y);page.mouse.wheel(0,300);page.wait_for_timeout(250)
        assert shell.evaluate('e=>e.scrollTop')>before and snap()['camera']==camera and page.evaluate('scrollY')==background
        shell.evaluate('e=>e.scrollTop=0');canvas.scroll_into_view_if_needed();page.wait_for_timeout(150)
        cb=canvas.bounding_box();sb=shell.bounding_box();y=(max(cb['y'],sb['y'])+min(cb['y']+cb['height'],sb['y']+sb['height']))/2;before=shell.evaluate('e=>e.scrollTop')
        cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x,'y':y,'id':1}]})
        for step in range(1,11):
            cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x,'y':y-step*15,'id':1}]});page.wait_for_timeout(20)
        cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]});page.wait_for_timeout(350)
        assert shell.evaluate('e=>e.scrollTop')>before and snap()['camera']==camera
        page.screenshot(path=str(OUT/f'dashboard-{width}.png'))
        page.locator('[data-knowledge-node-next]').scroll_into_view_if_needed()
        page.screenshot(path=str(OUT/f'detail-{width}.png'))
        if width<=390:
            close_box=page.locator('[data-knowledge-close]').bounding_box()
            assert close_box['y']>=box['y'] and close_box['y']+close_box['height']<=box['y']+box['height'], f'{width}: close must remain visible after scrolling to detail'
            page.locator('.kg-knowledge-detail').evaluate('(e)=>e.open=true');page.locator('[data-knowledge-list-toggle]').click()
            page.locator('[data-knowledge-list] button').last.scroll_into_view_if_needed()
            close_box=page.locator('[data-knowledge-close]').bounding_box()
            assert close_box['y']>=box['y'], f'{width}: close must remain visible while list scrolls'
            # Use physical coordinates so Playwright cannot silently scroll a hidden close into view.
            page.mouse.click(close_box['x']+close_box['width']/2,close_box['y']+close_box['height']/2)
            expect(dialog).not_to_be_visible();expect(page.locator('#open')).to_be_focused();assert snap()['destroyed']
            page.locator('#open').click()
            page.locator('.kg-knowledge-detail').evaluate('(e)=>e.open=true');page.locator('[data-knowledge-list-toggle]').click()
            page.locator('canvas').scroll_into_view_if_needed()
            page.wait_for_function('scenes.at(-1).snapshot().settled && !scenes.at(-1).snapshot().running')
        checks.append(f'{width}px screenshot, no horizontal overflow, 44px controls')
    page.locator('[data-knowledge-close]').click();expect(page.locator('#open')).to_be_focused();page.wait_for_function('scenes.at(-1).snapshot().destroyed')
    page.locator('#open').click();page.evaluate("document.querySelector('dialog').close()")
    expect(page.locator('#open')).to_be_focused();page.wait_for_function('scenes.at(-1).snapshot().destroyed')
    page.locator('#open').click();page.evaluate("dispatchEvent(new Event('pagehide'))");assert snap()['destroyed']
    checks.append('button close, external native close and pagehide destroy scene and clear owner data')
    # A device without a Canvas context must retain accessible data and controls.
    page.evaluate("KGKnowledgeDashboard.close();HTMLCanvasElement.prototype.getContext=()=>null")
    page.locator('#open').click()
    expect(page.locator('[data-knowledge-list]')).to_be_visible()
    expect(page.locator('[data-knowledge-status]')).to_contain_text('列表')
    page.locator('[data-knowledge-list] button').nth(3).click()
    expect(page.locator('[data-knowledge-detail-title]')).to_have_text('项目考点 4')
    assert page.locator('canvas').count()==0
    # Physical clicks must reach fallback pagination, rather than an overlapping detail overlay.
    for fallback_width in (1440,390):
        page.set_viewport_size({'width':fallback_width,'height':900})
        page.locator('[data-knowledge-group]').nth(2).click(timeout=1500)
        expect(page.locator('[data-knowledge-detail-subject]')).to_have_text('产品管理')
        page.locator('[data-knowledge-refresh]').click(timeout=1500)
        expect(page.locator('[data-knowledge-list]')).to_be_visible()
    checks.append('Canvas fallback desktop/mobile physical group, all catalog and refresh controls remain unobstructed')
    page.evaluate('nodes.forEach(node=>node.path=[])')
    page.locator('[data-knowledge-refresh]').click()
    expect(page.locator('[data-knowledge-group]').nth(1)).to_contain_text('PMP · 未分类')
    expect(page.locator('[data-knowledge-groups]')).not_to_contain_text('risk')
    expect(page.locator('[data-knowledge-detail-path]')).to_have_text('无路径标签')
    checks.append('readable common frozen category paths, honest unnamed fallback and explicit refresh')
    checks.append('Canvas failure retains selectable accessible real data list')
    assert not errors, errors
    browser.close()
(OUT/'results.json').write_text(json.dumps({'checks':checks,'errors':errors},ensure_ascii=False,indent=2))
print(json.dumps({'passed':len(checks),'checks':checks},ensure_ascii=False))
