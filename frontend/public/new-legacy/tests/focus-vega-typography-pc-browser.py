#!/usr/bin/env python3
"""Computed-style contract for the current Focus / Vega typography rollout.

The pages are mounted without their business scripts, then their declared
stylesheets are applied in document order.  That keeps the contract focused
on real browser layout and computed CSS while avoiding application data and
authentication side effects.
"""

import re
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
APPROVED_WEIGHTS = {400, 500, 600, 700}
VIEWPORTS = (
    ('100%-1440x900', 1440, 900, 1),
    ('100%-1366x768', 1366, 768, 1),
    ('100%-1024x768', 1024, 768, 1),
    # Reflow proxy for 200% browser zoom: halve the available CSS layout
    # viewport and use DPR 2.  This exercises the same responsive pressure;
    # it is intentionally not presented as exact browser zoom emulation.
    ('200%-1440x900', 720, 450, 2),
    ('200%-1366x768', 683, 384, 2),
    ('200%-1024x768', 512, 384, 2),
)

COMMON_ROLES = (
    ('page title', '.admin-page-head h1', 28),
    ('page kicker', '.admin-page-head>div:first-child>p', 12),
    ('page description', '.admin-page-head>div:first-child>span', 14),
    ('top action', '.admin-head-actions :is(button,a)', 14),
    ('admin navigation', '.admin-context-nav a', 14),
)

PAGES = {
    'admin-console.html': {
        'anchors': ('.admin-context-nav', '.admin-page-head', '.admin-kpi-grid'),
        'roles': COMMON_ROLES + (
            ('card title', '.admin-panel>header h2', 18),
            ('KPI label', '.admin-kpi-grid article>span', 12),
            ('KPI value', '.admin-kpi-grid article>strong', 24),
        ),
        'primary': '.admin-head-actions .primary',
    },
    'admin-operations.html': {
        'anchors': ('.admin-context-nav', '.admin-page-head', '.admin-two-column'),
        'roles': COMMON_ROLES + (
            ('card title', '.admin-panel>header h2', 18),
            ('KPI label', '.admin-kpi-grid article>span', 12),
            ('KPI value', '.admin-kpi-grid article>strong', 24),
        ),
        'primary': '#adminRefreshOperations',
    },
    'admin-settings.html': {
        'anchors': ('.admin-context-nav', '.admin-page-head', '.admin-settings-links'),
        'roles': COMMON_ROLES + (
            ('card title', '.admin-panel>header h2', 18),
            ('KPI label', '.admin-kpi-grid article>span', 12),
            ('KPI value', '.admin-kpi-grid article>strong', 24),
        ),
        'primary': '.admin-head-actions .primary',
    },
    'admin-subjects.html': {
        'anchors': ('.admin-context-nav', '.admin-page-head', '.admin-subject-workspace'),
        'roles': COMMON_ROLES + (
            (
                'workspace title',
                '.admin-rail-head h2,.admin-subject-detail-head h2,'
                '.admin-current-tree-title h3,.embedded-workspace-head h2',
                18,
            ),
            (
                'workspace KPI label',
                '.admin-subject-usage article>span,.admin-current-tree-metrics article>span',
                12,
            ),
            (
                'workspace KPI value',
                '.admin-subject-usage article>strong,.admin-current-tree-metrics article>strong',
                24,
            ),
        ),
        'primary': '#adminAddSubjectBtn',
    },
    'feedback-management.html': {
        'anchors': ('.admin-context-nav', '.admin-page-head', '.engagement-admin-grid'),
        'roles': COMMON_ROLES + (
            ('card title', '.engagement-admin-card>header h2', 18),
            ('card description', '.engagement-admin-card>header p', 14),
            ('filter control', '.engagement-admin-tools :is(input,select)', 14),
            ('KPI label', '.engagement-admin-summary article>span', 12),
            ('KPI value', '.engagement-admin-summary article>strong', 24),
        ),
        'primary': '#feedbackRefreshBtn',
    },
    'message-management.html': {
        'anchors': ('.admin-context-nav', '.admin-page-head', '.engagement-admin-grid'),
        'roles': COMMON_ROLES + (
            ('card title', '.engagement-admin-card>header h2', 18),
            ('card description', '.engagement-admin-card>header p', 14),
            ('filter control', '.engagement-admin-tools :is(input,select)', 14),
            ('KPI label', '.engagement-admin-summary article>span', 12),
            ('KPI value', '.engagement-admin-summary article>strong', 24),
        ),
        'primary': '#messageNewBtn',
    },
    'user-management.html': {
        'anchors': ('.admin-context-nav', '.um-topbar', '.um-summary', '.um-layout'),
        'roles': (
            ('page title', '.um-topbar h1', 28),
            ('page kicker', '.um-kicker', 12),
            ('page description', '.um-brand p:last-child', 14),
            ('admin navigation', '.admin-context-nav a', 14),
            ('card title', '.um-card-head h2,.um-right-dock-title h2', 18),
            (
                'card description',
                '.um-card-head p,.um-right-dock-title p,.um-help-list li',
                14,
            ),
            ('KPI label', '.um-summary .um-stat>span', 12),
            ('KPI value', '.um-summary .um-stat>strong', 24),
        ),
        'primary': '#umAddUserBtn',
    },
    'system-settings.html': {
        'anchors': ('.admin-context-nav', '.ss-topbar', '.ss-layout', '.ss-content'),
        'roles': (
            ('page title', '.ss-topbar h1', 28),
            ('page kicker', '.ss-topbar .um-kicker', 12),
            ('page description', '.ss-topbar .um-brand p:last-child', 14),
            ('admin navigation', '.admin-context-nav a', 14),
            (
                'settings navigation',
                '.ss-sidebar [data-ss-tab="themes"],'
                '.ss-sidebar [data-ss-tab="permissions"],'
                '.ss-sidebar [data-ss-tab="analytics"],'
                '.ss-sidebar [data-ss-tab="logs"]',
                14,
            ),
            ('card title', '.ss-content .um-card-head h2', 18),
            ('card description', '.ss-content .um-card-head p', 14),
        ),
        'primary': '.ss-sidebar button.active',
    },
    'practice-mode.html': {
        'anchors': ('.practice-header', '.practice-lobby-head', '.practice-setup-card', '.practice-mode-grid'),
        'roles': (
            ('page title', '.practice-lobby-head h1', 28),
            (
                'metadata',
                '.practice-lobby-head>span,.practice-brand small,.practice-field>span,'
                '.practice-field small,.practice-choice-group legend,.practice-mode-card small',
                12,
            ),
            ('field control', '.practice-field select', 16),
            ('choice control', '.practice-choice-group label>span', 14),
            ('mode switch', '.practice-mode-switch a', 14),
            ('card title', '.practice-mode-card h2', 18),
            ('card body', '.practice-mode-card p', 16),
            ('section title', '.practice-section-head h2', 20),
            ('primary action', '.practice-start-btn', 14),
        ),
        'primary': '.practice-start-btn[data-practice-start="challenge"]',
    },
}


