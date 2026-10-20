"""An answered practice question can restart danmaku after session cleanup."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
fixture = ROOT / 'tests/practice-side-nav-comments-browser.py'
setup = fixture.read_text().split("        assert page.locator('#practiceSideToggle')")[0]
scenario = '''
        # Turning on before answering must not reveal discussion spoilers.
        click_tool(page, '#practiceDanmakuToggle')
        click_tool(page, '#practiceDanmakuToggle')
        assert page.locator('.q-danmaku').count() == 0
        page.evaluate("KGActivitySchemaV1.getPracticeAutoExplain=()=>true")
        page.locator('[data-option-id=B]').click()
        expect(page.locator('#practiceExplanationPanel')).to_be_visible()
        page.wait_for_selector('body>.q-danmaku .q-danmaku-item')
        for open_comments in [False, True]:
            # The real auth module emits this on a same-account refresh too.
            page.evaluate("dispatchEvent(new CustomEvent('kg-auth-session-change',{detail:{username:'student-1',provider:'remote'}}))")
            assert page.locator('.q-danmaku').count() == 0
            expect(page.locator('#practiceExplanationPanel')).to_be_visible()
            if open_comments:
                click_tool(page, '#practiceCommentBtn')
                expect(page.locator('.q-comments-drawer .q-comment[data-comment-id=c1]')).to_be_visible()
                page.locator('[data-qc-action=collapse]').click()
                assert page.locator('.q-danmaku').count() == 0
            click_tool(page, '#practiceDanmakuToggle')
            expect(page.locator('#practiceDanmakuToggle')).to_have_attribute('aria-pressed', 'false')
            click_tool(page, '#practiceDanmakuToggle')
            expect(page.locator('#practiceDanmakuToggle')).to_have_attribute('aria-pressed', 'true')
            expect(page.locator('body>.q-danmaku .q-danmaku-item')).to_have_count(1)
        page.locator('#practiceInstantFeedback').uncheck()
        click_tool(page, '#practiceDanmakuToggle')
        click_tool(page, '#practiceDanmakuToggle')
        assert page.locator('.q-danmaku').count() == 0, 'feedback off must keep discussion hidden'
        # Saved exit still removes all viewport discussion elements.
        click_tool(page, '#practiceExitBtn')
        page.locator('#practiceSaveExitBtn').click()
        page.wait_for_function("document.body.dataset.practiceView==='lobby'")
        assert page.locator('.q-danmaku').count() == 0
        assert page.locator('.q-comments-standalone-host').count() == 0
        assert not errors, errors
        print('PASS answered practice danmaku recovery/anti-spoiler/exit', viewport)
        page.close()
    browser.close()
'''
exec(compile(setup + scenario, str(fixture), 'exec'), {'__file__': str(fixture)})
