"""Real practice DOM: all-count selection, paper switches, request and empty recovery.

The API boundary is a fixture; backend session tests separately exercise real DB selection.
"""
from pathlib import Path
from playwright.sync_api import expect

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT.parent / 'artifacts/practice-all-count-20261102'
OUT.mkdir(parents=True, exist_ok=True)
fixture = ROOT / 'tests/practice-mark-show-answers-browser.py'
setup = fixture.read_text().split('    # ---------- 场景 1：')[0]
setup = setup.replace('Array.from({length:10}', 'Array.from({length:185}')
setup = setup.replace('enterSession:async input=>{', 'enterSession:async input=>{window.__entryInput=JSON.parse(JSON.stringify(input));')
setup = setup.replace('const refs=JSON.parse(JSON.stringify(allRefs));', "const total=input.count==='all'?(input.paperId==='paper-3'?185:window.__catalog.find(p=>p.id===input.paperId).questionCount):Number(input.count);const refs=JSON.parse(JSON.stringify(allRefs.slice(0,total)));")
setup = setup.replace('stats:{total:10,answered:0,correct:0,wrong:0,unanswered:10,', 'stats:{total:refs.length,answered:0,correct:0,wrong:0,unanswered:refs.length,')
setup = setup.replace("completeSession:async()=>{throw new Error('not needed')}", "completeSession:async()=>{session.status='completed';session.revision+=1;return {session:normalize(),report:null}}")
setup = setup.replace('return {resumed:false,session:normalize()}', "if(input.paperId==='paper-3'&&sequence===2){session.answers=Object.fromEntries(refs.slice(0,184).map(ref=>[ref.questionId,{questionId:ref.questionId,selectedAnswer:'A',correctAnswer:'A',correct:true}]));session.stats={...session.stats,answered:184,correct:184,unanswered:1};session.runtimeState.currentIndex=184;return {resumed:true,session:normalize()}}return {resumed:false,session:normalize()}")
old = "window.__catalog=[{id:'paper-1',paperId:'paper-1',releaseId:'release-1',version:1,name:'PMP 模拟卷',subject:'PMP',status:'published',questionCount:10,totalCount:10,accessPolicy:{accessLevel:'free'}}];"
assert old in setup
setup = setup.replace(old, "window.__catalog=[93,99,185,3,0,180,10].map((n,i)=>({id:'paper-'+(i+1),paperId:'paper-'+(i+1),releaseId:'release-'+(i+1),version:1,name:'整卷 '+n+' 题',subject:'PMP',status:'published',questionCount:n,totalCount:n,accessPolicy:{accessLevel:'free'}}));")
scenario = '''
    all_option=page.locator('[name="practiceCount"][value="all"]')
    expect(all_option).to_have_count(1)
    expect(all_option.locator('..')).to_have_text('全部（93题）')
    all_option.locator('..').click()
    expect(all_option).to_be_checked()
    expect(page.locator('[data-practice-start="practice"]')).to_have_text('开始 93 题练习')
    for paper_id,total in [('paper-2',99),('paper-3',185),('paper-4',3),('paper-6',180),('paper-7',10)]:
        page.locator('#practicePaperLibrary [data-paper-id="'+paper_id+'"]').click()
        expect(all_option).to_be_checked()
        expect(all_option.locator('..')).to_have_text('全部（'+str(total)+'题）')
        assert page.locator('[name="practiceCount"]:checked').count()==1
        expect(page.locator('[data-practice-start="practice"]')).to_have_text('开始 '+str(total)+' 题'+('短练' if total<=20 else '练习'))
        if total==3:
            expect(page.locator('[name="practiceCount"][value="10"]')).to_be_disabled()
    page.locator('#practicePaperLibrary [data-paper-id="paper-5"]').click()
    expect(all_option).to_be_disabled()
    expect(page.locator('[data-practice-start="practice"]')).to_be_disabled()
    page.locator('#practicePaperLibrary [data-paper-id="paper-1"]').click()
    expect(all_option).to_be_enabled()
    expect(all_option).to_be_checked()
    page.locator('#practiceCountOptions label:has([value="60"])').click()
    expect(all_option).not_to_be_checked()
    expect(page.locator('[data-practice-start="practice"]')).to_have_text('开始 60 题练习')
    all_option.locator('..').click()
    for width in [320,390,1440]:
        page.set_viewport_size({'width':width,'height':960})
        all_option.scroll_into_view_if_needed()
        box=all_option.locator('..').bounding_box()
        assert box and box['x']>=0 and box['x']+box['width']<=width,(width,box)
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
        assert all_option.locator('..').locator('span').evaluate('e=>e.scrollHeight<=e.clientHeight&&e.scrollWidth<=e.clientWidth'),('all label clipped',width)
    page.set_viewport_size({'width':1440,'height':960})
    page.screenshot(path=str(OUT/'all-93-lobby.png'))
    page.locator('[data-practice-start="practice"]').click()
    expect(page.locator('#practiceGame')).to_be_visible()
    assert page.evaluate('window.__entryInput.count')=='all'
    expect(page.locator('#practiceQuestionProgress')).to_have_text('第 1 / 93 题')
    page.locator('#practiceAnswerSheetMobileBtn').click()
    expect(page.locator('#practiceAnswerSheet [data-question-id]')).to_have_count(93)
    page.locator('#practiceAnswerSheet [data-question-id="q93"]').click()
    expect(page.locator('#practiceQuestionStem')).to_have_text('这是第 93 道题')
    assert not errors,errors
    page.screenshot(path=str(OUT/'all-93-last-question.png'))
    click_tool(page,'#practiceExitBtn')
    page.locator('#practiceAbandonBtn').click()
    expect(page.locator('#practiceLobby')).to_be_visible()
    # The API owns 185 frozen questions even when catalog metadata is stale.
    page.evaluate("window.__catalog.find(p=>p.id==='paper-3').questionCount=1;window.__catalog.find(p=>p.id==='paper-3').totalCount=1;window.dispatchEvent(new Event('kg:published-papers-changed'))")
    page.locator('#practicePaperLibrary [data-paper-id="paper-3"]').click()
    all_option.locator('..').click()
    page.locator('[data-practice-start="practice"]').click()
    expect(page.locator('#practiceQuestionProgress')).to_have_text('第 185 / 185 题')
    page.locator('[data-option-id="A"]').click()
    expect(page.locator('#practiceResult')).to_be_visible()
    page.locator('#practiceAgainBtn').click()
    expect(page.locator('#practiceGame')).to_be_visible()
    assert page.evaluate('window.__entryInput.count')=='all'
    expect(page.locator('#practiceQuestionProgress')).to_have_text('第 1 / 185 题')
    browser.close()
'''
exec(compile(setup + scenario, str(__file__), 'exec'))
print('All count: 93/99/185/3/180/10, switch, duplicate values, empty/recovery, fixed 60, widths, all API request and last question PASS')
