"""T15 actual publication/loading/role/drawer desktop/narrow/fullscreen flow."""
import json
from pathlib import Path
from helpers.graph_detail_actions import open_retained_practice
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'artifacts/canvas-m2-m5/t15';BASE='http://127.0.0.1:5195'
def maintenance(row, name):
    """Use the visible manager entry before interacting with its controls."""
    menu=row.locator('.template-card-management')
    if menu.get_attribute('open') is None:menu.locator('summary').click()
    return row.get_by_role('button',name=name,exact=True)

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
            if item:maintenance(p.locator(f'[data-template-id="{item}"]'),'更新为新版本').click()
            else:p.locator('[data-template-publish]').click()
            form=p.locator('.template-publication-form');form.locator('[name=name]').fill(name);form.locator('[name=description]').fill('描述预览，不含完整图谱或答案');form.locator('[name=memberOnly]').set_checked(member);form.get_by_role('button',name='发布新版本' if item else '直接发布',exact=True).click();expect(form).to_have_count(0)
            row=p.locator('#graphTemplateCenter article').filter(has=p.get_by_role('heading',name=name,exact=True));expect(row).to_have_count(1);return row.get_attribute('data-template-id')
        teacher,p=session('teacher');center(p);free=publication(p,'免费完整模板');paid=publication(p,'会员完整模板',True)
        p.locator(f'[data-template-id="{paid}"]').get_by_role('button',name='预览',exact=True).click();expect(p.locator(f'[data-template-id="{paid}"]')).to_contain_text('描述预览')
        p.screenshot(path=str(OUT/'teacher-desktop.png'))
        source=teacher.request.get(BASE+'/api/v1/files/'+files['teacher']).json()['graphData']
        publication(p,'免费完整模板 v2',item=free)
        assert teacher.request.get(BASE+'/api/v1/graph-templates/'+free).json()['template']['version']==2
        maintenance(p.locator(f'[data-template-id="{free}"]'),'下架').click();expect(p.locator(f'[data-template-id="{free}"]')).to_contain_text('已下架');maintenance(p.locator(f'[data-template-id="{free}"]'),'重新上架').click()
        close(p);p.evaluate("document.querySelector('#stage').requestFullscreen()");center(p);assert p.evaluate("document.fullscreenElement.contains(document.querySelector('#graphTemplateCenter'))");p.screenshot(path=str(OUT/'teacher-fullscreen.png'));close(p);p.evaluate('document.exitFullscreen()')
        admin,a=session('admin');center(a);admin_template=publication(a,'管理员模板',True);assert maintenance(a.locator(f'[data-template-id="{paid}"]'),'下架').is_visible();close(a);admin.close()
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
        p.locator('#templateBtn').click();expect(p.locator('#graphTemplateCenter')).to_be_visible();maintenance(p.locator(f'[data-template-id="{paid}"]'),'下架').click()
        assert member.request.get(BASE+'/api/v1/files/'+memberfile).ok
        assert member.request.post(BASE+f'/api/v1/graph-templates/{paid}/loads',data={'version':1,'requestId':'after-downlist'}).status==404
        viewer,v=session('viewer');assert viewer.request.get(BASE+'/api/v1/graph-templates').status==403;viewer.close()
        assert not errors,errors
        student.close();member.close();teacher.close();browser.close();print('PASS teacher/admin publication/update/downlist; member/nonmember loads; independent saved copy; legal nonmember paid-question drawer; fullscreen/desktop/narrow')


