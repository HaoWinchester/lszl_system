#!/usr/bin/env python3
import re
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT.parent / 'artifacts' / 'admin-focus-vega'
PAGES = {
    'admin-console.html': ['.admin-context-nav', '.admin-topbar', '.admin-main', '.admin-page-head', '.admin-kpi-grid'],
    'admin-operations.html': ['.admin-context-nav', '.admin-topbar', '.admin-main', '.admin-page-head', '.admin-two-column'],
    'admin-settings.html': ['.admin-context-nav', '.admin-topbar', '.admin-main', '.admin-page-head', '.admin-settings-links'],
    'admin-subjects.html': ['.admin-context-nav', '.admin-topbar', '.admin-main', '.admin-page-head', '.admin-subject-workspace'],
    'feedback-management.html': ['.admin-context-nav', '.admin-topbar', '.engagement-admin-main', '.admin-page-head', '.engagement-admin-grid'],
    'message-management.html': ['.admin-context-nav', '.admin-topbar', '.engagement-admin-main', '.admin-page-head', '.engagement-admin-grid'],
    'user-management.html': ['.admin-context-nav', '.um-app', '.um-topbar', '.um-summary', '.um-layout'],
    'system-settings.html': ['.admin-context-nav', '.ss-app', '.ss-topbar', '.ss-layout', '.ss-sidebar', '.ss-content'],
}
VIEWPORTS = [(1440, 900), (1366, 768), (1024, 768)]
ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']


def mount(page, filename):
    html = (ROOT / filename).read_text(encoding='utf-8')
    body_match = re.search(r'<body([^>]*)>([\s\S]*)</body>', html, re.I)
    if not body_match:
        raise AssertionError(f'{filename}: body missing')
    if 'data-admin-skin="focus-vega"' not in body_match.group(1):
        raise AssertionError(f'{filename}: Focus Vega opt-in missing')
    body = re.sub(r'<script[\s\S]*?</script>', '', body_match.group(2), flags=re.I)
    page.set_content(f'<!doctype html><html><head></head><body{body_match.group(1)}>{body}</body></html>')
    links = re.findall(r'<link[^>]+href=["\']([^"\']+\.css)["\']', html, re.I)
    if links[-2:] != [
        'styles/admin-focus-vega.css',
        f'styles/admin-focus-vega-{family_for(filename)}.css',
    ]:
        raise AssertionError(f'{filename}: skin load order {links[-2:]}')
    for href in links:
        css_path = ROOT / href
        if not css_path.exists():
            raise AssertionError(f'{filename}: missing stylesheet {href}')
        page.add_style_tag(content=css_path.read_text(encoding='utf-8'))
    if filename == 'user-management.html':
        page.evaluate(
            """() => {
              const summary=document.querySelector('.um-summary');
              for(let index=0;index<4;index+=1){
                const stat=document.createElement('article');
                stat.className='um-stat';
                stat.innerHTML=`<span>统计 ${index+1}</span><strong>${index}</strong><em>几何回归</em>`;
                summary.appendChild(stat);
              }
            }"""
        )
    frozen = page.evaluate(
        """() => Object.fromEntries(
          Array.from(document.querySelectorAll('.admin-account-menu,#authModal,[data-ss-panel="subscriptions"],[data-ss-panel="wechat"]'))
            .map((element,index)=>[`${element.id||element.getAttribute('data-ss-panel')||'frozen'}-${index}`,element.outerHTML])
        )"""
    )
    adapter = ROOT / 'src/108-admin-ui-icons.js'
    if not adapter.exists():
        raise AssertionError(f'{filename}: visual icon adapter missing')
    page.add_script_tag(content=adapter.read_text(encoding='utf-8'))
    page.wait_for_timeout(40)
    after = page.evaluate(
        """() => Object.fromEntries(
          Array.from(document.querySelectorAll('.admin-account-menu,#authModal,[data-ss-panel="subscriptions"],[data-ss-panel="wechat"]'))
            .map((element,index)=>[`${element.id||element.getAttribute('data-ss-panel')||'frozen'}-${index}`,element.outerHTML])
        )"""
    )
    if after != frozen:
        raise AssertionError(f'{filename}: frozen DOM changed during icon hydration')


def family_for(filename):
    if filename == 'user-management.html':
        return 'users'
    if filename == 'system-settings.html':
        return 'settings'
    return 'common'


