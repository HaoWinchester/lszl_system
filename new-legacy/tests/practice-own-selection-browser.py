"""Real source DOM interactions for neutral selections, sheet states and restore."""
from pathlib import Path
import json
from helpers.practice_tools import click_tool
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT.parent/'artifacts/ui-polish-20261020/answers';OUT.mkdir(parents=True,exist_ok=True)
fixture=ROOT/'tests/practice-mark-show-answers-browser.py'
setup=fixture.read_text().split('    # ---------- 场景 1：')[0]
setup=setup.replace('    attrs, body = body_html()', '    page.clock.install()\n    attrs, body = body_html()')
old="Object.keys(input.answers||{}).forEach(qid=>{session.answers[qid]={questionId:qid,selectedAnswer:input.answers[qid].selectedAnswer,correctAnswer:'A',correct:input.answers[qid].selectedAnswer==='A'}});"
assert old in setup
setup=setup.replace(old,"session.answers=JSON.parse(JSON.stringify(input.answers||{}));")
original="const question=(index)=>({id:'q'+index,title:'题目 '+index,type:'single_choice',stemParts:[{text:'这是第 '+index+' 道题'}],options:[{id:'A',text:'正确选项',correct:true},{id:'B',text:'错误选项'}],correctAnswer:'A',analysis:'第 '+index+' 题解析'});"
questions={
'single_choice':original.replace('正确选项','方案一').replace('错误选项','方案二'),
'multiple_choice':"const question=(index)=>({id:'q'+index,title:'题目 '+index,type:'multiple_choice',stemParts:[{text:'请选择全部符合要求的方案'}],options:[{id:'A',text:'方案一',correct:true},{id:'B',text:'方案二',correct:true},{id:'C',text:'方案三'}],correctOptionIds:['A','B'],analysis:'正确答案解析'});",
'matching':"const question=(index)=>({id:'q'+index,title:'题目 '+index,type:'matching',stemParts:[{text:'请将左侧条目与候选配对'}],matching:{left:[{id:'l1',text:'左一'},{id:'l2',text:'左二'}],right:[{id:'r1',text:'右一'},{id:'r2',text:'右二'}],correctPairs:{l1:'r1',l2:'r2'}},analysis:'正确配对解析'});"
}
for kind in questions:
    expected={'single_choice':'B','multiple_choice':'A、C','matching':'左一 → 右二；左二 → 右一'}[kind]
    compact={'single_choice':'B','multiple_choice':'A、C','matching':'1→2；2→1'}[kind]
    actions={
      'single_choice':"    page.locator('[data-option-id=\"B\"]').click()\n",
      'multiple_choice':"    page.locator('[data-option-id=\"A\"]').click()\n    page.locator('[data-option-id=\"C\"]').click()\n    assert not page.locator('.practice-own-selection').is_visible()\n    page.locator('#practiceConfirmAnswerBtn').click()\n",
      'matching':"    page.locator('[data-qm-left=\"l1\"]').click()\n    page.locator('[data-qm-right=\"r2\"]').click()\n    page.locator('[data-qm-left=\"l2\"]').click()\n    page.locator('[data-qm-right=\"r1\"]').click()\n    assert not page.locator('.practice-own-selection').is_visible()\n    page.locator('#practiceConfirmAnswerBtn').click()\n"
    }[kind]
    scenario='''
    page.locator('[data-practice-start="practice"]').click()
    page.wait_for_timeout(200)
    page.clock.pause_at(page.evaluate('Date.now()')+10)
    page.locator('#practiceInstantFeedback').uncheck()
'''+actions+f'''
    expected={expected!r};compact={compact!r}
    def neutral():
        assert page.locator('.practice-own-selection').is_visible()
        assert page.locator('.practice-own-selection').inner_text()=='我的选择：'+expected
        assert page.locator('.practice-option.is-correct,.practice-option.is-wrong,.qm-pair-feedback').count()==0
        assert not page.locator('#practiceFeedback').is_visible()
        assert not page.locator('#practiceExplanationPanel').is_visible()
        assert page.locator('#practiceExplanationHead').inner_text()==''
    neutral()
    if {kind!r}!='matching':
        selected=page.locator('.practice-option.is-selected').first
        other=page.locator('.practice-option:not(.is-selected)').first
        assert selected.get_attribute('aria-pressed')=='true'
        assert selected.evaluate('e=>getComputedStyle(e).backgroundColor')!=other.evaluate('e=>getComputedStyle(e).backgroundColor'),'selection lost beneath answer-page CSS'
    page.locator('#practiceLanguageCycle').click();neutral()
    page.locator('#practiceNextBtn').click();assert not page.locator('.practice-own-selection').is_visible()
    page.locator('#practicePrevBtn').click();neutral()
    page.locator('#practiceInstantFeedback').check()
    assert page.locator('.is-correct,.is-wrong').count()>0
    page.locator('#practiceInstantFeedback').uncheck();neutral()
    page.locator('#practiceMarkToggle').click()
    page.locator('#practiceAnswerSheetMobileBtn').click()
    row=page.locator('#practiceAnswerSheet [data-question-id="q1"]')
    assert '我的选择：'+compact in row.inner_text()
    assert 'is-current' in row.get_attribute('class') and 'is-marked' in row.get_attribute('class')
    assert 'is-answered' in row.get_attribute('class')
    assert not any(word in page.locator('#practiceAnswerSheet').inner_html() for word in ['正确','错误','错题','is-correct','is-wrong'])
    for width in [320,390,1440]:
        page.set_viewport_size({{'width':width,'height':960}})
        page.clock.run_for(250) # Finish drawer/resize animation before measuring settled geometry.
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
        # Fast-forward finite CSS transitions for an unambiguous settled-state capture.
        page.screenshot(path=str(OUT/({kind!r}+'-sheet-'+str(width)+'.png')),animations='disabled')
        for button in page.locator('#practiceAnswerSheet [data-question-id]').all():
            box=button.bounding_box();assert box['x']>=0 and box['x']+box['width']<=width,(width,box)
    page.locator('[data-answer-filter="marked"]').click();assert page.locator('#practiceAnswerSheet [data-question-id]').count()==1
    page.locator('[data-answer-filter="unanswered"]').click();assert page.locator('#practiceAnswerSheet [data-question-id="q1"]').count()==0
    page.locator('[data-answer-filter="all"]').click()
    page.locator('#practiceAnswerSheet [data-question-id="q2"]').click()
    assert not page.locator('#practiceAnswerSheetDrawer').is_visible()
    assert not page.locator('.practice-own-selection').is_visible()
    page.locator('#practicePrevBtn').click();neutral()
    page.screenshot(path=str(OUT/({kind!r}+'-selected.png')),animations='disabled')
    click_tool(page,'#practiceExitBtn');page.locator('#practiceExitCancel').click();neutral()
    click_tool(page,'#practiceExitBtn');page.locator('#practiceSaveExitBtn').click()
    page.wait_for_timeout(100)
    page.locator('[data-practice-start="practice"]').click();page.wait_for_timeout(100)
    neutral()
    assert not page.locator('#practiceInstantFeedback').is_checked()
    assert not errors,errors
    browser.close()
'''
    assert original in setup
    exec(compile(setup.replace(original,questions[kind])+scenario,str(fixture)+'-own-'+kind,'exec'))
    print(kind+' own selection / correctness boundaries / language / navigation / sheet / cancel / saved restore PASS',flush=True)
(OUT/'results.json').write_text(json.dumps({'types':list(questions),'widths':[320,390,1440],'status':'passed'},ensure_ascii=False,indent=2))
