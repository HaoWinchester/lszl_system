"""Real isolated API + UI preview: panning, zoom, fullscreen, failure retry and copies."""
import argparse
from pathlib import Path
from uuid import uuid4
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/learning-tool-feedback/template';OUT.mkdir(parents=True,exist_ok=True)
parser=argparse.ArgumentParser();parser.add_argument('--base-url',default='http://127.0.0.1:5227');parser.add_argument('--legacy-mode',action='store_true');args=parser.parse_args();base=args.base_url
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='chrome');ctx=browser.new_context(viewport={'width':1440,'height':960})
    assert ctx.request.post(base+'/api/v1/auth/login',data={'username':'ink-browser','password':'ink-browser-test'}).ok
    graph={'nodes':[{'id':'a','geometry':{'x':0,'y':140,'width':600,'height':80},'title':'个人知识体系','fillColor':'#eff6ff','content':{'notes':'PRIVATE NOTES'}},{'id':'b','x':300,'y':0,'title':'知识归纳'},{'id':'c','x':300,'y':280,'title':'主动回忆'}], 'links':[{'id':'ab','from':'a','to':'b'},{'id':'ac','from':'a','to':'c'}]}
    response=ctx.request.post(base+'/api/v1/files',data={'name':'preview-'+uuid4().hex[:8],'graphData':graph});assert response.ok,response.text();fid=response.json()['file']['id']
    response=ctx.request.post(base+'/api/v1/graph-templates',data={'sourceFileId':fid,'expectedFileRevision':1,'name':'预览交互验证','description':'建立自己的知识体系','memberOnly':False});assert response.ok,response.text();tid=response.json()['template']['id']
    p=ctx.new_page();errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
    p.goto(base+'/graph?fileId='+fid,wait_until='networkidle');p.wait_for_function('!KGGraphFileTabs.isSwitching()')
    for selector in ('#learningEntryDismissBtn','.tour-skip','#hideHelpBtn'):
        if p.locator(selector).is_visible():p.locator(selector).click()
    if args.legacy_mode:
        assert p.evaluate('__KG_DIRECT_BOOTSTRAP__.graphFilesApiCutoverEnabled') is False
        assert p.evaluate('KGGraphFileApi.isRemote()') is False
        mutations=[];p.on('request',lambda request:mutations.append(request.url) if request.method=='POST' and '/graph-templates' in request.url else None)
        temporary=p.evaluate('JSON.stringify(state)')
        p.locator('#templateBtn').click();p.locator('[data-template-publish]').click()
        expect(p.locator('.template-publication-form')).to_have_count(0)
        expect(p.locator('#graphTemplateCenter [role=status]')).to_contain_text('导出学习包')
        row=p.locator('[data-template-id="'+tid+'"]');row.locator('.template-thumbnail').click()
        expect(p.locator('.template-preview-window svg')).to_be_visible()
        p.locator('.template-preview-window').get_by_role('button',name='加载为新图谱',exact=True).click()
        expect(p.locator('#graphTemplateCenter [role=status]')).to_contain_text('恢复在线图谱')
        assert mutations==[],mutations
        assert p.evaluate('JSON.stringify(state)')==temporary
        assert not errors,errors
        ctx.request.patch(base+'/api/v1/graph-templates/'+tid,data={'listed':False});ctx.request.delete(base+'/api/v1/files/'+fid)
        browser.close();print('PASS explicit legacy configuration: real preview remains available; publication/loading blocked before mutation; temporary graph preserved; recovery instructions shown')
        raise SystemExit(0)
    assert p.evaluate('__KG_DIRECT_BOOTSTRAP__.graphFilesApiCutoverEnabled') is True
    assert p.evaluate('KGGraphFileApi.isRemote()') is True
    source_tab=p.locator('.graph-file-tab[data-file-id="'+fid+'"]');expect(source_tab).to_be_visible();source_tab.click()
    p.wait_for_function('(id)=>!KGGraphFileTabs.isSwitching()&&KGGraphFileRemoteAdapter.getCurrentFileMeta()?.id===id&&state.nodes.some(node=>node.id==="b")',arg=fid)
    before=ctx.request.get(base+'/api/v1/files/'+fid).json()['graphData']
    p.locator('#templateBtn').click();row=p.locator('[data-template-id="'+tid+'"]')
    expect(row.locator('.template-thumbnail svg')).to_be_visible()
    updated=ctx.request.post(base+'/api/v1/graph-templates/'+tid+'/versions',data={'sourceFileId':fid,'expectedFileRevision':1,'name':'预览交互验证','description':'更新后的知识体系','memberOnly':False})
    assert updated.ok and updated.json()['template']['version']==2
    row.locator('.template-thumbnail').click()
    panel=p.locator('.template-preview-window');drawing=panel.locator('svg');expect(drawing).to_be_visible()
    assert drawing.locator('rect').count()==3
    assert drawing.locator('rect').first.get_attribute('width')=='600'
    assert drawing.locator('rect').first.get_attribute('height')=='80'
    original=drawing.get_attribute('viewBox');panel.get_by_role('button',name='放大预览').click();assert drawing.get_attribute('viewBox')!=original
    box=drawing.bounding_box();p.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2);p.mouse.down();p.mouse.move(box['x']+box['width']/2+45,box['y']+box['height']/2+30,steps=5);p.mouse.up();moved=drawing.get_attribute('viewBox');assert moved!=original
    panel.get_by_role('button',name='适应视图').click();assert drawing.get_attribute('viewBox')==original
    header=panel.locator('header h3').bounding_box();old=panel.bounding_box();p.mouse.move(header['x']+20,header['y']+10);p.mouse.down();p.mouse.move(header['x']+50,header['y']+40,steps=4);p.mouse.up();assert panel.bounding_box()['x']>old['x']+20
    panel.get_by_role('button',name='全屏',exact=True).click();p.wait_for_function("document.fullscreenElement?.classList.contains('template-preview-surface')")
    p.screenshot(path=str(OUT/'fullscreen.png'));panel.get_by_role('button',name='退出全屏',exact=True).click();p.wait_for_function('!document.fullscreenElement')
    panel.get_by_role('button',name='关闭模板预览').click();expect(panel).to_have_count(0)
    row.get_by_role('button',name='预览',exact=True).click();expect(drawing).to_be_visible();p.set_viewport_size({'width':390,'height':844});p.screenshot(path=str(OUT/'narrow.png'));r=panel.bounding_box();assert r['width']<=390 and r['height']<=844
    panel.get_by_role('button',name='关闭模板预览').click();p.set_viewport_size({'width':1440,'height':960})
    failed={'value':True}
    def fail_once(route):
        if failed['value']:failed['value']=False;route.fulfill(status=503,json={'detail':'临时加载失败'})
        else:route.continue_()
    p.route('**/api/v1/graph-templates/'+tid,fail_once)
    row.get_by_role('button',name='预览',exact=True).click();expect(panel.get_by_role('button',name='重试预览')).to_be_visible();panel.get_by_role('button',name='重试预览').click();expect(drawing).to_be_visible()
    p.screenshot(path=str(OUT/'desktop.png'))
    with p.expect_response('**/api/v1/graph-templates/'+tid+'/loads') as loaded:
        panel.get_by_role('button',name='加载为新图谱').click()
    assert loaded.value.json()['version']==2, 'loaded copy must match the displayed latest preview'
    expect(row.locator('[data-template-result]')).to_be_visible();copy=row.locator('[data-template-result]').get_attribute('data-template-result');assert copy!=fid
    assert ctx.request.get(base+'/api/v1/files/'+fid).json()['graphData']==before
    assert 'PRIVATE NOTES' not in str(ctx.request.get(base+'/api/v1/graph-templates/'+tid).json())
    # Real dirty editor -> failed save -> retry -> durable publication of the latest graph.
    p.locator('#graphTemplateCenter .template-center-actions button:last-child').click()
    source_tab.click()
    p.wait_for_function('(id)=>!KGGraphFileTabs.isSwitching()&&KGGraphFileRemoteAdapter.getCurrentFileMeta()?.id===id&&state.nodes.some(node=>node.id==="b")',arg=fid)
    p.locator('.graph-mode-trigger').click();p.locator('[data-graph-mode-option="professional"]').click()
    card=p.locator('.knowledge-card[data-node-id="b"]');box=card.bounding_box()
    p.mouse.move(box['x']+box['width']/2,box['y']+12);p.mouse.down();p.mouse.move(box['x']+box['width']/2+70,box['y']+62,steps=8);p.mouse.up()
    p.wait_for_function('KGGraphFileAutosave.isDirty()')
    latest=p.evaluate('JSON.parse(JSON.stringify(state.nodes.find(n=>n.id==="b")))')
    assert ctx.request.get(base+'/api/v1/files/'+fid).json()['graphData']==before, 'dirty edit must not already be saved by the test'
    publications=[]
    p.on('request',lambda request:publications.append(request.url) if request.method=='POST' and request.url.endswith('/graph-templates') else None)
    def fail_save(route):
        if route.request.method=='PUT':route.fulfill(status=503,json={'detail':'模拟保存失败'})
        else:route.continue_()
    p.route('**/api/v1/files/'+fid,fail_save)
    p.locator('#templateBtn').click();p.locator('[data-template-publish]').click()
    form=p.locator('.template-publication-form');form.locator('[name=name]').fill('最新画布发布回归');form.locator('[name=description]').fill('保留输入并重试')
    form.get_by_role('button',name='直接发布',exact=True).click()
    expect(p.locator('#graphTemplateCenter [role=status]')).to_contain_text('保存失败')
    assert publications==[];expect(form).to_be_visible();expect(form.locator('[name=name]')).to_have_value('最新画布发布回归')
    p.unroute('**/api/v1/files/'+fid,fail_save)
    with p.expect_response(lambda response:response.request.method=='POST' and response.url.endswith('/graph-templates')) as published:
        form.get_by_role('button',name='直接发布',exact=True).click()
    assert published.value.ok,published.value.text();new_tid=published.value.json()['template']['id'];expect(form).to_have_count(0)
    saved=ctx.request.get(base+'/api/v1/files/'+fid).json();assert saved['meta']['revision']>1
    saved_node=next(n for n in saved['graphData']['nodes'] if n['id']=='b');assert saved_node['geometry']==latest['geometry']
    loaded=ctx.request.post(base+'/api/v1/graph-templates/'+new_tid+'/loads',data={'version':1,'requestId':'publish-latest-'+uuid4().hex});assert loaded.ok,loaded.text()
    new_copy=loaded.json()['fileId'];copied=ctx.request.get(base+'/api/v1/files/'+new_copy).json()['graphData']
    assert next(n for n in copied['nodes'] if n['id']==loaded.json()['idMap']['b'])['geometry']==latest['geometry']
    assert len(publications)==1
    p.reload(wait_until='networkidle')
    p.wait_for_function('(id)=>!KGGraphFileTabs.isSwitching()&&KGGraphFileRemoteAdapter.getCurrentFileMeta()?.id===id&&state.nodes.some(node=>node.id==="b")',arg=fid)
    assert p.evaluate('state.nodes.find(node=>node.id==="b").geometry')==latest['geometry'], 'default configuration must restore the saved graph after refresh'
    assert p.evaluate('KGGraphFileApi.isRemote()') is True
    assert not errors,errors
    ctx.request.patch(base+'/api/v1/graph-templates/'+new_tid,data={'listed':False});ctx.request.delete(base+'/api/v1/files/'+new_copy)
    ctx.request.patch(base+'/api/v1/graph-templates/'+tid,data={'listed':False});ctx.request.delete(base+'/api/v1/files/'+fid);ctx.request.delete(base+'/api/v1/files/'+copy)
    browser.close()
print('PASS real template thumbnail/detail, pan/zoom/fit/window drag/fullscreen/narrow/retry/copy isolation; dirty publication save failure/retry/latest persisted graph')
