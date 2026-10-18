#!/usr/bin/env python3
"""Real shared-module/CSS/icon regression for the approved danmaku component.
Run: python3 new-legacy/tests/danmaku-design-browser.py
The routed API is isolated; no real user comments or preferences are changed.
"""
from pathlib import Path
import json
import re
import unittest
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT.parent / 'artifacts/danmaku-image-design'
COMMENTS = [dict(id='c1', questionId='q1', content='这题的关键是变更控制流程', likeCount=8,
                 createdAt='2026-10-16T08:00:00+08:00', author='小林', isMine=False,
                 myLike=False, myFavorite=False, danmakuEligible=True, canDelete=False),
            dict(id='c2', questionId='q1', content='<img src=x onerror=alert(1)>', likeCount=0,
                 createdAt='2026-10-16T08:00:00+08:00', author='<小张>', isMine=False,
                 myLike=False, myFavorite=False, danmakuEligible=True, canDelete=False)]


def launch_browser(playwright):
    chrome = Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    kwargs = dict(headless=True, args=['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'])
    if chrome.exists():
        kwargs['executable_path'] = str(chrome)
    elif Path('/usr/bin/chromium').exists():
        kwargs['executable_path'] = '/usr/bin/chromium'
    return playwright.chromium.launch(**kwargs)