def mount(page, filename):
    html = (ROOT / filename).read_text(encoding='utf-8')
    body_match = re.search(r'<body([^>]*)>([\s\S]*)</body>', html, re.I)
    if not body_match:
        raise AssertionError(f'{filename}: body missing')
    body_attributes = body_match.group(1)
    if not re.search(r'data-(?:admin|learning)-skin=["\']focus-vega["\']', body_attributes):
        raise AssertionError(f'{filename}: Focus Vega opt-in missing')

    body = re.sub(r'<script[\s\S]*?</script>', '', body_match.group(2), flags=re.I)
    page.set_content(
        f'<!doctype html><html lang="zh-CN"><head></head>'
        f'<body{body_attributes}>{body}</body></html>',
        wait_until='domcontentloaded',
    )
    links = re.findall(r'<link[^>]+href=["\']([^"\']+\.css)["\']', html, re.I)
    for href in links:
        css_path = ROOT / href
        if not css_path.exists():
            raise AssertionError(f'{filename}: missing stylesheet {href}')
        style_tag = page.add_style_tag(content=css_path.read_text(encoding='utf-8'))
        style_tag.evaluate(
            '(element,sourceHref) => { element.dataset.sourceStylesheet=sourceHref; }',
            href,
        )

    inject_fixture(page, filename)
    hydrate_visual_icons(page, filename)
    wait_for_stable_render(page, filename, links)
    page.evaluate('window.scrollTo(0,0)')


