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


# 真实题量选择、180 题的第 3/53/54 次答错、旧血量恢复，以及题量冲突确认。
# mock 必须尊重 startSession.count，不能用固定题量掩盖选择失效。

MOCK_BACKEND = r"""()=>{
  const TOTAL=180;
  const question=(index)=>({id:'q'+index,title:'题目 '+index,type:'single_choice',stemParts:[{text:'第 '+index+' 道题'}],options:[{id:'A',text:'正确选项',correct:true},{id:'B',text:'错误选项'}],correctAnswer:'A',analysis:'解析 '+index});
  const refs=(count)=>Array.from({length:count},(_,offset)=>({questionId:'q'+offset,bankId:'bank-1',orderIndex:offset,question:question(offset)}));
  let session=null;
  let sequence=0;
  window.__calls=[];
  const record=name=>window.__calls.push(name);
  window.KGAuthCore={currentUser:()=>({username:'student-1',role:'student'})};
  window.KGQuestionCatalogAdapter={ready:Promise.resolve()};
  window.KGPaperAccessService={inspect:()=>({allowed:true,accessLevel:'free',state:'free'})};
  window.KGPaperLearningModes={supports:()=>true,isPublishedStatus:()=>true};
  window.KGPublishedPaperRepository={listCatalogEntries:()=>[{id:'paper-hp',paperId:'paper-hp',releaseId:'release-hp',version:1,name:'血量测试卷',subject:'PMP',status:'published',questionCount:TOTAL,totalCount:TOTAL,accessPolicy:{accessLevel:'free'}}]};
  window.KGLearningLoading={show:()=>{},hide:()=>{}};
  window.KGLearningIcons={render:()=>'<svg data-icon="heart"></svg>'};
  window.KGActivitySchemaV1={getLanguageMode:()=>'zh',setLanguageMode:()=>{}};
  window.KGFreeModeLanguage={};
  const clone=value=>JSON.parse(JSON.stringify(value));
  const stats=session=>{const values=Object.values(session.answers||{});return {total:session.questions.length,answered:values.length,correct:values.filter(i=>i.correct).length,wrong:values.filter(i=>!i.correct).length,unanswered:session.questions.length-values.length,experience:0,durationMs:0}};
  window.__seedSession=patch=>{
    session=Object.assign({
      id:'ps-'+(++sequence),paperId:'paper-hp',releaseId:'release-hp',mode:'challenge',status:'active',revision:1,
      questions:refs(TOTAL),answers:{},
      runtimeState:{currentIndex:0,order:'paper',health:18,streak:0,experience:0,durationMs:0},
      stats:{},
    },patch||{});
    session.stats=stats(session);
    return clone(session);
  };
  window.__getActiveSessionsFilter=null;
  window.__seedProgress=({count=TOTAL,wrong=0,correct=0,health=3,mode='challenge'}={})=>{
    const answers={};
    for(let i=0;i<wrong+correct;i++)answers['q'+i]={selectedAnswer:i<wrong?'B':'A',correctAnswer:'A',correct:i>=wrong,selectionIndex:i+1};
    return window.__seedSession({mode,questions:refs(count),answers,runtimeState:{currentIndex:wrong+correct,health,order:'paper'}});
  };
  window.KGPracticeLearningApi={
    stats:()=>({active:0,pending:0,needsRemediation:0,mastered:0}),active:()=>[],refresh:async()=>({}),
    recordSession:async()=>({}),
    getActiveSessions:async filters=>{window.__getActiveSessionsFilter=filters;return session&&['active','paused'].includes(session.status)?[clone(session)]:[]},
    getSession:async id=>session&&session.id===id?clone(session):null,
    startSession:async input=>{
      record('startSession');window.__startInput=clone(input);
      window.__seedSession({id:'ps-'+(++sequence),status:'active',mode:input.mode,questions:refs(input.count),answers:{},runtimeState:{currentIndex:0,order:input.order,streak:0,experience:0,durationMs:0}});
      return clone(session);
    },
    pauseSession:async(id,input)=>{record('pause');Object.assign(session.runtimeState,input.runtimeState||{});Object.assign(session.answers||{},input.answers||{});session.stats=stats(session);session.revision+=1;session.status='paused';return clone(session)},
    completeSession:async(id,input)=>{record('complete');session.status='completed';session.revision+=1;return {session:clone(session),report:{sessionId:id,resultLabel:'模拟考试结果：FAIL',passed:false,scorePercent:0,passPercent:60,overallBand:'needsImprovement',counts:{total:TOTAL,answered:0,correct:0,wrong:0,unanswered:TOTAL},domainWeights:{},domains:{},wrongQuestionIds:[],durationMs:1000,official:false,disclaimer:'mock'}}},
    abandonSession:async(id,input)=>{record('abandon');session.status='abandoned';session.revision+=1;return clone(session)},
    getReport:async id=>({sessionId:id,resultLabel:'模拟考试结果：FAIL',passed:false,scorePercent:0,passPercent:60,overallBand:'needsImprovement',counts:{total:TOTAL,answered:0,correct:0,wrong:0,unanswered:TOTAL},domainWeights:{},domains:{},wrongQuestionIds:[],durationMs:1000,official:false,disclaimer:'mock'}),
    listSessions:async()=>[],clearSessions:async()=>{},
  };
}"""


