#!/usr/bin/env python3
"""Reuse the existing isolated practice DOM/API fixture; exercise feedback UI in Chromium."""
from pathlib import Path
fixture = Path(__file__).with_name('practice-mark-show-answers-browser.py')
setup = fixture.read_text().split('    # ---------- 场景 1：')[0]
scenario = '''
    page.evaluate("KGPracticeMode.startPractice('practice')")
    page.wait_for_timeout(300)
    assert page.locator('#practiceInstantFeedback').is_checked()
    for width in [390, 1440]:
        page.set_viewport_size({'width': width, 'height': 960})
        toggle = page.locator('#practiceInstantFeedbackToggle').bounding_box()
        assert toggle and toggle['x'] >= 0 and toggle['x'] + toggle['width'] <= width
    page.locator('#practiceShowAnswers').check()
    page.locator('#practiceInstantFeedback').uncheck()
    assert page.locator('#practiceShowAnswers').is_disabled()
    assert page.locator('#practiceShowAnswers').is_checked()
    assert page.locator('#practiceAutoExplain').is_disabled()
    assert not page.locator('#practiceExplanationPanel').is_visible()
    assert page.locator('.practice-option.is-correct').count() == 0
    page.locator('[data-option-id="B"]').click()
    assert page.locator('.practice-option.is-selected').count() == 1
    assert page.locator('.practice-option.is-correct,.practice-option.is-wrong').count() == 0
    assert not page.locator('#practiceFeedback').is_visible()
    assert not page.locator('#practiceStreakPop').is_visible()
    sheet = page.locator('#practiceAnswerSheet').inner_html()
    assert 'is-correct' not in sheet and 'is-wrong' not in sheet and '错题' not in sheet
    assert '已答' in sheet
    page.locator('#practiceInstantFeedback').check()
    assert page.locator('.practice-option.is-wrong').count() == 1
    assert page.locator('#practiceExplanationPanel').is_visible()
    page.locator('#practiceInstantFeedback').uncheck()
    page.locator('#practiceExitBtn').click()
    page.locator('#practiceSaveExitBtn').click()
    page.wait_for_timeout(250)
    saved = page.evaluate('Object.values(window.__pausedSnapshots)[0]')
    assert saved['runtimeState']['instantFeedback'] is False
    page.evaluate("KGPracticeMode.startPractice('practice')")
    page.wait_for_timeout(300)
    assert not page.locator('#practiceInstantFeedback').is_checked()
    assert page.locator('#practiceShowAnswers').is_checked()
    assert page.locator('.practice-option.is-correct,.practice-option.is-wrong').count() == 0
    assert not errors, errors
    browser.close()
print('practice instant feedback browser passed')
'''
exec(compile(setup + scenario, str(fixture), 'exec'))

for kind in ['multiple_choice', 'matching']:
    original = "const question=(index)=>({id:'q'+index,title:'题目 '+index,type:'single_choice',stemParts:[{text:'这是第 '+index+' 道题'}],options:[{id:'A',text:'正确选项',correct:true},{id:'B',text:'错误选项'}],correctAnswer:'A',analysis:'第 '+index+' 题解析'});"
    multiple = "const question=(index)=>({id:'q'+index,title:'题目 '+index,type:'multiple_choice',stemParts:[{text:'这是第 '+index+' 道题'}],options:[{id:'A',text:'一',correct:true},{id:'B',text:'二',correct:true},{id:'C',text:'三'}],correctOptionIds:['A','B'],analysis:'解析'});"
    matching = "const question=(index)=>({id:'q'+index,title:'题目 '+index,type:'matching',stemParts:[{text:'这是第 '+index+' 道题'}],matching:{left:[{id:'l1',text:'左一'},{id:'l2',text:'左二'}],right:[{id:'r1',text:'右一'},{id:'r2',text:'右二'}],correctPairs:{l1:'r1',l2:'r2'}},analysis:'解析'});"
    actions = '''
    page.locator('[data-option-id="A"]').click()
    page.locator('[data-option-id="C"]').click()
''' if kind == 'multiple_choice' else '''
    page.locator('[data-qm-left="l1"]').click()
    page.locator('[data-qm-right="r2"]').click()
    page.locator('[data-qm-left="l2"]').click()
    page.locator('[data-qm-right="r1"]').click()
'''
    check = '''
    page.evaluate("KGPracticeMode.startPractice('practice')")
    page.wait_for_timeout(300)
    page.locator('#practiceInstantFeedback').uncheck()
''' + actions + '''
    page.locator('#practiceConfirmAnswerBtn').click()
    assert page.evaluate('KGPracticeMode.snapshot().answered') == 1
    assert page.locator('.is-correct,.is-wrong,.qm-pair-feedback').count() == 0, page.locator('.is-correct,.is-wrong,.qm-pair-feedback').evaluate_all('(els)=>els.map(el=>el.outerHTML)')
    assert not page.locator('#practiceFeedback').is_visible()
    assert not page.locator('#practiceExplanationPanel').is_visible()
    page.locator('#practiceInstantFeedback').check()
    assert page.locator('.is-correct,.is-wrong').count() > 0
    assert page.locator('#practiceExplanationPanel').is_visible()
    page.locator('#practiceInstantFeedback').uncheck()
    assert page.locator('.is-correct,.is-wrong,.qm-pair-feedback').count() == 0, page.locator('.is-correct,.is-wrong,.qm-pair-feedback').evaluate_all('(els)=>els.map(el=>el.outerHTML)')
    assert not errors, errors
    browser.close()
'''
    assert original in setup
    exec(compile(setup.replace(original, multiple if kind == 'multiple_choice' else matching) + check, str(fixture) + '-' + kind, 'exec'))
    print(kind + ' instant feedback browser passed')