def wait_for_stable_render(page, filename, stylesheet_hrefs):
    adapter_href = (
        'styles/learning-skin.css'
        if filename == 'practice-mode.html'
        else 'styles/admin-focus-vega.css'
    )
    required = ('styles/focus-vega-typography.css', adapter_href)
    result = page.evaluate(
        """async ({allHrefs,requiredHrefs}) => {
          if(document.fonts && document.fonts.ready)await document.fonts.ready;
          const typographySelectors=[
            '.admin-context-nav a','.admin-page-head h1','.admin-head-actions button',
            '.um-kicker','.um-card-head h2',
            '.ss-sidebar [data-ss-tab="themes"]',
            '.ss-sidebar [data-ss-tab="permissions"]',
            '.ss-sidebar [data-ss-tab="analytics"]',
            '.ss-sidebar [data-ss-tab="logs"]',
            '.practice-lobby-head h1','.practice-start-btn'
          ].join(',');
          let previous='';
          let stableFrames=0;
          for(let frame=0;frame<16 && (frame<4 || stableFrames<2);frame+=1){
            await new Promise(resolve=>requestAnimationFrame(resolve));
            const snapshot=[...document.querySelectorAll(typographySelectors)].map(element=>{
              const style=getComputedStyle(element);
              return `${style.fontFamily}|${style.fontSize}|${style.fontWeight}`;
            }).join('\\n');
            stableFrames=frame>=3 && snapshot===previous?stableFrames+1:0;
            previous=snapshot;
          }
          const sheets=[...document.styleSheets].map(sheet=>({
            source:sheet.ownerNode?.dataset?.sourceStylesheet||'',
            ready:Boolean(sheet.ownerNode && sheet.cssRules),
          }));
          const loaded=new Set(sheets.filter(sheet=>sheet.ready).map(sheet=>sheet.source));
          return {
            sheetCount:sheets.length,
            missing:allHrefs.filter(href=>!loaded.has(href)),
            missingRequired:requiredHrefs.filter(href=>!loaded.has(href)),
            stableFrames,
          };
        }""",
        {'allHrefs': stylesheet_hrefs, 'requiredHrefs': required},
    )
    if (
        result['sheetCount'] != len(stylesheet_hrefs)
        or result['missing']
        or result['missingRequired']
        or result['stableFrames'] < 2
    ):
        raise AssertionError(f'{filename}: stylesheet render barrier failed {result}')


def hydrate_visual_icons(page, filename):
    learning = filename == 'practice-mode.html'
    adapter = ROOT / 'src' / ('107-learning-ui-icons.js' if learning else '108-admin-ui-icons.js')
    if not adapter.exists():
        raise AssertionError(f'{filename}: visual icon adapter missing')
    page.add_script_tag(content=adapter.read_text(encoding='utf-8'))
    result = page.evaluate(
        """learning => {
          const selector=learning?'[data-kg-icon]':'[data-admin-icon]';
          const iconSelector=learning?'svg.kg-icon use':'svg.admin-ui-icon use';
          const slots=[...document.querySelectorAll(selector)];
          const isVisible=element=>{
            for(let current=element;current;current=current.parentElement){
              const style=getComputedStyle(current);
              if(current.hidden || (current!==element && current.getAttribute('aria-hidden')==='true') ||
                  style.display==='none' || style.visibility==='hidden' ||
                  style.visibility==='collapse' || Number.parseFloat(style.opacity)<=0)return false;
            }
            const box=element.getBoundingClientRect();
            return box.width>0.5 && box.height>0.5;
          };
          const visible=slots.filter(isVisible);
          return {
            slots:slots.length,
            hydrated:slots.filter(slot=>slot.querySelector(iconSelector)).length,
            visible:visible.length,
            visibleSized:visible.filter(slot=>{
              const box=slot.getBoundingClientRect();
              return box.width>=12 && box.height>=12;
            }).length,
          };
        }""",
        learning,
    )
    if (
        result['slots'] < 1
        or result['hydrated'] != result['slots']
        or result['visible'] < 1
        or result['visibleSized'] != result['visible']
    ):
        raise AssertionError(f'{filename}: icon hydration or sizing failed {result}')


