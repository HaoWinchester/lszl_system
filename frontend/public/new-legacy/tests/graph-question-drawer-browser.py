"""Live T14 role/authorized-media/maintenance/error/fullscreen/mobile checks."""
import argparse,json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'artifacts/canvas-m2-m5/t14'
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--base-url',default='http://127.0.0.1:5194');base=parser.parse_args().base_url.rstrip('/');assert base.startswith('http://127.0.0.1:')
    fixture=json.loads((OUT/'fixture.json').read_text());users=fixture['users'];files=fixture['files'];password=fixture['password'];errors=[]
    with sync_playwright() as pw:
        browser=pw.chromium.launch(channel='chrome')
        def session(role):
            ctx=browser.new_context(viewport={'width':1440,'height':900});assert ctx.request.post(base+'/api/v1/auth/login',data={'username':users[role],'password':password}).ok
            assert ctx.request.put(base+'/api/v1/files/current',data={'fileId':files[role]}).ok
            page=ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.goto(base+'/index.html',wait_until='networkidle');page.wait_for_function('!KGGraphFileTabs.isSwitching()')
            for selector in ('#learningEntryDismissBtn','.tour-skip','#hideHelpBtn'):
                if page.locator(selector).is_visible():page.locator(selector).click()
            return ctx,page
        def visible_click(page,selector):
            loc=page.locator(selector);loc.wait_for(state='visible');r=loc.bounding_box();v=page.viewport_size;x=max(0,r['x'])+min(r['width'],v['width']-max(0,r['x']))/2;y=max(0,r['y'])+min(r['height'],v['height']-max(0,r['y']))/2
            assert 0<=x<v['width'] and 0<=y<v['height'],(selector,r)
            assert loc.evaluate('(el,p)=>el.contains(document.elementFromPoint(p.x,p.y))',{'x':x,'y':y}),(selector,r)
            page.mouse.click(x,y)
        def open_card(page,id='n'):
            visible_click(page,'.knowledge-card[data-node-id="'+id+'"]');visible_click(page,'#graphPracticeBtn');page.locator('.graph-question-drawer').wait_for(state='visible');expect(page.locator('.graph-question-drawer [data-status]')).to_have_text('')
        teacher,p=session('teacher');open_card(p);expect(p.locator('.gqd-question')).to_have_count(3);expect(p.locator('.gqd-analysis')).to_have_count(0)
        p.wait_for_function("[...document.querySelectorAll('.gqd-question img')].every(i=>i.complete&&i.naturalWidth===240)");p.screenshot(path=str(OUT/'teacher-1440.png'));(OUT/'native-bounds.json').write_text(json.dumps(p.evaluate("({scroll:[scrollX,scrollY],stage:document.querySelector('#stage').getBoundingClientRect().toJSON(),stageScroll:[document.querySelector('#stage').scrollLeft,document.querySelector('#stage').scrollTop]})")))
        bindings=teacher.request.get(base+f'/api/v1/graph-questions/files/{files["teacher"]}/nodes/n/bindings').json()['bindings'];assert 'analysis' not in bindings[0]['question'];asset=bindings[0]['question']['images'][0]['url'];assert teacher.request.get(base+asset).ok;assert teacher.request.get(base+asset.replace('nodeId=n','nodeId=empty')).status==404
        p.locator('[data-add]').click();p.locator('[data-search] input[name=q]').fill('card');p.locator('[data-search] form button').click();expect(p.locator('[data-results] label')).to_have_count(20)
        assert p.locator('[data-results] input:disabled').count()==3
        p.locator('[data-next]').click();expect(p.locator('[data-results] label')).to_have_count(8);p.locator('[data-prev]').click();expect(p.locator('[data-results] label')).to_have_count(20)
        checkbox=p.locator('[data-results] input:not(:disabled)').first;checkbox.check();assert len(teacher.request.get(base+f'/api/v1/graph-questions/files/{files["teacher"]}/nodes/n/bindings').json()['bindings'])==3
        p.locator('[data-confirm]').click();expect(p.locator('[data-status]')).to_have_text('关联已保存');expect(p.locator('.gqd-question')).to_have_count(4)
        p.screenshot(path=str(OUT/'teacher-maintenance.png'))
        # Empty card: teacher searches and adds; saved status never appears on failed request.
        p.locator('[data-close]').click();open_card(p,'empty');expect(p.locator('[data-questions]')).to_have_text('暂无关联题目');p.locator('[data-add]').click();p.locator('[data-search] input[name=q]').fill('zz-no-match');p.locator('[data-search] form button').click();expect(p.locator('[data-search-status]')).to_have_text('未找到匹配题目')
        p.locator('[data-search] input[name=q]').fill('card');p.locator('[data-search] form button').click();expect(p.locator('[data-results] label')).to_have_count(20);p.locator('[data-results] input').first.check()
        p.route('**/graph-questions/files/*/nodes/*/bindings',lambda route:route.fulfill(status=409,json={'detail':'REVISION_CONFLICT'}) if route.request.method=='PUT' else route.continue_());p.locator('[data-confirm]').click();expect(p.locator('[data-status]')).to_contain_text('关联保存失败');expect(p.locator('[data-questions]')).to_have_text('暂无关联题目');p.unroute('**/graph-questions/files/*/nodes/*/bindings');p.locator('[data-confirm]').click();expect(p.locator('.gqd-question')).to_have_count(1)
        p.on('dialog',lambda d:d.accept());p.locator('[data-remove]').click();expect(p.locator('[data-questions]')).to_have_text('暂无关联题目')
        # Search failures preserve explicit error and never fabricate results.
        p.route('**/graph-questions/search?*',lambda route:route.fulfill(status=503,json={'detail':'search unavailable'}));p.locator('[data-search] form button').click();expect(p.locator('[data-search-status]')).to_contain_text('搜索失败');expect(p.locator('[data-results] label')).to_have_count(0);p.unroute('**/graph-questions/search?*')
        # Request failure must not render the empty state; switching cancels old card response.
        p.locator('[data-close]').click();p.route('**/graph-questions/files/*/nodes/n/bindings',lambda route:route.fulfill(status=503,json={'detail':'unavailable'}));visible_click(p,'.knowledge-card[data-node-id=n]');visible_click(p,'#graphPracticeBtn');expect(p.locator('[data-status]')).to_contain_text('加载失败');expect(p.locator('[data-questions]')).to_have_count(0);p.unroute('**/graph-questions/files/*/nodes/n/bindings');p.locator('[data-retry]').click();expect(p.locator('.gqd-question')).to_have_count(4)
        p.locator('[data-close]').click();pending=[]
        p.route('**/graph-questions/files/*/nodes/empty/bindings',lambda route:pending.append(route));visible_click(p,'.knowledge-card[data-node-id=empty]');visible_click(p,'#graphPracticeBtn');expect(p.locator('[data-status]')).to_have_text('正在加载关联题目…');p.wait_for_timeout(100);visible_click(p,'.knowledge-card[data-node-id=n]');expect(p.locator('.graph-question-drawer')).to_be_hidden()
        for route in pending:route.continue_()
        p.unroute('**/graph-questions/files/*/nodes/empty/bindings');p.wait_for_timeout(100);expect(p.locator('.graph-question-drawer')).to_be_hidden()
        p.evaluate('openRelatedCanvasModal(false)');p.locator('.related-canvas-backdrop').wait_for();assert p.locator('.related-canvas-backdrop [data-submit]').count()==0;assert p.locator('.related-canvas-backdrop #graphPracticeBtn').count()==0;assert p.evaluate('graphQuestionDrawer.open(nodeById("n"))') is False;p.locator('.related-canvas-close').click()
        p.evaluate("document.querySelector('#stage').requestFullscreen()");open_card(p);assert p.evaluate("document.fullscreenElement.contains(document.querySelector('.graph-question-drawer'))");p.screenshot(path=str(OUT/'teacher-fullscreen.png'));p.set_viewport_size({'width':900,'height':900});p.screenshot(path=str(OUT/'teacher-900.png'));p.set_viewport_size({'width':1440,'height':900});p.locator('[data-close]').click();p.evaluate('document.exitFullscreen()')
        for role in ('student','admin','member'):
            ctx,page=session(role)
            if role in ('student','member'):
                open_card(page,'empty');expect(page.locator('[data-questions]')).to_have_text('暂无关联题目');expect(page.locator('[data-add]')).to_have_count(0);page.locator('[data-close]').click()
            open_card(page);expect(page.locator('.gqd-question')).to_have_count(3);expect(page.locator('[data-add]')).to_have_count(0 if role in ('student','member') else 1)
            if role=='admin':
                page.locator('[data-add]').click();page.locator('[data-search] input[name=q]').fill('card');page.locator('[data-search] input[name=subject]').fill('PMP');page.locator('[data-search] form button').click();expect(page.locator('[data-results] label')).to_have_count(20);page.locator('[data-results] input:not(:disabled)').first.check();page.locator('[data-confirm]').click();expect(page.locator('.gqd-question')).to_have_count(4)
                card=page.locator('.gqd-question').first;card.locator('input[value=B]').check();card.locator('[data-submit]').click();expect(card.locator('.gqd-analysis')).to_be_visible();expect(card.locator('[data-feedback]')).to_contain_text('回答错误')
            if role in ('student','member'):
                assert ctx.request.get(base+'/api/v1/graph-questions/search?fileId='+files[role]+'&nodeId=n').status==403
                assert ctx.request.put(base+f'/api/v1/graph-questions/files/{files[role]}/nodes/n/bindings',data={'expectedFileRevision':1,'questionIds':[users['q']]}).status==403
                assert ctx.request.get(base+f'/api/v1/graph-questions/files/{files["teacher"]}/nodes/n/bindings').status==404
                assert ctx.request.get(base+'/api/v1/question-catalog/questions/'+users['q']).status==403
                for index in range(3):
                    card=page.locator('.gqd-question').nth(index)
                    if index==2:
                        for left,right in (('l1','r1'),('l2','r2')):card.locator('[data-qm-left='+left+']').click();card.locator('[data-qm-right='+right+']').click()
                    else:
                        card.locator('input[value=A]').check()
                        if index==1:card.locator('input[value=B]').check()
                    card.locator('[data-submit]').click();expect(card.locator('.gqd-analysis')).to_be_visible();expect(card.locator('[data-feedback]')).to_contain_text('回答正确')
                    if index==2:
                        expect(card.locator('[data-qm-left=l1] span')).to_have_text('一');expect(card.locator('[data-qm-left=l2] span')).to_have_text('二')
                page.screenshot(path=str(OUT/(role+'-analysis.png')));page.set_viewport_size({'width':390,'height':844});page.screenshot(path=str(OUT/(role+'-mobile.png')));assert page.locator('[data-close]').bounding_box()['x']<390
                assert page.locator('[data-close]').evaluate('(el)=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}')
                page.locator('.gqd-question').last.locator('[data-submit]').scroll_into_view_if_needed();assert page.locator('.gqd-question').last.locator('[data-submit]').bounding_box()['y']<844
                page.locator('[data-close]').click()
            ctx.close()
        viewer,page=session('viewer');page.locator('.knowledge-card[data-node-id=n]').click();page.locator('#graphPracticeBtn').click();expect(page.locator('[data-status]')).to_contain_text('加载失败');viewer.close()
        assert not errors,errors;teacher.close();browser.close();print('PASS live teacher/admin/student/viewer, maintenance, safe media, all3types, errors, fullscreen, mobile')
if __name__=='__main__':main()
