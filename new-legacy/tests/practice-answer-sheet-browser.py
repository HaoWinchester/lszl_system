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
          const refs=Array.from({length:10},(_,offset)=>({questionId:'q'+(offset+1),bankId:'bank-1',orderIndex:offset,domain:offset<4?'people':offset<9?'process':'business-environment',question:question(offset+1)}));
          let session=null;
          const normalize=()=>JSON.parse(JSON.stringify(session));
          window.KGAuthCore={currentUser:()=>({username:'student-1',role:'student'})};
          window.KGPracticeLearningApi={
            stats:()=>({active:0,pending:0,needsRemediation:0,mastered:0}),active:()=>[],refresh:async()=>({}),
            getActiveSessions:async()=>session&&['active','paused'].includes(session.status)?[normalize()]:[],
            getSession:async()=>normalize(),
            startSession:async input=>{session={id:'ps-1',paperId:input.paperId,releaseId:input.releaseId,mode:input.mode,status:'active',revision:1,questions:refs,questionOrder:refs.map(({question,...ref})=>ref),answers:{},runtimeState:{currentIndex:0,order:input.order},stats:{total:10,answered:0,correct:0,wrong:0,unanswered:10,experience:0,durationMs:0}};return normalize()},
            updateState:async(id,input)=>{session.runtimeState={...session.runtimeState,...input.runtimeState};session.status='active';session.revision+=1;return normalize()},
            answerSession:async(id,input)=>{const correct=input.selectedAnswer==='A';session.answers[input.questionId]={questionId:input.questionId,selectedAnswer:input.selectedAnswer,correctAnswer:'A',correct};const values=Object.values(session.answers);session.stats={...session.stats,answered:values.length,correct:values.filter(item=>item.correct).length,wrong:values.filter(item=>!item.correct).length,unanswered:10-values.length};session.revision+=1;return {answer:session.answers[input.questionId],session:normalize()}},
            pauseSession:async(id,input)=>{session.runtimeState={...session.runtimeState,...input.runtimeState};session.status='paused';session.revision+=1;return normalize()},
            abandonSession:async()=>{session.status='abandoned';session.revision+=1;return normalize()},
            completeSession:async()=>{session.status='completed';session.revision+=1;return {session:normalize(),report:{scorePercent:10,durationMs:1000}}},
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
    for script in ["src/111-practice-session-core.js", "src/112-practice-answer-sheet.js", "src/100-practice-mode.js"]:
        page.add_script_tag(content=(ROOT / script).read_text(encoding="utf-8"))
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
    page.wait_for_timeout(120)

    page.locator('[data-practice-start="challenge"]').click()
    page.wait_for_timeout(180)
    assert page.locator("#practiceGame").is_visible()
    assert page.locator("#practiceAnswerSheet").is_visible()
    numbers = page.locator("#practiceAnswerSheet [data-question-id]")
    assert numbers.count() == 10
    assert all("题" in (numbers.nth(index).get_attribute("aria-label") or "") for index in range(10))

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
    page.locator('[data-practice-start="challenge"]').click()
    page.wait_for_timeout(160)
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
    assert not errors, errors
    browser.close()

print("practice-answer-sheet-browser-ok")