def inject_fixture(page, filename):
    if filename == 'user-management.html':
        page.evaluate(
            """() => {
              const summary=document.querySelector('.um-summary');
              summary.replaceChildren();
              ['账号总数','正常用户','已归档','题目总量'].forEach((label,index)=>{
                const stat=document.createElement('article');
                stat.className='um-stat';
                stat.innerHTML=`<span>${label}</span><strong>${index===0?200:index}</strong><em>字体契约数据</em>`;
                summary.appendChild(stat);
              });
              document.querySelector('#umUserList').innerHTML=`
                <div class="um-user-item compact active" data-user="long-user" role="button" tabindex="0" aria-label="选择长用户名测试用户">
                  <label class="um-user-check" title="加入批量选择"><input class="um-user-checkbox" type="checkbox"><span></span></label>
                  <span class="um-user-order">1</span>
                  <div class="um-user-main">
                    <div class="um-user-title"><strong>超长显示名称用于验证用户列表在较窄工作区仍然完整可读</strong><span class="um-pill active">正常</span></div>
                    <div class="um-user-compact-meta"><span>管理员</span><span>项目组合管理与复杂项目治理专业方向</span><span>123456 题</span></div>
                  </div>
                </div>`;
              document.querySelector('#umDataCard').innerHTML=
                '<div class="um-empty">用户题库数据读取失败，请稍后重试。</div>';
            }"""
        )
    elif filename in ('feedback-management.html', 'message-management.html'):
        page.evaluate(
            """filename => {
              const summary=document.querySelector('.engagement-admin-summary');
              summary.replaceChildren();
              ['全部记录','待处理','处理中','已完成'].forEach((label,index)=>{
                const stat=document.createElement('article');
                stat.innerHTML=`<span>${label}</span><strong>${index+1}</strong>`;
                summary.appendChild(stat);
              });
              if(filename==='feedback-management.html'){
                document.querySelector('#feedbackAdminList').innerHTML=`
                  <button type="button" class="engagement-admin-row active" data-feedback-id="long-feedback">
                    <header><strong>反馈标题包含一段足够长的中文内容用于验证窄列表内的换行与完整可读性</strong><time>2026/08/05 14:30</time></header>
                    <p>用户反馈详情同样使用较长文本，验证字号调整后列表摘要不会被错误地横向或纵向裁切。</p>
                    <footer><span>长用户名测试用户 · 功能建议</span><b>处理中</b></footer>
                  </button>`;
                document.querySelector('#feedbackAdminDetail').innerHTML=
                  '<div class="engagement-admin-empty">请选择一条反馈。</div>';
              }else{
                document.querySelector('#messageAdminList').innerHTML=`
                  <button type="button" class="engagement-admin-row active" data-message-id="long-message">
                    <header><strong>面向全部学习者的超长系统消息标题用于验证列表文字不会发生异常裁切</strong><time>2026/08/05 14:30</time></header>
                    <p>消息正文摘要包含较长的中文通知内容，确保在字体统一和二百缩放下依然能够保持稳定排版。</p>
                    <footer><span>指定用户：long-user-name-with-scope</span><b class="message-status-published">已发布</b></footer>
                  </button>`;
                document.querySelector('#messageAdminDetail').innerHTML=
                  '<div class="engagement-admin-empty">消息列表读取失败，请稍后重试。</div>';
              }
            }""",
            filename,
        )
    elif filename == 'system-settings.html':
        page.evaluate(
            """() => {
              document.querySelector('#ssRoleThemePanel').innerHTML=`
                <article class="um-role-theme" data-theme-role="admin" style="--theme:#6d5dfc;--theme-accent:#ede9fe;--theme-soft:#faf8ff">
                  <div class="um-role-theme-head"><span class="um-role-dot" style="background:#6d5dfc"></span><strong>管理员</strong></div>
                  <label><span>主色</span><input type="color" value="#6d5dfc"></label>
                  <label><span>强调色</span><input type="color" value="#8b7fff"></label>
                  <label><span>柔和底色</span><input type="color" value="#faf8ff"></label>
                  <div class="um-role-theme-actions"><button type="button">保存</button><button type="button">恢复默认</button></div>
                </article>`;
              document.querySelector('#ssPermissionMatrix').innerHTML=`
                <article class="um-permission-row"><strong>教师/教研</strong><div><span>维护题库</span><span>管理试卷</span><span>发布课程任务</span></div></article>`;
              document.querySelector('#ssAnalyticsContent').innerHTML=`
                <div class="ss-analytics-summary"><strong>128</strong><span>条有效事件</span></div>
                <div class="ss-analytics-table-wrap"><table><thead><tr><th>功能</th><th>活跃用户</th><th>关键操作</th><th>有效停留</th><th>成果用户率</th><th>质量指标</th></tr></thead><tbody><tr><th>题库</th><td>32</td><td>86</td><td>245 分钟</td><td>75%</td><td>92%</td></tr></tbody></table></div>
                <div class="ss-analytics-lower"><section><h3>每日趋势</h3><ul><li><span>2026-08-05</span><strong>86 次事件 · 32 位活跃用户</strong></li></ul></section><section><h3>确定性洞察</h3><div class="ss-analytics-insights"><article><strong>题库使用稳定</strong><p>当前样本显示题库关键操作完成率保持稳定。</p></article></div></section></div>`;
              document.querySelector('#ssLogList').innerHTML=`
                <div class="um-log-item"><strong>修改角色主题 · admin</strong><span>2026-08-05 14:30 · 操作者：system-admin</span><span>管理员主题色已更新并保存。</span></div>`;
            }"""
        )
    elif filename == 'practice-mode.html':
        page.evaluate(
            """() => {
              document.body.dataset.practiceView='lobby';
              const select=document.querySelector('#practicePaperSelect');
              select.innerHTML='<option value="pmp">PMP 综合模拟卷</option>';
              document.querySelector('#practicePaperMeta').textContent='共 180 题 · 已发布';
              const history=document.querySelector('#practiceHistorySection');
              history.hidden=false;
              document.querySelector('#practiceHistoryList').innerHTML=
                '<article class="practice-history-row"><strong>PMP 综合模拟卷</strong><span>10 题</span><span>正确率 80%</span><em>挑战模式</em></article>';
            }"""
        )


