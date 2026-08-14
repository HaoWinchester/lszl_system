#!/usr/bin/env python3
from pathlib import Path
import re
import shutil

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
ARGS = ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]


def body_html(file_name: str) -> tuple[str, str]:
    source = (ROOT / file_name).read_text(encoding="utf-8")
    match = re.search(r"<body([^>]*)>([\s\S]*)</body>", source, re.I)
    assert match
    return match.group(1), re.sub(r"<script[\s\S]*?</script>", "", match.group(2), flags=re.I)


with sync_playwright() as playwright:
    candidates = [
        shutil.which("chromium"),
        shutil.which("google-chrome"),
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        playwright.chromium.executable_path,
    ]
    executable = next(path for path in candidates if path and Path(path).exists())
    browser = playwright.chromium.launch(headless=True, executable_path=executable, args=ARGS)
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    page.set_default_timeout(10_000)
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))

    attrs, body = body_html("practice-mode.html")
    page.set_content(
        f'<!doctype html><html><head><base href="http://localhost/"></head><body{attrs}>{body}</body></html>'
    )
    page.evaluate(
        """() => {
          const question={id:'practice-q-1',title:'服务端判题',stemParts:[{text:'请选择正确选项'}],options:[{id:'A',text:'正确项',correct:true},{id:'B',text:'错误项'}],correctAnswer:'A'};
          const release={id:'paper-server',paperId:'paper-server',releaseId:'release-server',version:7,name:'服务端练习卷',subject:'PMP',status:'published',questionCount:1,totalCount:1,accessPolicy:{accessLevel:'free'}};
          window.__practiceAnswerCalls=[];
          window.KGAuthCore={currentUser:()=>({username:'practice-student',role:'student'})};
          window.KGQuestionCatalogAdapter={ready:Promise.resolve()};
          window.KGPaperAccessService={inspect:()=>({allowed:true,accessLevel:'free',state:'free'})};
          window.KGPaperLearningModes={supports:()=>true,isPublishedStatus:()=>true};
          window.KGPublishedPaperRepository={
            listCatalogEntries:()=>[release],
            resolvePublishedPaper:()=>({ok:true,items:[{ref:{bankId:'practice-bank',questionId:question.id},question}]})
          };
          window.KGPracticeLearningApi={
            stats:()=>({active:0,pending:0,needsRemediation:0,mastered:0}),active:()=>[],refresh:async()=>({}),
            answer:async input=>{window.__practiceAnswerCalls.push(input);const correct=input.selectedAnswer==='A';return {correct,mistake:correct?null:{id:'mistake-1',status:'pending'},completion:{status:'completed',selectedAnswer:input.selectedAnswer}}},
            recordSession:async()=>({}),listSessions:async()=>[],clearSessions:async()=>{}
          };
          window.confirm=()=>true;window.alert=()=>{};
        }"""
    )
    page.add_script_tag(content=(ROOT / "src/100-practice-mode.js").read_text(encoding="utf-8"))
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
    page.wait_for_timeout(100)

    page.locator('[data-practice-start="challenge"]').click()
    page.wait_for_timeout(50)
    assert page.locator("#practiceGame").is_visible()
    page.locator('[data-option-id="B"]').click()
    page.wait_for_timeout(100)
    calls = page.evaluate("window.__practiceAnswerCalls")
    assert len(calls) == 1
    assert calls[0] == {
        "questionId": "practice-q-1",
        "bankId": "practice-bank",
        "paperId": "paper-server",
        "releaseId": "release-server",
        "paperVersion": 7,
        "paperName": "服务端练习卷",
        "sourceMode": "challenge",
        "languageMode": "zh",
        "selectedAnswer": "B",
    }
    assert "is-wrong" in (page.locator('[data-option-id="B"]').get_attribute("class") or "")
    snapshot = page.evaluate("window.KGPracticeMode.snapshot()")
    assert snapshot["answered"] == 1 and snapshot["correct"] == 0 and snapshot["health"] == 2
    assert not errors, errors
    browser.close()

print("practice-server-answer-browser-ok")
