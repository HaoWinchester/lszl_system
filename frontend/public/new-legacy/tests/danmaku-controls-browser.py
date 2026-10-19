"""Shared comments settings, two top lanes, hand replay, emoji and real DOM load."""
import importlib.util,json,statistics,time
from pathlib import Path
import unittest
from playwright.sync_api import expect

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('danmaku_component',ROOT/'tests/danmaku-design-browser.py')
component=importlib.util.module_from_spec(spec);spec.loader.exec_module(component)

class Controls(component.DanmakuDesign):
    def feed(self,count):
        self.comments=[dict(component.COMMENTS[0],id=f'load-{i}',content=f'这是第{i+1}条知识点提示',likeCount=0) for i in range(count)]
        self.page.evaluate("KGQuestionComments.teardownSource('danmaku');window.inst=KGQuestionComments.mountDanmaku({questionId:'q1'})")
        self.page.wait_for_selector('.q-danmaku-item',state='attached')

    def test_only_two_top_lanes_without_pause_icon(self):
        self.feed(20)
        lanes=self.page.locator('.q-danmaku-item').evaluate_all("els=>[...new Set(els.map(e=>getComputedStyle(e).top))]")
        self.assertEqual(len(lanes),2)
        self.assertEqual(self.page.locator('.q-danmaku-pause').count(),0)
        box=self.page.locator('.q-danmaku').bounding_box()
        self.assertLessEqual(box['y']+box['height'],250)

    def test_settings_apply_cancel_refresh_and_owner(self):
        self.feed(20)
        self.page.evaluate('KGQuestionComments.openDanmakuSettings()')
        dialog=self.page.locator('#questionDanmakuSettings')
        dialog.locator('[name=count]').select_option('2')
        dialog.locator('[name=duration]').fill('10')
        dialog.locator('[name=opacity]').fill('40')
        dialog.locator('button[type=submit]').click()
        expect(self.page.locator('.q-danmaku-item')).to_have_count(2)
        self.assertEqual(self.page.locator('.q-danmaku-item').first.evaluate("e=>getComputedStyle(e).animationDuration"),'10s')
        self.assertEqual(self.page.locator('.q-danmaku-item').first.evaluate("e=>getComputedStyle(e).opacity"),'0.4')
        self.page.evaluate('KGQuestionComments.openDanmakuSettings()')
        dialog.locator('[name=count]').select_option('4');self.page.keyboard.press('Escape')
        self.assertEqual(self.page.evaluate('KGQuestionComments.getDanmakuSettings().count'),2)
        self.page.evaluate("KGQuestionComments.teardownSource('danmaku');window.inst=KGQuestionComments.mountDanmaku({questionId:'q1'})")
        expect(self.page.locator('.q-danmaku-item')).to_have_count(2)
        self.page.evaluate("KGAuthCore.currentUser=()=>({username:'other',role:'student'});window.dispatchEvent(new Event('kg-auth-session-change'))")
        self.assertEqual(self.page.evaluate('KGQuestionComments.getDanmakuSettings().count'),8)
        self.assertEqual(self.page.locator('dialog[open],.q-danmaku').count(),0)

    def test_hand_copies_and_replays_without_comment_post(self):
        pop=self.open();pop.locator('[data-qc-pop-action=more]').click()
        writes=[];self.page.on('request',lambda r:writes.append(r.method) if '/comments' in r.url and r.method=='POST' else None)
        pop.locator('[data-qc-pop-action=raise-hand]').click()
        self.assertEqual(self.page.evaluate('window.copied'),component.COMMENTS[0]['content'])
        replay=self.page.locator('.q-danmaku-item[data-danmaku-replay]')
        expect(replay).to_have_count(1)
        self.assertEqual(replay.evaluate('e=>getComputedStyle(e).animationIterationCount'),'1')
        self.assertEqual(writes,[])
        self.assertEqual(len(self.comments),2)
        self.page.evaluate("KGQuestionComments.teardownSource('danmaku')")
        self.assertEqual(self.page.locator('.q-danmaku').count(),0)

    def test_hand_clipboard_failure_and_late_teardown(self):
        self.page.evaluate("()=>{navigator.clipboard.writeText=async()=>{throw Error('blocked')}}")
        pop=self.open();pop.locator('[data-qc-pop-action=more]').click();pop.locator('[data-qc-pop-action=raise-hand]').click()
        expect(self.page.locator('[data-qc-toast]')).to_contain_text('复制失败')
        self.assertEqual(self.page.locator('[data-danmaku-replay]').count(),0)
        self.page.evaluate("()=>{navigator.clipboard.writeText=()=>new Promise(r=>window.resolveCopy=r)}")
        pop.locator('[data-qc-pop-action=raise-hand]').click()
        self.page.evaluate("KGQuestionComments.teardownSource('danmaku');window.resolveCopy()")
        self.page.wait_for_timeout(700)
        self.assertEqual(self.page.locator('.q-danmaku').count(),0)

    def test_collapsed_emoji_inserts_at_selection_and_keeps_draft(self):
        self.page.evaluate("KGQuestionComments.openPanel({questionId:'q1'})")
        drawer=self.page.locator('.q-comments-drawer');picker=drawer.locator('[data-qc-emoji-picker]')
        expect(picker).to_be_hidden()
        composer=drawer.locator('.q-composer-input');composer.fill('abcdef');composer.evaluate('e=>e.setSelectionRange(2,5)')
        drawer.locator('[data-qc-action=emoji-toggle]').click();picker.locator('[data-qc-emoji="👍"]').click()
        expect(composer).to_have_value('ab👍f')
        self.assertEqual(self.page.evaluate('window.inst.state.draft'),'ab👍f')
        expect(drawer.locator('[data-qc-action=send]')).to_be_enabled()

    def test_admin_real_200_and_600_dom_pressure(self):
        self.page.evaluate("KGAuthCore.currentUser=()=>({username:'stu',role:'admin'})")
        measurements=[]
        for count in [200,600]:
            self.page.evaluate('count=>KGQuestionComments.setDanmakuSettings({count,duration:18,opacity:75})',count)
            started=time.monotonic();self.feed(count)
            expect(self.page.locator('.q-danmaku-item')).to_have_count(count)
            frames=self.page.evaluate("()=>new Promise(resolve=>{const times=[];let last=performance.now();function tick(now){times.push(now-last);last=now;if(times.length===90)resolve(times);else requestAnimationFrame(tick)}requestAnimationFrame(tick)})")
            measurements.append({'actualRendered':count,'elapsedSeconds':round(time.monotonic()-started,3),'frameMedianMs':round(statistics.median(frames),2),'frameP95Ms':round(sorted(frames)[85],2)})
            self.assertEqual(self.page.locator('.q-danmaku-item').evaluate_all("els=>new Set(els.map(e=>e.style.getPropertyValue('--q-danmaku-lane'))).size"),2)
        out=ROOT.parent/'artifacts/remaining-learning-requirements';out.mkdir(parents=True,exist_ok=True)
        (out/'danmaku-pressure.json').write_text(json.dumps(measurements,indent=2))

if __name__=='__main__':unittest.main(verbosity=2)