def inspect_anchors(page, filename, label, selectors, width):
    failures = []
    for selector in selectors:
        locator = page.locator(selector)
        if locator.count() != 1:
            failures.append(f'anchor {selector}: expected 1, found {locator.count()}')
            continue
        box = locator.bounding_box()
        if not box or box['width'] <= 0 or box['height'] <= 0:
            failures.append(f'anchor {selector}: not rendered')
        elif box['x'] < -2 or box['x'] + box['width'] > width + 2:
            failures.append(f'anchor {selector}: outside viewport x={box["x"]:.1f} width={box["width"]:.1f}')
    if failures:
        raise AssertionError(f'{filename} {label}: ' + '; '.join(failures))


def inspect_roles(page, filename, label, roles):
    failures = []
    for role, selector, expected_size in roles:
        values = page.locator(selector).evaluate_all(
            """elements => elements.filter(element => {
              for(let current=element;current;current=current.parentElement){
                const ancestorStyle=getComputedStyle(current);
                if(current.hidden || current.getAttribute('aria-hidden')==='true' ||
                    ancestorStyle.display==='none' || ancestorStyle.visibility==='hidden' ||
                    ancestorStyle.visibility==='collapse' || Number.parseFloat(ancestorStyle.opacity)<=0)return false;
              }
              const box=element.getBoundingClientRect();
              return box.width>0.5 && box.height>0.5;
            }).map(element => {
              const style=getComputedStyle(element);
              const box=element.getBoundingClientRect();
              return {
                text:(element.innerText||element.value||element.getAttribute('aria-label')||'').trim().replace(/\s+/g,' ').slice(0,42),
                size:Number.parseFloat(style.fontSize),
                weight:Number.parseInt(style.fontWeight,10),
                family:style.fontFamily,
                ownOverflow:element.clientWidth>0 ? element.scrollWidth-element.clientWidth : 0,
                width:box.width,
              };
            })"""
        )
        if not values:
            failures.append(f'{role}: no visible match for {selector}')
            continue
        for value in values:
            subject = value['text'] or selector
            if abs(value['size'] - expected_size) > 0.75:
                failures.append(f'{role} "{subject}": {value["size"]:g}px != {expected_size}px')
            if value['weight'] not in APPROVED_WEIGHTS:
                failures.append(f'{role} "{subject}": weight {value["weight"]}')
            if not approved_font_stack(value['family']):
                failures.append(f'{role} "{subject}": font {value["family"]}')
            if value['ownOverflow'] > 2:
                failures.append(f'{role} "{subject}": clipped by {value["ownOverflow"]}px')
            if len(failures) >= 14:
                break
        if len(failures) >= 14:
            break
    if failures:
        raise AssertionError(f'{filename} {label}: semantic typography: ' + '; '.join(failures))


def approved_font_stack(value):
    families = [part.strip().strip('"\'').lower() for part in value.split(',')]
    expected = [
        'pingfang sc',
        'microsoft yahei',
        'system-ui',
        '-apple-system',
        'blinkmacsystemfont',
        'segoe ui',
        'sans-serif',
    ]
    # Chromium on macOS serializes BlinkMacSystemFont as a second system-ui
    # entry even when the authored token is exact.  The source contract locks
    # the authored seven-item stack; this browser check accepts that platform
    # serialization only.
    mac_chromium = [*expected]
    mac_chromium[4] = 'system-ui'
    return families in (expected, mac_chromium)


