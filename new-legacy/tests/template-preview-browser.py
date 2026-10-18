"""Real isolated API + UI preview: panning, zoom, fullscreen, failure retry and copies."""
import argparse
from pathlib import Path
from uuid import uuid4
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/learning-tool-feedback/template';OUT.mkdir(parents=True,exist_ok=True)
parser=argparse.ArgumentParser();parser.add_argument('--base-url',default='http://127.0.0.1:5227');args=parser.parse_args();base=args.base_url
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
    assert not errors,errors
    ctx.request.patch(base+'/api/v1/graph-templates/'+tid,data={'listed':False});ctx.request.delete(base+'/api/v1/files/'+fid);ctx.request.delete(base+'/api/v1/files/'+copy)
    browser.close()
print('PASS real template thumbnail/detail, pan/zoom/fit/window drag/fullscreen/narrow/retry/copy isolation')
