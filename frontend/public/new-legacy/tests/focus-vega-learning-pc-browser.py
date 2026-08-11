#!/usr/bin/env python3
"""PC visual contract for Focus / Vega learning-flow pages."""

import argparse
import re
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
VIEWPORTS = ((1440, 900), (1366, 768), (1024, 768))
STANDALONE = {
    'learning-path.html': {
        'anchors': ('.gl-app', '.gl-topbar', '.gl-main', '.gl-stage-switch'),
        'text_roots': (
            '.gl-subject-shell', '.gl-mode-toggle-shell', '.gl-main',
            '.gl-stage-picker-backdrop', '.gl-placement-backdrop', '.status-chip',
        ),
        'panels': ('.gl-stage-switch', '.gl-node-copy'),
        'primary': '.gl-stage-switch',
    },
    'guided-learning-node.html': {
        'anchors': ('.gln-topbar', '.gln-main', '.gln-activity', '.gln-action-bar'),
        'text_roots': ('.gln-topbar', '.gln-main', '.gln-action-bar'),
        'panels': ('.gln-activity', '.gln-choice-list button'),
        'primary': '.gln-primary-action',
    },
    'guided-learning-placement-test.html': {
        'anchors': ('.glp-topbar', '.glp-main', '.glp-intro'),
        'text_roots': ('.glp-topbar', '.glp-main', '.glp-action-bar'),
        'panels': ('.glp-activity', '.glp-intro-facts>div'),
        'primary': '.glp-primary-action',
    },
}
CHROME = {
    'question-training.html': {
        'anchors': ('.qt-topbar', '.qt-canvas-shell'),
        'text_roots': (
            '.qt-brand', '.qt-back-link', '.qt-language-control',
            '.qt-language-switch',
        ),
        'panels': ('.qt-language-switch',),
        'primary': '.qt-language-switch button[aria-pressed="true"]',
        'body_background': None,
    },
    'question-workspace.html': {
        'anchors': ('.qw-topbar', '.qw-workspace-tabbar', '.qw-canvas-shell'),
        'text_roots': (
            '.qw-brand', '.qw-back', '.qw-workspace-tabbar', '.qw-readonly-badge',
            '.qw-language-control', '.qw-language-switch',
        ),
        'panels': ('.qw-workspace-tabbar', '.qw-language-switch'),
        'primary': '.qw-workspace-tab.is-active',
        'body_background': None,
    },
    'knowledge-recall.html': {
        'anchors': ('.kr-topbar', '.kr-viewport'),
        'text_roots': (
            '.kr-brand', '.kr-back', '.kr-language-control',
            '.kr-language-switch', '.kr-scene-menu',
        ),
        'panels': ('.kr-language-switch', '.kr-scene-panel'),
        'primary': '.kr-language-switch button[aria-pressed="true"]',
        'body_background': None,
    },
}


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, _format, *_args):
        return


def runtime_server():
    handler = partial(QuietHandler, directory=str(ROOT))
    server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, f'http://127.0.0.1:{server.server_port}/'