def inspect_visible_text_and_controls(page, filename, label):
    result = page.evaluate(
        """() => {
          const approvedWeights=new Set([400,500,600,700]);
          const frozenSelector=[
            '#authModal','#authDialogRoot','.auth-backdrop','.auth-modal','.auth-status',
            '.admin-account-menu','.account-menu-shell','.um-subscription-card',
            '#ssSubscriptionPanel','#ssWechatConfigPanel',
            '[data-ss-panel="subscriptions"]','[data-ss-panel="wechat"]',
            '[data-ss-tab="subscriptions"]','[data-ss-tab="wechat"]',
            '[class^="subscription-"],[class*=" subscription-"]',
            '[class^="membership-"],[class*=" membership-"]',
            '[class^="payment-"],[class*=" payment-"]',
            '[class^="wechat-pay-"],[class*=" wechat-pay-"]',
            '.qt-canvas-shell','.qw-canvas-shell','.kr-viewport','iframe','embed'
          ].join(',');
          const iconSelector=[
            'svg','use','[aria-hidden="true"]','[data-admin-icon]','[data-kg-icon]',
            '[data-icon]','.practice-brand-mark','.admin-brand>span:first-child',
            '.um-back','.ss-back-label','button.icon'
          ].join(',');
          const isVisible=element=>{
            for(let current=element;current;current=current.parentElement){
              const ancestorStyle=getComputedStyle(current);
              if(current.hidden || current.getAttribute('aria-hidden')==='true' ||
                  ancestorStyle.display==='none' || ancestorStyle.visibility==='hidden' ||
                  ancestorStyle.visibility==='collapse' || Number.parseFloat(ancestorStyle.opacity)<=0)return false;
            }
            const box=element.getBoundingClientRect();
            return box.width>0.5 && box.height>0.5;
          };
          const isFrozen=element=>Boolean(element.closest(frozenSelector));
          const isIconText=(element,text)=>element.matches(iconSelector) ||
            /^[←→↪⌄×+＋?？·•—–]+$/.test(text);
          const path=element=>{
            if(element.id)return `${element.tagName.toLowerCase()}#${element.id}`;
            const classes=[...element.classList].slice(0,2).join('.');
            return `${element.tagName.toLowerCase()}${classes?'.'+classes:''}`;
          };
          const directText=element=>[...element.childNodes]
            .filter(node=>node.nodeType===Node.TEXT_NODE)
            .map(node=>node.textContent).join(' ').trim().replace(/\s+/g,' ');
          const smallText=[];
          const badTextWeight=[];
          const clippedText=[];
          let checkedText=0;
          for(const element of document.body.querySelectorAll('*')){
            const text=directText(element);
            if(!text || element.tagName==='OPTION' || !isVisible(element) ||
                isFrozen(element) || isIconText(element,text))continue;
            checkedText+=1;
            const style=getComputedStyle(element);
            const size=Number.parseFloat(style.fontSize);
            const weight=Number.parseInt(style.fontWeight,10);
            if(size<11.75 && smallText.length<4)smallText.push(`${path(element)} "${text.slice(0,30)}" ${size}px`);
            if(!approvedWeights.has(weight) && badTextWeight.length<4)badTextWeight.push(`${path(element)} "${text.slice(0,30)}" ${weight}`);
            const horizontalClip=element.clientWidth>0 ? element.scrollWidth-element.clientWidth : 0;
            const verticalClip=element.clientHeight>0 ? element.scrollHeight-element.clientHeight : 0;
            const clipsOverflow=value=>['hidden','clip','auto','scroll'].includes(value);
            const clipsX=horizontalClip>2 && clipsOverflow(style.overflowX);
            const clipsY=verticalClip>2 && clipsOverflow(style.overflowY);
            if((clipsX || clipsY) && clippedText.length<4){
              clippedText.push(`${path(element)} "${text.slice(0,30)}" x+${Math.max(0,horizontalClip)} y+${Math.max(0,verticalClip)}`);
            }
          }

          const smallControls=[];
          const badControlWeight=[];
          const overflowingControls=[];
          let checkedControls=0;
          for(const control of document.querySelectorAll('button,a,input,select,textarea')){
            const text=(control.innerText||control.value||control.placeholder||control.getAttribute('aria-label')||'').trim();
            if(!isVisible(control) || isFrozen(control) || control.matches(iconSelector) || !text)continue;
            checkedControls+=1;
            const style=getComputedStyle(control);
            const size=Number.parseFloat(style.fontSize);
            const weight=Number.parseInt(style.fontWeight,10);
            if(size<13.75 && smallControls.length<4)smallControls.push(`${path(control)} "${text.slice(0,30)}" ${size}px`);
            if(!approvedWeights.has(weight) && badControlWeight.length<4)badControlWeight.push(`${path(control)} "${text.slice(0,30)}" ${weight}`);
            if(control.clientWidth>0 && control.scrollWidth-control.clientWidth>2 && overflowingControls.length<4){
              overflowingControls.push(`${path(control)} "${text.slice(0,30)}" +${control.scrollWidth-control.clientWidth}px`);
            }
          }
          return {
            checkedText,checkedControls,smallText,badTextWeight,clippedText,smallControls,
            badControlWeight,overflowingControls,
            rootOverflow:Math.max(
              document.documentElement.scrollWidth-document.documentElement.clientWidth,
              document.body.scrollWidth-document.body.clientWidth
            ),
          };
        }"""
    )
    failures = []
    if result['checkedText'] < 10:
        failures.append(f"leaf-text scan too small ({result['checkedText']})")
    if result['checkedControls'] < 2:
        failures.append(f"control scan too small ({result['checkedControls']})")
    for key, description in (
        ('smallText', 'visible text below 12px'),
        ('badTextWeight', 'visible text with unsupported weight'),
        ('clippedText', 'clipped visible text'),
        ('smallControls', 'control text below 14px'),
        ('badControlWeight', 'control with unsupported weight'),
        ('overflowingControls', 'clipped control'),
    ):
        if result[key]:
            failures.append(f'{description}: ' + ', '.join(result[key]))
    if result['rootOverflow'] > 2:
        failures.append(f"root horizontal overflow {result['rootOverflow']}px")
    if failures:
        raise AssertionError(f'{filename} {label}: ' + '; '.join(failures))


