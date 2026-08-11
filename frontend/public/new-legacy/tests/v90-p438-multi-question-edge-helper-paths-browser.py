#!/usr/bin/env python3
from pathlib import Path
from playwright.sync_api import sync_playwright


ROOT=Path(__file__).resolve().parents[1]
ARGS=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']


with sync_playwright() as p:
    launch_options={'headless':True,'args':ARGS}
    if Path('/usr/bin/chromium').exists():
        launch_options['executable_path']='/usr/bin/chromium'
    browser=p.chromium.launch(**launch_options)
    page=browser.new_page()
    page.set_content('''<!doctype html><svg class="qw-edge-layer" viewBox="0 0 800 500">
      <path class="qw-edge-hover-outline" d="M 80 80 C 190 350 570 350 680 80"></path>
      <path class="qw-edge-selection-line" d="M 80 80 C 190 350 570 350 680 80"></path>
    </svg>''')
    page.add_style_tag(content=(ROOT/'styles/question-workspace.css').read_text(encoding='utf-8'))

    fills=page.locator('.qw-edge-layer :is(.qw-edge-hover-outline,.qw-edge-selection-line)').evaluate_all(
        'paths=>paths.map(path=>getComputedStyle(path).fill)'
    )
    assert fills==['none','none'],fills

    browser.close()

print('v90-p438-multi-question-edge-helper-paths-browser-ok')
