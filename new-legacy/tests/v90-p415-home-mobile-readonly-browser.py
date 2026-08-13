#!/usr/bin/env python3
from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']


def page_parts():
    source = (ROOT / 'index.html').read_text(encoding='utf-8')
    match = re.search(r'<body([^>]*)>([\s\S]*)</body>', source, re.I)
    attrs = match.group(1)
    body = re.sub(r'<script[\s\S]*?</script>', '', match.group(2), flags=re.I)
    scripts = re.findall(r'<script[^>]+src="([^"]+)"', source, re.I)
    styles = re.findall(r'<link[^>]+href="([^"]+\.css)"', source, re.I)
    return attrs, body, scripts, styles


def install_storage(page):
    page.evaluate("""()=>{
      const local=new Map(),session=new Map();
      const make=map=>({getItem:k=>map.has(String(k))?map.get(String(k)):null,setItem:(k,v)=>map.set(String(k),String(v)),removeItem:k=>map.delete(String(k)),clear:()=>map.clear(),key:i=>[...map.keys()][i]||null,get length(){return map.size}});
      Object.defineProperty(window,'localStorage',{configurable:true,value:make(local)});
      Object.defineProperty(window,'sessionStorage',{configurable:true,value:make(session)});
      window.alert=()=>{};window.confirm=()=>true;window.open=()=>null;
    }""")


def load(page):
    attrs, body, scripts, styles = page_parts()
    page.set_content(f'<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><base href="http://localhost/"></head><body{attrs}>{body}</body></html>')
    install_storage(page)
    for style in styles:
        target = ROOT / style
        if target.exists():
            page.add_style_tag(content=target.read_text(encoding='utf-8'))
    for script in scripts:
        target = ROOT / script
        if target.exists():
            page.add_script_tag(content=target.read_text(encoding='utf-8'))
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
    page.wait_for_timeout(650)


def assert_help_card_layout(page):
    card = page.locator('#helpCard')
    close = page.locator('#hideHelpBtn')
    guide = page.locator('#guidedTourStartBtn')
    assert card.is_visible() and close.is_visible() and guide.is_visible()
    card_box, close_box, guide_box = card.bounding_box(), close.bounding_box(), guide.bounding_box()
    assert guide_box['y'] >= close_box['y'] + close_box['height'] + 8, (card_box, close_box, guide_box)
    assert guide_box['x'] >= card_box['x'] and guide_box['x'] + guide_box['width'] <= card_box['x'] + card_box['width'], (card_box, guide_box)
    assert page.locator('.help-card-copy').count() == 1


def main():
    with sync_playwright() as p:
        options = {'headless': True, 'args': ARGS}
        if Path('/usr/bin/chromium').exists():
            options['executable_path'] = '/usr/bin/chromium'
        browser = p.chromium.launch(**options)
        desktop = browser.new_page(viewport={'width': 1440, 'height': 900})
        mobile = browser.new_page(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        touch_tablet = browser.new_page(viewport={'width': 800, 'height': 900}, has_touch=True)
        errors = []
        for page in (desktop, mobile, touch_tablet):
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)

        load(desktop)
        assert_help_card_layout(desktop)
        assert desktop.locator('#homeMobileReadonlyNotice').count() == 0

        load(mobile)
        assert_help_card_layout(mobile)
        notice = mobile.locator('#homeMobileReadonlyNotice')
        assert notice.is_visible()
        assert '仅支持查看模式，如需编辑请使用 PC 端。' in notice.inner_text()
        help_box, notice_box = mobile.locator('#helpCard').bounding_box(), notice.bounding_box()
        assert notice_box['y'] + notice_box['height'] <= help_box['y'], (notice_box, help_box)
        mobile.get_by_role('button', name='确定').click()
        assert notice.is_hidden()

        # The notice's coarse-pointer branch must use the same card avoidance.
        # It is intentionally not a phone viewport, so graph-phone-reading is absent.
        load(touch_tablet)
        assert not touch_tablet.locator('body').evaluate("node => node.classList.contains('graph-phone-reading')")
        tablet_notice = touch_tablet.locator('#homeMobileReadonlyNotice')
        assert tablet_notice.is_visible()
        tablet_help_box = touch_tablet.locator('#helpCard').bounding_box()
        tablet_notice_box = tablet_notice.bounding_box()
        assert tablet_notice_box['y'] + tablet_notice_box['height'] <= tablet_help_box['y'], (tablet_notice_box, tablet_help_box)
        assert not errors, errors
        browser.close()
    print('v90-p415-browser-pass home mobile readonly notice')


if __name__ == '__main__':
    main()
