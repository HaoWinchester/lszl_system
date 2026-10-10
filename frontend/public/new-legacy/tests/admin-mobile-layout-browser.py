#!/usr/bin/env python3
"""Exercise the actual admin page markup/styles at mobile and desktop widths."""
import re
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
TARGETS = (
    ('admin-subjects.html', '.admin-subject-rail', '.admin-subject-detail', 880),
    ('user-management.html', '.um-left-card', '.um-editor-card', 820),
)


def load_page(page, filename):
    source = (ROOT / filename).read_text(encoding='utf-8')
    source = re.sub(r'<script\b[^>]*>[\s\S]*?</script>', '', source, flags=re.I)

    def stylesheet(match):
        href = re.search(r'href=["\']([^"\']+)', match.group(0))
        if href and href.group(1).endswith('.css'):
            return '<style>' + (ROOT / href.group(1)).read_text(encoding='utf-8') + '</style>'
        return match.group(0)

    page.set_content(re.sub(r'<link\b[^>]*>', stylesheet, source), wait_until='load')


with sync_playwright() as playwright:
    options = {'headless': True, 'args': ['--no-sandbox', '--disable-dev-shm-usage']}
    if Path('/usr/bin/chromium').exists():
        options['executable_path'] = '/usr/bin/chromium'
    browser = playwright.chromium.launch(**options)
    for filename, left_selector, detail_selector, breakpoint in TARGETS:
        page = browser.new_page()
        load_page(page, filename)
        for width in (390, 768, breakpoint, 944, 1440):
            page.set_viewport_size({'width': width, 'height': 900})
            left = page.locator(left_selector).bounding_box()
            detail = page.locator(detail_selector).bounding_box()
            assert left and detail, filename
            if width <= breakpoint:
                assert detail['y'] >= left['y'] + left['height'], (filename, width, left, detail)
                assert detail['width'] >= width - 70, (filename, width, detail)
            else:
                assert detail['x'] >= left['x'] + left['width'], (filename, width, left, detail)
            assert detail['x'] >= 0 and detail['x'] + detail['width'] <= width + 1, (filename, width, detail)
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), (filename, width, 'page overflow')
        page.close()
    browser.close()

print('admin-mobile-layout-browser-ok')
