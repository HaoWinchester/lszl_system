#!/usr/bin/env python3
from pathlib import Path
import re
import shutil

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
ARGS = ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]


def body_html() -> tuple[str, str]:
    source = (ROOT / "practice-mode.html").read_text(encoding="utf-8")
    match = re.search(r"<body([^>]*)>([\s\S]*)</body>", source, re.I)
    assert match
    return match.group(1), re.sub(r"<script[\s\S]*?</script>", "", match.group(2), flags=re.I)


MOCK_BACKEND = r"""()=>{
  const question=(id,correct)=>({
    id,title:'多选题 '+id,type:'multiple_choice',stemParts:[{text:'请选择全部正确选项'}],
    options:['A','B','C','D'].map(optionId=>({id:optionId,text:'选项 '+optionId,correct:correct.includes(optionId)})),
    correctOptionIds:correct,analysis:'必须选中完整答案集合。'
  });
  const refs=[
    {questionId:'q1',bankId:'bank-multi',orderIndex:0,question:question('q1',['A','C'])},
    {questionId:'q2',bankId:'bank-multi',orderIndex:1,question:question('q2',['B','D'])},
  ];
  const clone=value=>JSON.parse(JSON.stringify(value));
  let session=null;
  window.KGAuthCore={currentUser:()=>({username:'student-multi',role:'student'})};
  window.KGQuestionCatalogAdapter={ready:Promise.resolve()};
  window.KGPaperAccessService={inspect:()=>({allowed:true,accessLevel:'free',state:'free'})};
  window.KGPaperLearningModes={supports:()=>true,isPublishedStatus:()=>true};
  window.KGPublishedPaperRepository={listCatalogEntries:()=>[{id:'paper-multi',paperId:'paper-multi',releaseId:'release-multi',version:1,name:'多选试卷',subject:'PMP',status:'published',paperType:'multiple_choice',questionCount:2,totalCount:2,accessPolicy:{accessLevel:'free'}}]};
  window.KGLearningLoading={show:()=>{},hide:()=>{}};
  window.KGActivitySchemaV1={getLanguageMode:()=>'zh',getPracticeAutoExplain:()=>true,setLanguageMode:()=>{},setPracticeAutoExplain:()=>{}};
  window.KGFreeModeLanguage={};
  window.KGPracticeLearningApi={
    stats:()=>({active:0,pending:0,needsRemediation:0,mastered:0}),active:()=>[],refresh:async()=>({}),
    getActiveSessions:async()=>[],getSession:async()=>null,
    startSession:async input=>{
      session={id:'ps-multi',paperId:input.paperId,releaseId:input.releaseId,mode:input.mode,status:'active',revision:1,questions:clone(refs),answers:{},runtimeState:{currentIndex:0,order:'paper',health:3,streak:0,experience:0,durationMs:0},stats:{total:2,answered:0,correct:0,wrong:0,unanswered:2,experience:0,durationMs:0}};
      return clone(session);
    },
    pauseSession:async()=>clone(session),completeSession:async()=>({session:clone(session),report:{}}),abandonSession:async()=>clone(session),
    listSessions:async()=>[],clearSessions:async()=>{},recordSession:async()=>({}),
  };
}"""


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
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    attrs, body = body_html()
    page.set_content(f'<!doctype html><html><head><base href="http://localhost/"></head><body{attrs}>{body}</body></html>')
    page.evaluate(MOCK_BACKEND)
    for stylesheet in ["styles/main.css", "styles/practice-mode.css"]:
        page.add_style_tag(content=(ROOT / stylesheet).read_text(encoding="utf-8"))
    for script in [
        "src/111-practice-session-core.js",
        "src/115-practice-mode-policy.js",
        "src/112-practice-answer-sheet.js",
        "src/113-practice-result-report.js",
        "src/116-practice-session-save.js",
        "src/117-question-answer-set.js",
        "src/114-practice-draft-state.js",
        "src/118-revenge-entry-policy.js",
        "src/100-practice-mode.js",
    ]:
        page.add_script_tag(content=(ROOT / script).read_text(encoding="utf-8"))
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
    page.wait_for_timeout(120)

    page.locator('[data-practice-start="challenge"]').click()
    page.wait_for_function("document.body.dataset.practiceView === 'game'")
    page.wait_for_function("document.querySelector('[data-practice-start=\"challenge\"]').getAttribute('aria-busy') === 'false'")
    page.wait_for_timeout(50)
    assert page.locator("#practiceConfirmAnswerBtn").is_visible()
    assert page.locator("#practiceConfirmAnswerBtn").is_disabled()

    # 未确认选择跨题保留。
    page.locator('[data-option-id="A"]').click()
    assert page.locator('[data-option-id="A"]').get_attribute("aria-pressed") == "true"
    page.locator("#practiceNextBtn").click()
    page.wait_for_timeout(50)
    assert page.locator("#practiceQuestionPos").inner_text() == "2 / 2", (page.evaluate("KGPracticeMode.snapshot()"), errors)
    page.locator("#practicePrevBtn").click()
    assert page.locator('[data-option-id="A"]').get_attribute("aria-pressed") == "true"

    # 选齐后确认，整题锁定且完整集合判对。
    page.locator('[data-option-id="C"]').click()
    page.locator("#practiceConfirmAnswerBtn").click()
    assert page.locator('[data-option-id="A"]').is_disabled()
    assert page.locator('[data-option-id="C"]').is_disabled()
    assert "正确" in page.locator("#practiceFeedback").inner_text()

    # 第二题少选后确认必须判错。
    page.wait_for_timeout(620)
    assert page.locator("#practiceQuestionPos").inner_text() == "2 / 2"
    page.locator('[data-option-id="B"]').click()
    page.locator("#practiceConfirmAnswerBtn").click()
    assert "失误" in page.locator("#practiceFeedback").inner_text()
    assert not errors, errors
    browser.close()

print("multiple-choice practice browser test passed")
