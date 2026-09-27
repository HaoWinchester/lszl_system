#!/usr/bin/env python3
"""Run against the disposable canvas_ink_server only; graph persistence and shared history."""
import argparse
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/canvas-tools'

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--base-url',required=True);args=parser.parse_args()
    base=args.base_url.rstrip('/');assert urlparse(base).hostname in ('127.0.0.1','localhost')
    OUT.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless=True)
        ctx=browser.new_context(viewport={'width':1440,'height':1000})
        assert ctx.request.post(base+'/api/v1/auth/login',data={'username':'ink-browser','password':'ink-browser-test'}).ok
        graph={'meta':{'title':'画笔截图验证'},'viewport':{'x':200,'y':180,'scale':1},'nodes':[{'id':'n1','title':'风险分析','x':100,'y':100},{'id':'n2','title':'采取措施','x':500,'y':200}], 'links':[{'id':'e1','from':'n1','to':'n2'}]}
        response=ctx.request.post(base+'/api/v1/files',data={'name':'画笔截图验证','graphData':graph});assert response.ok,response.text()
        fid=response.json()['file']['id'];assert ctx.request.put(base+'/api/v1/files/current',data={'fileId':fid}).ok
        page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(base+'/index.html',wait_until='networkidle')
        if page.locator('#learningEntryDismissBtn').is_visible(): page.locator('#learningEntryDismissBtn').click()
        page.wait_for_timeout(600)
        if page.locator('.tour-skip').is_visible(): page.locator('.tour-skip').click()
        expect(page.locator('#homeInkBtn')).to_be_visible(timeout=10000)
        page.wait_for_function('!!window.KGHomeInk')
        tool=page.locator('.canvas-ink-toolbar');expect(tool).to_be_hidden()
        page.locator('#homeInkBtn').click();expect(tool).to_be_visible()
        # Real pointer drawing, followed by a graph edit: one shared undo order.
        page.mouse.move(700,500);page.mouse.down();page.mouse.move(820,560,steps=15);page.mouse.up()
        expect(page.locator('.canvas-ink-layer path')).to_have_count(1)
        page.locator('#homeInkBtn').click();expect(tool).to_be_hidden()
        page.evaluate("pushGraphUndoSnapshot('移动卡牌');state.nodes[0].x+=30;render({persist:true})")
        page.keyboard.press('ControlOrMeta+z');expect(page.locator('.canvas-ink-layer path')).to_have_count(1)
        page.keyboard.press('ControlOrMeta+z');expect(page.locator('.canvas-ink-layer path')).to_have_count(0)
        page.keyboard.press('ControlOrMeta+Shift+z');expect(page.locator('.canvas-ink-layer path')).to_have_count(1)
        assert page.evaluate('KGGraphFileRemoteAdapter.active()') is True
        assert page.evaluate('persistCurrentGraphNow()') is True
        response=ctx.request.get(base+'/api/v1/files/'+fid);assert response.ok,response.text()
        assert len(response.json()['graphData']['strokes'])==1,response.text()[:300]
        page.reload(wait_until='networkidle');expect(page.locator('.canvas-ink-layer path')).to_have_count(1)
        expect(tool).to_be_hidden()
        with page.expect_download(timeout=30000) as download: page.locator('#homeCaptureBtn').click()
        download.value.save_as(str(OUT/'graph-capture.png'))
        page.screenshot(path=str(OUT/'graph-page.png'))
        page.locator('#homeInkBtn').click();tool.locator('[data-ink-tool=eraser]').dblclick()
        expect(page.locator('.canvas-ink-layer path')).to_have_count(0)
        tool.locator('[data-ink-action=undo]').click();expect(page.locator('.canvas-ink-layer path')).to_have_count(1)
        assert len(page.evaluate('state.nodes'))==2
        page.evaluate("KGHomeToolbarRegistry.setMode('professional')")
        expect(page.locator('#homeInkBtn')).to_have_attribute('aria-expanded','true')
        page.locator('#homeInkBtn').click();expect(tool).to_be_hidden()
        # Second file and return must keep independent persisted ink.
        response=ctx.request.post(base+'/api/v1/files',data={'name':'第二图谱','graphData':graph});assert response.ok
        second=response.json()['file']['id']
        # Slow remote save must lock drawing and keyboard undo until file open completes.
        page.locator('#homeInkBtn').click()
        page.mouse.move(650,560);page.mouse.down();page.mouse.move(760,600,steps=10);page.mouse.up()
        expect(page.locator('.canvas-ink-layer path')).to_have_count(2)
        held=[]
        def delay(route):
            if route.request.method=='PUT':held.append(route)
            else:route.continue_()
        page.route('**/api/v1/files/'+fid,delay)
        page.evaluate('(id)=>{void KGGraphFileTabs.openFile(id)}',second)
        page.wait_for_function('KGGraphFileTabs.isSwitching()')
        expect(page.locator('#homeInkBtn')).to_be_disabled()
        page.keyboard.press('ControlOrMeta+z')
        page.mouse.move(650,620);page.mouse.down();page.mouse.move(760,650,steps=10);page.mouse.up()
        expect(page.locator('.canvas-ink-layer path')).to_have_count(2)
        for _ in range(100):
            if held:break
            page.wait_for_timeout(25)
        assert held,'switch did not save dirty graph'
        for route in held:route.continue_()
        page.unroute('**/api/v1/files/'+fid,delay)
        page.wait_for_function('!KGGraphFileTabs.isSwitching()')
        expect(page.locator('.canvas-ink-layer path')).to_have_count(0)
        assert page.evaluate('(id)=>KGGraphFileTabs.openFile(id)',fid) is True
        expect(page.locator('.canvas-ink-layer path')).to_have_count(2)
        assert len(ctx.request.get(base+'/api/v1/files/'+fid).json()['graphData']['strokes'])==2
        # Readonly must guard the existing keyboard history as well as ink buttons.
        tool.locator('[data-ink-tool=eraser]').dblclick()
        expect(page.locator('.canvas-ink-layer path')).to_have_count(0)
        page.evaluate("document.body.classList.add('auth-readonly');KGHomeInk.refreshControls()")
        page.keyboard.press('ControlOrMeta+z')
        expect(page.locator('.canvas-ink-layer path')).to_have_count(0)
        expect(page.locator('#homeInkBtn')).to_be_disabled()
        page.evaluate("document.body.classList.remove('auth-readonly');KGHomeInk.refreshControls()")
        tool.locator('[data-ink-action=undo]').click();expect(page.locator('.canvas-ink-layer path')).to_have_count(2)
        assert not errors,errors
        print('home-canvas-tools: launcher, drawing, shared undo, persistence, screenshot, clear/undo, rebuilt toolbar and file isolation passed')
        browser.close()
if __name__=='__main__':main()
