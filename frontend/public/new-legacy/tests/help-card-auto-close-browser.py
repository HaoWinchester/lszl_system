#!/usr/bin/env python3
"""说明弹窗 10 秒自动关闭：默认可见 → 10s 后隐藏；手动关闭后不再出现。

Run: python3 new-legacy/tests/help-card-auto-close-browser.py --base-url http://127.0.0.1:<port>
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
        suffix=uuid.uuid4().hex[:6]
        graph={'meta':{'title':'helpCard'},'viewport':{'x':0,'y':0,'scale':1},'nodes':[{'id':'a','title':'甲','x':400,'y':300}],'links':[]}
        r=ctx.request.post(base+'/api/v1/files',data={'name':f'help-{suffix}','graphData':graph})
        assert r.ok,r.text()
        fid=r.json()['file']['id']
        assert ctx.request.put(base+'/api/v1/files/current',data={'fileId':fid}).ok
        page=ctx.new_page();errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        def load():
            page.goto(base+'/index.html',wait_until='networkidle')
            for selector in ['#learningEntryDismissBtn','.tour-skip']:
                if page.locator(selector).is_visible():page.locator(selector).click()
        # 场景一：不手动关闭 → 10 秒后自动隐藏。
        load()
        help_card=page.locator('#helpCard')
        expect(help_card).to_be_visible()
        page.wait_for_timeout(10600)
        expect(help_card).to_be_hidden()
        # 场景二：手动关闭后定时器取消，不会再次出现（刷新后重新计时属于新会话）。
        load()
        expect(help_card).to_be_visible()
        page.locator('#hideHelpBtn').click()
        expect(help_card).to_be_hidden()
        page.wait_for_timeout(10500)
        expect(help_card).to_be_hidden()
        assert not errors,errors
        print('PASS help card: auto-close after 10s, manual close cancels timer',flush=True)
        browser.close()

if __name__=='__main__':
    main()