def role_matrix(base, output):
    """Real browser role matrix. Run only against a disposable seeded fixture."""
    from datetime import datetime, timedelta, timezone
    from io import BytesIO
    from uuid import uuid4
    import base64
    from PIL import Image
    from urllib.parse import urlparse
    assert urlparse(base).hostname in {'127.0.0.1','localhost'} and urlparse(base).port==5265, 'role data must stay in the designated disposable fixture'
    output=Path(output);output.mkdir(parents=True,exist_ok=True)
    run=uuid4().hex[:8];password='template-role-test-'+run
    roles={'admin':'admin','teacher':'teacher','other_teacher':'teacher','student':'student','member':'student','viewer':'viewer'}
    usernames={role:'tqa-'+run+'-'+role for role in roles}
    results=[];errors=[];files={};contexts={};pages={};published={};assets={}
    def record(role,actions):
        page=pages[role];page.screenshot(path=str(output/(role+'.png')))
        results.append({'role':role,'username':usernames.get(role),'result':'PASS','actions':actions,'screenshot':role+'.png'})
        (output/'results.json').write_text(json.dumps({'run':run,'base':base,'results':results,'pageErrors':errors},ensure_ascii=False,indent=2))
        print('PASS '+role+': '+actions,flush=True)
    def checked(response,status=200):
        assert response.status==status,(response.url,response.status,response.text())
        return response.json()
    def dismiss(page):
        for selector in ('#learningEntryDismissBtn','.tour-skip','#hideHelpBtn'):
            if page.locator(selector).is_visible():page.locator(selector).click()
    def ready(page,fid=None):
        page.wait_for_function('window.KGGraphFileTabs && !KGGraphFileTabs.isSwitching()')
        if fid:page.wait_for_function('(id)=>KGGraphFileRemoteAdapter.getCurrentFileMeta()?.id===id && state.nodes.length===3',arg=fid)
        dismiss(page)
    def center(page):
        page.locator('#templateBtn').click();expect(page.locator('#graphTemplateCenter')).to_be_visible()
        expect(page.locator('#graphTemplateCenter [role=status]')).not_to_have_text('正在加载模板…')
    def close(page):page.locator('#graphTemplateCenter .template-center-actions button:last-child').click()
    def publication(page,name,member=False,template=None):
        if template:maintenance(page.locator('[data-template-id="'+template+'"]'),'更新为新版本').click()
        else:page.locator('[data-template-publish]').click()
        form=page.locator('.template-publication-form');form.locator('[name=name]').fill(name);form.locator('[name=description]').fill('角色实测模板');form.locator('[name=memberOnly]').set_checked(member)
        path='/api/v1/graph-templates'+('/'+template+'/versions' if template else '')
        with page.expect_response(lambda response:response.request.method=='POST' and response.url.endswith(path)) as response:
            form.get_by_role('button',name='发布新版本' if template else '直接发布',exact=True).click()
        result=checked(response.value,201)['template'];expect(form).to_have_count(0)
        expect(page.locator('[data-template-id="'+result['id']+'"]')).to_be_visible()
        return result
    def preview(page,template,role):
        row=page.locator('[data-template-id="'+template+'"]');row.get_by_role('button',name='预览',exact=True).click()
        panel=page.locator('.template-preview-window');drawing=panel.locator('svg');expect(drawing).to_be_visible()
        expect(drawing.locator('.knowledge-card')).to_have_count(3)
        expect(drawing.locator('.card-style-rounded')).to_have_count(1)
        expect(drawing.locator('.card-style-sticky')).to_have_count(1)
        expect(drawing.locator('path[data-preview-link-id]')).to_have_count(3)
        expect(drawing.locator('.graph-text-inline')).to_have_text('安全独立文字')
        expect(drawing.locator('[data-stroke-id=ink-text]')).to_have_text('安全画笔文字')
        assert drawing.locator('[data-stroke-id=ink-pen]').get_attribute('d')
        assert drawing.locator('button,input,[data-node-resize-handle]').count()==0
        assert 'PRIVATE' not in panel.inner_text() and panel.locator('img').count()==0
        page.screenshot(path=str(output/(role+'-preview.png')))
        data=checked(contexts[role].request.get(base+'/api/v1/graph-templates/'+template))['preview']
        payload=json.dumps(data)
        for forbidden in ('PRIVATE','notes','questions','images','graphData','/api/v1/graph-assets/','/api/v1/question-assets/'):
            assert forbidden not in payload,(role,forbidden)
        assert len(data['strokes'])==2 and len(data['elements'])==1
        panel.get_by_role('button',name='关闭模板预览',exact=True).click()
    def load_copy(role,template,expected=201):
        page=pages[role];ctx=contexts[role];row=page.locator('[data-template-id="'+template['id']+'"]')
        before=ctx.request.get(base+'/api/v1/files').json()['total']
        with page.expect_response(lambda response:response.request.method=='POST' and response.url.endswith('/'+template['id']+'/loads')) as response:
            row.locator('[data-template-load]').click()
        body=checked(response.value,expected)
        if expected!=201:
            assert body['detail']['code']=='TEMPLATE_MEMBERSHIP_REQUIRED'
            expect(page.locator('#graphTemplateCenter [role=status]')).to_contain_text('需要有效会员')
            assert ctx.request.get(base+'/api/v1/files').json()['total']==before
            return None
        fid=body['fileId'];assert fid!=files['teacher'];expect(row.locator('[data-template-result]')).to_be_visible()
        data=checked(ctx.request.get(base+'/api/v1/files/'+fid))['graphData']
        assert len(data['strokes'])==2 and all(stroke['id'] not in {'ink-text','ink-pen'} for stroke in data['strokes'])
        assert data['nodes'][0]['content']['notes'].startswith('PRIVATE')
        row.locator('[data-template-result]').click();ready(page,fid)
        page.reload(wait_until='networkidle');ready(page,fid)
        assert page.evaluate('state.nodes.map(node=>node.id)')==[node['id'] for node in data['nodes']]
        assert checked(ctx.request.get(base+'/api/v1/files/'+fid))['graphData']==data
        return fid
    with sync_playwright() as pw:
        browser=pw.chromium.launch(channel='chrome')
        setup=browser.new_context()
        checked(setup.request.post(base+'/api/v1/auth/login',data={'username':'ink-admin','password':'ink-browser-test'}))
        for role,actual in roles.items():
            checked(setup.request.post(base+'/api/v1/users',data={'username':usernames[role],'password':password,'role':actual,'subject':'PMP'}))
        checked(setup.request.put(base+'/api/v1/subscriptions/admin/'+usernames['member'],data={'planId':'monthly','status':'active','expiresAt':(datetime.now(timezone.utc)+timedelta(days=30)).isoformat(),'note':'isolated browser matrix'}))
        for role,actual in roles.items():
            ctx=browser.new_context(viewport={'width':1440,'height':960});contexts[role]=ctx;page=ctx.new_page();pages[role]=page
            page.on('pageerror',lambda error,role=role:errors.append({'role':role,'error':str(error)}))
            page.goto(base+'/index.html',wait_until='networkidle');ready(page)
            page.locator('#authStatus').click();page.locator('#accountMenuSessionBtn').click()
            expect(page.locator('#authModal')).to_be_visible();page.locator('#authUsername').fill(usernames[role]);page.locator('#authPassword').fill(password)
            if page.locator('#authLegalConsent').is_visible():page.locator('#authLegalConsent').check()
            with page.expect_response('**/api/v1/auth/login') as logged_in:page.locator('#authDoLoginBtn').click()
            checked(logged_in.value);page.wait_for_function('(expected)=>KGAuthCore.currentUser()?.role===expected',arg=actual)
            assert page.evaluate('KGAuthCore.currentUser().username')==usernames[role]
            if role=='viewer':
                page.reload(wait_until='networkidle');ready(page);continue
            image=BytesIO();Image.new('RGB',(2,3),'blue').save(image,format='PNG')
            asset=checked(ctx.request.post(base+'/api/v1/graph-assets',data={'filename':'private.png','mimeType':'image/png','dataBase64':base64.b64encode(image.getvalue()).decode(),'alt':'PRIVATE IMAGE'}),201)['asset'];assets[role]=asset
            graph={'meta':{'title':'角色模板画布'},'viewport':{'x':130,'y':100,'scale':1},'nodes':[
                {'id':'a','title':'角色图谱','geometry':{'x':100,'y':100,'width':240,'height':90},'content':{'title':'角色图谱','notes':'PRIVATE NOTES '+role,'images':[asset]},'appearance':{'color':'#db2777','fontSize':19}},
                {'id':'b','title':'知识归纳','geometry':{'x':440,'y':100,'width':160,'height':166},'appearance':{'cardStyle':'rounded','fillColor':'#ecfeff','fontSize':23,'fontFamily':'kai','underline':True}},
                {'id':'c','title':'主动回忆','geometry':{'x':100,'y':350,'width':128,'height':132},'appearance':{'cardStyle':'sticky','fillColor':'#fef3c7','fontSize':17,'fontFamily':'mono'}}],
                'links':[{'id':'curve','from':'a','to':'b','type':'因果','pathStyle':'curve','lineStyle':'dashed','strokeWidth':6,'arrowStyle':'both','fromPort':'bottom','toPort':'left','curveControls':[{'x':200,'y':20},{'x':700,'y':30}]},
                         {'id':'elbow','from':'a','to':'c','pathStyle':'elbow','waypoints':[{'x':50,'y':145},{'x':50,'y':416}]},
                         {'id':'free','from':'','to':'','fromPoint':{'x':300,'y':430},'toPoint':{'x':650,'y':450},'pathStyle':'straight'}],
                'elements':[{'id':'caption','type':'text','text':'安全独立文字','geometry':{'x':70,'y':20,'width':260,'height':60},'appearance':{'fontSize':26,'textColor':'#7c3aed'}}],
                'strokes':[{'id':'ink-pen','tool':'pen','color':'#16a34a','width':6,'points':[[70,500],[220,540],[400,510]],'opacity':0.7},{'id':'ink-text','tool':'text','color':'#111827','width':24,'points':[[500,480]],'text':'安全画笔文字','bold':True}]}
            fid=checked(ctx.request.post(base+'/api/v1/files',data={'name':'角色模板-'+role,'graphData':graph}))['file']['id'];files[role]=fid
            if role=='teacher':checked(ctx.request.put(base+'/api/v1/graph-questions/files/'+fid+'/nodes/a/bindings',data={'expectedFileRevision':1,'questionIds':['ink-question-1']}))
            checked(ctx.request.put(base+'/api/v1/files/current',data={'fileId':fid}));page.reload(wait_until='networkidle');ready(page,fid)
            print('AUTH '+role+': real UI login role='+actual,flush=True)
        teacher=pages['teacher'];teacher_ctx=contexts['teacher'];source=files['teacher']
        original=checked(teacher_ctx.request.get(base+'/api/v1/files/'+source))['graphData']
        teacher.locator('.graph-mode-trigger').click();teacher.locator('[data-graph-mode-option=professional]').click()
        writes=[];teacher.on('request',lambda request:writes.append(request.url) if request.method=='POST' and request.url.endswith('/graph-templates') else None)
        def fail_save(route):
            if route.request.method=='PUT':route.fulfill(status=503,json={'detail':'测试保存失败'})
            else:route.continue_()
        teacher.route('**/api/v1/files/'+source,fail_save)
        card=teacher.locator('.knowledge-card[data-node-id=b]');box=card.bounding_box();teacher.mouse.move(box['x']+box['width']/2,box['y']+12);teacher.mouse.down();teacher.mouse.move(box['x']+box['width']/2+60,box['y']+52,steps=8);teacher.mouse.up()
        teacher.wait_for_function('KGGraphFileAutosave.isDirty()');latest=teacher.evaluate('state.nodes.find(node=>node.id==="b").geometry')
        center(teacher);teacher.locator('[data-template-publish]').click();form=teacher.locator('.template-publication-form');form.locator('[name=name]').fill('教师免费模板-'+run)
        form.get_by_role('button',name='直接发布',exact=True).click();expect(teacher.locator('#graphTemplateCenter [role=status]')).to_contain_text('保存失败')
        assert writes==[];expect(form).to_be_visible();assert checked(teacher_ctx.request.get(base+'/api/v1/files/'+source))['graphData']==original
        teacher.screenshot(path=str(output/'teacher-save-failure.png'));teacher.unroute('**/api/v1/files/'+source,fail_save)
        with teacher.expect_response(lambda response:response.request.method=='POST' and response.url.endswith('/api/v1/graph-templates')) as response:form.get_by_role('button',name='直接发布',exact=True).click()
        free=checked(response.value,201)['template'];expect(form).to_have_count(0)
        assert next(node for node in checked(teacher_ctx.request.get(base+'/api/v1/files/'+source))['graphData']['nodes'] if node['id']=='b')['geometry']==latest
        paid=publication(teacher,'教师会员模板-'+run,True);free=publication(teacher,'教师免费更新-'+run,False,free['id']);assert free['version']==2
        row=teacher.locator('[data-template-id="'+free['id']+'"]');maintenance(row,'下架').click();expect(row).to_contain_text('已下架');maintenance(row,'重新上架').click();expect(row).not_to_contain_text('已下架')
        preview(teacher,paid['id'],'teacher');load_copy('teacher',paid);record('teacher','UI publish/save failure zero POST/retry/update/downlist/relist; rich preview private fields excluded; paid copy membership bypass opens and refreshes')
        source_snapshot=checked(teacher_ctx.request.get(base+'/api/v1/files/'+source))['graphData']
        admin=pages['admin'];center(admin);own=publication(admin,'管理员模板-'+run,True);own=publication(admin,'管理员模板更新-'+run,True,own['id']);assert own['version']==2
        row=admin.locator('[data-template-id="'+paid['id']+'"]');maintenance(row,'下架').click();expect(row).to_contain_text('已下架');maintenance(row,'重新上架').click();expect(row).not_to_contain_text('已下架')
        preview(admin,paid['id'],'admin');load_copy('admin',paid);record('admin','UI publish/update; maintains another teacher listing; rich preview; paid copy membership bypass opens and refreshes')
        other=pages['other_teacher'];center(other);foreign=other.locator('[data-template-id="'+free['id']+'"]');expect(foreign.get_by_role('button',name='更新为新版本',exact=True)).to_have_count(0);expect(foreign.get_by_role('button',name='下架',exact=True)).to_have_count(0)
        other_ctx=contexts['other_teacher'];rev=checked(other_ctx.request.get(base+'/api/v1/files/'+files['other_teacher']))['meta']['revision']
        checked(other_ctx.request.post(base+'/api/v1/graph-templates/'+free['id']+'/versions',data={'sourceFileId':files['other_teacher'],'expectedFileRevision':rev,'name':'不允许'}),404)
        checked(other_ctx.request.patch(base+'/api/v1/graph-templates/'+free['id'],data={'listed':False}),404)
        publication(other,'其他教师自己的模板-'+run);preview(other,free['id'],'other_teacher');record('other_teacher','own UI publication succeeds; foreign maintenance controls absent; real update/listing 404');close(other)
        for role in ('student','member'):
            page=pages[role];ctx=contexts[role];center(page);expect(page.locator('[data-template-publish]')).to_have_count(0)
            own_rev=checked(ctx.request.get(base+'/api/v1/files/'+files[role]))['meta']['revision']
            checked(ctx.request.post(base+'/api/v1/graph-templates',data={'sourceFileId':files[role],'expectedFileRevision':own_rev,'name':'不允许'}),403)
            checked(ctx.request.post(base+'/api/v1/graph-templates/'+free['id']+'/versions',data={'sourceFileId':files[role],'expectedFileRevision':own_rev,'name':'不允许'}),403)
            checked(ctx.request.patch(base+'/api/v1/graph-templates/'+free['id'],data={'listed':False}),403)
            preview(page,paid['id'],role)
            if role=='student':
                assert checked(ctx.request.get(base+'/api/v1/subscriptions/me'))['entitlements']['allExamPapers'] is False
                load_copy(role,paid,403);fid=load_copy(role,free)
            else:
                assert checked(ctx.request.get(base+'/api/v1/subscriptions/me'))['entitlements']['allExamPapers'] is True
                fid=load_copy(role,paid)
            assert checked(teacher_ctx.request.get(base+'/api/v1/files/'+source))['graphData']==source_snapshot
            assert ctx.request.get(base+'/api/v1/files/'+source).status==404
            loaded=checked(ctx.request.get(base+'/api/v1/files/'+fid))['graphData'];node=loaded['nodes'][0]
            binding=checked(ctx.request.get(base+'/api/v1/graph-questions/files/'+fid+'/nodes/'+node['id']+'/bindings'))['bindings'];assert len(binding)==1
            record(role,'publication/update/listing denied 403 and UI hidden; private rich preview; '+('member template denied 403 then free copy succeeds' if role=='student' else 'active monthly membership member-copy succeeds')+'; independent copy opens and survives refresh with safe binding grant')
        viewer=pages['viewer'];expect(viewer.locator('#templateBtn')).not_to_be_visible();viewer.keyboard.press('t');expect(viewer.locator('#graphTemplateCenter')).to_have_count(0)
        viewer_ctx=contexts['viewer'];checked(viewer_ctx.request.get(base+'/api/v1/graph-templates'),403);checked(viewer_ctx.request.post(base+'/api/v1/graph-templates',data={'sourceFileId':source,'expectedFileRevision':1,'name':'不允许'}),403);checked(viewer_ctx.request.post(base+'/api/v1/graph-templates/'+free['id']+'/loads',data={'version':2,'requestId':'viewer-'+run}),403)
        record('viewer','real UI login; template entry hidden and shortcut blocked; catalog/publish/load denied 403')
        guest_ctx=browser.new_context(viewport={'width':1440,'height':960});contexts['guest']=guest_ctx;guest=guest_ctx.new_page();pages['guest']=guest;guest.on('pageerror',lambda error:errors.append({'role':'guest','error':str(error)}));guest.goto(base+'/index.html',wait_until='networkidle');ready(guest)
        expect(guest.locator('#templateBtn')).not_to_be_visible();guest.keyboard.press('t');expect(guest.locator('#graphTemplateCenter')).to_have_count(0)
        checked(guest_ctx.request.get(base+'/api/v1/graph-templates'),401);checked(guest_ctx.request.post(base+'/api/v1/graph-templates',data={'sourceFileId':source,'expectedFileRevision':1,'name':'不允许'}),401);checked(guest_ctx.request.post(base+'/api/v1/graph-templates/'+free['id']+'/loads',data={'version':2,'requestId':'guest-'+run}),401)
        record('guest','unauthenticated browser; template entry/shortcut blocked; catalog/publish/load denied 401')
        assert not errors,errors
        assert {item['role'] for item in results}=={'admin','teacher','other_teacher','student','member','viewer','guest'}
        browser.close()
    print('PASS template role matrix: 7/7 real browser identities; fixture only; all positive/negative paths checked',flush=True)



