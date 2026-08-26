#!/usr/bin/env python3
from pathlib import Path
import re

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ARGS = ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]


def body_html():
    source = (ROOT / "practice-mode.html").read_text(encoding="utf-8")
    match = re.search(r"<body([^>]*)>([\s\S]*)</body>", source, re.I)
    return match.group(1), re.sub(r"<script[\s\S]*?</script>", "", match.group(2), flags=re.I)


with sync_playwright() as playwright:
    launch = {"headless": True, "args": ARGS}
    if Path("/usr/bin/chromium").exists():
        launch["executable_path"] = "/usr/bin/chromium"
    browser = playwright.chromium.launch(**launch)
    page = browser.new_page(viewport={"width": 1440, "height": 960})
    page.set_default_timeout(10000)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    attrs, body = body_html()
    page.set_content(f'<!doctype html><html><head><base href="http://localhost/"></head><body{attrs}>{body}</body></html>')
    page.evaluate(
        """()=>{
          const question=(index)=>({id:'q'+index,title:'题目 '+index,type:'single_choice',stemParts:[{text:'这是第 '+index+' 道题'}],options:[{id:'A',text:'正确选项',correct:true},{id:'B',text:'错误选项'}],correctAnswer:'A',analysis:'第 '+index+' 题解析'});
          const redact=(raw)=>({...raw,options:raw.options.map(({correct,...option})=>option),correctAnswer:undefined,analysis:undefined});
          const fullRefs=Array.from({length:10},(_,offset)=>({questionId:'q'+(offset+1),bankId:'bank-1',mistakeId:'mistake-'+(offset+1),orderIndex:offset,domain:offset<4?'people':offset<9?'process':'business-environment',question:question(offset+1)}));
          const sessionRefs=()=>fullRefs.map(ref=>({...ref,question:redact(ref.question)}));
          let session=null;
          let report=null;
          let sequence=0;
          const normalize=()=>JSON.parse(JSON.stringify(session));
          window.__supersedeSession=()=>{if(session)session.releaseId='release-v1-superseded'};
          window.__updates=[];
          window.__conflictNext=false;
          window.__saveFailNext=false;
          window.__startConflictNext=false;
          window.KGAuthCore={currentUser:()=>({username:'student-1',role:'student'})};
          window.KGPracticeLearningApi={
            stats:()=>({active:3,pending:2,needsRemediation:1,mastered:0}),active:()=>[],refresh:async()=>({}),
            getActiveSessions:async filters=>session&&['active','paused'].includes(session.status)&&(!filters?.mode||filters.mode===session.mode)&&(!filters?.releaseId||filters.releaseId===session.releaseId)?[normalize()]:[],
            getSession:async()=>normalize(),
            startSession:async input=>{session={id:'ps-'+(++sequence),paperId:input.paperId,releaseId:input.releaseId,mode:input.mode,status:'active',revision:1,questions:sessionRefs(),questionOrder:fullRefs.map(({question,...ref})=>ref),answers:{},runtimeState:{currentIndex:0,order:input.order,...(input.mode==='scholar'?{remainingMs:0}:{})},stats:{total:10,answered:0,correct:0,wrong:0,unanswered:10,experience:0,durationMs:0}};if(window.__startConflictNext){window.__startConflictNext=false;throw Object.assign(new Error('existing session'),{status:409,detail:{code:'RESUMABLE_SESSION_EXISTS',sessionId:session.id}})}return normalize()},
            updateState:async(id,input)=>{await new Promise(resolve=>setTimeout(resolve,20));window.__updates.push(input.revision);if(window.__saveFailNext){window.__saveFailNext=false;throw Object.assign(new Error('offline'),{status:503})}if(window.__conflictNext){window.__conflictNext=false;throw Object.assign(new Error('conflict'),{status:409})}if(input.revision!==session.revision)throw Object.assign(new Error('stale revision'),{status:409});session.runtimeState={...session.runtimeState,...input.runtimeState};session.status='active';session.revision+=1;return normalize()},
            answerSession:async(id,input)=>{const selected=input.timedOut?'__timeout__':input.selectedAnswer,correct=selected==='A';session.answers[input.questionId]={questionId:input.questionId,selectedAnswer:selected,correctAnswer:'A',correct,timedOut:input.timedOut===true,mistakeStatus:session.mode==='revenge'?'needs_remediation':undefined};const ref=session.questions.find(item=>item.questionId===input.questionId);if(ref)ref.question=fullRefs.find(item=>item.questionId===input.questionId).question;const values=Object.values(session.answers);session.stats={...session.stats,answered:values.length,correct:values.filter(item=>item.correct).length,wrong:values.filter(item=>!item.correct).length,unanswered:10-values.length};session.revision+=1;return {answer:session.answers[input.questionId],session:normalize()}},
            pauseSession:async(id,input)=>{session.runtimeState={...session.runtimeState,...input.runtimeState};session.status='paused';session.revision+=1;return normalize()},
            abandonSession:async()=>{session.status='abandoned';session.revision+=1;return normalize()},
            completeSession:async()=>{session.status='completed';session.revision+=1;report={sessionId:session.id,resultLabel:'模拟考试结果：FAIL',passed:false,scorePercent:0,passPercent:60,overallBand:'needsImprovement',counts:{total:10,answered:1,correct:0,wrong:1,unanswered:9},domainWeights:{people:42,process:50,'business-environment':8},domains:{people:{weight:42,total:4,answered:1,correct:0,wrong:1,unanswered:3,scorePercent:0,performanceBand:'needsImprovement'},process:{weight:50,total:5,answered:0,correct:0,wrong:0,unanswered:5,scorePercent:0,performanceBand:'needsImprovement'},'business-environment':{weight:8,total:1,answered:0,correct:0,wrong:0,unanswered:1,scorePercent:0,performanceBand:'needsImprovement'}},wrongQuestionIds:['q7'],durationMs:1000,official:false,disclaimer:'幻谱模拟判定，不代表 PMI 官方考试成绩'};return {session:normalize(),report}},
            getReport:async()=>JSON.parse(JSON.stringify(report)),
            listSessions:async()=>session?.status==='completed'?[{paperId:'paper-1',paperName:'PMP 模拟卷',sessionId:session.id,mode:session.mode,answered:1,correct:0,createdAt:new Date(Date.now()-1000).toISOString(),reportAvailable:true},{paperId:'paper-1',paperName:'PMP 模拟卷',sessionId:'abandoned-newer',mode:'challenge',answered:0,correct:0,createdAt:new Date().toISOString(),reportAvailable:false}]:[],
            clearSessions:async()=>{},
          };
          window.KGPublishedPaperRepository={listCatalogEntries:()=>[{id:'paper-1',paperId:'paper-1',releaseId:'release-1',version:1,name:'PMP 模拟卷',subject:'PMP',status:'published',questionCount:10,totalCount:10,accessPolicy:{accessLevel:'free'}}]};
          window.KGPaperAccessService={inspect:()=>({allowed:true,accessLevel:'free'})};
          window.KGQuestionCatalogAdapter={ready:Promise.resolve()};
          window.KGLearningLoading={show:()=>{},hide:()=>{}};
          window.KGActivitySchemaV1={getPracticeAutoExplain:()=>true,getLanguageMode:()=> 'zh',setPracticeAutoExplain:()=>{}};
          window.KGFreeModeLanguage={};
          window.fetch=async()=>new Response('{}',{status:200,headers:{'content-type':'application/json'}});
        }"""
    )
    for stylesheet in ["styles/main.css", "styles/practice-mode.css"]:
        page.add_style_tag(content=(ROOT / stylesheet).read_text(encoding="utf-8"))
    for script in ["src/111-practice-session-core.js", "src/112-practice-answer-sheet.js", "src/113-practice-result-report.js", "src/100-practice-mode.js"]:
        page.add_script_tag(content=(ROOT / script).read_text(encoding="utf-8"))
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
    page.wait_for_timeout(120)

    page.locator('[data-practice-start="challenge"]').click()
    page.wait_for_timeout(180)
    assert page.locator("#practiceGame").is_visible()
    assert page.locator("#practiceAnswerSheet").is_visible()
    initial = page.evaluate("window.KGPracticeLearningApi.getSession().then(s=>s.questions[0].question)")
    assert "correctAnswer" not in initial and "analysis" not in initial
    assert all("correct" not in option for option in initial["options"])
    numbers = page.locator("#practiceAnswerSheet [data-question-id]")
    assert numbers.count() == 10
    assert all("题" in (numbers.nth(index).get_attribute("aria-label") or "") for index in range(10))

    for question_id in ["q2", "q3", "q4"]:
        page.locator(f'#practiceAnswerSheet [data-question-id="{question_id}"]').click()
    page.wait_for_timeout(160)
    revisions = page.evaluate("window.__updates.slice(0,3)")
    assert revisions == sorted(revisions) and len(set(revisions)) == 3, revisions

    page.evaluate("window.__saveFailNext=true")
    page.locator('#practiceAnswerSheet [data-question-id="q5"]').click()
    page.wait_for_timeout(80)
    assert page.locator("#practiceSessionUnsaved").is_visible()
    page.locator('#practiceAnswerSheet [data-question-id="q6"]').click()
    page.wait_for_timeout(80)
    assert page.locator("#practiceSessionUnsaved").is_hidden()

    page.evaluate("window.__conflictNext=true")
    page.locator('#practiceAnswerSheet [data-question-id="q5"]').click()
    page.wait_for_timeout(80)
    assert page.locator("#practiceSessionConflict").is_visible()
    page.locator("#practiceSessionConflictReload").click()
    page.wait_for_timeout(100)
    assert page.locator("#practiceSessionConflict").is_hidden()

    page.locator('#practiceAnswerSheet [data-question-id="q7"]').click()
    page.wait_for_timeout(100)
    assert "第 7 道题" in page.locator("#practiceQuestionStem").inner_text()
    page.locator('[data-option-id="B"]').click()
    page.wait_for_timeout(100)
    assert page.locator('[data-option-id="B"]').is_disabled()
    assert "正确答案：A" in page.locator("#practiceExplanationPanel").inner_text()
    assert "错误" in (page.locator('#practiceAnswerSheet [data-question-id="q7"]').get_attribute("aria-label") or "")

    page.locator('#practiceAnswerSheet [data-answer-submit]').click()
    assert page.locator("#practiceSubmitConfirm").is_visible()
    assert "9 题未作答" in page.locator("#practiceSubmitMessage").inner_text()
    page.locator("#practiceSubmitReturnBtn").click()
    page.wait_for_timeout(100)
    assert "第 1 道题" in page.locator("#practiceQuestionStem").inner_text()

    page.locator("#practiceExitBtn").click()
    page.locator("#practiceSaveExitBtn").click()
    page.wait_for_timeout(120)
    assert page.locator("#practiceLobby").is_visible()
    original_session = page.evaluate("window.KGPracticeMode.snapshot().sessionId")
    page.evaluate("window.__supersedeSession()")
    page.locator('[data-practice-start="challenge"]').click()
    page.wait_for_timeout(160)
    assert page.evaluate("window.KGPracticeMode.snapshot().sessionId") == original_session
    assert "第 1 道题" in page.locator("#practiceQuestionStem").inner_text()
    assert "错误" in (page.locator('#practiceAnswerSheet [data-question-id="q7"]').get_attribute("aria-label") or "")

    page.set_viewport_size({"width": 390, "height": 844})
    page.wait_for_timeout(80)
    assert page.locator("#practiceAnswerSheetMobileBtn").is_visible()
    page.locator("#practiceAnswerSheetMobileBtn").click()
    assert page.locator("#practiceAnswerSheetDrawer").is_visible()
    assert page.locator("#practiceAnswerSheetMobile [data-question-id]").count() == 10
    page.locator("#practiceAnswerSheetDrawerClose").click()
    assert page.locator("#practiceAnswerSheetDrawer").is_hidden()
    page.locator("#practiceAnswerSheetMobileBtn").click()
    page.locator("#practiceAnswerSheetMobile [data-answer-submit]").click()
    assert page.locator("#practiceSubmitConfirm").is_visible()
    page.locator("#practiceSubmitAnywayBtn").click()
    page.wait_for_timeout(140)
    assert page.locator("#practiceResult").is_visible()
    assert "幻谱 PMP 模拟成绩分析报告" in page.locator("#practiceResult").inner_text()
    page.locator('[data-review-question="q7"]').click()
    page.wait_for_timeout(80)
    assert page.locator("#practiceGame").is_visible()
    assert page.locator("#practiceReviewBackBtn").is_visible()
    assert page.locator('[data-option-id="B"]').is_disabled()
    assert "第 7 题解析" in page.locator("#practiceExplanationPanel").inner_text()
    assert page.locator("#practiceAnswerSheet [data-question-id]").count() == 1
    assert page.locator("#practiceAnswerSheet [data-answer-submit]").count() == 0
    page.locator("#practiceReviewBackBtn").click()
    assert page.locator("#practiceResult").is_visible()

    page.locator('[data-report-lobby="true"]').click()
    page.locator("#practiceHistoryOpenBtn").click()
    page.wait_for_timeout(80)
    assert "查看成绩" in page.locator("#practiceHistoryList").inner_text()
    page.locator("#practiceHistoryList [data-history-report=true]").click()
    page.wait_for_timeout(80)
    assert page.locator("#practiceResult").is_visible()
    assert "幻谱 PMP 模拟成绩分析报告" in page.locator("#practiceResult").inner_text()

    page.locator('[data-report-lobby="true"]').click()
    page.evaluate("window.__startConflictNext=true")
    scholar = page.evaluate("window.KGPracticeMode.startPractice('scholar').then(()=>window.KGPracticeMode.snapshot())")
    assert scholar["mode"] == "scholar" and scholar["remainingSeconds"] == 0, scholar
    page.wait_for_timeout(120)
    timed_out = page.evaluate("window.KGPracticeLearningApi.getSession().then(s=>Object.values(s.answers)[0])")
    assert timed_out and timed_out["timedOut"] is True and timed_out["selectedAnswer"] == "__timeout__", timed_out
    page.locator("#practiceExitBtn").click()
    page.locator("#practiceSaveExitBtn").click()
    page.wait_for_timeout(80)

    page.locator('[data-practice-start="revenge"]').click()
    page.wait_for_timeout(100)
    revenge_session = page.evaluate("window.KGPracticeMode.snapshot().sessionId")
    assert revenge_session and page.evaluate("window.KGPracticeMode.snapshot().mode") == "revenge"
    page.locator("#practiceExitBtn").click()
    page.locator("#practiceSaveExitBtn").click()
    page.wait_for_timeout(80)
    page.locator('[data-practice-start="revenge"]').click()
    page.wait_for_timeout(100)
    resumed = page.evaluate("window.KGPracticeMode.snapshot()")
    assert resumed["sessionId"] == revenge_session and resumed["mode"] == "revenge", resumed
    assert not errors, errors
    browser.close()

print("practice-answer-sheet-browser-ok")