def inspect_initial_zoom_title(page, filename, label, selector, width, height):
    locator = page.locator(selector)
    if locator.count() != 1:
        raise AssertionError(f'{filename} {label}: page title {selector}: expected 1, found {locator.count()}')
    result = locator.evaluate(
        """(element,viewport) => {
          const style=getComputedStyle(element);
          let ancestorHidden=false;
          for(let current=element;current;current=current.parentElement){
            const ancestorStyle=getComputedStyle(current);
            if(current.hidden || current.getAttribute('aria-hidden')==='true' ||
                ancestorStyle.display==='none' || ancestorStyle.visibility==='hidden' ||
                ancestorStyle.visibility==='collapse' || Number.parseFloat(ancestorStyle.opacity)<=0){
              ancestorHidden=true;break;
            }
          }
          const box=element.getBoundingClientRect();
          const visibleTop=Math.max(0,box.top);
          const visibleBottom=Math.min(viewport.height,box.bottom);
          const visibleHeight=Math.max(0,visibleBottom-visibleTop);
          const x=Math.min(viewport.width-1,Math.max(1,box.left+box.width/2));
          const y=visibleHeight>0 ? visibleTop+visibleHeight/2 : -1;
          const hit=y>=0?document.elementFromPoint(x,y):null;
          return {
            display:style.display,visibility:style.visibility,opacity:Number.parseFloat(style.opacity),ancestorHidden,
            box:{left:box.left,right:box.right,top:box.top,bottom:box.bottom,width:box.width,height:box.height},
            visibleHeight,
            uncovered:Boolean(hit && (hit===element || element.contains(hit))),
          };
        }""",
        {'width': width, 'height': height},
    )
    if (
        result['display'] == 'none'
        or result['visibility'] in ('hidden', 'collapse')
        or result['opacity'] <= 0
        or result['ancestorHidden']
        or result['box']['width'] <= 0
        or result['box']['height'] <= 0
        or result['visibleHeight'] <= 1
        or not result['uncovered']
    ):
        raise AssertionError(f'{filename} {label}: page title not initially visible {selector}: {result}')


def inspect_primary_action(page, filename, label, selector, width, height):
    locator = page.locator(selector)
    if locator.count() != 1:
        raise AssertionError(f'{filename} {label}: primary {selector}: expected 1, found {locator.count()}')
    result = locator.evaluate(
        """(element,viewport) => {
          element.scrollIntoView({block:'center',inline:'center'});
          const style=getComputedStyle(element);
          let ancestorHidden=false;
          for(let current=element;current;current=current.parentElement){
            const ancestorStyle=getComputedStyle(current);
            if(current.hidden || current.getAttribute('aria-hidden')==='true' ||
                ancestorStyle.display==='none' || ancestorStyle.visibility==='hidden' ||
                ancestorStyle.visibility==='collapse' || Number.parseFloat(ancestorStyle.opacity)<=0){
              ancestorHidden=true;break;
            }
          }
          const box=element.getBoundingClientRect();
          const x=box.left+box.width/2;
          const y=box.top+box.height/2;
          const hit=document.elementFromPoint(x,y);
          return {
            display:style.display,visibility:style.visibility,opacity:Number.parseFloat(style.opacity),ancestorHidden,
            disabled:Boolean(element.disabled || element.getAttribute('aria-disabled')==='true'),
            box:{left:box.left,right:box.right,top:box.top,bottom:box.bottom,width:box.width,height:box.height},
            inViewport:box.left>=-2 && box.right<=viewport.width+2 && box.top>=-2 && box.bottom<=viewport.height+2,
            hit:Boolean(hit && (hit===element || element.contains(hit))),
          };
        }""",
        {'width': width, 'height': height},
    )
    if (
        result['display'] == 'none'
        or result['visibility'] in ('hidden', 'collapse')
        or result['opacity'] <= 0
        or result['ancestorHidden']
        or result['disabled']
        or result['box']['width'] <= 0
        or result['box']['height'] <= 0
        or not result['inViewport']
        or not result['hit']
    ):
        raise AssertionError(f'{filename} {label}: primary action not usable {selector}: {result}')