def publication_flow(base,output,source=False,tag='candidate'):
    """Complete publication -> preview -> independent-copy workflow on a disposable fixture."""
    from types import SimpleNamespace
    from uuid import uuid4
    A=SimpleNamespace(source=source,tag=tag);B=base.rstrip('/');O=Path(output);O.mkdir(parents=True,exist_ok=True)
    report={'baseUrl':B,'sourceOverrides':source,'results':[],'errors':[]};uid=uuid4().hex[:6]
    def check(label,condition=True,detail=None):
     assert condition,(label,detail);report['results'].append({'label':label,'pass':True,'detail':detail});print('PASS',label,flush=True);(O/(A.tag+'-results.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2))
    def dismiss(w):
     for sel in ['#learningEntryDismissBtn','.tour-skip','#hideHelpBtn']:
      if w.locator(sel).is_visible():w.locator(sel).click()
    def ready(w):
     w.wait_for_function('window.KGGraphFileTabs&&!KGGraphFileTabs.isSwitching()');dismiss(w)
     if A.source:w.add_script_tag(path=str(ROOT/'new-legacy/src/graph/template-center-controller.js'))
    def center(w):
     w.locator('#templateBtn').click();expect(w.locator('#graphTemplateCenter')).to_be_visible();expect(w.locator('#graphTemplateCenter [role=status]')).not_to_have_text('正在加载模板…')
    def close(w):w.locator('#graphTemplateCenter .template-center-actions').get_by_role('button',name='关闭',exact=True).click()
    def form(w,name,member=False,tid=None):
     if tid:maintenance(w.locator('[data-template-id="'+tid+'"]'),'更新为新版本').click()
     else:w.locator('[data-template-publish]').click()
     f=w.locator('.template-publication-form');f.locator('[name=name]').fill(name);f.locator('[name=description]').fill('完整流程 '+uid);f.locator('[name=memberOnly]').set_checked(member);return f
    def publish(w,f,tid=None):
     path='/api/v1/graph-templates'+('/'+tid+'/versions' if tid else '')
     with w.expect_response(lambda r:r.request.method=='POST' and r.url.endswith(path)) as res:f.get_by_role('button',name='发布新版本' if tid else '直接发布',exact=True).click()
     assert res.value.status==201,res.value.text();expect(f).to_have_count(0);return res.value.json()['template']
    def load(w,tid):
     row=w.locator('[data-template-id="'+tid+'"]')
     with w.expect_response('**/api/v1/graph-templates/'+tid+'/loads') as res:row.locator('[data-template-load]').click()
     assert res.value.status==201,res.value.text();expect(row.locator('[data-template-result]')).to_be_visible();return res.value.json()
    def edit_title(w,nid,text):
     card=w.locator('.knowledge-card[data-node-id="'+nid+'"]');card.locator('.node-title').dblclick();editor=w.locator('[data-node-inline-editor=true]');expect(editor).to_be_visible();editor.fill(text);w.mouse.click(1050,650);expect(editor).to_have_count(0)
    with sync_playwright() as pw:
     browser=pw.chromium.launch(channel='chrome');pages=[]
     def session(user):
      c=browser.new_context(viewport={'width':1440,'height':960});assert c.request.post(B+'/api/v1/auth/login',data={'username':user,'password':'ink-browser-test'}).ok;w=c.new_page();w.set_default_timeout(10000);w.on('pageerror',lambda e:report['errors'].append(str(e)));pages.append(w);return c,w
     try:
      teacher,w=session('ink-browser')
      setup=browser.new_context();assert setup.request.post(B+'/api/v1/auth/login',data={'username':'ink-admin','password':'ink-browser-test'}).ok;assert setup.request.put(B+'/api/v1/subscriptions/admin/ink-student',data={'planId':'free','status':'active','note':'isolated browser fixture reset'}).ok;setup.close()
      graph={'nodes':[{'id':'a','title':'完整学习体系','geometry':{'x':200,'y':250,'width':240,'height':130},'appearance':{'cardStyle':'rounded','fillColor':'#fff1f2','textColor':'#9f1239','fontSize':24,'borderColor':'#fb7185','borderWidth':2}},{'id':'b','title':'知识关联','x':650,'y':150},{'id':'c','title':'主动回忆','x':650,'y':450}], 'links':[{'id':'ab','from':'a','to':'b','pathStyle':'curve','strokeWidth':5,'color':'#db2777','arrowStyle':'end','curveControls':[{'x':500,'y':300},{'x':540,'y':160}]},{'id':'ac','from':'a','to':'c','pathStyle':'elbow','lineStyle':'dashed','waypoints':[{'x':550,'y':315},{'x':550,'y':516}]}], 'strokes':[{'id':'ink-pen','tool':'pen','width':5,'color':'#16a34a','opacity':.6,'points':[[280,600],[450,630],[700,600]]},{'id':'ink-text','tool':'text','text':'画布文字 '+uid,'width':24,'color':'#7c3aed','points':[[200,100]]}]}
      r=teacher.request.post(B+'/api/v1/files',data={'name':'模板全流程-'+uid,'graphData':graph});assert r.ok;fid=r.json()['file']['id'];assert teacher.request.put(B+'/api/v1/files/current',data={'fileId':fid}).ok
      w.goto(B+'/graph',wait_until='networkidle');ready(w);w.locator('.graph-mode-trigger').click();w.locator('[data-graph-mode-option=professional]').click();edit_title(w,'b','最新知识关联 '+uid);check('edit_source_through_visible_title_editor')
      center(w);f=form(w,'免费模板 '+uid);w.locator('[data-template-publish]').click();expect(f).to_have_count(1);expect(f.locator('[name=name]')).to_have_value('免费模板 '+uid);check('one_form_retains_input_on_repeated_publish_entry')
      posts=[];w.on('request',lambda r:posts.append(r.url) if r.method=='POST' and r.url.endswith('/graph-templates') else None)
      f.locator('[name=name]').fill(' \u3000 ');f.get_by_role('button',name='直接发布',exact=True).click();expect(w.locator('#graphTemplateCenter [role=status]')).to_contain_text('名称');assert not posts;check('whitespace_name_rejected_before_publish')
      f.locator('[name=name]').fill('  免费模板 '+uid+'  ')
      def fail(route):route.fulfill(status=503,json={'detail':'模板服务临时不可用'})
      w.route('**/api/v1/graph-templates',lambda route:fail(route) if route.request.method=='POST' else route.continue_())
      f.get_by_role('button',name='直接发布',exact=True).click();expect(w.locator('#graphTemplateCenter [role=status]')).to_contain_text('临时不可用');expect(f).to_be_visible();expect(f.locator('[name=name]')).to_have_value('  免费模板 '+uid+'  ');check('publish_503_retains_name_description_and_retry')
      w.unroute('**/api/v1/graph-templates');free=publish(w,f);tid=free['id'];check('retry_publishes_one_named_template',free['name']=='免费模板 '+uid and free['version']==1)
      original=teacher.request.get(B+'/api/v1/files/'+fid).json()['graphData'];row=w.locator('[data-template-id="'+tid+'"]');expect(row.locator('.template-thumbnail svg')).to_be_visible();row.locator('.template-thumbnail').click();panel=w.locator('.template-preview-window');drawing=panel.locator('svg');expect(drawing.locator('.knowledge-card')).to_have_count(3);expect(drawing.locator('[data-stroke-id=ink-text]')).to_have_text('画布文字 '+uid);assert drawing.locator('path[data-preview-link-id]').count()==2;check('preview_latest_cards_edges_pen_and_text')
      source_b=w.locator('#cardsLayer .knowledge-card[data-node-id=b] .node-title').text_content();assert drawing.locator('.knowledge-card[data-node-id=b] .node-title').text_content()==source_b
      attrs=['width','height','backgroundColor','borderRadius'];styles='(e,keys)=>Object.fromEntries(keys.map(k=>[k,getComputedStyle(e)[k]]))';source_style=w.locator('#cardsLayer .knowledge-card[data-node-id=a]').evaluate(styles,attrs);preview_style=drawing.locator('.knowledge-card[data-node-id=a]').evaluate(styles,attrs);check('preview_card_geometry_and_style_match_original',source_style==preview_style)
      view=drawing.get_attribute('viewBox');panel.get_by_role('button',name='放大预览',exact=True).click();assert drawing.get_attribute('viewBox')!=view;panel.get_by_role('button',name='缩小预览',exact=True).click();panel.get_by_role('button',name='适应视图',exact=True).click();assert drawing.get_attribute('viewBox')==view
      box=drawing.bounding_box();w.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2);w.mouse.down();w.mouse.move(box['x']+box['width']/2+75,box['y']+box['height']/2+30,steps=8);w.mouse.up();assert drawing.get_attribute('viewBox')!=view;panel.get_by_role('button',name='适应视图',exact=True).click();check('preview_zoom_pan_fit')
      before=w.evaluate('JSON.stringify({graph:saveableState(),history:KGGraphKernel.history.getState()})');w.keyboard.press('Delete');assert w.evaluate('JSON.stringify({graph:saveableState(),history:KGGraphKernel.history.getState()})')==before;check('preview_keyboard_cannot_change_source')
      panel.get_by_role('button',name='全屏',exact=True).click();w.wait_for_function('!!document.fullscreenElement');panel.get_by_role('button',name='退出全屏',exact=True).click();w.wait_for_function('!document.fullscreenElement');w.screenshot(path=str(O/(A.tag+'-preview.png')));panel.get_by_role('button',name='关闭模板预览',exact=True).click();check('preview_fullscreen_and_close')
      paid=publish(w,form(w,'会员模板 '+uid,True));close(w)
      student,s=session('ink-student');s.goto(B+'/graph',wait_until='networkidle');ready(s);student_source=student.request.get(B+'/api/v1/files/current').json();center(s);expect(s.locator('[data-template-publish]')).to_have_count(0);check('student_cannot_publish_in_ui')
      s.locator('[data-template-id="'+paid['id']+'"] [data-template-load]').click();expect(s.locator('#graphTemplateCenter [role=status]')).to_contain_text('需要有效会员');check('nonmember_paid_template_denied')
      copied=load(s,tid);copyid=copied['fileId'];row=s.locator('[data-template-id="'+tid+'"]');row.locator('[data-template-result]').click();s.wait_for_function('(id)=>KGGraphFileRemoteAdapter.getCurrentFileMeta()?.id===id&&!KGGraphFileTabs.isSwitching()',arg=copyid);check('student_load_opens_new_independent_graph',copyid!=fid)
      loaded=student.request.get(B+'/api/v1/files/'+copyid).json()['graphData'];check('copy_preserves_cards_links_strokes',len(loaded['nodes'])==3 and len(loaded['links'])==2 and len(loaded['strokes'])==2);check('copy_uses_new_ids',all(n['id'] not in {'a','b','c'} for n in loaded['nodes']) and all(t['id'] not in {'ink-pen','ink-text'} for t in loaded['strokes']))
      s.locator('.graph-mode-trigger').click();s.locator('[data-graph-mode-option=professional]').click();edit_title(s,copied['idMap']['b'],'学生副本改动 '+uid);s.wait_for_function('!KGGraphFileAutosave.isDirty()');s.reload(wait_until='networkidle');ready(s);expect(s.locator('.knowledge-card[data-node-id="'+copied['idMap']['b']+'"] .node-title')).to_have_text('学生副本改动 '+uid);check('copy_edit_saved_and_refreshed');check('copy_edit_leaves_published_source_unchanged',teacher.request.get(B+'/api/v1/files/'+fid).json()['graphData']==original)
      edit_title(w,'b','第二版知识关联 '+uid);center(w);f=form(w,'免费模板新版 '+uid,tid=tid);updated=publish(w,f,tid);check('teacher_updates_immutable_version',updated['version']==2);assert teacher.request.get(B+'/api/v1/graph-templates/'+tid).json()['preview']['version']==2
      check('new_version_leaves_existing_copy_unchanged',next(n for n in student.request.get(B+'/api/v1/files/'+copyid).json()['graphData']['nodes'] if n['id']==copied['idMap']['b'])['title']=='学生副本改动 '+uid)
      w.locator('[data-template-id=\"'+tid+'\"]').get_by_role('button',name='预览',exact=True).click();expect(w.locator('.template-preview-window .knowledge-card[data-node-id=b] .node-title')).to_have_text('第二版知识关联 '+uid);w.locator('.template-preview-window').get_by_role('button',name='关闭模板预览',exact=True).click();check('preview_shows_updated_version_content')
      row=w.locator('[data-template-id="'+tid+'"]');maintenance(row,'下架').click();expect(row).to_contain_text('已下架');check('downlist_keeps_loaded_copy',student.request.get(B+'/api/v1/files/'+copyid).ok);maintenance(row,'重新上架').click();expect(row).not_to_contain_text('已下架');check('relist_template')
      admin,a=session('ink-admin');a.goto(B+'/graph',wait_until='networkidle');ready(a);center(a);expect(a.locator('[data-template-id="'+tid+'"]')).to_be_visible();expect(a.locator('[data-template-id="'+tid+'"]')).to_contain_text('下架');check('admin_can_maintain_teacher_template')
      response=admin.request.put(B+'/api/v1/subscriptions/admin/ink-student',data={'planId':'lifetime','status':'active','note':'isolated browser template fixture'});assert response.ok,response.text();s.reload(wait_until='networkidle');ready(s);center(s);membercopy=load(s,paid['id']);check('active_member_loads_paid_template',membercopy['fileId']!=copyid)
      viewer,v=session('ink-viewer');v.goto(B+'/graph',wait_until='networkidle');ready(v);check('viewer_template_entry_hidden',not v.locator('#templateBtn').is_visible());check('viewer_catalog_denied',viewer.request.get(B+'/api/v1/graph-templates').status==403)
      body={'sourceFileId':fid,'expectedFileRevision':1,'name':'非法发布','memberOnly':False};check('student_publisher_api_denied',student.request.post(B+'/api/v1/graph-templates',data=body).status==403)
      check('server_rejects_blank_publication_name',teacher.request.post(B+'/api/v1/graph-templates',data={**body,'name':' \u3000 '}).status==422)
      anon=browser.new_context();check('guest_templates_require_login',anon.request.get(B+'/api/v1/graph-templates').status==401);anon.close();check('no_browser_page_errors',not report['errors'],report['errors'])
      report['version']=teacher.request.get(B+'/VERSION').text().strip();report['pass']=True
     except Exception as e:
      report['pass']=False;report['error']=str(e)
      for i,p in enumerate(pages):
       try:p.screenshot(path=str(O/(A.tag+'-failure-'+str(i)+'.png')))
       except Exception:pass
      raise
     finally:
      (O/(A.tag+'-results.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2));browser.close()

if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('--role-matrix',action='store_true');parser.add_argument('--full-flow',action='store_true');parser.add_argument('--source',action='store_true');parser.add_argument('--tag',default='candidate');parser.add_argument('--base-url',default='http://127.0.0.1:5265');parser.add_argument('--output',default=str(ROOT/'artifacts/window-role-qa/templates'));args=parser.parse_args()
    if args.full_flow:publication_flow(args.base_url,args.output,args.source,args.tag)
    elif args.role_matrix:role_matrix(args.base_url.rstrip('/'),args.output)
    else:main()
