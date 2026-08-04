from pathlib import Path
import argparse, json, re, tempfile
from PIL import Image, ImageChops
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
BASELINE_DIR=ROOT/'visual-regression'/'v8.6.1.2.1'
ARGS=['--no-sandbox','--disable-dev-shm-usage']
MATRIX=[(1366,768),(1440,900),(1920,1080)]
ZOOMS=[1.0,1.25,1.5]

def text(path): return (ROOT/path).read_text(encoding='utf-8')

def body_html(path):
    source=text(path)
    match=re.search(r'<body[^>]*>([\s\S]*)</body>',source,re.I)
    return re.sub(r'<script[\s\S]*?</script>','',match.group(1),flags=re.I)

def install(page):
    page.evaluate("""()=>{const values=new Map();Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:key=>values.has(key)?values.get(key):null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key),clear:()=>values.clear()}});window.confirm=()=>true;window.alert=()=>{};window.prompt=(message,value)=>value||'自动测试';}""")

def add(page,paths):
    for path in paths:
        page.add_script_tag(content=text(path))

def setup(browser,width,height,zoom):
    css_width=round(width/zoom)
    css_height=round(height/zoom)
    context=browser.new_context(viewport={'width':css_width,'height':css_height},device_scale_factor=zoom)
    page=context.new_page()
    page.set_default_timeout(6000)
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.set_content('<body>'+body_html('content-center.html')+'</body>')
    for path in ['styles/teacher-workbench.css','styles/content-center.css','styles/workspace-panels.css','styles/content-organization.css']:
        page.add_style_tag(content=text(path))
    install(page)
    add(page,['src/28-app-storage.js','src/29-auth-core.js','src/86-activity-schema-v1.js','src/87-guided-learning-data.js','src/91-learning-content-core.js','src/93-content-organization-core.js','src/91-knowledge-tree-index.js','src/91-content-center-app.js','src/93-content-organization-app.js','src/92-workspace-panel-manager.js'])
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
    page.wait_for_timeout(220)
    return context,page,errors

def assert_layout(page):
    result=page.evaluate("""()=>{const rect=e=>e.getBoundingClientRect();const toolbar=document.querySelector('.cc-toolbar'),layout=document.querySelector('.cc-layout'),org=document.querySelector('.cc-organize-panel');const tb=rect(toolbar);return {
      innerWidth,innerHeight,scrollWidth:document.documentElement.scrollWidth,
      visiblePanels:layout.dataset.visiblePanels,columns:getComputedStyle(layout).gridTemplateColumns,
      defaultTreeView:document.querySelector('[data-tree-view].active')?.dataset.treeView,
      rowCount:document.querySelectorAll('#ccActivityRows tr').length,
      toolbarOverflow:[...toolbar.children].some(el=>{const b=rect(el);return b.left<tb.left-1||b.right>tb.right+1||b.top<tb.top-1||b.bottom>tb.bottom+1}),
      orgSpan:(()=>{const o=rect(org),t=rect(document.querySelector('.cc-tree-panel')),l=rect(document.querySelector('.cc-library-panel'));return Math.abs(o.left-Math.min(t.left,l.left))<2&&Math.abs(o.right-Math.max(t.right,l.right))<2})()
    }}""")
    assert result['rowCount']==82,result
    assert result['scrollWidth']<=result['innerWidth']+1,result
    assert not result['toolbarOverflow'],result
    assert result['orgSpan'],result
    assert result['visiblePanels']=='2',result
    assert result['defaultTreeView']=='list',result
    return result