def inspect_runtime(browser):
    server, base_url = runtime_server()
    errors = []
    page = browser.new_page(viewport={'width': 1440, 'height': 900})
    page.add_init_script(
        """() => {
          const username='student-ui-runtime';
          localStorage.setItem('kg_local_current_user_v1',username);
          localStorage.setItem('kg_local_users_v1',JSON.stringify({
            [username]:{username,displayName:'学习端测试用户',role:'student',status:'active',subject:'PMP',salt:'x',hash:'x'}
          }));
        }"""
    )
    page.on('dialog', lambda dialog: dialog.accept())
    page.on('pageerror', lambda error: errors.append(f'pageerror:{error}'))
    page.on('console', lambda message: errors.append(f'console:{message.text}') if message.type == 'error' else None)
    try:
        page.goto(base_url + 'learning-path.html', wait_until='networkidle')
        page.locator('.gl-path-node').first.wait_for(state='visible')
        page.locator('#glSubjectBtn').click()
        if not page.locator('#glSubjectMenu').is_visible():
            raise AssertionError('learning-path.html: subject menu did not open')
        page.locator('#glSubjectBtn').click()
        page.locator('#glStageSwitch').click()
        if page.locator('#glStagePicker').get_attribute('aria-hidden') != 'false':
            raise AssertionError('learning-path.html: stage picker did not open')
        page.locator('#glStagePickerClose').click()

        page.goto(base_url + 'guided-learning-node.html?node=awareness-keywords', wait_until='networkidle')
        page.locator('.gln-question-head').wait_for(state='visible')
        page.locator('[data-question-language="bilingual"]').click()
        page.wait_for_load_state('networkidle')
        if page.locator('[data-question-language="bilingual"]').get_attribute('aria-pressed') != 'true':
            raise AssertionError('guided-learning-node.html: language switch did not persist')
        if not page.locator('[data-footer-action="check"]').is_visible():
            raise AssertionError('guided-learning-node.html: primary action missing')

        page.goto(base_url + 'guided-learning-placement-test.html?part=environment', wait_until='networkidle')
        page.locator('#gptStartBtn').wait_for(state='visible')
        page.locator('#gptStartBtn').click()
        page.locator('#gptQuestion .glp-question-head').wait_for(state='visible')
        if not page.locator('#gptPrimaryAction').is_visible():
            raise AssertionError('guided-learning-placement-test.html: primary action missing')
        page.locator('[data-question-language="zh"]').click()
        page.wait_for_load_state('networkidle')
        if page.locator('[data-question-language="zh"]').get_attribute('aria-pressed') != 'true':
            raise AssertionError('guided-learning-placement-test.html: language switch did not persist')
        if errors:
            raise AssertionError(f'standalone runtime console errors: {errors}')
    finally:
        page.close()
        server.shutdown()
        server.server_close()


def inspect_chrome_runtime(browser):
    server, base_url = runtime_server()
    errors = []
    page = browser.new_page(viewport={'width': 1440, 'height': 900})
    page.add_init_script(
        """(() => {
          const username='student-chrome-runtime';
          localStorage.setItem('kg_local_current_user_v1',username);
          localStorage.setItem('kg_local_users_v1',JSON.stringify({
            [username]:{username,displayName:'学习外壳测试用户',role:'student',status:'active',subject:'PMP',salt:'x',hash:'x'}
          }));
        })();"""
    )
    page.on('dialog', lambda dialog: dialog.accept('界面验证画布') if dialog.type == 'prompt' else dialog.accept())
    page.on('pageerror', lambda error: errors.append(f'pageerror:{error}'))
    page.on('console', lambda message: errors.append(f'console:{message.text}') if message.type == 'error' else None)
    try:
        page.goto(base_url + 'question-training.html', wait_until='networkidle')
        page.locator('.qt-canvas-shell').wait_for(state='visible')
        page.locator('.qt-back-link [data-ui-icon-ready]').wait_for(state='attached')
        page.locator('.qt-language-switch [data-question-language="bilingual"]').click()
        if page.locator('.qt-language-switch [data-question-language="bilingual"]').get_attribute('aria-pressed') != 'true':
            raise AssertionError('question-training.html: language switch failed')

        page.goto(base_url + 'question-workspace.html', wait_until='networkidle')
        page.locator('.qw-canvas-shell').wait_for(state='visible')
        page.locator('.qw-back [data-ui-icon-ready]').wait_for(state='attached')
        page.locator('.qw-language-switch [data-question-language="zh"]').click()
        if page.locator('.qw-language-switch [data-question-language="zh"]').get_attribute('aria-pressed') != 'true':
            raise AssertionError('question-workspace.html: language switch failed')
        before_tabs = page.locator('.qw-workspace-tab').count()
        page.locator('#qwCreateWorkspaceBtn').click()
        page.wait_for_timeout(100)
        if page.locator('.qw-workspace-tab').count() < before_tabs:
            raise AssertionError('question-workspace.html: workspace tabs regressed after create')

        page.goto(base_url + 'knowledge-recall.html', wait_until='networkidle')
        page.locator('.kr-viewport').wait_for(state='visible')
        page.locator('.kr-back [data-ui-icon-ready]').wait_for(state='attached')
        page.locator('#krSceneMenu>summary').hover()
        page.locator('.kr-scene-panel').wait_for(state='visible')
        page.locator('[data-kr-theme="ocean"]').click()
        theme = page.locator('#krApp').get_attribute('data-theme') or page.locator('#krViewport').get_attribute('data-theme')
        if theme != 'ocean':
            raise AssertionError(f'knowledge-recall.html: scene switch failed ({theme})')
        page.locator('.kr-language-switch [data-question-language="bilingual"]').click()
        if page.locator('.kr-language-switch [data-question-language="bilingual"]').get_attribute('aria-pressed') != 'true':
            raise AssertionError('knowledge-recall.html: language switch failed')
        if errors:
            raise AssertionError(f'learning chrome runtime console errors: {errors}')
    finally:
        page.close()
        server.shutdown()
        server.server_close()


