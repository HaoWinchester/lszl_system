"""T15 actual publication/loading/role/drawer desktop/narrow/fullscreen flow."""
import json
from pathlib import Path
from helpers.graph_detail_actions import open_retained_practice
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'artifacts/canvas-m2-m5/t15';BASE='http://127.0.0.1:5195'
def main():
    fixture=json.loads((OUT/'fixture.json').read_text());users=fixture['users'];files=fixture['files'];password=fixture['password'];errors=[]
    with sync_playwright() as pw:
        browser=pw.chromium.launch(channel='chrome')
        def session(role):
            ctx=browser.new_context(viewport={'width':1440,'height':900});assert ctx.request.post(BASE+'/api/v1/auth/login',data={'username':users[role],'password':password}).ok
            assert ctx.request.put(BASE+'/api/v1/files/current',data={'fileId':files[role]}).ok
            p=ctx.new_page();p.on('pageerror',lambda e:errors.append(str(e)));p.goto(BASE+'/index.html',wait_until='networkidle');p.wait_for_function('!KGGraphFileTabs.isSwitching()')
            for selector in ('#learningEntryDismissBtn','.tour-skip','#hideHelpBtn'):
                if p.locator(selector).is_visible():p.locator(selector).click()
            return ctx,p
        def visible_click(p,selector):
            # 允许一次瞬态重试（如 requestFullscreen 过渡），持续遮挡仍会失败
            loc=p.locator(selector);loc.wait_for(state='visible');r=None
            for attempt in range(2):
                r=loc.bounding_box();v=p.viewport_size;x=max(0,r['x'])+min(r['width'],v['width']-max(0,r['x']))/2;y=max(0,r['y'])+min(r['height'],v['height']-max(0,r['y']))/2
                assert 0<=x<v['width'] and 0<=y<v['height'],(selector,r)
                if loc.evaluate('(el,p)=>el.contains(document.elementFromPoint(p.x,p.y))',{'x':x,'y':y}):
                    p.mouse.click(x,y);return
                if attempt==0:p.wait_for_timeout(400)
            raise AssertionError(('visible-click',selector,r))
        def practice(p,nid):
            visible_click(p,f'.knowledge-card[data-node-id="{nid}"]')
            panel=p.locator('#detailPanel');r=panel.bounding_box();assert r['y']+r['height']<=p.viewport_size['height']
            open_retained_practice(p)
        def center(p):
            visible_click(p,'#templateBtn');expect(p.locator('#graphTemplateCenter')).to_be_visible();expect(p.locator('#graphTemplateCenter [role=status]')).not_to_have_text('正在加载模板…')
        def close(p):visible_click(p,'#graphTemplateCenter .template-center-actions button:last-child')
        def publication(p,name,member=False,item=None):
            if item:p.locator(f'[data-template-id="{item}"]').get_by_role('button',name='更新为新版本').click()
            else:p.locator('[data-template-publish]').click()
            form=p.locator('.template-publication-form');form.locator('[name=name]').fill(name);form.locator('[name=description]').fill('描述预览，不含完整图谱或答案');form.locator('[name=memberOnly]').set_checked(member);form.get_by_role('button',name='发布新版本' if item else '直接发布',exact=True).click();expect(form).to_have_count(0)
            row=p.locator('#graphTemplateCenter article').filter(has=p.get_by_role('heading',name=name,exact=True));expect(row).to_have_count(1);return row.get_attribute('data-template-id')
        teacher,p=session('teacher');center(p);free=publication(p,'免费完整模板');paid=publication(p,'会员完整模板',True)
        p.locator(f'[data-template-id="{paid}"]').get_by_role('button',name='预览',exact=True).click();expect(p.locator(f'[data-template-id="{paid}"]')).to_contain_text('描述预览')
        p.screenshot(path=str(OUT/'teacher-desktop.png'))
        source=teacher.request.get(BASE+'/api/v1/files/'+files['teacher']).json()['graphData']
        publication(p,'免费完整模板 v2',item=free)
        assert teacher.request.get(BASE+'/api/v1/graph-templates/'+free).json()['template']['version']==2
        p.locator(f'[data-template-id="{free}"]').get_by_role('button',name='下架',exact=True).click();expect(p.locator(f'[data-template-id="{free}"]')).to_contain_text('已下架');p.locator(f'[data-template-id="{free}"]').get_by_role('button',name='重新上架',exact=True).click()
        close(p);p.evaluate("document.querySelector('#stage').requestFullscreen()");center(p);assert p.evaluate("document.fullscreenElement.contains(document.querySelector('#graphTemplateCenter'))");p.screenshot(path=str(OUT/'teacher-fullscreen.png'));close(p);p.evaluate('document.exitFullscreen()')
        admin,a=session('admin');center(a);admin_template=publication(a,'管理员模板',True);assert a.locator(f'[data-template-id="{paid}"]').get_by_role('button',name='下架',exact=True).is_visible();close(a);admin.close()
        student,s=session('student');center(s);expect(s.locator('[data-template-publish]')).to_have_count(0)
        s.locator(f'[data-template-id="{paid}"] [data-template-load]').click();expect(s.locator('[role=status]')).to_contain_text('需要有效会员')
        before=student.request.get(BASE+'/api/v1/files/'+files['student']).json()['graphData']
        row=s.locator(f'[data-template-id="{free}"]');row.locator('[data-template-load]').click();expect(row.locator('[data-template-result]')).to_be_visible();fid=row.locator('[data-template-result]').get_attribute('data-template-result');row.locator('[data-template-result]').click();s.wait_for_function('!KGGraphFileTabs.isSwitching()')
        assert fid!=files['student'];assert student.request.get(BASE+'/api/v1/files/'+files['student']).json()['graphData']==before
        loaded=student.request.get(BASE+'/api/v1/files/'+fid).json()['graphData'];node=next(n for n in loaded['nodes'] if n.get('title')=='card');nid=node['id'];assert nid!='n';assert node['content']['notes']==source['nodes'][0]['content']['notes']
        s.wait_for_function("[...document.querySelectorAll('.knowledge-card img')].some(i=>i.complete&&i.naturalWidth===2)")
        practice(s,nid);expect(s.locator('.gqd-question')).to_have_count(1);s.locator('.gqd-question input[value=A]').check();s.locator('.gqd-question [data-submit]').click();expect(s.locator('.gqd-analysis')).to_be_visible();expect(s.locator('[data-feedback]')).to_contain_text('回答正确');s.screenshot(path=str(OUT/'student-free-member-question.png'));s.locator('[data-close]').click();s.evaluate("document.querySelector('#stage').requestFullscreen()");practice(s,nid);expect(s.locator('.gqd-question')).to_have_count(1);s.screenshot(path=str(OUT/'long-notes-fullscreen-practice.png'));s.locator('[data-close]').click();s.evaluate('document.exitFullscreen()')
        # Save/edit the private copy, then reopen. No source/template mutation.
        changed=json.loads(json.dumps(loaded));changed['nodes'][0]['content']['notes']='副本改动';assert student.request.put(BASE+'/api/v1/files/'+fid,data={'graphData':changed,'expectedRevision':1}).ok
        s.reload(wait_until='networkidle');s.wait_for_function('!KGGraphFileTabs.isSwitching()');assert student.request.get(BASE+'/api/v1/files/'+fid).json()['graphData']['nodes'][0]['content']['notes']=='副本改动'
        assert teacher.request.get(BASE+'/api/v1/files/'+files['teacher']).json()['graphData']==source
        center(s);s.set_viewport_size({'width':390,'height':844});s.screenshot(path=str(OUT/'student-narrow.png'));visible_click(s,'#graphTemplateCenter .template-center-actions button:last-child');expect(s.locator('#graphTemplateCenter')).to_have_count(0)
        member,m=session('member');center(m);row=m.locator(f'[data-template-id="{paid}"]');row.locator('[data-template-load]').click();expect(row.locator('[data-template-result]')).to_be_visible();memberfile=row.locator('[data-template-result]').get_attribute('data-template-result');m.screenshot(path=str(OUT/'member-load.png'));close(m)
        p.locator('#templateBtn').click();expect(p.locator('#graphTemplateCenter')).to_be_visible();p.locator(f'[data-template-id="{paid}"]').get_by_role('button',name='下架',exact=True).click()
        assert member.request.get(BASE+'/api/v1/files/'+memberfile).ok
        assert member.request.post(BASE+f'/api/v1/graph-templates/{paid}/loads',data={'version':1,'requestId':'after-downlist'}).status==404
        viewer,v=session('viewer');assert viewer.request.get(BASE+'/api/v1/graph-templates').status==403;viewer.close()
        assert not errors,errors
        student.close();member.close();teacher.close();browser.close();print('PASS teacher/admin publication/update/downlist; member/nonmember loads; independent saved copy; legal nonmember paid-question drawer; fullscreen/desktop/narrow')
if __name__=='__main__':main()
