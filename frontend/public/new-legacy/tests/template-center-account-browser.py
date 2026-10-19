"""Actual template controller async owner-boundary regressions in Chrome."""
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[2]
with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,channel='chrome')
    def setup():
        page=browser.new_page();page.set_content('<!doctype html><body></body>')
        page.evaluate('''() => {
          window.owner='A';window.writes=[];window.refreshes=0;window.fakeFull=null;window.loadMode='ready';
          window.KGAuthCore={currentUser:()=>owner?{username:owner,role:'student'}:null};
          window.KGGraphFileEditorStoreBridge={isRemote:()=>true};
          window.KGTemplatePreview={mount:()=>({destroy(){},fit(){},zoom(){}})};
          window.KGGraphFileRemoteStore={refresh:async()=>{refreshes++}};
          window.KGGraphFileTabs={refresh:async()=>{refreshes++}};
          Object.defineProperty(document,'fullscreenElement',{configurable:true,get:()=>fakeFull});
          document.exitFullscreen=()=>new Promise(resolve=>window.releaseExit=()=>{fakeFull=null;resolve()});
          window.fetch=async(url,options={})=>{
            if(options.method==='POST'){
              writes.push({url,owner});
              if(loadMode==='pending')return new Promise(resolve=>window.releaseLoad=()=>resolve({ok:true,json:async()=>({fileId:'A-private-copy',version:1})}));
              if(loadMode==='failure')return new Promise((resolve,reject)=>window.rejectLoad=()=>reject(Error('A-private-error')));
              return {ok:true,json:async()=>({fileId:'new-copy',version:1})};
            }
            return {ok:true,json:async()=>url.endsWith('template-one')?{template:{id:'template-one',name:'Template one',listed:true},preview:{version:1,nodes:[],links:[]}}:{templates:[{id:'template-one',name:'Template one',version:1,listed:true}]}};
          };
        }''')
        page.add_script_tag(path=str(ROOT/'new-legacy/src/graph/template-center-controller.js'))
        page.evaluate('KGGraphTemplateCenter.open()')
        expect(page.locator('[data-template-id]')).to_be_visible();return page
    p=setup();p.locator('.template-card-actions button').first.click()
    use=p.locator('.template-preview-window footer button').last;expect(use).to_be_enabled()
    p.evaluate("fakeFull=document.querySelector('.template-preview-surface')")
    use.click();p.wait_for_function('!!window.releaseExit')
    p.evaluate("owner='B';dispatchEvent(new Event('kg-auth-session-change'));releaseExit()")
    expect(p.locator('#graphTemplateCenter')).to_have_count(0)
    p.wait_for_timeout(100)
    assert p.evaluate('writes')==[],p.evaluate('writes')
    p.close()
    for mode in ('pending','failure'):
        p=setup();p.evaluate('mode=>loadMode=mode',mode);p.locator('[data-template-load]').click()
        p.wait_for_function('writes.length===1')
        p.evaluate("owner='B';dispatchEvent(new Event('kg-auth-session-change'))")
        expect(p.locator('#graphTemplateCenter')).to_have_count(0)
        p.evaluate('mode=>mode===\"pending\"?releaseLoad():rejectLoad()',mode)
        p.wait_for_timeout(100)
        assert p.evaluate('refreshes')==0
        assert p.locator('[data-template-result]').count()==0
        assert 'A-private' not in p.locator('body').inner_text()
        p.close()
    browser.close()
print('PASS fullscreen-dismiss owner switch blocks POST; pending load success/failure cannot refresh or repaint next account')
