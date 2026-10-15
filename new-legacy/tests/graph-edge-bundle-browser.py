#!/usr/bin/env python3
"""多线汇总自动重叠：端点收拢 + 派生折线通道对齐，真实图谱画布验收。

Run against the disposable canvas_ink_server:
  python3 new-legacy/tests/graph-edge-bundle-browser.py --base-url http://127.0.0.1:<port>
"""
import argparse
import uuid
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[2]

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--base-url',required=True)
    args=parser.parse_args()
    base=args.base_url.rstrip('/')
    assert urlparse(base).hostname in ('localhost','127.0.0.1')
    with sync_playwright() as pw:
        browser=pw.chromium.launch(channel='chrome')
        ctx=browser.new_context(viewport={'width':1680,'height':1050})
        assert ctx.request.post(base+'/api/v1/auth/login',data={'username':'ink-browser','password':'ink-browser-test'}).ok
        suffix=uuid.uuid4().hex[:7]
        # 场景 A：两条不同角度的边汇入同一圆形卡（圆的附着点随方向连续变化）→ 端点收拢。
        # 场景 B：两条不同宽度的左侧卡汇入同一矩形卡，派生折线 trunk 相差 20px → 通道对齐。
        nodes=[
            {'id':'a1','title':'汇入甲','level':'基础','geometry':{'x':0,'y':250,'width':200,'height':100}},
            {'id':'a2','title':'汇入乙','level':'基础','geometry':{'x':0,'y':380,'width':200,'height':100}},
            {'id':'b','title':'圆形汇总','level':'基础','cardStyle':'circle','geometry':{'x':700,'y':240,'width':200,'height':220}},
            {'id':'c1','title':'宽卡','level':'基础','geometry':{'x':0,'y':700,'width':200,'height':100}},
            {'id':'c2','title':'窄卡','level':'基础','geometry':{'x':0,'y':710,'width':160,'height':60}},
            {'id':'d','title':'矩形汇总','level':'基础','geometry':{'x':700,'y':640,'width':200,'height':220}},
        ]
        graph={'meta':{'title':'多线汇总'},'viewport':{'x':60,'y':20,'scale':1},'nodes':nodes,
               'links':[{'id':'e1','from':'a1','to':'b','pathStyle':'elbow'},
                        {'id':'e2','from':'a2','to':'b','pathStyle':'elbow'},
                        {'id':'f1','from':'c1','to':'d','pathStyle':'elbow'},
                        {'id':'f2','from':'c2','to':'d','pathStyle':'elbow'}]}
        r=ctx.request.post(base+'/api/v1/files',data={'name':f'edge-bundle-{suffix}','graphData':graph})
        assert r.ok,r.text()
        fid=r.json()['file']['id']
        assert ctx.request.put(base+'/api/v1/files/current',data={'fileId':fid}).ok
        page=ctx.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(base+'/index.html',wait_until='networkidle')
        page.wait_for_function('!!window.KGGraphFileTabs && !!window.KGGraphModel')
        for selector in ['#learningEntryDismissBtn','.tour-skip','#hideHelpBtn']:
            if page.locator(selector).is_visible():page.locator(selector).click()
        page.wait_for_timeout(300)

        def snapshot():
            return page.evaluate('''()=>{const read=id=>{const dom=edgeDomById.get(id);if(!dom?.geometry)return null;return{endpoints:dom.geometry.endpoints.map(p=>({x:p.x,y:p.y})),controls:dom.geometry.controls.map(p=>({x:p.x,y:p.y})),d:dom.geometry.d}};return{e1:read('e1'),e2:read('e2'),f1:read('f1'),f2:read('f2'),stored:state.links.map(l=>({id:l.id,waypoints:l.waypoints,curveControls:l.curveControls}))}}''')

        snap=snapshot()
        assert all(snap[key] for key in ('e1','e2','f1','f2')),snap
        # 场景 A：端点收拢——两条边汇入圆形卡的附着点完全重合。
        assert snap['e1']['endpoints'][1]==snap['e2']['endpoints'][1],snap
        # 场景 B：通道对齐——原本相差 20px 的派生折线主干 x 完全一致。
        f1x=snap['f1']['controls'][0]['x'];f2x=snap['f2']['controls'][0]['x']
        assert f1x==f2x,snap
        # render-only：持久数据不得被写入 waypoints/curveControls。
        assert all(link['waypoints'] is None and link['curveControls'] is None for link in snap['stored']),snap
        # 刷新后（重新规划）几何保持一致。
        page.reload(wait_until='networkidle')
        page.wait_for_function('!!window.KGGraphFileTabs && !!window.KGGraphModel')
        page.wait_for_timeout(300)
        reloaded=snapshot()
        for key in ('e1','e2','f1','f2'):assert reloaded[key]['d']==snap[key]['d'],(key,snap[key],reloaded[key])
        assert not errors,errors
        print('PASS edge bundle: converging endpoints merged, parallel elbow trunks aligned, persisted data untouched',flush=True)
        browser.close()

if __name__=='__main__':
    main()
