#!/usr/bin/env python3
"""Exercise shared learning themes with real source pages in two same-origin tabs."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
KEY = 'kg_deep_recall_theme_v1'


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def check_theme(page, kind, theme):
    expect(page.locator('body')).to_have_attribute('data-kr-theme', theme)
    if kind == 'recall':
        expect(page.locator('#krApp')).to_have_attribute('data-theme', theme)
        expect(page.locator('#krViewport')).to_have_attribute('data-theme', theme)
        expect(page.locator('#krThemeSelect')).to_have_value(theme)
        expect(page.locator(f'.kr-scene-option[data-kr-theme="{theme}"]')).to_have_attribute('aria-checked', 'true')
        expect(page.locator('.kr-scene-option[aria-checked="true"]')).to_have_count(1)
    else:
        expect(page.locator('body')).to_have_attribute('data-theme', theme)
        expect(page.locator('#qwThemeSelect')).to_have_value(theme)


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT)))
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            context = browser.new_context()
            context.add_init_script("""(() => {
              if (!localStorage.getItem('kg_deep_recall_theme_platform_migrated_v1')) {
                localStorage.setItem('kg_deep_recall_theme_platform_migrated_v1', '1');
                localStorage.setItem('kg_deep_recall_theme_v1', 'platform');
              }
              window.__themeWrites = [];
              const original = Storage.prototype.setItem;
              Storage.prototype.setItem = function(key, value) {
                if (this === localStorage && key === 'kg_deep_recall_theme_v1') window.__themeWrites.push(value);
                return original.call(this, key, value);
              };
            })();""")
            base = f'http://127.0.0.1:{server.server_port}'
            recall, workspace = context.new_page(), context.new_page()
            recall.goto(base + '/knowledge-recall.html', wait_until='networkidle')
            workspace.goto(base + '/question-workspace.html', wait_until='networkidle')
            check_theme(recall, 'recall', 'platform')
            check_theme(workspace, 'workspace', 'platform')
            for page in (recall, workspace):
                page.evaluate('window.__themeWrites = []')

            workspace.locator('#qwThemeSelect').select_option('ocean')
            check_theme(workspace, 'workspace', 'ocean')
            check_theme(recall, 'recall', 'ocean')
            assert recall.evaluate('__themeWrites') == [], 'Receiving tab rewrote shared theme'
            assert workspace.evaluate('__themeWrites') == ['ocean']

            recall.locator('#krSceneMenu').evaluate('(menu) => menu.open = true')
            recall.locator('.kr-scene-option[data-kr-theme="sakura"]').click()
            check_theme(recall, 'recall', 'sakura')
            check_theme(workspace, 'workspace', 'sakura')
            assert recall.evaluate('__themeWrites') == ['sakura']
            assert workspace.evaluate('__themeWrites') == ['ocean'], 'Storage echo loop'

            workspace.evaluate("sessionStorage.setItem('kg_deep_recall_theme_v1', 'neon')")
            check_theme(recall, 'recall', 'sakura')
            # A key removed in another tab returns the receiver to the default without re-creating it.
            workspace.evaluate("localStorage.removeItem('kg_deep_recall_theme_v1')")
            check_theme(recall, 'recall', 'platform')
            assert recall.evaluate('__themeWrites') == ['sakura']
            assert recall.evaluate("localStorage.getItem('kg_deep_recall_theme_v1')") is None
            browser.close()
            print('PASS learning themes: bidirectional tabs, controls, no storage echo, removal fallback')
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


if __name__ == '__main__':
    main()
