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
          // 正常作答（挑战/学霸/复仇、非会话与 sessionId）均不得产生任何写请求。
          window.__practiceWrites=[];
          window.KGAuthCore={currentUser:()=>({username:'practice-student',role:'student'})};
          window.KGQuestionCatalogAdapter={ready:Promise.resolve()};
          window.KGPaperAccessService={inspect:()=>({allowed:true,accessLevel:'free',state:'free'})};
          window.KGPaperLearningModes={supports:()=>true,isPublishedStatus:()=>true};
          window.KGPublishedPaperRepository={
            listCatalogEntries:()=>[release],
            resolvePublishedPaper:()=>({ok:true,items:[{ref:{bankId:'practice-bank',questionId:question.id},question}]})
          };
          const record=(name)=>(input)=>{window.__practiceWrites.push([name,input]);return {}};
          window.KGPracticeLearningApi={
            stats:()=>({active:0,pending:0,needsRemediation:0,mastered:0}),active:()=>[],refresh:async()=>({}),
            // 旧逐题写路由：一旦被前端调用立即暴露
            answer:async input=>{window.__practiceWrites.push(['answers',input]);return {correct:false}},
            recordSession:async input=>{window.__practiceWrites.push(['recordSession',input]);return {}},
            listSessions:async()=>[],clearSessions:async()=>{}
          };
          window.confirm=()=>true;window.alert=()=>{};
        }"""
    )
    for stylesheet in ["styles/main.css", "styles/practice-mode.css"]:
        page.add_style_tag(content=(ROOT / stylesheet).read_text(encoding="utf-8"))
    for script in ["src/111-practice-session-core.js", "src/112-practice-answer-sheet.js", "src/113-practice-result-report.js", "src/114-practice-draft-state.js", "src/100-practice-mode.js"]:
        page.add_script_tag(content=(ROOT / script).read_text(encoding="utf-8"))
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
    page.wait_for_timeout(100)

    page.locator('[data-practice-start="challenge"]').click()
    page.wait_for_timeout(50)
    assert page.locator("#practiceGame").is_visible()

    # Step 1 契约：选择答案零写请求，本地正误反馈保留
    page.evaluate("window.__practiceWrites=[]")
    page.locator('[data-option-id="B"]').click()
    page.wait_for_timeout(100)
    assert page.evaluate("window.__practiceWrites") == []
    assert "is-wrong" in (page.locator('[data-option-id="B"]').get_attribute("class") or "")
    assert "is-correct" in (page.locator('[data-option-id="A"]').get_attribute("class") or "")
    snapshot = page.evaluate("window.KGPracticeMode.snapshot()")
    assert snapshot["answered"] == 1 and snapshot["correct"] == 0 and snapshot["health"] == 2

    # 全部答完也不自动交卷：超过原 1.2s 自动交卷窗口仍停留 game 且零写请求
    page.wait_for_timeout(1400)
    assert page.locator("#practiceGame").is_visible()
    assert not page.locator("#practiceResult").is_visible()
    assert page.evaluate("window.__practiceWrites") == []

    # dirty 时原生离开提醒；不发起任何网络请求
    prevented_dirty = page.evaluate(
        "()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented}"
    )
    assert prevented_dirty is True

    # 只有明确点击答题卡“交卷”才产生唯一一次整卷写请求（答题卡折叠在抽屉内：先开抽屉）
    page.evaluate("""() => {
      const api=window.KGPracticeLearningApi;
      const original=api.recordSession;
      api.recordSession=async input=>{
        const started=window.__practiceWrites.length;
        await original(input);
        return {};
      };
    }""")
    page.locator('#practiceAnswerSheetMobileBtn').click()
    page.wait_for_timeout(320)
    page.locator('#practiceAnswerSheet [data-answer-submit]').first.click()
    page.wait_for_timeout(200)
    assert page.locator("#practiceResult").is_visible()
    writes = page.evaluate("window.__practiceWrites")
    assert [write[0] for write in writes].count("recordSession") == 1, writes

    # 交卷成功后不再拦截离开
    prevented_clean = page.evaluate(
        "()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented}"
    )
    assert prevented_clean is False

    assert not errors, errors
    browser.close()

print("practice-server-answer-browser-ok")