def answer_wrong(page):
    page.locator('[data-option-id="B"]').click()
    page.clock.fast_forward(600)
    if page.locator("#practiceCheckpoint").is_visible():
        page.locator("#practiceCheckpointContinue").click()


def health_label(page):
    return page.locator("#practiceHealth").get_attribute("aria-label")


def health_count(page):
    return page.locator("#practiceHealth .practice-health-count").inner_text()


def fail_hidden(page):
    return page.locator("#practiceFailBackdrop").is_hidden()


with sync_playwright() as playwright:
    candidates = [
        shutil.which("chromium"),
        shutil.which("google-chrome"),
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        playwright.chromium.executable_path,
    ]
    executable = next(path for path in candidates if path and Path(path).exists())
    browser = playwright.chromium.launch(headless=True, executable_path=executable, args=ARGS)
    page = browser.new_page(viewport={"width": 1440, "height": 960})
    page.set_default_timeout(10_000)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    attrs, body = body_html()
    page.set_content(f'<!doctype html><html><head><base href="http://localhost/"></head><body{attrs}>{body}</body></html>')
    page.evaluate(MOCK_BACKEND)
    for stylesheet in ["styles/main.css", "styles/practice-mode.css"]:
        page.add_style_tag(content=(ROOT / stylesheet).read_text(encoding="utf-8"))
    for script in ["src/111-practice-session-core.js", "src/112-practice-answer-sheet.js", "src/113-practice-result-report.js", "src/114-practice-draft-state.js", "src/100-practice-mode.js"]:
        page.add_script_tag(content=(ROOT / script).read_text(encoding="utf-8"))
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
    page.wait_for_timeout(150)

    page.clock.install()

    def start(count=180):
        page.locator(f'[name="practiceCount"][value="{count}"]').check(force=True)
        page.locator('[data-practice-start="challenge"]').click()
        page.wait_for_function("document.body.dataset.practiceView === 'game'")

    def abandon():
        page.locator("#practiceExitBtn").click()
        page.locator("#practiceAbandonBtn").click()
        page.wait_for_function("document.body.dataset.practiceView === 'lobby'")

    # 真正通过题量单选框启动，mock 和服务端一样按请求 count 返回题目。
    for count, maximum in [(10, 3), (20, 6), (60, 18), (180, 54)]:
        start(count)
        assert page.evaluate("window.__startInput.count") == count
        assert page.evaluate("window.KGPracticeMode.snapshot().questionCount") == count
        assert health_label(page) == f"剩余血量 {maximum} / {maximum}"
        abandon()

    # 保存的旧 health=3 不得覆盖 180 题的新规则：无错题应恢复为 54。
    page.evaluate("window.__seedProgress({health:3});window.KGPracticeMode.showLobby()")
    start()
    assert health_count(page) == "54/54", health_count(page)
    for wrong in range(1, 55):
        answer_wrong(page)
        assert health_count(page) == f"{54-wrong}/54", (wrong, health_count(page))
        assert fail_hidden(page) == (wrong < 54), f"wrong={wrong}: fail dialog threshold must be 54"
    page.locator("#practiceFailContinueBtn").click()
    assert fail_hidden(page)
    answer_wrong(page)
    assert fail_hidden(page), "failure dialog must not reopen on every subsequent wrong answer"
    abandon()

    # 正常恢复以实际已答错题为准；不能因为修复而把已消耗血量补满。
    page.evaluate("window.__seedProgress({wrong:53,health:1});window.KGPracticeMode.showLobby()")
    start()
    assert health_count(page) == "1/54"
    assert "1 / 54" in page.locator("#practiceToast").inner_text()
    answer_wrong(page)
    assert health_count(page) == "0/54"
    assert not fail_hidden(page)
    page.locator("#practiceFailContinueBtn").click()
    abandon()

    # 缺少 health 的保存进度也不能满血恢复；答对不扣血。
    page.evaluate("window.__seedProgress({wrong:3,correct:2,health:null});window.KGPracticeMode.showLobby()")
    start()
    assert health_count(page) == "51/54"
    page.locator('[data-option-id="A"]').click()
    page.clock.fast_forward(600)
    assert health_count(page) == "51/54"
    page.locator("#practiceExitBtn").click()
    page.locator("#practiceSaveExitBtn").click()
    page.wait_for_function("document.body.dataset.practiceView === 'lobby'")
    start()
    assert health_count(page) == "51/54"
    abandon()

    # 最后一题才用尽生命也必须弹窗（不能被末题提前 return 跳过）。
    page.evaluate("window.__seedProgress({wrong:53,correct:126,health:1});window.KGPracticeMode.showLobby()")
    start()
    answer_wrong(page)
    assert health_count(page) == "0/54"
    assert not fail_hidden(page)
    page.locator("#practiceFailContinueBtn").click()
    abandon()

    # 选 180 题不能静默恢复旧 10 题；取消必须保留旧会话，确认后才放弃并新建。
    page.evaluate("window.__seedProgress({count:10});window.KGPracticeMode.showLobby();window.__calls=[]")
    dialogs = []
    def cancel_dialog(dialog):
        dialogs.append(dialog.message)
        dialog.dismiss()
    page.on("dialog", cancel_dialog)
    page.locator('[name="practiceCount"][value="180"]').check(force=True)
    page.locator('[data-practice-start="challenge"]').click()
    page.wait_for_function("!document.querySelector('[data-practice-start=challenge]').disabled")
    assert dialogs and "10" in dialogs[-1] and "180" in dialogs[-1], dialogs
    assert page.locator("#practiceLobby").is_visible()
    assert "abandon" not in page.evaluate("window.__calls")
    assert "startSession" not in page.evaluate("window.__calls")
    page.remove_listener("dialog", cancel_dialog)
    page.once("dialog", lambda dialog: dialog.accept())
    start()
    assert page.evaluate("window.__calls") == ["abandon", "startSession"]
    assert page.evaluate("window.KGPracticeMode.snapshot().questionCount") == 180
    assert health_count(page) == "54/54"
    for _ in range(3):
        answer_wrong(page)
    assert health_count(page) == "51/54" and fail_hidden(page)
    abandon()

    # 学霸仍使用已保存的血量（有回血/超时规则，不能套用挑战计算）。
    page.evaluate("window.__seedProgress({mode:'scholar',wrong:3,health:7});window.KGPracticeMode.showLobby()")
    page.locator('[data-practice-start="scholar"]').click()
    page.wait_for_function("document.body.dataset.practiceView === 'game'")
    assert health_label(page) == "剩余血量 7 / 18"
    abandon()

    # 放弃旧练习失败时不新建、不吞掉旧进度；下一次操作可以重试。
    page.evaluate("""()=>{
      window.__seedProgress({count:10});window.KGPracticeMode.showLobby();window.__calls=[];
      window.__originalAbandon=window.KGPracticeLearningApi.abandonSession;
      window.KGPracticeLearningApi.abandonSession=async()=>{throw new Error('network unavailable')};
    }""")
    page.once("dialog", lambda dialog: dialog.accept())
    page.locator('[data-practice-start="challenge"]').click()
    page.wait_for_function("!document.querySelector('[data-practice-start=challenge]').disabled")
    assert page.locator("#practiceLobby").is_visible()
    assert "startSession" not in page.evaluate("window.__calls")
    assert "失败" in page.locator("#practiceToast").inner_text()
    page.evaluate("window.KGPracticeLearningApi.abandonSession=window.__originalAbandon")

    # 并发新建返回 409 时也必须校验题量，不能从错误恢复路径静默进入旧 10 题。
    page.evaluate("""()=>{
      const api=window.KGPracticeLearningApi;
      api.getActiveSessions=async()=>[];
      api.startSession=async()=>{throw {detail:{code:'RESUMABLE_SESSION_EXISTS',sessionId:window.__seedProgress({count:10}).id}}};
      window.__calls=[];
    }""")
    page.once("dialog", cancel_dialog)
    page.locator('[data-practice-start="challenge"]').click()
    page.wait_for_function("!document.querySelector('[data-practice-start=challenge]').disabled")
    assert len(dialogs) == 2
    assert page.locator("#practiceLobby").is_visible()
    assert "abandon" not in page.evaluate("window.__calls")
    assert not errors, errors
    print("practice-challenge-health-browser-ok: counts, 3/53/54 boundary, resume, save, last question, count mismatch cancel/confirm")
    browser.close()
