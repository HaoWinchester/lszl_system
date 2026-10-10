#!/usr/bin/env python3
"""Revenge resume actions must not widen the icon column at any lobby width."""
from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
html = (ROOT / 'practice-mode.html').read_text()
body = re.search(r'<body([^>]*)>([\s\S]*)</body>', html, re.I)
content = re.sub(r'<script[\s\S]*?</script>', '', body.group(2), flags=re.I)
with sync_playwright() as p:
    options = {'headless': True}
    if Path('/usr/bin/chromium').exists():
        options['executable_path'] = '/usr/bin/chromium'
    browser = p.chromium.launch(**options)
    page = browser.new_page()
    page.set_content(f'<html><body{body.group(1)}>{content}</body></html>')
    for file in ['styles/main.css', 'styles/practice-mode.css', 'styles/learning-skin.css']:
        page.add_style_tag(content=(ROOT / file).read_text())
    for width in [1440, 944, 390]:
        page.set_viewport_size({'width': width, 'height': 944})
        normal_before = page.locator('.practice-standard-modes').bounding_box()
        for resume in [False, True]:
            page.evaluate('''resume => {
                document.querySelector('[data-practice-new="revenge"]').hidden = !resume;
                document.querySelector('[data-practice-start="revenge"]').textContent = resume ? '继续上次复仇 1/6' : '暂无错题';
                document.querySelector('[data-practice-start="revenge"]').disabled = !resume;
            }''', resume)
            geometry = page.evaluate('''() => {
                const card = document.querySelector('.practice-mode-card.revenge');
                const rect = selector => card.querySelector(selector).getBoundingClientRect();
                const icon = rect('.practice-mode-icon'), header = card.children[1].getBoundingClientRect();
                const start = rect('.practice-start-btn'), fresh = rect('.practice-secondary-btn');
                return {headerGap:header.left-icon.right, expectedGap:parseFloat(getComputedStyle(card).columnGap), startWidth:start.width, freshWidth:fresh.width, startLeft:start.left, freshLeft:fresh.left, overflow:document.documentElement.scrollWidth > innerWidth};
            }''')
            assert abs(geometry['headerGap'] - geometry['expectedGap']) < 1, (width, resume, geometry)
            assert not geometry['overflow'], (width, resume, geometry)
            if resume:
                assert abs(geometry['startWidth'] - geometry['freshWidth']) < 1, (width, geometry)
                assert abs(geometry['startLeft'] - geometry['freshLeft']) < 1, (width, geometry)
            assert page.locator('.practice-standard-modes').bounding_box() == normal_before
    browser.close()
print('practice revenge responsive resume/empty layout: PASS')
