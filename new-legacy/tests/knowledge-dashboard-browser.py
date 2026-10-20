"""Exercise the real scene and dashboard with API-shaped, isolated account fixtures."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/knowledge-universe-20261020/task-4'
OUT.mkdir(parents=True, exist_ok=True)
checks = []
with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True, channel='chrome')
    context = browser.new_context(viewport={'width': 1440, 'height': 900}, reduced_motion='reduce',has_touch=True)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.set_content('<!doctype html><html lang="zh"><body><button id="open" data-knowledge-dashboard-open>星空知识网络</button><div style="height:2500px"></div></body></html>')
    # Preserve the actual page cascade, including styles loaded after the dashboard.
    import re
    for asset in re.findall(r'href="(styles/[^"]+\.css)"', (ROOT/'new-legacy/practice-mode.html').read_text()):
        page.add_style_tag(path=str(ROOT/'new-legacy'/asset))
    page.evaluate('''() => {
      window.owner='A'; window.KGAuthCore={currentUser:()=>owner?{username:owner}:null};
      window.mode='ready'; window.calls=[];
      window.nodes=Array.from({length:320},(_,i)=>({id:'topic-'+i,title:i===0?'风险管理 <安全>':i===1?'<img src=x onerror="window.injected=true">':'项目考点 '+(i+1),subject:i<160?'PMP':'产品管理',taxonomyId:i<160?'risk':'<分类>',path:['项目',i<160?'风险':'<分类>'],practiced:i<3,attemptCount:i===2?5:i<2?1:0,brightness:i===0?.2:i===1?.2:i===2?.58:.12,proficiencyScore:i===0?0:i===2?47.5:null,proficiencyLevel:i===0?'developing':i===1?'pending':i===2?'familiar':'unpracticed',recentAccuracy:i===0?0:i===2?.8:null,recentGradedAttemptCount:i===0?1:i===2?5:0,correctStreak:i===2?3:0,lastPracticedAt:i<3?'2026-10-17T00:00:00Z':null}));
      window.KGDomainApi={request: async options => {
        calls.push(options.path); if(mode==='error')throw Error('offline');
        if(mode==='401')throw Object.assign(Error('unauthorized'),{status:401});
        if(mode==='pending')return new Promise(resolve=>window.resolveOld=resolve);
        if(mode==='empty')return {nodes:[],topicCount:0,attemptCount:0};
        if(mode==='unknown')return {nodes:[],topicCount:0,attemptCount:7,unknownAttemptCount:7};
        return {nodes,subjects:[{id:'pmp',code:'PMP',name:'项目管理专业人士'},{id:'product',code:'产品管理',name:'产品管理'}],topicCount:320,practicedTopicCount:3,unpracticedTopicCount:317,attemptCount:7,recentAttemptCount:7,unknownAttemptCount:0};
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
    page.wait_for_function('scenes.at(-1).snapshot().settled && !scenes.at(-1).snapshot().running')
    snap=lambda:page.evaluate('scenes.at(-1).snapshot()')
    assert len(snap()['positions'])==320 and len(set(p['depth'] for p in snap()['positions']))>10
    expect(page.locator('[data-knowledge-detail-title]')).to_have_text('风险管理 <安全>')
    expect(page.locator('[data-knowledge-page-count]')).to_have_text('全部 320 个考点')
    expect(page.locator('[data-knowledge-summary]')).to_contain_text('全部 320 · 已练 3 · 未练 317')
    assert page.evaluate('calls')==['/api/v1/learning/practice/knowledge-universe']
    search=page.get_by_role('searchbox',name='搜索知识点')
    search.fill('项目考点 320');expect(page.locator('[data-knowledge-search-results] button')).to_have_count(1)
    page.locator('[data-knowledge-search-results] button').click();page.wait_for_function('!scenes.at(-1).snapshot().running')
    found=snap();point=found['positions'][319];canvas_box=page.locator('canvas').bounding_box()
    assert found['selected']==319 and abs(point['x']-canvas_box['width']/2)<2 and abs(point['y']-canvas_box['height']/2)<2
    expect(page.locator('[data-knowledge-detail-title]')).to_have_text('项目考点 320')
    search.fill('不存在的知识点');expect(page.locator('[data-knowledge-search-status]')).to_contain_text('没有找到');assert len(snap()['positions'])==320
    search.fill('风险管理 <安全>');search.press('Enter');assert snap()['selected']==0 and not page.evaluate('!!window.injected')
    page.locator('[data-knowledge-search-clear]').click();expect(search).to_have_value('');expect(search).to_be_focused()
    page.locator('[data-knowledge-reset]').click();page.locator('[data-knowledge-node="0"]').evaluate('e=>e.click()')
    expect(page.locator('[data-knowledge-groups]')).not_to_contain_text('risk')
    expect(page.locator('[data-knowledge-group]').nth(1)).to_contain_text('项目管理专业人士 · 160')
    page.locator('[data-knowledge-node-next]').click()
    expect(page.locator('[data-knowledge-detail-score]')).to_have_text('待评估')
    expect(page.locator('[data-knowledge-detail-accuracy]')).to_have_text('待评估 · 0 次')
    page.locator('[data-knowledge-node-next]').click()
    expect(page.locator('[data-knowledge-detail-score]')).to_have_text('47.5 / 100')
    expect(page.locator('[data-knowledge-detail-accuracy]')).to_have_text('80% · 5 次')
    expect(page.locator('[data-knowledge-detail-streak]')).to_have_text('3 次')
    page.locator('[data-knowledge-node-next]').click()
    expect(page.locator('[data-knowledge-detail-date]')).to_have_text('尚未练习')
    expect(page.locator('[data-knowledge-detail-attempts]')).to_have_text('0 次')
    calls=page.evaluate('calls.length')
    page.locator('[data-knowledge-list-toggle]').click()
    buttons=page.locator('[data-knowledge-list] button')
    expect(buttons).to_have_count(320)
    buttons.nth(1).focus();page.keyboard.press('Enter')
    expect(page.locator('[data-knowledge-detail-title]')).to_have_text('<img src=x onerror="window.injected=true">')
    assert snap()['selected']==1 and page.locator('dialog img').count()==0 and not page.evaluate('!!window.injected')
    expect(buttons.nth(1)).to_have_attribute('aria-pressed','true')
    page.locator('[data-knowledge-node-next]').click();assert snap()['selected']==2
    page.locator('[data-knowledge-node-prev]').click();assert snap()['selected']==1
    page.locator('[data-knowledge-group]').nth(2).click()
    state=snap();assert state['group']=='["产品管理","<分类>"]' and state['selected']==160
    assert sum(p['visible'] for p in state['positions'])==160
    expect(page.locator('[data-knowledge-detail-subject]')).to_have_text('产品管理')
    assert page.locator('[data-knowledge-list] button:visible').count()==160
    expect(page.locator('[data-knowledge-page-count]')).to_have_text('产品管理 · 160 个考点')
    page.locator('[data-knowledge-node-prev]').click();assert snap()['selected']==319
    expect(page.locator('[data-knowledge-detail-title]')).to_have_text('项目考点 320')
    expect(page.locator('[data-knowledge-detail-date]')).to_have_text('尚未练习')
    page.locator('[data-knowledge-reset]').click();assert snap()['group']==''
    zoom=snap()['camera']['zoom'];page.locator('[data-knowledge-zoom-out]').click();assert snap()['camera']['zoom']<zoom
    page.locator('[data-knowledge-zoom-in]').click();assert abs(snap()['camera']['zoom']-zoom)<.001
    yaw=snap()['camera']['yaw'];page.locator('[data-knowledge-rotate-left]').focus();page.keyboard.press('Enter');assert snap()['camera']['yaw']!=yaw
    page.locator('[data-knowledge-reset]').click();assert snap()['camera']['yaw']==.24
    page.locator('[data-knowledge-list-toggle]').click()
    page.wait_for_function('!scenes.at(-1).snapshot().running')
    state=snap();point=state['positions'][15];box=page.locator('canvas').bounding_box()
    page.mouse.click(box['x']+point['x'],box['y']+point['y'])
    chosen=snap()['selected'];assert chosen!=319
    expect(page.locator('[data-knowledge-detail-title]')).to_have_text(page.evaluate('nodes[scenes.at(-1).snapshot().selected].title'))
    assert page.evaluate('calls.length')==calls, 'selection, group and camera must never refetch'
    checks.append('real 3D projection, safe labels, semantic list keyboard selection, pointer/detail sync, group traversal and camera controls')
    checks.append('complete 320-node universe from one request, full Canvas/list and subject filter')
    # Native modal containment covers forward/backward Tab and Escape return focus.
    page.locator('[data-knowledge-close]').focus();page.keyboard.press('Shift+Tab')
    assert page.evaluate('document.querySelector("dialog").contains(document.activeElement)')
    page.keyboard.press('Escape');expect(dialog).not_to_be_visible();expect(page.locator('#open')).to_be_focused()
    assert snap()['destroyed'] and page.locator('canvas').count()==0
    checks.append('native dialog focus containment, Escape restoration and scene destruction')
    page.evaluate("mode='error'");page.locator('#open').click();expect(page.locator('[data-knowledge-retry]')).to_be_visible()
    assert page.locator('[data-knowledge-list] li').count()==0 and page.locator('canvas').count()==0
    expect(page.locator('[data-knowledge-detail-title]')).to_have_text('选择一个考点')
    page.evaluate("mode='ready'");page.locator('[data-knowledge-retry]').click();expect(page.locator('[data-knowledge-list] li')).to_have_count(320)
    checks.append('network error clears rows/details/canvas and retry recovers')
    page.evaluate("mode='pending';void KGKnowledgeDashboard.open()")
    page.wait_for_function('!!window.resolveOld')
    assert snap()['destroyed'] and page.locator('canvas').count()==0
    expect(page.locator('[data-knowledge-detail-title]')).to_have_text('选择一个考点')
    page.evaluate("owner='B';mode='empty';dispatchEvent(new Event('kg-auth-session-change'))")
    expect(page.locator('[data-knowledge-status]')).to_contain_text('暂无发布知识树')
    page.evaluate("resolveOld({nodes:[{title:'A private'}],topicCount:1})")
    expect(page.locator('[data-knowledge-list] li')).to_have_count(0)
    assert 'A private' not in dialog.inner_text() and page.locator('canvas').count()==0
    page.evaluate("mode='unknown';void KGKnowledgeDashboard.open()")
    expect(page.locator('[data-knowledge-status]')).to_contain_text('暂无发布知识树')
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
    expect(page.locator('[data-knowledge-list] li')).to_have_count(320)
    page.wait_for_function('scenes.at(-1).snapshot().settled && !scenes.at(-1).snapshot().running')
    scroll_evidence=[]
    cdp=context.new_cdp_session(page)
    shell=page.locator('.kg-knowledge-shell')
    def touch_swipe(x,start,end):
        cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x,'y':start,'id':1}]})
        for i in range(1,13):
            cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x,'y':start+(end-start)*i/12,'id':1}]})
            page.wait_for_timeout(20)
        cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
        page.wait_for_timeout(1200)
    for width,height in ((1440,900),(1440,650),(390,844),(320,568)):
        page.set_viewport_size({'width':width,'height':height})
        page.wait_for_timeout(150)
        shell.evaluate('(e)=>e.scrollTop=0')
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        assert dialog.evaluate('(e)=>e.scrollWidth<=e.clientWidth&&e.querySelector(".kg-knowledge-shell").scrollWidth<=e.querySelector(".kg-knowledge-shell").clientWidth'), f'{width}: dialog overflow'
        assert dialog.evaluate('e=>[...e.querySelectorAll("button")].filter(b=>b.getClientRects().length).every(b=>b.getBoundingClientRect().height>=44)')
        assert shell.evaluate('e=>e.scrollHeight>e.clientHeight'), f'{width}x{height}: no scroll range'
        page.locator('canvas').scroll_into_view_if_needed()
        box=page.locator('canvas').bounding_box();shell_box=shell.bounding_box()
        x=box['x']+box['width']/2;y=(max(box['y'],shell_box['y'])+min(box['y']+box['height'],shell_box['y']+shell_box['height']))/2
        assert y>box['y'] and y<box['y']+box['height']
        background=page.evaluate('scrollY');zoom=snap()['camera']['zoom'];wheel_before=shell.evaluate('e=>e.scrollTop')
        page.mouse.move(x,y);page.mouse.wheel(0,450);page.wait_for_timeout(300)
        wheel_top=shell.evaluate('e=>e.scrollTop');assert wheel_top>wheel_before, f'{width}x{height}: Canvas wheel did not scroll'
        assert snap()['camera']['zoom']==zoom and page.evaluate('scrollY')==background
        page.screenshot(path=str(OUT/f'dashboard-{width}x{height}-wheel.png'))
        shell.evaluate('(e)=>e.scrollTop=0');page.wait_for_timeout(600)
        page.locator('canvas').scroll_into_view_if_needed()
        box=page.locator('canvas').bounding_box();shell_box=shell.bounding_box()
        y=(max(box['y'],shell_box['y'])+min(box['y']+box['height'],shell_box['y']+shell_box['height']))/2
        assert page.evaluate('([x,y])=>document.elementFromPoint(x,y)?.tagName',[x,y])=='CANVAS'
        touch_before=shell.evaluate('e=>e.scrollTop');camera=snap()['camera']
        touch_swipe(x,y,max(shell_box['y']+20,y-200))
        assert snap()['camera']==camera and page.evaluate('scrollY')==background
        touch_top=shell.evaluate('e=>e.scrollTop');assert touch_top>touch_before, f'{width}x{height}: Canvas touch did not scroll'
        for _ in range(12):
            if shell.evaluate('e=>e.scrollTop+e.clientHeight>=e.scrollHeight-2'):break
            touch_swipe(shell_box['x']+shell_box['width']/2,shell_box['y']+shell_box['height']*.65,shell_box['y']+shell_box['height']*.2)
        assert shell.evaluate('e=>e.scrollTop+e.clientHeight>=e.scrollHeight-2'), f'{width}x{height}: touch cannot reach footer {shell.evaluate("e=>[e.scrollTop,e.clientHeight,e.scrollHeight]")}'
        assert page.locator('#kgKnowledgeMeaning').bounding_box()['y']<height
        page.screenshot(path=str(OUT/f'dashboard-{width}x{height}-bottom.png'))
        touch_swipe(shell_box['x']+shell_box['width']/2,shell_box['y']+shell_box['height']*.3,shell_box['y']+shell_box['height']*.65)
        assert shell.evaluate('e=>e.scrollTop')<shell.evaluate('e=>e.scrollHeight-e.clientHeight'), 'downward touch must recover toward top'
        close_box=page.locator('[data-knowledge-close]').bounding_box()
        assert close_box['y']>=0 and close_box['y']+close_box['height']<=height
        page.mouse.click(close_box['x']+close_box['width']/2,close_box['y']+close_box['height']/2)
        expect(dialog).not_to_be_visible();expect(page.locator('#open')).to_be_focused();assert snap()['destroyed']
        page.mouse.move(width/2,height/2);page.mouse.wheel(0,300);page.wait_for_timeout(150)
        assert page.evaluate('scrollY')>background, 'closing must restore lobby wheel'
        page.locator('#open').click();page.wait_for_function('scenes.at(-1).snapshot().settled && !scenes.at(-1).snapshot().running')
        scroll_evidence.append({'width':width,'height':height,'wheelScrollTop':wheel_top,'touchScrollTop':touch_top})
        checks.append(f'{width}x{height}: physical Canvas wheel/touch, bottom and return swipe, fixed close and background recovery')
    (OUT/'scroll-evidence.json').write_text(json.dumps(scroll_evidence,indent=2))
    # A physical click outside the dialog must close and restore focus as well.
    page.mouse.click(1,1);expect(dialog).not_to_be_visible();expect(page.locator('#open')).to_be_focused()
    page.locator('#open').click()
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
    page.evaluate('nodes.forEach(node=>node.path=[])')
    page.locator('[data-knowledge-refresh]').click()
    expect(page.locator('[data-knowledge-group]').nth(1)).to_contain_text('项目管理专业人士 · 160')
    search=page.get_by_role('searchbox',name='搜索知识点');search.fill('项目考点 320')
    page.locator('[data-knowledge-search-results] button').click()
    expect(page.locator('[data-knowledge-detail-title]')).to_have_text('项目考点 320');assert page.locator('canvas').count()==0
    page.locator('[data-knowledge-search-clear]').click()
    expect(page.locator('[data-knowledge-groups]')).not_to_contain_text('risk')
    expect(page.locator('[data-knowledge-detail-path]')).to_have_text('无路径标签')
    checks.append('readable subject names and counts, missing path fallback and explicit refresh')
    checks.append('Canvas failure retains selectable accessible real data list')
    assert not errors, errors
    browser.close()
(OUT/'results.json').write_text(json.dumps({'checks':checks,'errors':errors},ensure_ascii=False,indent=2))
print(json.dumps({'passed':len(checks),'checks':checks},ensure_ascii=False))
