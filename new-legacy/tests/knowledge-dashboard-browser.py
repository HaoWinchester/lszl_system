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
    # A missing optional scene asset differs from an unavailable Canvas context.
    missing=context.new_page()
    missing.set_content('<button id="open" data-knowledge-dashboard-open>知识星空</button>')
    missing.add_style_tag(path=str(ROOT/'new-legacy/styles/knowledge-dashboard.css'))
    missing.evaluate("""()=>{window.fallbackCalls=0;KGAuthCore={currentUser:()=>({username:'fallback'})};KGDomainApi={request:async()=>{fallbackCalls++;return {attemptCount:3,nodes:[{id:'one',title:'第一个考点',subject:'PMP',path:['PMP','过程','第一个考点'],attemptCount:1},{id:'two',title:'第二个考点',subject:'PMP',path:['PMP','过程','第二个考点'],attemptCount:2}]}}}}""")
    missing.add_script_tag(path=str(ROOT/'new-legacy/src/practice/knowledge-dashboard.js'))
    missing.click('#open')
    expect(missing.locator('[data-knowledge-list] button')).to_have_count(2)
    expect(missing.locator('[data-knowledge-status]')).to_contain_text('列表')
    expect(missing.locator('[data-knowledge-retry]')).not_to_be_visible()
    assert missing.locator('[data-knowledge-focus-subject]').evaluate('e=>getComputedStyle(e).color')=='rgb(129, 147, 168)'
    missing.click('[data-knowledge-details-open]')
    missing.locator('[data-knowledge-list] button').nth(1).click()
    expect(missing.locator('[data-knowledge-detail-title]')).to_have_text('第二个考点')
    expect(missing.locator('[data-knowledge-focus-title]')).to_have_text('第二个考点')
    expect(missing.locator('[data-knowledge-detail-attempts]')).to_have_text('2 次')
    expect(missing.locator('[data-knowledge-focus-attempts]')).to_have_text('2 次')
    missing.keyboard.press('Escape')
    expect(missing.locator('[data-knowledge-details-open]')).to_be_focused()
    assert missing.locator('canvas').count()==0 and missing.evaluate('fallbackCalls')==1
    missing.add_script_tag(path=str(ROOT/'new-legacy/src/practice/knowledge-space-scene.js'))
    missing.click('[data-knowledge-refresh]')
    expect(missing.locator('canvas')).to_have_count(1)
    expect(missing.locator('[data-knowledge-list] button')).to_have_count(2)
    expect(missing.locator('[data-knowledge-retry]')).not_to_be_visible()
    assert missing.evaluate('fallbackCalls')==2
    missing.close()
    checks.append('missing optional scene script retains catalog, neutral inline color, usable child selection and refresh recovery after scene loads')
    page=context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.set_content('<!doctype html><html lang="zh"><body><button id="open" data-knowledge-dashboard-open>星空知识网络</button></body></html>')
    # Exercise the actual homepage cascade, including its unrelated graph stage.
    page.add_style_tag(path=str(ROOT/'new-legacy/styles/main.css'))
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
        if(mode==='unknown')return {nodes:[],topicCount:0,attemptCount:51,unknownAttemptCount:23,unmappedAttemptCount:28};
        if(mode==='historical')return {nodes:Array.from({length:317},(_,i)=>({id:'current-'+i,parentId:null,title:i===0?'长考点标题：项目团队与相关方沟通、风险识别和持续改进的完整知识路径':'当前目录 '+i,path:['当前目录','长路径：团队协作与项目交付过程中的知识组织和练习记录'],attemptCount:0})),topicCount:317,attemptCount:51,unknownAttemptCount:23,unmappedAttemptCount:28};
        if(mode==='ancestry')return {nodes:[{id:'parent',parentId:null,title:'父节点',attemptCount:0},{id:'child',parentId:'parent',title:'子节点',attemptCount:1},{id:'unlit',parentId:null,title:'未练习',attemptCount:0}],attemptCount:1};
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
    assert page.locator('#kgKnowledgeDashboard .ui > section').last.evaluate("e=>{const s=getComputedStyle(e);return s.backgroundColor==='rgba(0, 0, 0, 0)'&&s.backgroundImage==='none'}"), 'homepage graph stage background must not cover the star field'
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
    page.locator('[data-knowledge-details-open]').click()

    buttons=page.locator('[data-knowledge-list] button')
    expect(buttons).to_have_count(81)
    buttons.nth(1).focus();page.keyboard.press('Enter')
    expect(page.locator('[data-knowledge-detail-title]')).to_have_text('<img src=x onerror="window.injected=true">')
    assert snap()['selected']==1 and page.locator('dialog img').count()==0 and not page.evaluate('!!window.injected')
    expect(buttons.nth(1)).to_have_attribute('aria-pressed','true')
    page.locator('[data-knowledge-node-next]').click();assert snap()['selected']==2
    page.locator('[data-knowledge-node-prev]').click();assert snap()['selected']==1
    page.locator('[data-knowledge-details-close]').click()
    page.locator('[data-knowledge-group]').nth(2).click()
    state=snap();assert state['group']=='["产品管理","<分类>","项目"]' and state['selected']==30
    assert sum(p['visible'] for p in state['positions'])==51
    expect(page.locator('[data-knowledge-detail-subject]')).to_have_text('产品管理')
    page.locator('[data-knowledge-details-open]').click()
    assert page.locator('[data-knowledge-list] button:visible').count()==51
    page.locator('[data-knowledge-node-prev]').click();assert snap()['selected']==80
    page.locator('[data-knowledge-details-close]').click()
    page.locator('[data-knowledge-reset]').click();assert snap()['group']==''
    zoom=snap()['camera']['zoom'];page.locator('[data-knowledge-zoom-out]').click();assert snap()['camera']['zoom']<zoom
    page.locator('[data-knowledge-zoom-in]').click();assert abs(snap()['camera']['zoom']-zoom)<.001
    yaw=snap()['camera']['yaw'];page.locator('[data-knowledge-rotate-left]').focus();page.keyboard.press('Enter');assert snap()['camera']['yaw']!=yaw
    page.locator('[data-knowledge-reset]').click();assert snap()['camera']['yaw']==.10

    page.wait_for_function('!scenes.at(-1).snapshot().running')
    page.evaluate('scenes.at(-1).zoomBy(1.5)');page.wait_for_function('!scenes.at(-1).snapshot().running')
    state=snap();box=page.locator('canvas').bounding_box()
    point=next(p for p in state['positions'] if 20<p['x']<box['width']-20 and 160<p['y']<box['height']-200 and page.evaluate('(p)=>document.elementFromPoint(p.x,p.y)?.tagName==="CANVAS"',{'x':box['x']+p['x'],'y':box['y']+p['y']}))
    page.mouse.click(box['x']+point['x'],box['y']+point['y'])
    chosen=snap()['selected'];assert chosen!=80
    expect(page.locator('[data-knowledge-detail-title]')).to_have_text(page.evaluate('nodes[scenes.at(-1).snapshot().selected].title'))
    assert page.evaluate('calls.length')==calls, 'selection, group and camera must never refetch'
    checks.append('real 3D projection, safe labels, semantic list keyboard selection, pointer/detail sync, group traversal and camera controls')
    checks.append('whole catalog API contract retains all 81 nodes without pagination')
    # Star selection leaves the child closed; explicit details retains layered Escape.
    expect(page.locator('.kg-knowledge-detail')).not_to_be_visible()
    page.locator('[data-knowledge-details-open]').click()
    # Native modal containment covers forward/backward Tab and Escape return focus.
    page.keyboard.press('Escape');expect(dialog).to_be_visible()
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
    expect(page.locator('[data-knowledge-status]')).to_have_text('当前暂无已发布的知识目录。')
    assert page.locator('canvas').count()==0
    page.evaluate("mode='historical';void KGKnowledgeDashboard.open()")
    expect(page.locator('[data-knowledge-list] li')).to_have_count(317)
    expect(page.locator('[data-knowledge-summary]')).to_contain_text('累计 51 次作答 · 317 个目录节点 · 已点亮 0 个')
    expect(page.locator('[data-knowledge-summary]')).to_contain_text('23 次作答暂无考点引用')
    expect(page.locator('[data-knowledge-summary]')).to_contain_text('28 次作答未映射到当前目录')
    page.evaluate("mode='ancestry';void KGKnowledgeDashboard.open()")
    expect(page.locator('[data-knowledge-summary]')).to_contain_text('3 个目录节点 · 已点亮 2 个')
    checks.append('real-response shape 317 nodes/51 historical attempts/23 unknown/28 unmapped shows zero lit; ancestor illumination counted; empty catalog with history stays honest')
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
    page.evaluate("mode='historical';void KGKnowledgeDashboard.init().refresh()")
    expect(page.locator('[data-knowledge-list] button')).to_have_count(317)
    for width,height in ((1440,960),(559,854),(390,844),(390,568)):
        page.set_viewport_size({'width':width,'height':height})
        page.locator('[data-knowledge-details-open]').click()
        child=page.locator('.kg-knowledge-detail')
        expect(child).to_be_visible()
        assert child.bounding_box()['width']>=min(1000,width-50)
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        assert child.evaluate('e=>e.scrollWidth<=e.clientWidth')
        for control in child.locator('.kg-knowledge-step button').all():
            bounds=control.bounding_box();assert 44<=bounds['height']<=70, bounds
        if width>850:
            cb=child.bounding_box();lb=page.locator('[data-knowledge-list]').bounding_box()
            assert lb['y']+lb['height']<=cb['y']+cb['height']-10, (cb,lb)
        assert child.evaluate('e=>[...e.querySelectorAll("button")].filter(b=>b.getClientRects().length).every(b=>b.getBoundingClientRect().height>=44)')
        listing=page.locator('[data-knowledge-list]');listing.scroll_into_view_if_needed()
        listing.evaluate('e=>e.scrollTop=0');r=listing.bounding_box()
        page.mouse.move(r['x']+r['width']/2,r['y']+min(r['height']/2,150));page.mouse.wheel(0,260);page.wait_for_timeout(180)
        assert listing.evaluate('e=>e.scrollTop')>0, 'native child list wheel scroll'
        page.locator('[data-knowledge-list] button').last.click()
        page.locator('[data-knowledge-node-prev]').click()
        page.keyboard.press('Escape');expect(child).not_to_be_visible();expect(dialog).to_be_visible()
        expect(page.locator('[data-knowledge-details-open]')).to_be_focused()
        page.locator('[data-knowledge-details-open]').click()
        page.evaluate("dispatchEvent(new Event('kg-auth-session-change'))")
        expect(child).not_to_be_visible()
        shell=page.locator('.kg-knowledge-shell');shell.evaluate('e=>e.scrollTop=0')
        assert dialog.evaluate('e=>e.scrollWidth<=e.clientWidth&&e.querySelector(".kg-knowledge-shell").scrollWidth<=e.querySelector(".kg-knowledge-shell").clientWidth')
        before=shell.evaluate('e=>e.scrollTop');camera=snap()['camera'];r=shell.bounding_box()
        page.mouse.move(r['x']+r['width']/2,r['y']+r['height']/2);page.mouse.wheel(0,300);page.wait_for_timeout(180)
        if shell.evaluate('e=>e.scrollHeight>e.clientHeight'):assert shell.evaluate('e=>e.scrollTop')>before
        assert snap()['camera']==camera
        if height<600:
            shell.evaluate('e=>e.scrollTop=0');cdp=context.new_cdp_session(page)
            x=r['x']+r['width']/2;y=r['y']+r['height']/2
            cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x,'y':y,'id':1}]})
            for step in range(1,9):
                cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x,'y':y-step*12,'id':1}]});page.wait_for_timeout(20)
            cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]});page.wait_for_timeout(180)
            assert shell.evaluate('e=>e.scrollTop')>0 and snap()['camera']==camera, f'native vertical touch scroll must preserve camera: scroll={shell.evaluate("e=>e.scrollTop")}, before={camera}, after={snap()["camera"]}'
            cdp.detach()
        page.locator('[data-knowledge-close]').scroll_into_view_if_needed()
        close_box=page.locator('[data-knowledge-close]').bounding_box();box=dialog.bounding_box()
        assert box['y']<=close_box['y'] and close_box['y']+close_box['height']<=box['y']+box['height']
        page.screenshot(path=str(OUT/f'dashboard-{width}.png'))
        checks.append(f'{width}px spacious modal list, prev/next, child Escape and account invalidation')
    page.evaluate("mode='ready'")
    page.locator('[data-knowledge-close]').click();expect(page.locator('#open')).to_be_focused();page.wait_for_function('scenes.at(-1).snapshot().destroyed')
    page.locator('#open').click();page.evaluate("document.querySelector('dialog').close()")
    expect(page.locator('#open')).to_be_focused();page.wait_for_function('scenes.at(-1).snapshot().destroyed')
    page.locator('#open').click();page.evaluate("dispatchEvent(new Event('pagehide'))");assert snap()['destroyed']
    checks.append('button close, external native close and pagehide destroy scene and clear owner data')
    # A device without a Canvas context must retain accessible data and controls.
    page.evaluate("KGKnowledgeDashboard.close();HTMLCanvasElement.prototype.getContext=()=>null")
    page.locator('#open').click()
    page.locator('[data-knowledge-details-open]').click()
    expect(page.locator('[data-knowledge-list]')).to_be_visible()
    expect(page.locator('[data-knowledge-status]')).to_contain_text('列表')
    page.locator('[data-knowledge-list] button').nth(3).click()
    expect(page.locator('[data-knowledge-detail-title]')).to_have_text('项目考点 4')
    assert page.locator('canvas').count()==0
    # Physical clicks must reach fallback pagination, rather than an overlapping detail overlay.
    for fallback_width in (1440,390):
        page.set_viewport_size({'width':fallback_width,'height':900})
        page.locator('[data-knowledge-details-close]').click()
        page.locator('[data-knowledge-group]').nth(2).click(timeout=1500)
        expect(page.locator('[data-knowledge-detail-subject]')).to_have_text('产品管理')
        page.locator('[data-knowledge-refresh]').click(timeout=1500)
        page.locator('[data-knowledge-details-open]').click()
        expect(page.locator('[data-knowledge-list]')).to_be_visible()
    checks.append('Canvas fallback desktop/mobile physical group, all catalog and refresh controls remain unobstructed')
    page.locator('[data-knowledge-details-close]').click()
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
