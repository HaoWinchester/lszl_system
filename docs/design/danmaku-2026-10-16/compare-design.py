"""Fixed-frame screenshot versus the approved original; no masked pixels."""
from pathlib import Path
from datetime import datetime
import importlib.util
import json
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'artifacts/danmaku-image-design'
OUT.mkdir(parents=True, exist_ok=True)
spec = importlib.util.spec_from_file_location('danmaku_fixture', ROOT/'new-legacy/tests/danmaku-design-browser.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.DanmakuDesign.setUpClass()
fixture = module.DanmakuDesign()
try:
    fixture.setUp()
    fixture.context.close()
    fixture.comments = [dict(module.COMMENTS[0], myLike=True), dict(module.COMMENTS[0], id='c2', author='小张', content='先分析影响，再决定是否变更', likeCount=12)]
    fixture.context = fixture.browser.new_context(viewport={'width':1440,'height':1000}, device_scale_factor=3, timezone_id='Asia/Shanghai')
    fixture.page = fixture.context.new_page()
    p = fixture.page
    p.route('http://localhost/**', fixture.route)
    p.clock.install(time=datetime(2026,10,16,8,0,10))
    p.goto('http://localhost/test-harness')
    p.evaluate("document.querySelector('main').style.cssText='box-sizing:border-box;width:418px;padding:52px 20px;';document.querySelector('h1').style.cssText='font-size:14px;font-weight:400;line-height:1.5;margin:0 0 30px';document.querySelector('main p').style.cssText='font-size:14px;line-height:1.5;margin:100px 0 0'")
    p.evaluate("window.KGAuthCore={currentUser:()=>({username:'stu',role:'student'})}")
    for src in ['28-device-preferences.js','107-learning-ui-icons.js','119-question-comments.js']:
        p.add_script_tag(url='http://localhost/src/'+src)
    p.evaluate("window.inst=KGQuestionComments.mountDanmaku({questionId:'q1'})")
    p.wait_for_selector('.q-danmaku-item', state='attached')
    fixture.place(68.3,80,'c2')
    fixture.place(68.3,137.7,'c1')
    p.locator('[data-danmaku-comment-id="c1"]').click()
    p.wait_for_selector('[data-danmaku-pop]')
    p.mouse.move(0,0)
    # Only animation coordinates are frozen. Component CSS, SVGs, text and size
    # remain production values; question text is deliberately readable.
    p.screenshot(path=str(OUT/'design-actual.png'), clip={'x':0,'y':0,'width':418,'height':418}, animations='disabled')
    boxes = p.locator('[data-danmaku-comment-id="c2"],[data-danmaku-comment-id="c1"],[data-danmaku-pop]').evaluate_all('els=>els.map(e=>({id:e.dataset.danmakuCommentId||"popover",rect:(()=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})(),font:getComputedStyle(e).font,background:getComputedStyle(e).backgroundColor}))')
    actual=Image.open(OUT/'design-actual.png').convert('RGB')
    ref=Image.open(ROOT/'docs/design/danmaku-2026-10-16/concept.png').convert('RGB')
    assert actual.size==ref.size==(1254,1254)
    a=np.asarray(actual,dtype=np.int16);r=np.asarray(ref,dtype=np.int16)
    delta=np.abs(a-r)
    threshold=24
    def metric(d):
        return {'meanAbsoluteChannelError':round(float(d.mean()),4),'pixelsOver24Of255Percent':round(float((d.max(axis=2)>threshold).mean()*100),4)}
    diff=Image.fromarray(np.clip(delta*4,0,255).astype(np.uint8))
    diff.save(OUT/'design-diff.png')
    sheet=Image.new('RGB',(1254*3,1290),'white');draw=ImageDraw.Draw(sheet)
    for i,(title,img) in enumerate([('APPROVED ORIGINAL',ref),('ACTUAL CSS / DPR 3',actual),('ABSOLUTE DIFFERENCE x4',diff)]):
        draw.text((i*1254+12,10),title,fill='black');sheet.paste(img,(i*1254,36))
    sheet.save(OUT/'design-comparison.png')
    regions={'normalChip':[205,240,1051,374],'activeChip':[205,412,1051,549],'popover':[198,585,1058,1174]}
    report={'reference':'docs/design/danmaku-2026-10-16/concept.png','actual':'design-actual.png','size':list(ref.size),'render':'Chrome actual shared source, DPR3, 418x418 CSS crop of desktop viewport1440x1000','threshold':threshold,'maskedPixels':0,'full':metric(delta),'referenceRegions':{name:metric(delta[y0:y1,x0:x1]) for name,(x0,y0,x1,y1) in regions.items()},'actualGeometryCss':boxes,'limitations':['Original is a generated bitmap, not a DOM/font specification.','Readable question background is retained; original illustration blurs it.','Fixed chip coordinates freeze a representative animation frame only.','Timestamps use the existing time format, not the image\u2019s literal 刚刚.','No resizing or warping of the actual screenshot or original; all pixels included.']}
    (OUT/'design-comparison.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(report,ensure_ascii=False,indent=2))
finally:
    fixture.tearDown()
    module.DanmakuDesign.tearDownClass()