def stylesheet_hrefs(html):
    return [
        match.group(1)
        for match in re.finditer(r'<link\b[^>]*\bhref=["\']([^"\']+\.css)["\'][^>]*>', html, re.I)
    ]


def mount(page, filename):
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
    if hrefs[-2:] != ['styles/focus-vega-typography.css', 'styles/focus-vega-learning.css']:
        raise AssertionError(f'{filename}: final styles {hrefs[-2:]}')
    for href in hrefs:
        page.add_style_tag(content=(ROOT / href).read_text(encoding='utf-8'))
    page.add_style_tag(content='*{transition:none!important;animation:none!important}')
    inject_fixture(page, filename)
    page.evaluate(
        """async () => {
          document.getAnimations().forEach(animation=>animation.cancel());
          if(document.fonts?.ready)await document.fonts.ready;
          for(let frame=0;frame<6;frame+=1)await new Promise(resolve=>requestAnimationFrame(resolve));
        }"""
    )


def inject_fixture(page, filename):
    if filename == 'learning-path.html':
        page.locator('#glStageDescription').evaluate(
            "element => element.textContent='沿用现有学习路径布局，逐步完成知识节点与练习任务。'"
        )
        page.locator('#glPathParts').evaluate(
            """element => {
              element.innerHTML=`
                <section class="gl-stage-path-shell">
                  <div class="gl-stage-path-tools"><span>拖动画布浏览完整路径</span><div><button type="button" aria-label="上一个部分">\u2190</button><button type="button" aria-label="下一个部分">\u2192</button></div></div>
                  <div class="gl-stage-path-scroll"><div class="gl-stage-path-track"><section class="gl-part is-active" style="--gl-part-path-height:520px">
                    <div class="gl-part-divider"><div class="gl-part-divider-copy"><strong>第 1 部分</strong><span>项目启动与目标拆解</span></div></div>
                    <div class="gl-part-path"><div class="gl-part-path-track">
                      <article class="gl-path-node is-current is-available" style="--gl-path-left:35%;--gl-path-top:180px"><button class="gl-node-button" type="button"><span class="gl-node-base"></span><span class="gl-node-face"><span class="gl-node-icon">1</span></span></button><span class="gl-node-copy"><strong>理解项目目标与成功标准</strong></span></article>
                      <article class="gl-path-node is-locked" style="--gl-path-left:65%;--gl-path-top:360px"><button class="gl-node-button" type="button"><span class="gl-node-base"></span><span class="gl-node-face"><span class="gl-node-icon">2</span></span></button><span class="gl-node-copy"><strong>识别关键干系人与约束条件</strong></span></article>
                    </div></div>
                  </section></div></div>
                </section>`;
            }"""
        )
    elif filename == 'guided-learning-node.html':
        page.locator('#glnTitle').evaluate("element => element.textContent='识别项目目标与约束条件'")
        page.locator('#glnActivity').evaluate(
            """element => {
              element.innerHTML=`<div class="gln-question-head"><span>单选练习 · 第 1 题</span><h2>项目启动阶段，项目经理首先应该确认哪项信息？</h2><p>请选择最符合项目治理原则的答案。</p></div><div class="gln-choice-list"><button type="button"><span>A</span><strong>项目章程中的目标、边界与授权关系</strong></button><button type="button"><span>B</span><strong>团队成员的个人偏好与休假安排</strong></button><button type="button"><span>C</span><strong>所有供应商的最终报价与合同附件</strong></button></div>`;
            }"""
        )
    elif filename == 'guided-learning-placement-test.html':
        page.locator('#gptTitle').evaluate("element => element.textContent='项目启动与目标拆解'")
        page.locator('#gptScoreRule').evaluate("element => element.textContent='通过标准：10 / 12'")
        page.locator('#gptIntroDescription').evaluate(
            "element => element.textContent='通过一组代表性任务判断是否可以跳过本部分基础节点。未通过不会影响现有学习进度。'"
        )
    elif filename == 'question-workspace.html':
        page.locator('.qw-workspace-tabs').evaluate(
            """element => {
              element.innerHTML='<div class="qw-workspace-tab is-active" role="tab"><span class="qw-workspace-tab-title">项目整合与范围管理归纳画布</span><button type="button" class="qw-workspace-tab-close" aria-label="关闭工作区">\u00d7</button></div><div class="qw-workspace-tab" role="tab"><span class="qw-workspace-tab-title">敏捷团队场景</span></div>';
            }"""
        )
    elif filename == 'knowledge-recall.html':
        page.locator('#krSceneMenu').evaluate('element => { element.open=true; }')


