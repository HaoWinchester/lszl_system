"""Image load, details, save/reopen and independent same-owner copy."""
import argparse,base64
from io import BytesIO
from PIL import Image
from playwright.sync_api import sync_playwright

def main():
    p=argparse.ArgumentParser();p.add_argument('--base-url',required=True);base=p.parse_args().base_url.rstrip('/');assert base.startswith('http://127.0.0.1:')
    data=BytesIO();Image.new('RGB',(12,16),'blue').save(data,format='PNG')
    with sync_playwright() as pw:
        browser=pw.chromium.launch(channel='chrome');ctx=browser.new_context(viewport={'width':1440,'height':1000})
        assert ctx.request.post(base+'/api/v1/auth/login',data={'username':'ink-browser','password':'ink-browser-test'}).ok
        asset=ctx.request.post(base+'/api/v1/graph-assets',data={'filename':'test.png','mimeType':'image/png','dataBase64':base64.b64encode(data.getvalue()).decode(),'alt':'蓝图'}).json()['asset']
        graph={'nodes':[{'id':'a','title':'图片','x':400,'y':300,'content':{'title':'图片','notes':'长备注\n'*1500,'images':[asset,asset]}}],'links':[]}
        source=ctx.request.post(base+'/api/v1/files',data={'name':'media','graphData':graph}).json()['file']['id']
        assert ctx.request.put(base+'/api/v1/files/current',data={'fileId':source}).ok
        page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto(base+'/index.html',wait_until='networkidle');page.wait_for_function('!KGGraphFileTabs.isSwitching()')
        page.wait_for_function("document.querySelectorAll('.graph-card-image').length===2 && [...document.querySelectorAll('.graph-card-image')].every(i=>i.complete&&i.naturalWidth===12)")
        page.evaluate("state.selectedNodeId='a';renderDetails()")
        assert page.locator('.graph-detail-image').count()==2
        assert page.evaluate('save({force:true})');saved=page.evaluate('saveableState()');page.reload(wait_until='networkidle');page.wait_for_function('!KGGraphFileTabs.isSwitching()')
        assert page.evaluate('saveableState()')==saved
        copy=ctx.request.post(base+'/api/v1/files/'+source+'/duplicate',data={});assert copy.ok,copy.text();target=copy.json()['file']['id']
        assert ctx.request.delete(base+'/api/v1/files/'+source).ok
        assert ctx.request.put(base+'/api/v1/files/current',data={'fileId':target}).ok
        page.reload(wait_until='networkidle');page.wait_for_function('!KGGraphFileTabs.isSwitching()');page.wait_for_function("document.querySelectorAll('.graph-card-image').length===2 && [...document.querySelectorAll('.graph-card-image')].every(i=>i.complete&&i.naturalWidth===12)")
        assert page.evaluate('state.nodes[0].notes.length')==6000
        assert not errors,errors
        browser.close();print('PASS graph image save/reopen/copy and detail display')
if __name__=='__main__':main()
