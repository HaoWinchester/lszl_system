#!/usr/bin/env python3
from pathlib import Path
import re
import sys
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
ARGS=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']

def text(path): return (ROOT/path).read_text(encoding='utf-8')
def page_parts(file):
    source=text(file)
    match=re.search(r'<body([^>]*)>([\s\S]*)</body>',source,re.I)
    attrs=match.group(1)
    body=re.sub(r'<script[\s\S]*?</script>','',match.group(2),flags=re.I)
    scripts=re.findall(r'<script[^>]+src="([^"]+)"',source,re.I)
    styles=re.findall(r'<link[^>]+href="([^"]+\.css)"',source,re.I)
    return attrs,body,scripts,styles

def install_storage(page):
    page.evaluate("""()=>{
      const local=new Map(),session=new Map();
      const storage=map=>({getItem:k=>map.has(String(k))?map.get(String(k)):null,setItem:(k,v)=>map.set(String(k),String(v)),removeItem:k=>map.delete(String(k)),clear:()=>map.clear(),key:i=>[...map.keys()][i]||null,get length(){return map.size}});
      Object.defineProperty(window,'localStorage',{configurable:true,value:storage(local)});
      Object.defineProperty(window,'sessionStorage',{configurable:true,value:storage(session)});
      const username='p430-user';
      localStorage.setItem('kg_local_current_user_v1',username);
      localStorage.setItem('kg_local_users_v1',JSON.stringify({[username]:{username,displayName:'P4.3.0 用户',role:'teacher',status:'active',subject:'PMP',salt:'x',hash:'x'}}));
      const question={id:'p430-q1',title:'统一画布测试题',teacherNumber:'P430-1',type:'single_choice',subject:'PMP',stemParts:[{text:'项目团队需要统一视图。'}],options:[{id:'A',text:'建立统一运行时',correct:true},{id:'B',text:'复制四套代码'}],clues:[{id:'runtime',text:'统一运行时',recallNodeId:'runtime'}],concepts:[],answer:'A'};
      const release={id:'p430-release',releaseId:'p430-release',paperId:'p430-paper',version:1,name:'P4.3.0 发布卷',title:'P4.3.0 发布卷',subject:'PMP',status:'published',publishedAt:1,enabledModes:['deep_recall','multi_question_canvas','single_deep_study'],totalCount:1,questions:[{bankId:'p430-bank',questionId:'p430-q1',order:1}],questionSnapshots:[{bankId:'p430-bank',bankName:'P4.3.0 题库',bankSubject:'PMP',questionId:'p430-q1',question}]};
      localStorage.setItem('kg_exam_papers_published_v1',JSON.stringify([release]));
      localStorage.setItem('kg_question_banks_v1__user__'+username,JSON.stringify([{id:'p430-bank',name:'P4.3.0 题库',subject:'PMP',questions:[question]}]));
      window.alert=()=>{};window.confirm=()=>true;window.open=()=>null;
    }""")

def load_page(page,file):
    attrs,body,scripts,styles=page_parts(file)
    page.set_content(f'<!doctype html><html><head><base href="http://localhost/"></head><body{attrs}>{body}</body></html>')
    install_storage(page)
    for style in styles:
        target=ROOT/style
        if target.exists(): page.add_style_tag(content=target.read_text(encoding='utf-8'))
    for script in scripts:
        target=ROOT/script
        if target.exists(): page.add_script_tag(content=target.read_text(encoding='utf-8'))
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
    page.wait_for_timeout(750)

CASES=[
 ('index.html','KGHomeGraphCanvasAdapter','#canvasZoomPercentBtn','home-graph-canvas'),
 ('question-workspace.html','KGMultiQuestionCanvasAdapter','#qwZoomLabel','multi-question-canvas'),
 ('question-training.html','KGSingleQuestionCanvasAdapter','#qtCanvasZoomLabel','single-question-canvas'),
 ('knowledge-recall.html','KGRecallCanvasAdapter','#krZoomLabel','recall-canvas')
]

