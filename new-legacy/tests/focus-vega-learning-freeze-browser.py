#!/usr/bin/env python3
"""Freeze contract for learning canvases and protected account surfaces."""

import json
import re
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
VIEWPORTS = ((1440, 900), (1366, 768), (1024, 768))
CANVASES = {
    'question-training.html': '.qt-canvas-shell',
    'question-workspace.html': '.qw-canvas-shell',
    'knowledge-recall.html': '.kr-viewport',
}
PROTECTED = (
    '.account-menu-shell',
    '#authModal',
    '#userCenterModal',
    '#userSubscriptionDetailModal',
)
NEW_STYLES = (
    'styles/focus-vega-typography.css',
    'styles/focus-vega-learning.css',
)


def stylesheet_hrefs(html):
    return [
        match.group(1)
        for match in re.finditer(
            r'<link\b[^>]*\brel=["\']stylesheet["\'][^>]*\bhref=["\']([^"\']+)["\'][^>]*>',
            html,
            re.I,
        )
    ]


def mount_original_styles(page, filename):
    html = (ROOT / filename).read_text(encoding='utf-8')
    body_match = re.search(r'<body([^>]*)>([\s\S]*)</body>', html, re.I)
    if not body_match:
        raise AssertionError(f'{filename}: body missing')
    body = re.sub(r'<script[\s\S]*?</script>', '', body_match.group(2), flags=re.I)
    page.set_content(
        '<!doctype html><html lang="zh-CN"><head></head>'
        f'<body{body_match.group(1)}>{body}</body></html>',
        wait_until='domcontentloaded',
    )
    hrefs = stylesheet_hrefs(html)
    if hrefs[-2:] != list(NEW_STYLES):
        raise AssertionError(f'{filename}: final stylesheet order {hrefs[-2:]}')
    for href in hrefs:
        if href in NEW_STYLES:
            continue
        page.add_style_tag(content=(ROOT / href).read_text(encoding='utf-8'))
    page.add_style_tag(content='*{transition:none!important;animation:none!important}')
    inject_protected_fixtures(page)
    settle(page)


def inject_protected_fixtures(page):
    page.evaluate(
        """() => {
          if(!document.querySelector('#userCenterModal')){
            const center=document.createElement('div');
            center.id='userCenterModal';center.className='user-center-backdrop';
            center.innerHTML='<section class="uc-panel"><h2>用户中心</h2><button>保存资料</button><input value="账号资料"></section>';
            document.body.appendChild(center);
          }
          if(!document.querySelector('#userSubscriptionDetailModal')){
            const member=document.createElement('div');
            member.id='userSubscriptionDetailModal';member.className='kg-subscription-modal';
            member.innerHTML='<section class="membership-card"><button class="payment-action">购买会员</button><span class="wechat-pay-state">等待支付</span></section>';
            document.body.appendChild(member);
          }
        }"""
    )


def settle(page):
    page.evaluate(
        """async () => {
          document.getAnimations().forEach(animation=>animation.cancel());
          if(document.fonts?.ready)await document.fonts.ready;
          for(let frame=0;frame<10;frame+=1){
            await new Promise(resolve=>requestAnimationFrame(resolve));
          }
        }"""
    )


def signature(page, selectors):
    return page.evaluate(
        """selectors => {
          const properties=[
            'fontFamily','fontSize','fontWeight','lineHeight','color','backgroundColor',
            'borderTopColor','borderRightColor','borderBottomColor','borderLeftColor',
            'borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth',
            'borderRadius','display','position','top','right','bottom','left','inset',
            'gridTemplateColumns','gridTemplateRows','gap','alignItems','justifyContent',
            'paddingTop','paddingRight','paddingBottom','paddingLeft',
            'marginTop','marginRight','marginBottom','marginLeft',
            'transform','width','height','minWidth','minHeight','maxWidth','maxHeight',
            'overflowX','overflowY','opacity','visibility'
          ];
          return selectors.map(selector=>{
            const root=document.querySelector(selector);
            if(!root)return {selector,missing:true};
            const elements=[root,...root.querySelectorAll('*')];
            return {
              selector,
              outerHTML:root.outerHTML,
              nodes:elements.map((element,index)=>{
                const style=getComputedStyle(element);
                return {
                  index,
                  tag:element.tagName,
                  id:element.id,
                  className:typeof element.className==='string'?element.className:'',
                  style:Object.fromEntries(properties.map(name=>[name,style[name]])),
                };
              }),
            };
          });
        }""",
        list(selectors),
    )


def main():
    checked = 0
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, args=ARGS)
        try:
            for filename, canvas in CANVASES.items():
                for width, height in VIEWPORTS:
                    page = browser.new_page(viewport={'width': width, 'height': height})
                    mount_original_styles(page, filename)
                    selectors = (canvas,) + PROTECTED
                    before = signature(page, selectors)
                    for href in NEW_STYLES:
                        css_path = ROOT / href
                        if not css_path.exists():
                            raise AssertionError(f'{filename}: missing {href}')
                        page.add_style_tag(content=css_path.read_text(encoding='utf-8'))
                    settle(page)
                    after = signature(page, selectors)
                    if after != before:
                        for index, (left, right) in enumerate(zip(before, after)):
                            if left != right:
                                detail = json.dumps(
                                    {'before': left, 'after': right},
                                    ensure_ascii=False,
                                )[:2400]
                                raise AssertionError(
                                    f'{filename} {width}x{height}: frozen selector '
                                    f'{selectors[index]} changed: {detail}'
                                )
                        raise AssertionError(f'{filename} {width}x{height}: freeze signature changed')
                    checked += 1
                    page.close()
        finally:
            browser.close()
    print(f'focus-vega-learning-freeze-browser-ok {checked}/{len(CANVASES)*len(VIEWPORTS)}')


if __name__ == '__main__':
    main()