def visible_box(page, filename, selector, width, height):
    locator = page.locator(selector)
    if locator.count() != 1:
        raise AssertionError(f'{filename} {width}x{height}: expected one {selector}, got {locator.count()}')
    box = locator.bounding_box()
    if not box or box['width'] <= 0.5 or box['height'] <= 0.5:
        raise AssertionError(f'{filename} {width}x{height}: invisible {selector}')
    if box['x'] < -2 or box['x'] + box['width'] > width + 2:
        raise AssertionError(f'{filename} {width}x{height}: horizontal overflow {selector} {box}')


def inspect(page, filename, spec, width, height):
    result = page.evaluate(
        """({roots,panelSelectors,primarySelector}) => {
          const visible=element=>{
            for(let current=element;current;current=current.parentElement){
              const style=getComputedStyle(current);
              if(current.hidden||style.display==='none'||style.visibility==='hidden'||Number(style.opacity)<=0)return false;
            }
            const box=element.getBoundingClientRect();return box.width>.5&&box.height>.5;
          };
          const protectedSelector='.account-menu-shell,#authModal,#userCenterModal,#userSubscriptionDetailModal,.subscription-backdrop,.membership-card,.payment-action,.wechat-pay-state';
          const iconOnly='.gl-node-button,.gln-keyword-passage button,.glp-keyword-passage button,.kr-scene-option';
          const candidates=new Set();
          for(const rootSelector of roots){
            document.querySelectorAll(rootSelector).forEach(root=>{
              candidates.add(root);root.querySelectorAll('*').forEach(element=>candidates.add(element));
            });
          }
          const textFailures=[];const weightFailures=[];const controlFailures=[];
          for(const element of candidates){
            if(!visible(element)||element.closest(protectedSelector)||element.matches('[aria-hidden="true"]'))continue;
            const direct=[...element.childNodes].filter(node=>node.nodeType===Node.TEXT_NODE).map(node=>node.textContent).join(' ').trim();
            const style=getComputedStyle(element);
            if(direct){
              const size=parseFloat(style.fontSize),weight=Number(style.fontWeight);
              if(size<12)textFailures.push(`${element.tagName.toLowerCase()}.${element.className||''}:${size}:${direct.slice(0,22)}`);
              if(![400,500,600,700].includes(weight))weightFailures.push(`${element.tagName.toLowerCase()}.${element.className||''}:${weight}:${direct.slice(0,18)}`);
            }
            if(element.matches('button,a,input,select,textarea')&&!element.matches(iconOnly)){
              const box=element.getBoundingClientRect();
              if(box.height<35.5)controlFailures.push(`${element.tagName.toLowerCase()}#${element.id||''}.${element.className||''}:${box.height}`);
              if(parseFloat(style.fontSize)<14)controlFailures.push(`${element.tagName.toLowerCase()}#${element.id||''}:font-${style.fontSize}`);
            }
          }
          const panels=panelSelectors.flatMap(selector=>[...document.querySelectorAll(selector)]).filter(visible).map(panel=>{
            const style=getComputedStyle(panel);return {className:panel.className,radius:parseFloat(style.borderRadius),border:style.borderColor,background:style.backgroundColor};
          });
          const primary=getComputedStyle(document.querySelector(primarySelector));
          return {
            bodyBackground:getComputedStyle(document.body).backgroundColor,
            primaryBackground:primary.backgroundColor,
            primaryColor:primary.color,
            rootOverflow:Math.max(document.documentElement.scrollWidth-document.documentElement.clientWidth,document.body.scrollWidth-document.body.clientWidth),
            textFailures:textFailures.slice(0,20),weightFailures:weightFailures.slice(0,20),controlFailures:controlFailures.slice(0,20),panels,
          };
        }""",
        {'roots': spec['text_roots'], 'panelSelectors': spec['panels'], 'primarySelector': spec['primary']},
    )
    if spec.get('body_background', 'rgb(250, 250, 250)') and result['bodyBackground'] != spec.get('body_background', 'rgb(250, 250, 250)'):
        raise AssertionError(f'{filename} {width}x{height}: body background {result["bodyBackground"]}')
    if result['primaryBackground'] not in ('rgb(109, 93, 252)', 'rgba(0, 0, 0, 0)'):
        raise AssertionError(f'{filename} {width}x{height}: primary {result["primaryBackground"]}')
    if result['rootOverflow'] > 2:
        raise AssertionError(f'{filename} {width}x{height}: root overflow {result["rootOverflow"]}')
    if result['textFailures'] or result['weightFailures'] or result['controlFailures']:
        raise AssertionError(f'{filename} {width}x{height}: typography/control failures {result}')
    for panel in result['panels']:
        if panel['radius'] not in (8, 10):
            raise AssertionError(f'{filename} {width}x{height}: panel radius {panel}')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--group', choices=('standalone', 'chrome', 'all'), default='all')
    args = parser.parse_args()
    cases = STANDALONE if args.group == 'standalone' else CHROME if args.group == 'chrome' else {**STANDALONE, **CHROME}
    checked = 0
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, args=ARGS)
        try:
            for filename, spec in cases.items():
                for width, height in VIEWPORTS:
                    page = browser.new_page(viewport={'width': width, 'height': height})
                    mount(page, filename)
                    for anchor in spec['anchors']:
                        visible_box(page, filename, anchor, width, height)
                    inspect(page, filename, spec, width, height)
                    checked += 1
                    page.close()
            if args.group in ('standalone', 'all'):
                inspect_runtime(browser)
            if args.group in ('chrome', 'all'):
                inspect_chrome_runtime(browser)
        finally:
            browser.close()
    print(f'focus-vega-learning-pc-browser-ok {checked}/{len(cases)*len(VIEWPORTS)}')


if __name__ == '__main__':
    main()