def inspect_system_settings_panes(page, filename, label, roles):
    failures = []
    panes = ('themes', 'permissions', 'analytics', 'logs')
    try:
        for pane_name in panes:
            page.evaluate(
                """paneName => {
                  document.querySelectorAll('[data-ss-tab]').forEach(button=>{
                    button.classList.toggle('active',button.dataset.ssTab===paneName);
                  });
                  document.querySelectorAll('[data-ss-panel]').forEach(panel=>{
                    panel.classList.toggle('active',panel.dataset.ssPanel===paneName);
                  });
                  window.scrollTo(0,0);
                }""",
                pane_name,
            )
            pane_label = f'{label}/{pane_name}'
            for inspection in (
                lambda: inspect_roles(page, filename, pane_label, roles),
                lambda: inspect_visible_text_and_controls(page, filename, pane_label),
            ):
                try:
                    inspection()
                except AssertionError as error:
                    failures.append(str(error))
    finally:
        page.evaluate(
            """() => {
              document.querySelectorAll('[data-ss-tab]').forEach(button=>{
                button.classList.toggle('active',button.dataset.ssTab==='themes');
              });
              document.querySelectorAll('[data-ss-panel]').forEach(panel=>{
                panel.classList.toggle('active',panel.dataset.ssPanel==='themes');
              });
              window.scrollTo(0,0);
            }"""
        )
    if failures:
        raise AssertionError(' | '.join(failures))


def inspect_case(page, filename, spec, label, width, height, zoomed):
    failures = []
    inspections = [lambda: inspect_anchors(page, filename, label, spec['anchors'], width)]
    if filename == 'system-settings.html':
        inspections.append(
            lambda: inspect_system_settings_panes(page, filename, label, spec['roles'])
        )
    else:
        inspections.extend((
            lambda: inspect_roles(page, filename, label, spec['roles']),
            lambda: inspect_visible_text_and_controls(page, filename, label),
        ))
    for inspection in inspections:
        try:
            inspection()
        except AssertionError as error:
            failures.append(str(error))
    if zoomed:
        title_selector = next(selector for role, selector, _ in spec['roles'] if role == 'page title')
        try:
            inspect_initial_zoom_title(page, filename, label, title_selector, width, height)
        except AssertionError as error:
            failures.append(str(error))
        try:
            inspect_primary_action(page, filename, label, spec['primary'], width, height)
        except AssertionError as error:
            failures.append(str(error))
    if failures:
        prefix = f'{filename} {label}: '
        raise AssertionError(prefix + ' | '.join(
            failure.removeprefix(prefix) for failure in failures
        ))


def main():
    failures = []
    checks = 0
    with sync_playwright() as playwright:
        launch = {'headless': True, 'args': ARGS}
        if Path('/usr/bin/chromium').exists():
            launch['executable_path'] = '/usr/bin/chromium'
        browser = playwright.chromium.launch(**launch)
        contexts = {}
        pages = {}
        error_buckets = {}
        try:
            for dpr in (1, 2):
                context = browser.new_context(device_scale_factor=dpr, reduced_motion='reduce')
                page = context.new_page()
                page.set_default_timeout(3000)
                bucket = []
                page.on('pageerror', lambda error, target=bucket: target.append(f'pageerror: {error}'))
                page.on(
                    'console',
                    lambda message, target=bucket: target.append(f'console: {message.text}')
                    if message.type == 'error' else None,
                )
                contexts[dpr] = context
                pages[dpr] = page
                error_buckets[dpr] = bucket

            for label, width, height, dpr in VIEWPORTS:
                page = pages[dpr]
                page.set_viewport_size({'width': width, 'height': height})
                for filename, spec in PAGES.items():
                    checks += 1
                    error_buckets[dpr].clear()
                    try:
                        mount(page, filename)
                    except Exception as error:
                        failures.append(str(error))
                        continue
                    try:
                        inspect_case(page, filename, spec, label, width, height, dpr == 2)
                    except Exception as error:
                        failures.append(str(error))
                    if error_buckets[dpr]:
                        failures.append(
                            f'{filename} {label}: browser errors {error_buckets[dpr][:4]}'
                        )
        finally:
            for context in contexts.values():
                context.close()
            browser.close()

    if failures:
        categories = (
            ('semantic typography', 'semantic'),
            ('visible text below', 'sub-12 text'),
            ('unsupported weight', 'unsupported weights'),
            ('clipped visible text', 'clipped text'),
            ('control text below', 'sub-14 controls'),
            ('horizontal overflow', 'root overflow'),
            ('page title not initially visible', 'hidden zoom title'),
            ('primary action not usable', 'unusable primary action'),
            ('browser errors', 'browser errors'),
        )
        summary = ', '.join(
            f'{label}={sum(needle in failure for failure in failures)}'
            for needle, label in categories
        )
        preview = '\n'.join(f'- {failure}' for failure in failures[:12])
        remaining = len(failures) - min(len(failures), 12)
        suffix = f'\n- ... {remaining} additional failing cases omitted' if remaining else ''
        raise AssertionError(
            f'focus-vega typography RED: {len(failures)}/{checks} failures; {summary}\n'
            f'{preview}{suffix}'
        )
    print(f'focus-vega-typography-pc-browser-ok {checks}/{checks}')


if __name__ == '__main__':
    main()
