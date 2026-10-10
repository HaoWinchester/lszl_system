#!/usr/bin/env python3
"""Exercise focus with the index page's real stylesheet order (no backend required)."""
from pathlib import Path
import re
import unittest
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
STYLES = re.findall(r'<link[^>]+href="([^"]+\.css)"', (ROOT / 'index.html').read_text())
SHAPES = ('standard', 'sticky', 'rounded', 'rectangle', 'circle', 'triangle')


class FocusVisualTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(headless=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.page = self.browser.new_page(viewport={'width': 1400, 'height': 900})
        cards = ''.join(f'<div id="{kind}-{shape}" class="knowledge-card card-style-{shape} {"focus-card large-related-muted" if kind == "important" else "large-related-anchor active"}" style="left:{i*200}px;top:{row*190}px;width:160px;height:150px;--node-fill-color:#fef3c7"><div class="card-body"><div class="node-title">{kind} {shape}</div></div></div>' for row, kind in enumerate(('important', 'normal')) for i, shape in enumerate(SHAPES))
        self.page.set_content(f'<html><body><div class="app"><div id="stage" class="stage uc-canvas-surface" data-canvas-pattern="dots"><div class="world"><div class="cards-layer">{cards}<div class="graph-text-element">text</div></div><svg class="edge-layer"><path class="edge-visible"/></svg><svg class="canvas-ink-layer"></svg></div><div class="floating-toolbox"><button id="focusBtn">退出聚焦</button></div></div></div></body></html>')
        for style in STYLES:
            self.page.add_style_tag(content=(ROOT / style).read_text())
        # Remove transition timing as a factor; focus visuals themselves must be static.
        self.page.add_style_tag(content='*{transition:none!important}')

    def tearDown(self):
        self.page.close()

    def css(self, selector):
        return self.page.locator(selector).evaluate('el=>{const s=getComputedStyle(el);return Object.fromEntries(["backgroundColor","backgroundImage","opacity","filter","outlineColor","outlineStyle","boxShadow","animationName","color"].map(k=>[k,s[k]]))}')

    def test_custom_canvas_background_darkens_and_restores_without_dimming_toolbar(self):
        for theme, color in [('light', '#fff4df'), ('dark', '#101727')]:
            for pattern in ('dots', 'grid', 'solid'):
                with self.subTest(theme=theme, pattern=pattern):
                    self.page.eval_on_selector('#stage', '(el,p)=>{el.dataset.canvasTheme=p.theme;el.dataset.canvasPattern=p.pattern;el.style.setProperty("--uc-canvas-bg",p.color);el.style.setProperty("--uc-canvas-pattern-ink","rgba(71,85,105,.13)")}', {'theme': theme, 'color': color, 'pattern': pattern})
                    before = self.css('#stage')
                    toolbar = self.css('.floating-toolbox')
                    inline = self.page.locator('#stage').get_attribute('style')
                    self.page.eval_on_selector('#stage', 'el=>el.classList.add("focus-mode")')
                    focused = self.css('#stage')
                    self.assertNotEqual(focused['backgroundColor'], before['backgroundColor'])
                    self.assertEqual(focused['filter'], 'none')
                    self.assertEqual(self.css('.floating-toolbox'), toolbar)
                    self.assertEqual(focused['backgroundImage'] == 'none', pattern == 'solid')
                    self.assertEqual(self.page.locator('#stage').get_attribute('style'), inline)
                    self.page.eval_on_selector('#stage', 'el=>el.classList.remove("focus-mode")')
                    self.assertEqual(self.css('#stage'), before)

    def test_only_important_cards_stay_bright_across_shapes_flow_large_and_drag(self):
        for mode in ('', 'flow-mode graph-related-focus', 'large-graph-mode large-graph-related-focus', 'large-graph-mode large-graph-related-focus is-interacting'):
            with self.subTest(mode=mode):
                self.page.eval_on_selector('#stage', '(el,m)=>el.className="stage uc-canvas-surface "+m', mode)
                before = {f'{kind}-{shape}': self.css(f'#{kind}-{shape}') for kind in ('important', 'normal') for shape in SHAPES}
                self.page.eval_on_selector('#stage', 'el=>el.classList.add("focus-mode")')
                for shape in SHAPES:
                    important, normal = self.css(f'#important-{shape}'), self.css(f'#normal-{shape}')
                    self.assertEqual(important['opacity'], '1', (mode, shape, important))
                    if shape == 'triangle':
                        self.assertIn('drop-shadow(', important['filter'])
                        self.assertEqual(important['outlineStyle'], 'none')
                        self.assertEqual(self.css('#important-triangle .card-body')['backgroundColor'], 'rgb(250, 204, 21)')
                    else:
                        self.assertEqual(important['filter'], 'none')
                        self.assertEqual(important['outlineColor'], 'rgb(250, 204, 21)')
                        self.assertEqual(important['outlineStyle'], 'solid')
                        self.assertNotEqual(important['boxShadow'], 'none')
                    self.assertEqual(important['animationName'], 'none')
                    self.assertLess(float(normal['opacity']), .7)
                    self.assertIn('brightness(', normal['filter'])
                self.page.eval_on_selector('#stage', 'el=>el.classList.remove("focus-mode")')
                for key, expected in before.items():
                    self.assertEqual(self.css('#'+key), expected, key)

    def test_other_canvas_content_dims(self):
        self.page.eval_on_selector('#stage', 'el=>el.classList.add("focus-mode")')
        for selector in ('.graph-text-element', '.edge-layer', '.canvas-ink-layer'):
            self.assertLess(float(self.css(selector)['opacity']), .7, selector)


if __name__ == '__main__':
    unittest.main(verbosity=2)
