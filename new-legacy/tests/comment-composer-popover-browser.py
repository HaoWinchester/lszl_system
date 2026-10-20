"""Regression: stable same-question danmaku and non-reflowing emoji popover."""
import importlib.util
from pathlib import Path
import unittest
from playwright.sync_api import expect
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('comments_base',ROOT/'tests/danmaku-design-browser.py')
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
OUT=ROOT.parent/'artifacts/ui-polish-20261020';OUT.mkdir(parents=True,exist_ok=True)

class Popover(base.DanmakuDesign):
    def test_same_question_mount_preserves_instance_and_animation(self):
        self.page.evaluate("window.originalOverlay=inst.overlay;window.originalChip=inst.overlay.querySelector('.q-danmaku-item');window.originalInst=inst;KGQuestionComments.mountDanmaku({questionId:'q1'})")
        self.assertTrue(self.page.evaluate("originalOverlay===originalInst.overlay && originalChip===originalInst.overlay.querySelector('.q-danmaku-item')"),'same question must not recreate/restart danmaku')
        self.page.evaluate("KGQuestionComments.teardownSource('danmaku',{exceptQuestionId:'q1'})")
        self.assertTrue(self.page.evaluate('originalOverlay.isConnected'),'same question re-render preserves overlay')
        self.page.evaluate("KGQuestionComments.teardownSource('danmaku',{exceptQuestionId:'q2'})")
        self.assertEqual(self.page.locator('.q-danmaku').count(),0,'different question tears down old overlay')

    def test_danmaku_stays_below_language_control_across_resize(self):
        self.page.evaluate("document.querySelectorAll('.q-danmaku-item').forEach(e=>e.removeAttribute('style'));const b=document.createElement('button');b.id='practiceLanguageCycle';b.textContent='中 / EN';b.style.cssText='position:fixed;right:20px;top:120px;height:36px';document.body.append(b)")
        for width in [1440,390,320]:
            self.page.set_viewport_size({'width':width,'height':844})
            self.page.wait_for_function("document.querySelector('.q-danmaku').getBoundingClientRect().top>=document.querySelector('#practiceLanguageCycle').getBoundingClientRect().bottom+12")
            self.page.locator('#practiceLanguageCycle').click()
        self.page.emulate_media(reduced_motion='reduce')
        self.page.wait_for_function("document.querySelector('.q-danmaku').getBoundingClientRect().top>=document.querySelector('#practiceLanguageCycle').getBoundingClientRect().bottom+12")

    def test_emoji_popover_keeps_layout_and_draft_with_keyboard_cancel(self):
        self.page.evaluate("KGQuestionComments.openPanel({questionId:'q1'})")
        drawer=self.page.locator('.q-comments-drawer');composer=drawer.locator('.q-composer-input');composer.fill('abcdef');composer.evaluate('e=>e.setSelectionRange(2,5)')
        before=composer.bounding_box();send_before=drawer.locator('[data-qc-action=send]').bounding_box()
        drawer.locator('[data-qc-action=emoji-toggle]').click()
        picker=drawer.locator('[data-qc-emoji-picker]');expect(picker).to_be_visible()
        after=composer.bounding_box();send_after=drawer.locator('[data-qc-action=send]').bounding_box()
        self.assertAlmostEqual(before['y'],after['y'],delta=1);self.assertAlmostEqual(send_before['y'],send_after['y'],delta=1)
        self.assertGreaterEqual(picker.locator('[data-qc-emoji]').count(),32)
        self.assertGreater(picker.locator('img').count(),0,'approved Fluent artwork is rendered')
        self.page.wait_for_function("[...document.querySelectorAll('[data-qc-emoji] img')].every(img=>img.complete&&img.naturalWidth>0)")
        picker.locator('[data-qc-emoji-category=learning]').click();self.assertGreater(picker.locator('[data-qc-emoji]:visible').count(),4)
        self.assertEqual(picker.locator('[data-qc-emoji-group=faces]:visible').count(),0)
        picker.locator('[data-qc-emoji-category=all]').click()
        picker.locator('[data-qc-emoji="👍"]').click();expect(composer).to_have_value('ab👍f')
        drawer.locator('[data-qc-action=emoji-toggle]').click();self.page.keyboard.press('Escape');expect(picker).to_be_hidden();expect(drawer).to_be_visible();expect(composer).to_have_value('ab👍f')
        self.page.screenshot(path=str(OUT/'comment-desktop.png'))

    def test_mobile_popover_bounds_and_outside_close(self):
        self.page.set_viewport_size({'width':320,'height':640})
        self.page.evaluate("KGQuestionComments.openPanel({questionId:'q1'})")
        drawer=self.page.locator('.q-comments-drawer');drawer.locator('.q-composer-input').fill('保留草稿')
        drawer.locator('[data-qc-action=emoji-toggle]').click();picker=drawer.locator('[data-qc-emoji-picker]');expect(picker).to_be_visible()
        rect=picker.bounding_box();self.assertGreaterEqual(rect['x'],4);self.assertLessEqual(rect['x']+rect['width'],316);self.assertGreaterEqual(rect['y'],4);self.assertLessEqual(rect['y']+rect['height'],636)
        self.page.screenshot(path=str(OUT/'comment-mobile.png'))
        drawer.locator('.q-composer-input').click();expect(picker).to_be_hidden();expect(drawer.locator('.q-composer-input')).to_have_value('保留草稿')

    def test_comment_artwork_preserves_unicode_and_escapes_text(self):
        self.comments[0]['content']='已掌握😊 👍🏽 <script>window.bad=true</script>'
        self.page.evaluate("KGQuestionComments.teardownSource('danmaku');KGQuestionComments.mountDanmaku({questionId:'q1'})")
        self.page.wait_for_selector('.q-danmaku-item')
        self.page.evaluate("KGQuestionComments.openPanel({questionId:'q1'})")
        content=self.page.locator('.q-comments-drawer [data-comment-id=c1] .q-comment-content')
        expect(content.locator('img[data-comment-emoji]')).to_have_count(1)
        self.assertEqual(content.locator('img').get_attribute('alt'),'😊')
        self.assertIn('👍🏽',content.inner_text());self.assertIn('<script>',content.inner_text())
        self.assertFalse(self.page.evaluate('Boolean(window.bad)'))
        self.assertEqual(self.comments[0]['content'],'已掌握😊 👍🏽 <script>window.bad=true</script>')

    def test_image_failure_remains_usable_and_draft_survives(self):
        self.page.route('**/assets/emoji/fluent/*.svg',lambda route:route.abort())
        self.page.evaluate("KGQuestionComments.openPanel({questionId:'q1'})")
        drawer=self.page.locator('.q-comments-drawer');composer=drawer.locator('.q-composer-input');composer.fill('继续学习')
        drawer.locator('[data-qc-action=emoji-toggle]').click();picker=drawer.locator('[data-qc-emoji-picker]')
        fallback=picker.locator('[data-qc-emoji="👍"] .q-emoji-fallback');expect(fallback).to_be_visible()
        picker.locator('[data-qc-emoji="👍"]').click();expect(composer).to_have_value('继续学习👍')
        expect(drawer.locator('[data-qc-action=send]')).to_be_enabled()

if __name__=='__main__':
    suite=unittest.TestSuite(Popover(name) for name in Popover.__dict__ if name.startswith('test_'))
    result=unittest.TextTestRunner(verbosity=2).run(suite)
    raise SystemExit(not result.wasSuccessful())