class DanmakuDesign(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = launch_browser(cls.playwright)
        ARTIFACTS.mkdir(parents=True, exist_ok=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.context = self.browser.new_context(viewport={'width':1440, 'height':1000}, timezone_id='Asia/Shanghai')
        self.page = self.context.new_page()
        self.comments = [dict(row) for row in COMMENTS]
        self.fail_like = False
        self.fail_favorite = False
        self.page.route('http://localhost/**', self.route)
        # Exact production practice CSS order and body attributes, including ID-specific global skin rules.
        html = (ROOT / 'practice-mode.html').read_text()
        self.body_attrs = re.search(r'<body([^>]*)>', html).group(1)
        self.css = re.findall(r'<link[^>]+href="([^"]+\.css)"', html)
        self.page.goto('http://localhost/test-harness')
        self.page.evaluate("window.KGAuthCore={currentUser:()=>({username:'stu',role:'student'})}; window.copied=''; Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>{window.copied=value}}})")
        self.page.add_script_tag(url='http://localhost/src/28-device-preferences.js')
        self.page.add_script_tag(url='http://localhost/src/107-learning-ui-icons.js')
        self.page.add_script_tag(url='http://localhost/src/119-question-comments.js')
        self.page.evaluate("window.inst=KGQuestionComments.mountDanmaku({questionId:'q1'})")
        self.page.wait_for_selector('.q-danmaku-item', state='attached')
        self.place()

    def tearDown(self):
        self.context.close()

    def route(self, route):
        url = route.request.url.removeprefix('http://localhost/')
        if url == 'test-harness':
            links = ''.join('<link rel="stylesheet" href="/'+p+'">' for p in self.css)
            route.fulfill(content_type='text/html', body='<!doctype html><html><head><meta charset="utf-8">'+links+'</head><body'+self.body_attrs+'><main style="padding:40px"><h1>项目经理发现项目范围发生了变化，下一步应该做什么？</h1><p>解析：首先分析影响，再决定是否变更。</p></main></body></html>')
        elif url.startswith('api/v1/'):
            method = route.request.method
            if url.endswith('/like'):
                if self.fail_like:
                    route.fulfill(status=500, json={'detail':'temporary failure'}); return
                self.comments[0].update(myLike=method=='POST', likeCount=9 if method=='POST' else 8)
                route.fulfill(json={'comment':self.comments[0]})
            elif url.endswith('/favorite'):
                if self.fail_favorite:
                    route.fulfill(status=500, json={'detail':'favorite failed'}); return
                self.comments[0]['myFavorite'] = method == 'PUT'
                route.fulfill(json={'comment':self.comments[0]})
            else:
                route.fulfill(json={'comments':self.comments, 'nextCursor':None})
        else:
            path = ROOT / url.split('?')[0]
            if path.is_file():
                route.fulfill(path=str(path))
            else:
                route.fulfill(status=404, body='not found')

    def place(self, x=300, y=220, comment='c1'):
        self.page.evaluate("([x,y,id])=>{const e=document.querySelector('[data-danmaku-comment-id=\"'+id+'\"]');e.style.cssText='animation:none;position:fixed;transform:none;left:'+x+'px;top:'+y+'px'}", [x,y,comment])

    def open(self):
        self.page.locator('[data-danmaku-comment-id="c1"]').click()
        self.page.wait_for_selector('[data-danmaku-pop]')
        return self.page.locator('[data-danmaku-pop]')

    def assert_bounds(self):
        box = self.page.locator('[data-danmaku-pop]').bounding_box()
        view = self.page.viewport_size
        self.assertGreaterEqual(box['x'], 8)
        self.assertGreaterEqual(box['y'], 8)
        self.assertLessEqual(box['x']+box['width'], view['width']-8)
        self.assertLessEqual(box['y']+box['height'], view['height']-8)
        arrow = self.page.locator('[data-danmaku-pop]').evaluate("e=>parseFloat(getComputedStyle(e).getPropertyValue('--q-pop-arrow-left'))")
        self.assertGreaterEqual(arrow, 18)
        self.assertLessEqual(arrow, box['width']-18)

    def test_approved_chip_popover_and_real_icons(self):
        chip = self.page.locator('[data-danmaku-comment-id="c1"]')
        self.assertEqual(chip.locator('.q-comment-avatar').count(), 0, 'danmaku must not show name initials')
        self.assertGreaterEqual(chip.bounding_box()['height'], 44)
        self.assertNotIn('小林', chip.inner_text())
        self.assertEqual(chip.locator('.q-danmaku-like').inner_text().strip(), '8')
        self.page.screenshot(path=str(ARTIFACTS/'desktop-normal.png'))
        normal = chip.evaluate('e=>getComputedStyle(e).backgroundColor')
        chip.hover()
        self.page.wait_for_function("normal=>getComputedStyle(document.querySelector('[data-danmaku-comment-id=\"c1\"]')).backgroundColor!==normal", arg=normal)
        self.assertNotEqual(chip.evaluate('e=>getComputedStyle(e).backgroundColor'), normal)
        self.page.screenshot(path=str(ARTIFACTS/'desktop-hover.png'))
        pop = self.open()
        self.assertEqual(pop.locator('.q-danmaku-pop-author,.q-comment-avatar').count(), 0)
        self.assertNotIn('小林', pop.inner_text())
        self.assertIn('08:00', pop.locator('time').inner_text())
        self.assertEqual(pop.locator('[data-qc-pop-action="close"]').count(), 1)
        self.assertEqual(pop.locator('.q-danmaku-pop-actions button').all_text_contents(), ['点赞 8', '回复', '不喜欢', '更多'])
        self.assertEqual(pop.locator('.q-danmaku-pop-actions svg use').count(), 4)
        # External use references must resolve to a real loaded symbol, not a blank SVG.
        refs = pop.locator('.q-danmaku-pop-actions use').evaluate_all('els=>els.map(e=>e.getAttribute("href"))')
        self.assertEqual([r.split('#')[1] for r in refs], ['heart','message-circle','eye-off','ellipsis'])
        self.assertTrue(pop.locator('.q-danmaku-pop-actions svg').evaluate_all('els=>els.every(e=>e.getBBox().width>0 && e.getBBox().height>0)'))
        for ref in refs:
            self.assertIn('<symbol', self.page.evaluate('async url=>(await fetch(url)).text()', ref.split('#')[0]))
        for button in pop.locator('.q-danmaku-pop-actions button').all():
            self.assertGreaterEqual(button.bounding_box()['height'], 44)
            self.assertGreaterEqual(button.bounding_box()['width'], 44)
        self.assertIn('点击空白处继续播放', pop.inner_text())
        self.page.screenshot(path=str(ARTIFACTS/'desktop-paused.png'))
        pop.locator('[data-qc-pop-action="close"]').click()
        self.assertEqual(self.page.locator('[data-danmaku-pop],.q-danmaku-item.is-paused').count(), 0)
        self.open()
        self.page.keyboard.press('Escape')
        self.assertEqual(self.page.locator('[data-danmaku-pop],.q-danmaku-item.is-paused').count(), 0)
        self.open()
        self.page.mouse.click(20, 20)
        self.assertEqual(self.page.locator('[data-danmaku-pop],.q-danmaku-item.is-paused').count(), 0)

    def test_practice_skin_keeps_flat_action_cells_in_normal_and_hover_states(self):
        self.page.set_viewport_size({'width':390, 'height':844})
        self.place(40,160)
        pop = self.open()
        for index, button in enumerate(pop.locator('.q-danmaku-pop-actions button').all()):
            for hovered in [False, True]:
                self.page.mouse.move(0,0)
                if hovered:
                    button.hover()
                style = button.evaluate("e=>{const s=getComputedStyle(e);return {radius:s.borderRadius,top:s.borderTopWidth,right:s.borderRightWidth,bottom:s.borderBottomWidth,left:s.borderLeftWidth,shadow:s.boxShadow,transform:s.transform}}")
                self.assertEqual(style, dict(radius='0px',top='0px',right='0px',bottom='0px',left='0px' if index==0 else '1px',shadow='none',transform='none'), f'flat action cell {index}, hover={hovered}')
        close = pop.locator('[data-qc-pop-action="close"]')
        close.hover()
        self.assertEqual(close.evaluate('e=>getComputedStyle(e).boxShadow'), 'none')
        self.assertEqual(close.evaluate('e=>getComputedStyle(e).transform'), 'none')
        self.assertEqual(self.page.locator('[data-danmaku-comment-id="c1"]').evaluate('e=>getComputedStyle(e).borderRadius'), '14px')
        self.page.locator('[data-qc-pop-action="more"]').click()
        self.page.screenshot(path=str(ARTIFACTS/'practice-skin-mobile-more.png'))

    def test_top_bottom_more_and_resize_clamp(self):
        for x,y in [(8,8),(1080,800)]:
            self.place(x,y)
            self.open()
            self.assert_bounds()
            self.assertEqual(self.page.locator('[data-danmaku-pop]').get_attribute('data-placement'), 'bottom' if y==8 else 'top')
            self.page.locator('[data-qc-pop-action="more"]').click()
            self.assert_bounds()
            self.page.keyboard.press('Escape')
        self.place(300,220)
        self.open()
        self.page.set_viewport_size({'width':390,'height':650})
        self.page.wait_for_timeout(50)
        self.assert_bounds()
        self.page.locator('[data-qc-pop-action="more"]').click()
        self.assert_bounds()
        self.page.screenshot(path=str(ARTIFACTS/'mobile-more.png'))

    def live_animation_state(self):
        self.page.mouse.move(0,0)
        return self.page.locator('[data-danmaku-comment-id="c1"]').evaluate("e=>({paused:e.classList.contains('is-paused'), animation:getComputedStyle(e).animationName, playState:getComputedStyle(e).animationPlayState, pop:!!document.querySelector('[data-danmaku-pop]')})")

    def test_live_animation_stays_paused_through_like_and_favorite_refresh(self):
        self.open()
        # place() only stabilizes the initial click. Restore real production animation
        # before actions, and move away from the chip so hover cannot hide a pause bug.
        self.page.locator('[data-danmaku-comment-id="c1"]').evaluate("e=>e.style.removeProperty('animation')")
        paused = dict(paused=True, animation='q-danmaku-scroll', playState='paused', pop=True)
        self.assertEqual(self.live_animation_state(), paused)
        for action in ['like','favorite']:
            if action=='favorite':
                self.page.locator('[data-qc-pop-action="more"]').click()
            for pressed in ['true','false']:
                self.page.locator(f'[data-qc-pop-action="{action}"]').click()
                self.page.wait_for_function("([action,pressed])=>document.querySelector('[data-qc-pop-action='+action+']').getAttribute('aria-pressed')===pressed", arg=[action,pressed])
                self.assertEqual(self.live_animation_state(), paused, f'{action} {pressed} must retain popover-owned pause')
            setattr(self, 'fail_'+action, True)
            self.page.locator(f'[data-qc-pop-action="{action}"]').click()
            self.page.wait_for_selector('[data-danmaku-pop] [data-qc-toast]')
            self.page.wait_for_function("!window.inst.pending.has('c1')")
            self.assertEqual(self.live_animation_state(), paused, f'{action} error refresh must retain pause')
            setattr(self, 'fail_'+action, False)
        self.page.keyboard.press('Escape')
        running = dict(paused=False,animation='q-danmaku-scroll',playState='running',pop=False)
        self.assertEqual(self.live_animation_state(), running)
        for dismissal in ['close','outside']:
            self.place()
            self.open()
            self.page.locator('[data-danmaku-comment-id="c1"]').evaluate("e=>e.style.removeProperty('animation')")
            self.assertEqual(self.live_animation_state(), paused)
            if dismissal=='close':
                self.page.locator('[data-qc-pop-action="close"]').click()
            else:
                self.page.mouse.click(0,0)
            self.assertEqual(self.live_animation_state(), running, dismissal+' must release pause')

    def test_async_completion_after_dismiss_or_dispose_does_not_reopen(self):
        pending = []
        self.page.route('**/comments/c1/like', lambda route: pending.append(route))
        for dispose in [False, True]:
            if dispose:
                self.page.evaluate("KGQuestionComments.teardownSource('danmaku'); window.inst=KGQuestionComments.mountDanmaku({questionId:'q1'})")
                self.page.wait_for_selector('[data-danmaku-comment-id="c1"]', state='attached')
                self.place()
            self.open()
            self.page.locator('[data-danmaku-comment-id="c1"]').evaluate("e=>e.style.removeProperty('animation')")
            self.page.locator('[data-qc-pop-action="like"]').click()
            self.assertEqual(len(pending), 1)
            if dispose:
                self.page.evaluate("KGQuestionComments.teardownSource('danmaku')")
            else:
                self.page.keyboard.press('Escape')
                self.assertEqual(self.live_animation_state(), dict(paused=False,animation='q-danmaku-scroll',playState='running',pop=False))
            updated = dict(self.comments[0], myLike=True, likeCount=9)
            pending.pop().fulfill(json={'comment':updated})
            self.page.wait_for_function("!window.inst.pending.has('c1')")
            self.assertEqual(self.page.locator('[data-danmaku-pop],.q-danmaku-item.is-paused').count(), 0)
            if dispose:
                self.assertEqual(self.page.locator('.q-danmaku').count(), 0)

    def test_like_favorite_copy_reply_and_failures(self):
        self.open()
        self.fail_like=True
        self.page.locator('[data-qc-pop-action="like"]').click()
        self.page.wait_for_function("document.querySelector('[data-qc-pop-action=like]').textContent.includes('8')")
        self.assertEqual(self.page.locator('[data-qc-pop-action="like"]').get_attribute('aria-pressed'), 'false')
        self.assertIn('操作失败', self.page.locator('[data-danmaku-pop] [data-qc-toast]').inner_text())
        self.fail_like=False
        self.page.locator('[data-qc-pop-action="like"]').click()
        self.page.wait_for_function("document.querySelector('[data-qc-pop-action=like]').getAttribute('aria-pressed')==='true'")
        self.assertIn('9', self.page.locator('[data-danmaku-comment-id="c1"] .q-danmaku-like').inner_text())
        self.page.locator('[data-qc-pop-action="more"]').click()
        self.fail_favorite=True
        self.page.locator('[data-qc-pop-action="favorite"]').click()
        self.page.wait_for_timeout(80)
        self.assertEqual(self.page.locator('[data-qc-pop-action="favorite"]').get_attribute('aria-pressed'), 'false')
        self.fail_favorite=False
        self.page.locator('[data-qc-pop-action="favorite"]').click()
        self.page.wait_for_function("document.querySelector('[data-qc-pop-action=favorite]').getAttribute('aria-pressed')==='true'")
        self.page.locator('[data-qc-pop-action="copy"]').click()
        self.assertEqual(self.page.evaluate('window.copied'), COMMENTS[0]['content'])
        self.page.locator('[data-qc-pop-action="reply"]').click()
        self.assertEqual(self.page.locator('.q-comments-drawer [data-qc-reply]').count(), 1)
        self.assertEqual(self.page.locator('.q-composer-input').evaluate('e=>e===document.activeElement'), True)

    def test_escape_html_reduced_motion_and_teardown(self):
        self.page.emulate_media(reduced_motion='reduce')
        self.assertEqual(self.page.locator('[data-danmaku-comment-id="c2"] img').count(), 0)
        self.assertIn('<img src=x', self.page.locator('[data-danmaku-comment-id="c2"]').inner_text())
        self.assertEqual(self.page.locator('[data-danmaku-comment-id="c2"]').evaluate('e=>getComputedStyle(e).animationName'), 'none')
        self.page.locator('[data-danmaku-comment-id="c2"]').click()
        self.assertEqual(self.page.locator('[data-danmaku-pop] img').count(), 0)
        self.assertEqual(self.page.locator('.q-danmaku-pop-author').count(), 0)
        self.assertNotIn('<小张>', self.page.locator('[data-danmaku-pop]').inner_text())
        self.page.evaluate("KGQuestionComments.teardownSource('danmaku')")
        self.assertEqual(self.page.locator('.q-danmaku').count(), 0)
        self.page.keyboard.press('Escape')
        self.page.set_viewport_size({'width':390,'height':650})
        self.page.evaluate("KGQuestionComments.openPanel({questionId:'q1'})")
        self.page.wait_for_selector('.q-comments-drawer')
        self.assertEqual(self.page.locator('.q-danmaku').count(), 0, 'before explanation no danmaku')


if __name__ == '__main__':
    unittest.main(verbosity=2)
