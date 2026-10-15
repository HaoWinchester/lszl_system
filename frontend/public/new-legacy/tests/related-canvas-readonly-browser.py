#!/usr/bin/env python3
"""阅读模式启用「打开相关画布」（只查看）：入口可见、只读弹层、零写入。

Run: python3 new-legacy/tests/related-canvas-readonly-browser.py --base-url http://127.0.0.1:<port>
"""
import argparse
import uuid
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[2]

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--base-url',required=True)
    args=parser.parse_args()
    base=args.base_url.rstrip('/')
    assert urlparse(base).hostname in ('localhost','127.0.0.1')
    with sync_playwright() as pw:
        browser=pw.chromium.launch(channel='chrome')
        ctx=browser.new_context(viewport={'width':1440,'height':1000})
        assert ctx.request.post(base+'/api/v1/auth/login',data={'username':'ink-browser','password':'ink-browser-test'}).ok
        suffix=uuid.uuid4().hex[:7]
        nodes=[{'id':i,'title':i,'x':x,'y':y} for i,x,y in [('a',400,300),('b',750,300),('c',750,550)]]
        graph={'meta':{'title':'阅读相关画布'},'viewport':{'x':0,'y':0,'scale':1},'nodes':nodes,
               'links':[{'id':'ab','from':'a','to':'b'},{'id':'bc','from':'b','to':'c'}]}
        r=ctx.request.post(base+'/api/v1/files',data={'name':f'readonly-{suffix}','graphData':graph})
        assert r.ok,r.text()
        fid=r.json()['file']['id']
        assert ctx.request.put(base+'/api/v1/files/current',data={'fileId':fid}).ok
        page=ctx.new_page();errors=[];writes=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.on('request',lambda req:writes.append(req.url) if '/api/v1/files' in req.url and req.method in ('POST','PUT','PATCH','DELETE') else None)
        page.goto(base+'/index.html',wait_until='networkidle')
        for selector in ['#learningEntryDismissBtn','.tour-skip','#hideHelpBtn']:
            if page.locator(selector).is_visible():page.locator(selector).click()
        # 切到阅读模式。
        page.locator('.graph-mode-trigger').click();page.locator('[data-graph-mode-option="reading"]').click()
        page.wait_for_function('!KGGraphFileTabs.isSwitching()');page.wait_for_timeout(200)
        # 阅读模式点卡牌（tap 选中）→ 工具栏仅显示 grip 与「打开相关画布」。
        card=page.locator('.knowledge-card[data-node-id="a"]');box=card.bounding_box()
        page.mouse.click(box['x']+box['width']/2,box['y']+box['height']/2);page.wait_for_timeout(300)
        toolbar=page.locator('.node-style-toolbar')
        expect(toolbar).to_be_visible()
        visible_actions=toolbar.evaluate('''root=>[...root.querySelectorAll('.node-toolbar-btn')].filter(btn=>btn.offsetParent!==null||btn.getClientRects().length).map(btn=>btn.dataset.nodeToolbarAction||'grip')''')
        assert sorted(set(visible_actions))in(['grip','related-canvas'],['related-canvas','grip']),visible_actions
        # 打开相关画布 → 只读弹层。
        toolbar.locator('[data-node-toolbar-action="related-canvas"]').click()
        expect(page.locator('.related-canvas-backdrop')).to_be_visible()
        writes.clear()  # 打开前的 before-temporary 强制保存是合法写；此后只读弹层必须零写。
        backdrop=page.locator('.related-canvas-backdrop')
        assert backdrop.locator('[data-action="add"]').count()==0
        assert backdrop.locator('[data-action="connect"]').count()==0
        assert backdrop.locator('[data-action="delete"]').count()==0
        assert backdrop.locator('[data-action="undo"]').count()==0
        assert backdrop.locator('[data-action="ink"]').count()==0
        assert backdrop.locator('form').count()==0
        expect(backdrop.locator('.related-canvas-header span')).to_contain_text('只读查看')
        assert backdrop.locator('.related-canvas-card').count()==2  # 一跳：a + b
        # 卡牌不可拖动（只查看）。
        target=backdrop.locator('.related-canvas-card[data-node-id="a"]');rbox=target.bounding_box()
        page.mouse.move(rbox['x']+60,rbox['y']+30);page.mouse.down();page.mouse.move(rbox['x']+160,rbox['y']+80,steps=6);page.mouse.up()
        x=page.evaluate('relatedCanvasController.session.getState().nodes.find(n=>n.id==="a").x')
        assert x==400,x
        # 关闭弹层；全程零写请求。
        backdrop.locator('[data-action="close"]').click()
        expect(page.locator('.related-canvas-backdrop')).to_have_count(0)
        assert not writes,writes
        assert not errors,errors
        print('PASS reading related-canvas: readonly entry, view-only modal, zero writes',flush=True)
        browser.close()

if __name__=='__main__':
    main()
