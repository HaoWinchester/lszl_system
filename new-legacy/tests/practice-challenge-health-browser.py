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


# ---------------------------------------------------------------------------
# 挑战模式血量判定与顶栏显示一致性（用户报告：180 题血量显示 54，错 3 题即判失败）。
#
# 场景 a（全新会话）：60 题（血量 18），连错 3 题后：
#   * 顶栏血量 = 6/9；
#   * 不弹"挑战失败"弹窗（#practiceFailBackdrop hidden）。
#
# 场景 b（恢复会话）：同卷同模式存在旧会话，runtimeState.health 极低（=1）：
#   * 点"开始挑战"静默恢复旧会话后，顶栏血量必须显示真实剩余 1/9；
#   * 血量显示与失败判定必须一致（再错 1 题即可触发弹窗，而不是显示 9 却错 1 题就弹）。
#
# 失败弹窗触发链：answer() 错题 -1 → advanceAfterAnswer() mode==='challenge'&&health<=0
# → showChallengeFailDialog()。
# ---------------------------------------------------------------------------

MOCK_BACKEND = r"""()=>{
  const TOTAL=60;
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
  const stats=session=>{const values=Object.values(session.answers||{});return {total:TOTAL,answered:values.length,correct:values.filter(i=>i.correct).length,wrong:values.filter(i=>!i.correct).length,unanswered:TOTAL-values.length,experience:0,durationMs:0}};
  window.__seedSession=patch=>{
    session=Object.assign({
      id:'ps-'+(++sequence),paperId:'paper-hp',releaseId:'release-hp',mode:'challenge',status:'active',revision:1,
      questions:refs(TOTAL),answers:{},
      runtimeState:{currentIndex:0,order:'paper',health:18,streak:0,experience:0,durationMs:0},
      stats:stats({answers:{}}),
    },patch||{});
    session.stats=stats(session);
    return clone(session);
  };
  window.__getActiveSessionsFilter=null;
  window.KGPracticeLearningApi={
    stats:()=>({active:0,pending:0,needsRemediation:0,mastered:0}),active:()=>[],refresh:async()=>({}),
    recordSession:async()=>({}),
    getActiveSessions:async filters=>{window.__getActiveSessionsFilter=filters;return session&&['active','paused'].includes(session.status)?[clone(session)]:[]},
    getSession:async id=>session&&session.id===id?clone(session):null,
    startSession:async input=>{
      record('startSession');
      window.__seedSession({id:'ps-'+(++sequence),status:'active',answers:{},runtimeState:{currentIndex:0,order:input.order,streak:0,experience:0,durationMs:0}});
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
    page.wait_for_timeout(700)


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
    page.on("pageerror", lambda error: page.evaluate(f"window.__pageErrors=(window.__pageErrors||[]).concat({error!r})"))
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

    # ---------- 场景 a：全新 60 题挑战会话（血量 18），连错 3 题不得判失败 ----------
    page.locator('[data-practice-start="challenge"]').click()
    page.wait_for_timeout(250)
    assert page.locator("#practiceGame").is_visible(), page.evaluate("document.body.dataset.practiceView")
    assert health_count(page) == "18/18", health_count(page)
    assert health_label(page) == "剩余血量 18 / 18", health_label(page)

    answer_wrong(page)
    answer_wrong(page)
    assert fail_hidden(page), "fail dialog must stay hidden before health reaches 0"
    answer_wrong(page)
    page.wait_for_timeout(120)
    assert health_count(page) == "15/18", health_count(page)
    assert health_label(page) == "剩余血量 15 / 18", health_label(page)
    assert fail_hidden(page), "3 wrong answers must NOT trigger challenge fail dialog at health 9"
    assert page.locator("#practiceGame").is_visible()

    # ---------- 场景 b：恢复 health=1 的旧会话，顶栏必须如实显示 1/18 ----------
    page.locator("#practiceExitBtn").click()
    page.locator("#practiceAbandonBtn").click()
    page.wait_for_timeout(300)
    assert page.locator("#practiceLobby").is_visible()

    # 造一个血量只剩 1 的 active 旧会话（后台保留记录），重新进入大厅后点开始挑战
    page.evaluate(
        """()=>{const s=window.__seedSession({id:'ps-resume',status:'active',revision:2,
        runtimeState:{currentIndex:2,order:'paper',health:1,streak:0,experience:20,durationMs:8000}});
        s.answers={q0:{questionId:'q0',selectedAnswer:'B',correctAnswer:'A',correct:false},q1:{questionId:'q1',selectedAnswer:'B',correctAnswer:'A',correct:false}};}"""
    )
    page.evaluate("window.KGPracticeMode.showLobby()")
    page.wait_for_timeout(250)
    page.evaluate("window.__calls=[]")
    page.locator('[data-practice-start="challenge"]').click()
    page.wait_for_timeout(300)
    assert page.locator("#practiceGame").is_visible(), page.evaluate("document.body.dataset.practiceView")
    # 必须走恢复路径（getSession），不得新建会话
    calls = page.evaluate("window.__calls")
    assert "startSession" not in calls, calls
    # 恢复低血量会话必须给出明确 toast 提示（剩余血量如实告知）
    toast = page.locator("#practiceToast")
    assert toast.is_visible(), "resuming a low-health session must surface a toast"
    assert "1" in toast.inner_text() and "18" in toast.inner_text(), toast.inner_text()
    assert health_count(page) == "1/18", health_count(page)
    assert health_label(page) == "剩余血量 1 / 18", health_label(page)

    # 恢复会话 health=1 时再错 1 题 → 归零，弹失败弹窗（判定与显示一致）
    answer_wrong(page)
    page.wait_for_timeout(150)
    assert health_count(page) == "0/18", health_count(page)
    assert not fail_hidden(page), "resumed session at health 1: one more wrong answer must trigger the fail dialog"

    # 弹窗"继续作答"关闭弹窗后不中断试卷（挑战 V2 语义）
    page.locator("#practiceFailContinueBtn").click()
    page.wait_for_timeout(120)
    assert fail_hidden(page)
    assert page.locator("#practiceGame").is_visible()
    assert not errors, errors

    print("practice-challenge-health-browser-ok")

    browser.close()
