"""Native workspace wheel zoom, editable text anchoring and database reload."""
import argparse,json,uuid
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright,expect

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--base-url',required=True)
parser.add_argument('--source',action='store_true',help='Overlay changed authoritative source on a local fixture server')
args=parser.parse_args();base=args.base_url.rstrip('/')
assert urlparse(base).hostname in ('127.0.0.1','localhost'),'Use a disposable local canvas fixture'
sources=['src/canvas/94-canvas-ink.js','src/canvas/79-canvas-viewport-controller.js','styles/canvas-ink.css']
def override(route):
    path=urlparse(route.request.url).path.lstrip('/')
    if path in sources:route.fulfill(path=str(ROOT/path));return
    if path.startswith('bundles/') and path.endswith('.js'):
        response=route.fetch();body=response.text();marker='})([['
        if marker in body:
            start=body.index(marker)+3;entries=json.loads(body[start:body.rindex(');')])
            for entry in entries:
                if entry[0] in sources:entry[1]=(ROOT/entry[0]).read_text()
            body=body[:start]+json.dumps(entries,ensure_ascii=False)+');'
        route.fulfill(response=response,body=body);return
    route.continue_()

with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='chrome');context=browser.new_context(viewport={'width':1440,'height':1000})
    if args.source:context.route('**/*',override)
    assert context.request.post(base+'/api/v1/auth/login',data={'username':'ink-browser','password':'ink-browser-test'}).ok
    wid='text-zoom-'+uuid.uuid4().hex[:10];message='缩放文字定位 '+wid
    payload={'id':wid,'userId':'ink-browser','title':'文字缩放回归','schemaVersion':10,'nodes':{},'edges':[],'groups':[],'strokes':[],'viewport':{'x':0,'y':0,'zoom':1}}
    assert context.request.post(base+'/api/v1/workspaces',data={'id':wid,'title':payload['title'],'schemaVersion':10,'payload':payload}).ok
    page=context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    page.goto(base+'/question-workspace.html?paperId=ink-paper&releaseId=ink-release&workspace='+wid,wait_until='networkidle')
    page.wait_for_function('!!window.KGWorkspaceInk && !KGMultiQuestionWorkspace.getState().readonly')
    page.evaluate('KGMultiQuestionWorkspace.setViewport({x:0,y:0,zoom:1},{instant:true,persist:false})')
    assert page.evaluate('KGWorkspaceInk.openTextAt(400,350)')
    editor=page.get_by_role('textbox',name='画布文字内容');editor.fill(message)
    point=page.evaluate('''()=>{const r=document.querySelector('#qwCanvasViewport').getBoundingClientRect();return [400-r.left,350-r.top]}''')
    assert page.locator('.canvas-ink-text-editor-viewport').evaluate('e=>getComputedStyle(e).scrollbarWidth')=='none'
    for delta in [220,-220,220,-220]:
        before=page.evaluate('KGMultiQuestionWorkspace.getState().zoom')
        page.evaluate('''point=>{
            window.textZoomSamples=[];window.textZoomUntil=performance.now()+350;
            const sample=()=>{const v=KGMultiQuestionWorkspace.getState(),r=document.querySelector('#qwCanvasViewport').getBoundingClientRect(),e=document.querySelector('.canvas-ink-text-editor-viewport')?.getBoundingClientRect();
                if(e)textZoomSamples.push({x:e.x-(r.left+v.panX+(point[0]-8)*v.zoom),y:e.y-(r.top+v.panY+(point[1]-4)*v.zoom),zoom:v.zoom});
                if(performance.now()<textZoomUntil)requestAnimationFrame(()=>setTimeout(sample,0));};sample();
        }''',point)
        page.mouse.move(950,500);page.mouse.wheel(0,delta)
        page.wait_for_function('performance.now()>textZoomUntil')
        samples=page.evaluate('textZoomSamples')
        assert len(set(round(s['zoom'],4) for s in samples))>2,'Native wheel must exercise animated zoom'
        assert max(max(abs(s['x']),abs(s['y'])) for s in samples)<1,('Text detached during native wheel zoom',samples)
        assert page.evaluate('KGMultiQuestionWorkspace.getState().zoom')!=before
        expect(editor).to_be_focused();expect(editor).to_have_value(message)
    editor.press('Control+Enter');expect(editor).to_have_count(0)
    data=context.request.get(base+'/api/v1/workspaces/'+wid).json()
    workspace=data.get('workspace',data);stroke=workspace['payload']['strokes'][0]
    assert stroke['text']==message and stroke['points']==[point],stroke
    page.reload(wait_until='networkidle');text=page.locator('.canvas-ink-layer text').filter(has_text=message);expect(text).to_be_visible()
    saved=text.evaluate('e=>{const b=e.getBBox();return [b.x,b.y,b.width,b.height,e.getAttribute("font-size")]}')
    for delta in [220,-220]:
        page.mouse.move(950,500);page.mouse.wheel(0,delta);page.wait_for_timeout(250)
        assert text.evaluate('e=>{const b=e.getBBox();return [b.x,b.y,b.width,b.height,e.getAttribute("font-size")]}')==saved
    for button in ['#qwZoomInBtn','#qwZoomOutBtn']:
        before=page.evaluate('KGMultiQuestionWorkspace.getState().zoom');page.locator(button).click();page.wait_for_timeout(250)
        assert page.evaluate('KGMultiQuestionWorkspace.getState().zoom')!=before
        assert text.evaluate('e=>{const b=e.getBBox();return [b.x,b.y,b.width,b.height,e.getAttribute("font-size")]}')==saved
    page.evaluate('KGWorkspaceInk.setTool("text")');text.dblclick(position={'x':8,'y':8},force=True);expect(editor).to_have_value(message)
    editor.fill('取消修改');editor.press('Escape');expect(text).to_have_text(message)
    assert not errors,errors
    print('PASS native multi-question wheel: every-frame text anchor <1px, focus/draft retained, hidden scrollbars, DB save/reload, saved wheel/button geometry, cancel recovery')
    browser.close()