def assert_interactions(page):
    page.locator('[data-tree-view="graph"]').dispatch_event('click')
    page.wait_for_timeout(80)
    assert page.locator('#ccKnowledgeGraph .cc-map-node').count()>0
    page.locator('[data-tree-view="list"]').dispatch_event('click')
    page.wait_for_timeout(50)

    first=page.locator('#ccActivityRows [data-select]').first
    second=page.locator('#ccActivityRows [data-select]').nth(1)
    first.evaluate("el=>{el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}))}")
    second.evaluate("el=>{el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}))}")
    page.wait_for_timeout(30)
    assert not page.locator('#ccSelectionBar').is_hidden()
    selection=page.locator('#ccSelectionBar').evaluate("(el)=>{const b=el.getBoundingClientRect();return {left:b.left,right:b.right,width:b.width}}")
    library=page.locator('.cc-library-panel').evaluate("(el)=>{const b=el.getBoundingClientRect();return {left:b.left,right:b.right,width:b.width}}")
    assert selection['left']>=library['left']-1 and selection['right']<=library['right']+1

    max_button=page.locator('[data-workspace-panel="activity-library"] [data-wsp-action="maximize"]')
    max_button.dispatch_event('click')
    page.wait_for_timeout(40)
    assert page.locator('[data-workspace-panel="activity-library"]').evaluate("el=>el.classList.contains('wsp-panel-maximized')")
    max_button.dispatch_event('click')
    page.wait_for_timeout(40)
    assert not page.locator('[data-workspace-panel="activity-library"]').evaluate("el=>el.classList.contains('wsp-panel-maximized')")

    collapse=page.locator('[data-workspace-panel="knowledge-tree"] [data-wsp-action="collapse"]')
    collapse.dispatch_event('click')
    page.wait_for_timeout(40)
    assert page.locator('.cc-layout').get_attribute('data-visible-panels')=='1'
    page.locator('[data-restore-panel="knowledge-tree"]').dispatch_event('click')
    page.wait_for_timeout(120)
    assert page.locator('.cc-layout').get_attribute('data-visible-panels')=='2'


def assert_resize_reflow(page):
    page.set_viewport_size({'width':960,'height':600})
    page.wait_for_timeout(80)
    narrow=page.evaluate("""()=>({scrollWidth:document.documentElement.scrollWidth,innerWidth,columns:getComputedStyle(document.querySelector('.cc-layout')).gridTemplateColumns})""")
    assert narrow['scrollWidth']<=narrow['innerWidth']+1,narrow
    assert ' ' not in narrow['columns'].strip(),narrow
    page.set_viewport_size({'width':1920,'height':1080})
    page.wait_for_timeout(80)
    wide=page.evaluate("""()=>({scrollWidth:document.documentElement.scrollWidth,innerWidth,columns:getComputedStyle(document.querySelector('.cc-layout')).gridTemplateColumns})""")
    assert wide['scrollWidth']<=wide['innerWidth']+1,wide
    assert ' ' in wide['columns'].strip(),wide

def compare_images(expected,actual):
    a=Image.open(expected).convert('RGB')
    b=Image.open(actual).convert('RGB')
    assert a.size==b.size,f'截图尺寸变化：{expected.name} {a.size} != {b.size}'
    diff=ImageChops.difference(a,b)
    masks=[channel.point(lambda value:255 if value>18 else 0) for channel in diff.split()]
    mask=ImageChops.lighter(ImageChops.lighter(masks[0],masks[1]),masks[2])
    changed=mask.histogram()[255]
    ratio=changed/max(1,a.size[0]*a.size[1])
    assert ratio<=0.01,f'视觉差异超过阈值：{expected.name} changed={ratio:.4%}'
    return ratio

def main(update=False):
    BASELINE_DIR.mkdir(parents=True,exist_ok=True)
    manifest=[]
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=ARGS)
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_dir=Path(temp_dir)
            for width,height in MATRIX:
                for zoom in ZOOMS:
                    context,page,errors=setup(browser,width,height,zoom)
                    result=assert_layout(page)
                    page.evaluate("()=>{const layout=document.querySelector('.cc-layout');const topbar=document.querySelector('.tw-topbar');window.scrollTo(0,Math.max(0,layout.offsetTop-(topbar?.getBoundingClientRect().height||0)-12))}")
                    page.wait_for_timeout(80)
                    name=f'content-center_{width}x{height}_zoom-{int(zoom*100)}.png'
                    target=BASELINE_DIR/name if update else temp_dir/name
                    page.screenshot(path=str(target),animations='disabled')
                    ratio=0.0
                    if not update:
                        assert (BASELINE_DIR/name).exists(),f'缺少视觉基线：{name}'
                        ratio=compare_images(BASELINE_DIR/name,target)
                    assert_interactions(page)
                    if width==1920 and height==1080 and zoom==1.0:
                        assert_resize_reflow(page)
                    assert not errors,errors
                    manifest.append({'screen':f'{width}x{height}','zoom':int(zoom*100),'cssViewport':result['innerWidth'],'columns':result['columns'],'pixelDiffRatio':ratio})
                    context.close()
        browser.close()
    (BASELINE_DIR/'manifest.json').write_text(json.dumps({'release':'v8.6.1.2.1','matrix':manifest},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print('v861121-layout-browser-regression-ok',{'snapshots':len(manifest),'update':update})

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--update',action='store_true')
    main(parser.parse_args().update)