# Precise timer-controlled interaction: only committed answers with feedback off advance.
for kind in ['single_choice', 'multiple_choice', 'matching']:
    timed_setup = setup.replace('    attrs, body = body_html()', '    page.clock.install()\n    attrs, body = body_html()')
    if kind != 'single_choice':
        assert original in timed_setup
        timed_setup = timed_setup.replace(original, multiple if kind == 'multiple_choice' else matching)
    commit_actions = "    page.locator('[data-option-id=\"B\"]').click()\n" if kind == 'single_choice' else actions if kind == 'matching' else "    page.locator('[data-option-id=\"A\"]').click()\n    page.locator('[data-option-id=\"C\"]').click()\n"
    confirm = "    page.locator('#practiceConfirmAnswerBtn').click()\n" if kind != 'single_choice' else ''
    timed = '''
    page.evaluate("KGPracticeMode.startPractice('practice')")
    page.wait_for_timeout(300)
    page.clock.pause_at(page.evaluate('Date.now()') + 10)
    page.locator('#practiceInstantFeedback').uncheck()
''' + commit_actions
    if kind != 'single_choice':
        timed += "    page.clock.run_for(600)\n    assert page.evaluate('KGPracticeMode.snapshot().index') == 0, 'unconfirmed answer advanced'\n"
    timed += confirm + '''
    page.clock.run_for(499)
    assert page.evaluate('KGPracticeMode.snapshot().index') == 0, 'advanced too early'
    page.clock.run_for(41)
    assert page.evaluate('KGPracticeMode.snapshot().index') == 1, 'did not advance after about 0.5s'
    assert page.locator('.is-correct,.is-wrong,.qm-pair-feedback').count() == 0
    # Feedback on preserves manual navigation.
    page.locator('#practiceInstantFeedback').check()
''' + commit_actions + confirm + '''
    page.clock.run_for(600)
    assert page.evaluate('KGPracticeMode.snapshot().index') == 1
    page.locator('#practiceInstantFeedback').uncheck()
    page.locator('#practiceNextBtn').click()
''' + commit_actions + confirm + '''
    page.locator('#practiceNextBtn').click()
    page.clock.run_for(600)
    assert page.evaluate('KGPracticeMode.snapshot().index') == 3, 'stale timer skipped a question after manual navigation'
''' + commit_actions + confirm + '''
    page.locator('#practiceInstantFeedback').check()
    page.locator('#practiceInstantFeedback').uncheck()
    page.clock.run_for(600)
    assert page.evaluate('KGPracticeMode.snapshot().index') == 3, 'toggle must cancel pending navigation'
    page.locator('#practiceNextBtn').click()
''' + commit_actions + confirm + '''
    page.locator('#practiceExitBtn').click()
    page.clock.run_for(600)
    assert page.evaluate('KGPracticeMode.snapshot().index') == 4, 'exit dialog must cancel pending navigation'
    page.locator('#practiceExitCancel').click()
    page.locator('#practiceAnswerSheetMobileBtn').click()
    page.locator('#practiceAnswerSheet [data-question-id="q10"]').click()
''' + commit_actions + confirm + '''
    page.clock.run_for(600)
    assert page.evaluate('KGPracticeMode.snapshot().index') == 9, 'last question overflowed'
    assert page.evaluate('KGPracticeMode.snapshot().active') is True
    assert not errors, errors
    browser.close()
'''
    exec(compile(timed_setup + timed, str(fixture) + '-auto-next-' + kind, 'exec'))
    print(kind + ' feedback-off auto-next browser passed')
