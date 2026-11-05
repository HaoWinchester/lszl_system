"""Real UI start/save/resume/submit/history for a disposable 180-question PMP paper."""
import argparse,json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect

ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'artifacts/pmp-unscored';OUT.mkdir(parents=True,exist_ok=True)
parser=argparse.ArgumentParser();parser.add_argument('--base-url',required=True);base=parser.parse_args().base_url.rstrip('/')
assert base.startswith('http://127.0.0.1:')
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='chrome',headless=True)
    ctx=browser.new_context(viewport={'width':1440,'height':900});p=ctx.new_page();errors=[];requests=[]
    p.on('pageerror',lambda e:errors.append(str(e)));p.on('request',lambda r:requests.append(r.url))
    p.goto(base+'/practice-mode.html',wait_until='networkidle')
    initial=[u for u in requests if '/bundles/practice-' in u and '.js?' in u];assert len(initial)==2,initial
    assert ctx.request.post(base+'/api/v1/auth/login',data={'username':'pretest-student','password':'practice-session-pass'}).ok
    p.reload(wait_until='networkidle')
    p.locator('#practicePaperLibrary [data-paper-id="pretest-paper"]').click()
    p.locator('label').filter(has=p.locator('input[name="practiceCount"][value="180"]')).click()
    p.locator('[data-practice-start="practice"]').click();expect(p.locator('#practiceGame')).to_be_visible()
    sid=p.evaluate('KGPracticeMode.snapshot().sessionId');api=base+'/api/v1/learning/practice/sessions/'+sid
    active=ctx.request.get(api).json()['session'];assert len(active['questionOrder'])==180
    assert 'pmpPretest' not in json.dumps(active) and 'unscoredQuestions' not in json.dumps(active)
    # Save through the actual UI, then preload a long answer draft through the real API.
    p.locator('#practiceSideToggle').click();p.locator('#practiceExitBtn').click();p.locator('#practiceSaveExitBtn').click()
    expect(p.locator('#practiceLobby')).to_be_visible()
    paused=ctx.request.get(api).json()['session'];assert paused['status']=='paused'
    ids=[q['questionId'] for q in paused['questionOrder']]
    answers={qid:{'selectedAnswer':'A' if index<100 else 'B','selectionIndex':index+1} for index,qid in enumerate(ids[:179])}
    saved=ctx.request.post(api+'/pause',data={'revision':paused['revision'],'answers':answers,'runtimeState':{'currentIndex':179}})
    assert saved.ok,saved.text()
    p.locator('[data-practice-start="practice"]').click();expect(p.locator('#practiceGame')).to_be_visible()
    # Ordinary practice automatically submits after the final answer; retain its existing policy.
    p.locator('[data-option-id="A"]').click()
    expect(p.locator('#practiceResult')).to_be_visible(timeout=30000)
    report=ctx.request.get(api+'/report').json()['report'];unscored=report['unscoredQuestions'];excluded={q['questionId'] for q in unscored}
    assert len(excluded)==10 and excluded <= set(ids)
    scores={q['questionId']:q['score'] for q in paused['questionOrder']}
    assert report['rawScore']==sum(scores[qid] for qid in ids[:100]+ids[179:] if qid not in excluded)
    assert report['maxScore']==sum(scores[qid] for qid in ids if qid not in excluded)
    assert report['scorePercent']==round(report['rawScore']/report['maxScore']*100,2)
    assert report['counts']=={'total':180,'answered':180,'correct':101,'wrong':79,'unanswered':0}
    assert len(report['wrongQuestionIds'])==79
    assert sum(d['total'] for d in report['domains'].values())==170
    assert [q['number'] for q in unscored]==[ids.index(q['questionId'])+1 for q in unscored]
    assert ctx.request.post(api+'/complete',data={'revision':1}).json()['report']==report

    def open_history(session_id=sid):
        p.goto(base+'/practice-mode.html',wait_until='networkidle');p.locator('#practiceHistoryOpenBtn').click()
        target=p.locator(f'[data-history-session="{session_id}"]');group=target.locator('xpath=ancestor::details').first
        if group.get_attribute('open') is None:group.locator('summary').first.click()
        target.click()
        expect(p.locator('#practiceResult')).to_be_visible()

    for width,height in [(1440,900),(390,844)]:
        p.set_viewport_size({'width':width,'height':height});open_history()
        note=p.locator('.practice-report-unscored');expect(note).to_contain_text('170 道计分题')
        expect(p.locator('[data-report-unscored]')).to_have_count(10)
        for item in unscored:
            button=p.locator(f'[data-report-unscored="{item["questionId"]}"]');expect(button).to_have_text(f'第 {item["number"]} 题')
            button.click();expect(p.locator('#practiceGame')).to_be_visible()
            expect(p.locator('#practiceQuestionProgress')).to_contain_text(f'第 {item["number"]} / 180 题')
            expect(p.locator('#practiceOptions button').first).to_be_disabled()
            p.locator('#practiceReviewBackBtn').click();expect(p.locator('#practiceResult')).to_be_visible()
        note.scroll_into_view_if_needed();note.screenshot(path=str(OUT/f'pretest-note-{width}.png'))
        assert p.evaluate('document.scrollingElement.scrollWidth<=innerWidth+1'),width
        assert ctx.request.get(api+'/report').json()['report']==report
        p.locator('[data-report-review-all]').click()
        expect(p.locator('[data-review-card]')).to_have_count(180)
        for item in unscored:
            expect(p.locator(f'[data-review-card="{item["questionId"]}"] .practice-review-status')).to_contain_text('不计分')
    # A frozen report can contain unanswered items (e.g. an early API completion).
    # Exercise the production report callback, not only the inline review fallback.
    for kind in ('single_choice','multiple_choice','matching'):
        paper='pretest-paper' if kind=='single_choice' else f'pretest-{kind}'
        release='pretest-release' if kind=='single_choice' else f'{paper}-release'
        created=ctx.request.post(base+'/api/v1/learning/practice/sessions/enter',data={
            'paperId':paper,'releaseId':release,'mode':'practice','count':'all','order':'paper'}).json()['session']
        empty_api=base+'/api/v1/learning/practice/sessions/'+created['id']
        finished=ctx.request.post(empty_api+'/complete',data={'revision':created['revision'],'answers':{}})
        assert finished.ok,finished.text()
        empty_report=finished.json()['report'];assert empty_report['counts']['unanswered']==180
        open_history(created['id']);qid=empty_report['unscoredQuestions'][0]['questionId']
        p.locator(f'[data-report-unscored="{qid}"]').click()
        expect(p.locator('#practiceGame')).to_be_visible()
        expect(p.locator('#practiceOptions button').first).to_be_disabled()
        expect(p.locator('#practiceConfirmAnswerBtn')).to_be_hidden()
        expect(p.locator('#practiceExplanationPanel')).to_be_visible()
        expect(p.locator('#practiceExplanationBody')).to_contain_text('解析')
        if kind=='matching':
            expect(p.locator('[data-qm-right]')).to_have_count(0)
            expect(p.locator('.qm-pair-feedback').first).to_contain_text('正确配对')
        assert ctx.request.get(empty_api+'/report').json()['report']==empty_report
        p.locator('#practiceReviewBackBtn').click();expect(p.locator('#practiceResult')).to_be_visible()
    assert not errors,errors
    (OUT/'browser-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    ctx.close();browser.close()
print('PASS real 180-PMP UI start/save/resume/submit, private fixed subset, 170 scoring, full review, desktop/mobile all 10 links, history reload, idempotent report and unanswered single/multiple/matching readonly; initial 2 scripts')
