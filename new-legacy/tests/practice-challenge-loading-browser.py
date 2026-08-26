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
    attrs, body = body_html()
    page.set_content(
        f'<!doctype html><html><head><base href="http://localhost/"></head><body{attrs}>{body}</body></html>'
    )
    page.evaluate(
        """() => {
          const release={id:'paper-loading',paperId:'paper-loading',releaseId:'release-loading',version:1,name:'加载测试卷',subject:'PMP',status:'published',questionCount:10,totalCount:10,accessPolicy:{accessLevel:'free'}};
          const questions=Array.from({length:10},(_,index)=>({
            ref:{bankId:'bank-loading',questionId:'question-'+index},
            question:{id:'question-'+index,stemParts:[{text:'题目 '+index}],options:[{id:'A',text:'正确'},{id:'B',text:'错误'}],correctAnswer:'A'}
          }));
          window.__challengeResolveCalls=0;
          window.__challengePending=[];
          window.__challengeSuccess={ok:true,items:questions};
          window.KGAuthCore={currentUser:()=>({username:'student',role:'student'})};
          window.KGQuestionCatalogAdapter={ready:Promise.resolve()};
          window.KGPaperAccessService={inspect:()=>({allowed:true,accessLevel:'free',state:'free'})};
          window.KGPaperLearningModes={supports:()=>true,isPublishedStatus:()=>true};
          window.KGPublishedPaperRepository={
            listCatalogEntries:()=>[release],
            resolvePublishedPaper:()=>{
              window.__challengeResolveCalls+=1;
              return new Promise((resolve,reject)=>window.__challengePending.push({resolve,reject}));
            }
          };
          window.KGPracticeLearningApi={
            stats:()=>({active:0,pending:0,needsRemediation:0,mastered:0}),active:()=>[],refresh:async()=>({}),
            answer:async()=>({correct:true}),recordSession:async()=>({}),
            listSessions:async()=>[{paperId:'paper-loading',paperName:'加载测试卷',answered:10,correct:8,endedAt:Date.now(),status:'completed'}],
            clearSessions:async()=>{}
          };
        }"""
    )
    page.add_style_tag(content=(ROOT / "styles/learning-loading.css").read_text(encoding="utf-8"))
    page.add_script_tag(content=(ROOT / "src/110-learning-loading.js").read_text(encoding="utf-8"))
    page.add_script_tag(content=(ROOT / "src/100-practice-mode.js").read_text(encoding="utf-8"))
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
    page.wait_for_timeout(50)

    page.locator("#practiceHistoryOpenBtn").click()
    history_row = page.locator('[data-history-paper="paper-loading"]')
    history_row.wait_for()
    history_row.click()
    loading = page.locator("[data-learning-loading]")
    assert page.locator("[data-learning-loading]").count() == 1
    assert loading.is_visible()
    assert loading.locator("[data-learning-loading-title]").inner_text() == "正在进入练习模式"
    assert loading.locator("[data-learning-loading-message]").inner_text() == "正在读取试题…"
    assert page.evaluate("window.__challengeResolveCalls") == 1

    page.evaluate("window.KGPracticeMode.startPractice('practice')")
    page.wait_for_timeout(30)
    assert page.evaluate("window.__challengeResolveCalls") == 1

    page.evaluate("window.__challengePending.shift().reject(new Error('network unavailable'))")
    page.wait_for_function("document.querySelector('[data-learning-loading]').hidden")
    assert page.locator("#practiceToast").inner_text() == "试题读取失败，请稍后重试。"

    page.locator("#practiceHistoryOpenBtn").click()
    page.locator('[data-history-paper="paper-loading"]').click()
    assert loading.is_visible()
    assert page.evaluate("window.__challengeResolveCalls") == 2
    page.evaluate("window.__challengePending.shift().resolve(window.__challengeSuccess)")
    page.wait_for_function("document.body.dataset.practiceView === 'game'")
    assert loading.is_hidden()
    page.evaluate("window.KGPracticeMode.showLobby(); window.__challengeResolveCalls=0; window.__challengePending=[]")

    button = page.locator('[data-practice-start="challenge"]')
    button.click()
    assert loading.is_visible()
    assert loading.locator("[data-learning-loading-title]").inner_text() == "正在准备挑战"
    assert loading.locator("[data-learning-loading-message]").inner_text() == "正在读取试题…"
    assert button.is_disabled()
    assert button.get_attribute("aria-busy") == "true"
    assert page.evaluate("window.__challengeResolveCalls") == 1

    page.evaluate("window.KGPracticeMode.startPractice('challenge')")
    page.wait_for_timeout(30)
    assert page.evaluate("window.__challengeResolveCalls") == 1

    page.evaluate("window.__challengePending.shift().reject(new Error('network unavailable'))")
    page.wait_for_function("document.querySelector('[data-learning-loading]').hidden")
    assert page.locator("#practiceToast").is_visible()
    assert page.locator("#practiceToast").inner_text() == "试题读取失败，请稍后重试。"
    assert button.is_enabled()
    assert button.get_attribute("aria-busy") == "false"
    assert page.evaluate("document.activeElement === document.querySelector('[data-practice-start=challenge]')")

    button.click()
    assert loading.is_visible()
    assert page.evaluate("window.__challengeResolveCalls") == 2
    page.evaluate("window.__challengePending.shift().resolve(window.__challengeSuccess)")
    page.wait_for_function("document.body.dataset.practiceView === 'game'")
    assert loading.is_hidden()
    assert page.locator("#practiceGame").is_visible()
    browser.close()

print("practice-challenge-loading-browser-ok")