def run_case(case):
    file,adapter_name,percent_selector,runtime_id=case
    with sync_playwright() as p:
        launch_options={'headless':True,'args':ARGS}
        if Path('/usr/bin/chromium').exists(): launch_options['executable_path']='/usr/bin/chromium'
        browser=p.chromium.launch(**launch_options)
        context=browser.new_context(viewport={'width':1440,'height':900})
        page=context.new_page();page.set_default_timeout(10000)
        errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.on('console',lambda message:errors.append(message.text) if message.type=='error' and 'lucide-product.svg' not in message.text else None)
        load_page(page,file)
        info=page.evaluate("""({adapterName,runtimeId})=>({
          count:window.KGUnifiedCanvasRuntime?.list?.().length||0,
          adapter:Boolean(window[adapterName]),
          runtime:Boolean(window.KGUnifiedCanvasRuntime?.get?.(runtimeId)),
          surface:document.querySelector('[data-canvas-runtime-id]')?.dataset.canvasRuntimeId||'',
          settings:document.querySelectorAll('[data-uc-canvas-settings]').length,
          minimap:document.querySelectorAll('.uc-minimap').length
        })""",{'adapterName':adapter_name,'runtimeId':runtime_id})
        assert info=={'count':1,'adapter':True,'runtime':True,'surface':runtime_id,'settings':1,'minimap':1},(file,info)

        page.locator('[data-uc-canvas-settings]').click();page.wait_for_timeout(80)
        assert page.locator('.uc-settings-backdrop').is_visible(),file
        page.locator('[data-uc-theme="dark"]').click();page.locator('[data-uc-pattern="grid"]').click();page.locator('[data-uc-confirm]').click();page.wait_for_timeout(80)
        appearance=page.evaluate("""()=>{const el=document.querySelector('[data-canvas-runtime-id]');return{theme:el.dataset.canvasTheme,pattern:el.dataset.canvasPattern,key:JSON.parse(localStorage.getItem('kg_canvas_view_preferences_v1')||'{}')}}""")
        assert appearance['theme']=='dark' and appearance['pattern']=='grid',(file,appearance)
        assert appearance['key']['theme']=='dark' and appearance['key']['pattern']=='grid',(file,appearance)
        page.locator('[data-uc-canvas-settings]').click();page.locator('[data-uc-theme="light"]').click();page.locator('[data-uc-cancel]').click();page.wait_for_timeout(60)
        assert page.evaluate("document.querySelector('[data-canvas-runtime-id]').dataset.canvasTheme")=='dark',file

        if file=='knowledge-recall.html':
            page.evaluate("name=>window[name].setViewport({x:123,y:87,zoom:.75},{persist:true,smooth:false})",adapter_name)
            page.wait_for_timeout(280)
            stored_transform=page.evaluate("""()=>{for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);try{const value=JSON.parse(localStorage.getItem(key));if(value&&value.transform)return value.transform}catch(_){}}return null}""")
            assert stored_transform and abs(stored_transform['x']-123)<.01 and abs(stored_transform['y']-87)<.01 and abs(stored_transform['scale']-.75)<.01,(file,stored_transform)
        page.evaluate("name=>window[name].setViewport({x:321,y:177,zoom:2},{persist:false,smooth:false})",adapter_name)
        page.locator(percent_selector).evaluate('el=>el.click()');page.wait_for_timeout(540)
        centered=page.evaluate("""name=>{const a=window[name],v=a.getViewport(),b=a.getContentBounds?.(),r=a.getViewportElement?.()?.getBoundingClientRect?.();return{zoom:v.zoom??v.scale,x:v.x,y:v.y,b,r,sliderOpen:Boolean(a.getZoomDock?.()?.classList.contains('slider-open'))}}""",adapter_name)
        assert abs(centered['zoom']-1)<.015,(file,centered)
        assert centered['sliderOpen'] is False,(file,centered)
        if centered['b'] and centered['r'] and file!='question-workspace.html':
            expected_x=(centered['r']['width']-(centered['b']['left']+centered['b']['right']))/2
            expected_y=(centered['r']['height']-(centered['b']['top']+centered['b']['bottom']))/2
            assert abs(centered['x']-expected_x)<5 and abs(centered['y']-expected_y)<5,(file,centered,expected_x,expected_y)

        navigation=page.evaluate("""name=>{const a=window[name],root=document.querySelector('.uc-minimap'),before=a.getViewport(),rect=root.getBoundingClientRect();root.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,clientX:rect.left+14,clientY:rect.top+14}));const after=a.getViewport();return{before,after}}""",adapter_name)
        assert abs(navigation['after']['x']-navigation['before']['x'])>1 or abs(navigation['after']['y']-navigation['before']['y'])>1,(file,navigation)

        toggle=page.locator('.uc-minimap-toggle').first
        assert toggle.count()==1,file
        before=toggle.get_attribute('aria-expanded')
        toggle.evaluate('el=>el.click()');page.wait_for_timeout(60)
        after=toggle.get_attribute('aria-expanded')
        assert before!=after,(file,before,after)
        toggle.evaluate('el=>el.click()');page.wait_for_timeout(60)
        assert toggle.get_attribute('aria-expanded')==before,(file,before)
        assert not errors,(file,errors)
        context.close();browser.close()
    print('v90-p430-browser-pass',file,flush=True)

def main():
    if len(sys.argv)==3 and sys.argv[1]=='--case':
        match=next((case for case in CASES if case[0]==sys.argv[2]),None)
        if not match: raise SystemExit(f'unknown case: {sys.argv[2]}')
        run_case(match);return
    print('usage: python tests/v90-p430-unified-canvas-runtime-browser.py --case <html-file>')
    print('cases: '+', '.join(case[0] for case in CASES))

if __name__=='__main__': main()