def inspect_page(page, filename, selectors, width, height):
    for selector in selectors:
        locator = page.locator(selector)
        if locator.count() != 1:
            raise AssertionError(f'{filename} {width}x{height}: expected one {selector}, found {locator.count()}')
        box = locator.bounding_box()
        if not box or box['width'] <= 0 or box['height'] <= 0:
            raise AssertionError(f'{filename} {width}x{height}: invisible {selector}')
        if box['x'] < -2 or box['y'] < -2:
            raise AssertionError(f'{filename} {width}x{height}: negative position {selector} {box}')
        if box['x'] + box['width'] > width + 2:
            raise AssertionError(f'{filename} {width}x{height}: viewport overflow {selector} {box}')
    metrics = page.evaluate(
        """() => {
          const style=getComputedStyle(document.body);
          const panel=document.querySelector('.admin-page-head,.um-topbar,.ss-topbar');
          const primary=document.createElement('div');
          primary.style.color='var(--admin-primary)';document.body.appendChild(primary);
          const result={
            bodyBackground:style.backgroundColor,
            primaryColor:getComputedStyle(primary).color,
            panelRadius:panel?getComputedStyle(panel).borderRadius:'',
            overflow:document.body.scrollWidth-document.body.clientWidth,
            iconSlots:document.querySelectorAll('[data-admin-icon]').length,
            hydratedIcons:document.querySelectorAll('[data-admin-icon] svg.admin-ui-icon use').length,
          };
          primary.remove();return result;
        }"""
    )
    if metrics['bodyBackground'] != 'rgb(250, 250, 250)':
        raise AssertionError(f'{filename} {width}x{height}: body background {metrics}')
    if metrics['primaryColor'] != 'rgb(109, 93, 252)':
        raise AssertionError(f'{filename} {width}x{height}: primary color {metrics}')
    if metrics['panelRadius'] != '10px':
        raise AssertionError(f'{filename} {width}x{height}: panel radius {metrics}')
    if metrics['overflow'] > 2:
        raise AssertionError(f'{filename} {width}x{height}: body overflow {metrics}')
    if metrics['iconSlots'] < 1 or metrics['hydratedIcons'] != metrics['iconSlots']:
        raise AssertionError(f'{filename} {width}x{height}: icon hydration {metrics}')
    nav = page.locator('.admin-context-nav').bounding_box()
    if filename not in ('user-management.html', 'system-settings.html'):
        topbar = page.locator('.admin-topbar').bounding_box()
        if not nav or not topbar or abs(topbar['y'] - nav['height']) > 2:
            raise AssertionError(f'{filename} {width}x{height}: sticky stack nav={nav}, topbar={topbar}')
    if filename == 'user-management.html':
        inspect_user_management_alignment(page, width, height)


def inspect_user_management_alignment(page, width, height):
    geometry = page.evaluate(
        """() => {
          const rect=(element)=>{
            const box=element.getBoundingClientRect();
            return {x:box.x,right:box.right,width:box.width,y:box.y,height:box.height};
          };
          const buttons=[...document.querySelectorAll('.um-top-actions button')].map((button)=>{
            const icon=button.querySelector('[data-admin-icon]');
            const label=button.querySelector('span:not([data-admin-icon])');
            const iconBox=rect(icon);
            const labelBox=rect(label);
            const style=getComputedStyle(button);
            return {
              id:button.id,
              display:style.display,
              alignItems:style.alignItems,
              centerDelta:Math.abs((iconBox.y+iconBox.height/2)-(labelBox.y+labelBox.height/2)),
              gap:labelBox.x-(iconBox.x+iconBox.width),
            };
          });
          return {
            stats:[...document.querySelectorAll('.um-summary > .um-stat')].map(rect),
            left:rect(document.querySelector('.um-left-card')),
            editor:rect(document.querySelector('.um-editor-card')),
            right:rect(document.querySelector('.um-right-card')),
            buttons,
          };
        }"""
    )
    failures = []
    for button in geometry['buttons']:
        # Flex items are blockified by the parent flex container, so Chromium
        # serializes the authored inline-flex value as flex in computed style.
        if button['display'] not in ('flex', 'inline-flex') or button['alignItems'] != 'center':
            failures.append(f"{button['id']} flex alignment {button}")
        if button['centerDelta'] > 1:
            failures.append(f"{button['id']} center delta {button['centerDelta']}")
        if button['gap'] < 6:
            failures.append(f"{button['id']} icon gap {button['gap']}")
    if width >= 1181:
        stats = geometry['stats']
        if len(stats) != 4:
            failures.append(f"expected four summary cards, found {len(stats)}")
        else:
            comparisons = (
                ('left.x', geometry['left']['x'], stats[0]['x']),
                ('left.right', geometry['left']['right'], stats[0]['right']),
                ('editor.x', geometry['editor']['x'], stats[1]['x']),
                ('editor.right', geometry['editor']['right'], stats[2]['right']),
                ('right.x', geometry['right']['x'], stats[3]['x']),
                ('right.right', geometry['right']['right'], stats[3]['right']),
            )
            for label, actual, expected in comparisons:
                if abs(actual-expected) > 1:
                    failures.append(f'{label} actual={actual} expected={expected}')
    if failures:
        raise AssertionError(f"user-management.html {width}x{height}: " + '; '.join(failures))


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    failures = []
    checks = 0
    with sync_playwright() as playwright:
        launch = {'headless': True, 'args': ARGS}
        if Path('/usr/bin/chromium').exists():
            launch['executable_path'] = '/usr/bin/chromium'
        browser = playwright.chromium.launch(**launch)
        try:
            for width, height in VIEWPORTS:
                for filename, selectors in PAGES.items():
                    checks += 1
                    page = browser.new_page(viewport={'width': width, 'height': height})
                    errors = []
                    page.on('pageerror', lambda error, target=errors: target.append(str(error)))
                    page.on('console', lambda message, target=errors: target.append(message.text) if message.type == 'error' else None)
                    try:
                        mount(page, filename)
                        inspect_page(page, filename, selectors, width, height)
                        if errors:
                            raise AssertionError(f'{filename} {width}x{height}: browser errors {errors}')
                        page.screenshot(path=str(OUTPUT / f'{Path(filename).stem}-{width}x{height}.png'), full_page=True)
                    except Exception as error:
                        failures.append(str(error))
                    finally:
                        page.close()
        finally:
            browser.close()
    if failures:
        raise AssertionError('\n'.join(failures))
    print(f'admin-focus-vega-pc-browser-ok {checks}/24')


if __name__ == '__main__':
    main()
