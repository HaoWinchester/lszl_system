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
# Task 7：所有点击触发的请求统一走 runClickedRequest 公共加载框包装器。
#   * keys: start（开始/继续）、save、complete、abandon、reload、report；
#   * 每个被包装的请求都注入可控 Promise，延迟期间断言加载框可见 + 标题文案；
#   * 500 / 网络异常 / 409 都必须关闭加载框并恢复按钮；
#   * 重复点击被 state.pendingRequestKey 拦截（业务端点只调用一次）；
#   * 选择答案 / 题号跳转 / 前后题切换等本地交互零请求零加载框。
# 阶段一沿用 KGPublishedPaperRepository 目录路径覆盖 key=start；
# 阶段二切换到会话 API mock 覆盖 save/complete/abandon/reload/report。
# ---------------------------------------------------------------------------


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
    page.on("pageerror", lambda error: page.evaluate(f"window.__pageErrors=(window.__pageErrors||[]).concat({error!r})"))
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
          // ---- Task 7：生命周期端点全部换成可控 Promise 并挂计数器 ----
          const baseSession=overrides=>JSON.parse(JSON.stringify(Object.assign({
            id:'ps-loading',paperId:'paper-loading',releaseId:'release-loading',mode:'challenge',status:'active',revision:3,
            questions:questions.map(item=>({questionId:item.question.id,bankId:'bank-loading',orderIndex:0,question:item.question})),
            answers:{},runtimeState:{currentIndex:0,order:'paper',health:3,streak:0,experience:10,durationMs:12000},
            stats:{total:10,answered:2,correct:2,wrong:0,unanswered:8,experience:20,durationMs:12000}
          },overrides||{})));
          let active=null;
          window.__baseSession=baseSession;
          window.__setActiveSession=session=>{active=session};
          window.__getActiveSession=()=>active&&JSON.parse(JSON.stringify(active));
          window.__statusError=status=>Object.assign(new Error('http '+status),{status});
          const gate=name=>{
            window['__'+name+'Calls']=0;
            window['__'+name+'Pending']=[];
            return async(...args)=>{window['__'+name+'Calls']+=1;return new Promise((resolve,reject)=>window['__'+name+'Pending'].push({resolve,reject}))};
          };
          window.KGPracticeLearningApi={
            stats:()=>({active:0,pending:0,needsRemediation:0,mastered:0}),active:()=>[],refresh:async()=>({}),
            answer:async()=>({correct:true}),recordSession:async()=>({}),
            getSession:gate('getSession'),
            pauseSession:gate('pause'),
            completeSession:gate('complete'),
            abandonSession:gate('abandon'),
            getReport:sessionId=>Promise.resolve({sessionId,resultLabel:'模拟考试结果：PASS',passed:true,scorePercent:88,passPercent:60,overallBand:'target',
              counts:{total:10,answered:9,correct:8,wrong:1,unanswered:1},domainWeights:{people:50,process:50},
              domains:{people:{weight:50,total:5,answered:5,correct:5,wrong:0,unanswered:0,scorePercent:100,performanceBand:'aboveTarget'},
                       process:{weight:50,total:5,answered:4,correct:3,wrong:1,unanswered:1,scorePercent:75,performanceBand:'target'}},
              wrongQuestionIds:['question-1'],durationMs:60000,official:false,disclaimer:'幻谱模拟判定'}),
            // 阶段一无 startSession => startPractice 走目录读取路径（KGPublishedPaperRepository），
            // 目录解析 Promise 由 __challengePending 闸门控制；阶段二再装上 startSession 切到会话路径。
            getActiveSessions:async filters=>{const s=window.__getActiveSession();return s&&(!filters?.mode||filters.mode===s.mode)?[s]:[]},
            listSessions:async()=>[{paperId:'paper-loading',paperName:'加载测试卷',answered:10,correct:8,endedAt:Date.now(),status:'completed'}],
            clearSessions:async()=>{}
          };
          ['pause','complete','abandon','getSession'].forEach(name=>{
            const Key=name[0].toUpperCase()+name.slice(1);
            window['__resolve'+Key]=payload=>{
              const item=window['__'+name+'Pending'].shift();
              if(item)item.resolve(payload===undefined?baseSession():payload);
            };
            window['__reject'+Key]=error=>{
              const item=window['__'+name+'Pending'].shift();
              if(item)item.reject(error||new Error('mock rejection'));
            };
          });
          // 本地交互哨兵：记录生命周期端点调用，作答/切题/跳题后必须为空
          window.__lifecycleProbe=[];
          ['pauseSession','completeSession','abandonSession','getSession'].forEach(name=>{
            const original=window.KGPracticeLearningApi[name];
            window.KGPracticeLearningApi[name]=async(...args)=>{
              window.__lifecycleProbe.push(name);
              return original.apply(window.KGPracticeLearningApi,args);
            };
          });
          // 加载框观测与本地交互断言
          window.__watchLearningLoading=()=>{
            const node=document.querySelector('[data-learning-loading]');
            return {present:!!node,visible:!!node&&!node.hidden,title:(node&&node.querySelector('[data-learning-loading-title]')||{}).textContent||''};
          };
          window.__expectLearningHidden=()=>{
            const info=window.__watchLearningLoading();
            if(info.visible)throw new Error('本地交互不应出现公共加载框: '+info.title);
            return true;
          };
        }"""
    )
    page.add_style_tag(content=(ROOT / "styles/main.css").read_text(encoding="utf-8"))
    page.add_style_tag(content=(ROOT / "styles/practice-mode.css").read_text(encoding="utf-8"))
    page.add_style_tag(content=(ROOT / "styles/learning-loading.css").read_text(encoding="utf-8"))
    page.add_script_tag(content=(ROOT / "src/110-learning-loading.js").read_text(encoding="utf-8"))
    # 阶段二走会话 API：需要 session-core / answer-sheet / draft-state 模块
    for script in ["src/111-practice-session-core.js", "src/115-practice-mode-policy.js", "src/112-practice-answer-sheet.js",
                   "src/113-practice-result-report.js", "src/116-practice-session-save.js", "src/117-question-answer-set.js", "src/114-practice-draft-state.js", "src/118-revenge-entry-policy.js"]:
        page.add_script_tag(content=(ROOT / script).read_text(encoding="utf-8"))
    page.add_script_tag(content=(ROOT / "src/100-practice-mode.js").read_text(encoding="utf-8"))
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
    page.wait_for_timeout(50)

    def settle(name, verb, payload=None):
        call = "window.__resolve" if verb == "resolve" else "window.__reject"
        argument = "" if payload is None else payload
        page.evaluate(f"{call}{name[0].upper()}{name[1:]}({argument})")

    # ---------- 大厅本地交互零加载框 ----------
    page.locator('[data-paper-id="paper-loading"]').first.click()
    page.wait_for_timeout(60)
    assert page.evaluate("window.__expectLearningHidden()")
    page.locator('[name="practiceOrder"][value="random"]').check(force=True)
    page.wait_for_timeout(40)
    assert page.evaluate("window.__expectLearningHidden()")

    # ---------- key=start（目录读取路径）：从学习记录点击"再练一次"进入练习 ----------
    # 该行 data-history-mode 为 challenge，加载标题与大厅挑战入口一致（复用同一 startPractice）
    page.locator("#practiceHistoryOpenBtn").click()
    history_row = page.locator('[data-history-practice="paper-loading"]')
    history_row.wait_for()
    history_row.click()
    loading = page.locator("[data-learning-loading]")
    assert page.locator("[data-learning-loading]").count() == 1
    assert loading.is_visible()
    assert loading.locator("[data-learning-loading-title]").inner_text() == "正在进入练习模式"
    assert loading.locator("[data-learning-loading-message]").inner_text() == "正在读取试题…"
    assert page.evaluate("window.__challengeResolveCalls") == 1

    # 会话进行中重复调用（含 practice 别名）被 pendingRequestKey 拦截
    page.evaluate("window.KGPracticeMode.startPractice('practice')")
    page.wait_for_timeout(30)
    assert page.evaluate("window.__challengeResolveCalls") == 1

    page.evaluate("window.__challengePending.shift().reject(new Error('network unavailable'))")
    page.wait_for_function("document.querySelector('[data-learning-loading]').hidden")
    assert page.locator("#practiceToast").inner_text() == "试题读取失败，请稍后重试。"

    page.locator("#practiceHistoryOpenBtn").click()
    page.locator('[data-history-practice="paper-loading"]').click()
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

    # ---------- 会话内本地交互（作答 / 切题 / 抽屉跳题）零请求零加载框 ----------
    # 装上 startSession 后 startPractice 优先走会话 API 路径；目录仓储保留以维持大厅试卷数据
    page.evaluate("""()=>{
      const api=window.KGPracticeLearningApi;
      api.startSession=async input=>JSON.parse(JSON.stringify(window.__setActiveSession(window.__baseSession())));
      api.getSession=async id=>JSON.parse(JSON.stringify(window.__getActiveSession()));
      window.__setActiveSession(window.__baseSession());
      window.__lifecycleProbe=[];
    }""")
    page.evaluate("async()=>{await window.KGPracticeMode.startPractice('challenge')}")
    page.wait_for_timeout(150)
    assert page.evaluate("window.KGPracticeMode.snapshot().sessionId") == "ps-loading", page.evaluate("window.KGPracticeMode.snapshot()")
    assert page.locator("#practiceGame").is_visible()
    # 选择答案零写请求零加载框
    page.locator('[data-option-id="B"]').click()
    page.wait_for_timeout(160)
    assert page.evaluate("(window.__lifecycleProbe||[]).filter(n=>n!=='getSession').length===0"), page.evaluate("window.__lifecycleProbe")
    assert page.evaluate("window.__expectLearningHidden()")
    # 前后题切换零加载框
    page.locator("#practiceNextBtn").click()
    page.wait_for_timeout(120)
    page.locator("#practicePrevBtn").click()
    page.locator("#practiceNextBtn").click()
    page.wait_for_timeout(120)
    assert page.evaluate("(window.__lifecycleProbe||[]).filter(n=>n!=='getSession').length===0")
    assert page.evaluate("window.__expectLearningHidden()")
    # 答题卡抽屉打开零加载框（跳题断言由 practice-answer-sheet-browser.py 覆盖）
    page.locator("#practiceAnswerSheetMobileBtn").click()
    page.wait_for_timeout(320)
    assert page.evaluate("window.__expectLearningHidden()")
    page.locator("#practiceAnswerSheetDrawerClose").click()
    page.wait_for_timeout(120)

    # ---------- key=save：saveAndExit 延迟响应、双击防重入、500 失败恢复 ----------
    page.locator("#practiceExitBtn").click()
    save_button = page.locator("#practiceSaveExitBtn")
    save_button.click()
    info = page.evaluate("window.__watchLearningLoading()")
    assert info["visible"] is True and info["title"] == "正在保存进度", info
    assert "正在保存做题进度…" in page.locator("[data-learning-loading-message]").inner_text()
    assert save_button.is_disabled()
    assert page.evaluate("window.__pauseCalls") == 1
    save_button.click(force=True)
    page.wait_for_timeout(40)
    assert page.evaluate("window.__pauseCalls") == 1, "重复点击保存必须被 pendingRequestKey 拦截"
    settle("pause", "reject", "window.__statusError(500)")
    page.wait_for_function("document.querySelector('[data-learning-loading]').hidden")
    assert save_button.is_enabled(), "500 后必须恢复保存按钮"
    assert page.evaluate("document.body.dataset.practiceView") == "game"

    # 失败后退出弹窗保持开启（答案未保存）→ 直接再次点击同一"保存并退出"
    save_button.click()
    assert page.evaluate("window.__watchLearningLoading()")["visible"]
    assert page.evaluate("window.__pauseCalls") == 2
    settle("pause", "resolve")
    page.wait_for_function("document.body.dataset.practiceView === 'lobby'")
    assert loading.is_hidden()
    assert save_button.is_enabled()

    # ---------- key=reload：冲突横幅的"加载最新进度"走统一加载框 ----------
    # 上一轮保存成功已回大厅：冲突横幅仅在做题视图可见，先恢复会话再展开横幅
    page.evaluate(
        """async()=>{
          const api=window.KGPracticeLearningApi;
          api.getActiveSessions=async filters=>{const s=window.__getActiveSession();return s&&(!filters?.mode||filters.mode===s.mode)?[s]:[]};
          api.getSession=async id=>JSON.parse(JSON.stringify(window.__getActiveSession()));
          window.__setActiveSession(Object.assign(window.__baseSession(),{status:'paused'}));
          await window.KGPracticeMode.startPractice('challenge');
          // 恢复完成后把 getSession 换回可控闸门，供 reloadLatestSession 失败/成功分支使用
          window.__getSessionCalls=0;
          window.__reloadGatePending=[];
          api.getSession=async id=>{
            window.__getSessionCalls+=1;
            return new Promise((resolve,reject)=>window.__reloadGatePending.push({resolve,reject}));
          };
          document.getElementById('practiceSessionConflict').hidden=false;
        }"""
    )
    page.wait_for_function("document.body.dataset.practiceView === 'game'")
    reload_button = page.locator("#practiceSessionConflictReload")
    reload_button.click()
    page.wait_for_function("window.__watchLearningLoading().title === '正在加载最新进度' && document.querySelector('[data-learning-loading]').hidden === false")
    assert "正在同步服务器上的最新做题记录…" in page.locator("[data-learning-loading-message]").inner_text()
    assert page.evaluate("window.__getSessionCalls") == 1, "reloadLatestSession 必须先拉取服务端最新会话"
    # 失败分支：拒绝受控 Promise → 加载框收起、按钮恢复、toast 提示
    page.evaluate("""()=>{const g=window.__reloadGatePending.shift();if(g)g.reject(new Error('network unavailable'))}""")
    page.wait_for_function("document.querySelector('[data-learning-loading]').hidden")
    assert reload_button.is_enabled(), "网络异常后必须恢复加载最新进度按钮"
    assert "最新进度加载失败" in page.locator("#practiceToast").inner_text()

    # 冲突刷新成功分支：resolve gated getSession → 恢复到最新做题视图且加载框收起
    reload_button.click()
    assert page.evaluate("window.__getSessionCalls") == 2, "第二次 reload 必须再次调用 getSession"
    page.evaluate("""()=>{const g=window.__reloadGatePending.shift();if(g)g.resolve(window.__getActiveSession())}""")
    page.wait_for_function("document.querySelector('[data-learning-loading]').hidden")
    assert page.evaluate("document.body.dataset.practiceView") == "game"

    # ---------- key=report：学习记录点"查看成绩"读取报告走统一加载框 ----------
    # 此处 api.getSession 已被换回可控闸门（reload 阶段），resolve 后 getReport 同步返回 → 加载框收起
    page.evaluate(
        """()=>{
          window.KGPracticeLearningApi.listSessions=async()=>[{paperId:'paper-loading',paperName:'加载测试卷',answered:10,correct:8,endedAt:Date.now(),status:'completed',reportAvailable:true,sessionId:'ps-done'}];
          window.KGPracticeMode.showLobby();
        }"""
    )
    page.wait_for_function("document.body.dataset.practiceView === 'lobby'")
    page.locator("#practiceHistoryOpenBtn").click()
    report_row = page.locator('[data-history-session="ps-done"]')
    report_row.wait_for()
    report_row.click()
    page.wait_for_function("window.__watchLearningLoading().visible === true && window.__watchLearningLoading().title === '正在打开成绩报告'")
    assert "正在读取历史成绩…" in page.locator("[data-learning-loading-message]").inner_text()
    page.evaluate("window.__setActiveSession(window.__baseSession({id:'ps-done',status:'completed'}))")
    page.evaluate("""()=>{const g=window.__reloadGatePending.shift();if(g)g.resolve(JSON.parse(JSON.stringify(window.__getActiveSession())))}""")
    page.wait_for_function("document.querySelector('[data-learning-loading]').hidden")
    assert loading.is_hidden()

    # 失败路径（409）：拒绝受控 Promise → 关闭加载框并给出既有失败文案
    # （上一轮成功后已跳到 result 视图且抽屉被关闭，先回大厅再打开学习记录抽屉）
    page.evaluate("window.KGPracticeMode.showLobby()")
    page.wait_for_function("document.body.dataset.practiceView === 'lobby'")
    page.locator("#practiceHistoryOpenBtn").click()
    page.wait_for_timeout(120)
    page.locator('[data-history-session="ps-done"]').click()
    page.wait_for_function("window.__watchLearningLoading().visible === true && window.__watchLearningLoading().title === '正在打开成绩报告'")
    page.evaluate("""()=>{const g=window.__reloadGatePending.shift();if(g)g.reject(window.__statusError(409))}""")
    page.wait_for_function("document.querySelector('[data-learning-loading]').hidden")
    assert loading.is_hidden()
    assert "成绩报告暂时无法打开" in page.locator("#practiceToast").inner_text()
    page.locator("#practiceHistoryCloseBtn").click()
    page.wait_for_timeout(120)

    # ---------- key=abandon：放弃练习延迟、双击防重入、500 失败恢复 ----------
    # （getSession 已换成可控闸门，这里先直连返回活动会话，保证 startPractice 能恢复）
    page.evaluate(
        """async()=>{
          const api=window.KGPracticeLearningApi;
          api.getSession=async id=>JSON.parse(JSON.stringify(window.__getActiveSession()));
          window.__setActiveSession(window.__baseSession());
          await window.KGPracticeMode.startPractice('challenge');
          if(document.body.dataset.practiceView!=='game')throw new Error('expected game view');
          document.getElementById('practiceExitBtn').click();
        }"""
    )
    abandon_button = page.locator("#practiceAbandonBtn")
    page.wait_for_function("document.getElementById('practiceHistoryDrawer').hidden")
    abandon_button.click()
    info = page.evaluate("window.__watchLearningLoading()")
    assert info["visible"] and info["title"] == "正在放弃练习", info
    assert "正在结束本次练习…" in page.locator("[data-learning-loading-message]").inner_text()
    assert abandon_button.is_disabled()
    assert page.evaluate("window.__abandonCalls") == 1
    abandon_button.click(force=True)
    page.wait_for_timeout(40)
    assert page.evaluate("window.__abandonCalls") == 1, "重复点击放弃必须被 pendingRequestKey 拦截"
    settle("abandon", "reject", "window.__statusError(500)")
    page.wait_for_function("document.querySelector('[data-learning-loading]').hidden")
    assert abandon_button.is_enabled(), "放弃失败后必须恢复按钮"
    assert page.evaluate("document.body.dataset.practiceView") == "game"

    # 500 失败后退出弹窗保持开启，直接再次点击"放弃本次练习"
    abandon_button.click()
    assert page.evaluate("window.__abandonCalls") == 2
    settle("abandon", "resolve")
    page.wait_for_function("document.body.dataset.practiceView === 'lobby'")
    assert loading.is_hidden()

    # ---------- key=complete：交卷延迟、双击防重入、网络异常恢复、成功出结果页 ----------
    page.evaluate(
        """()=>{
          window.KGPracticeLearningApi.getActiveSessions=async filters=>{const s=window.__getActiveSession();return s&&(!filters?.mode||filters.mode===s.mode)?[s]:[]};
          window.__setActiveSession(window.__baseSession({mode:'revenge'}));
        }"""
    )
    page.evaluate("window.KGPracticeMode.startPractice('revenge')")
    page.wait_for_function("document.body.dataset.practiceView === 'game'")
    page.locator("#practiceAnswerSheetMobileBtn").click()
    page.locator("[data-answer-submit]").click()
    submit_anyway = page.locator("#practiceSubmitAnywayBtn")
    submit_anyway.click()
    info = page.evaluate("window.__watchLearningLoading()")
    assert info["visible"] and info["title"] == "正在结算练习", info
    assert "正在生成成绩报告…" in page.locator("[data-learning-loading-message]").inner_text()
    assert submit_anyway.is_disabled()
    assert page.evaluate("window.__completeCalls") == 1
    page.evaluate("document.getElementById('practiceSubmitAnywayBtn').click()")  # DOM 直点验证防重入
    page.wait_for_timeout(40)
    assert page.evaluate("window.__completeCalls") == 1, "重复点击交卷必须被 pendingRequestKey 拦截"
    settle("complete", "reject", "new Error('offline')")
    page.wait_for_function("document.querySelector('[data-learning-loading]').hidden")
    assert submit_anyway.is_enabled(), "交卷网络失败后必须恢复按钮"
    assert page.evaluate("document.body.dataset.practiceView") == "game"

    # 成功分支：resolve 已完成 session + 完整 report，落 result 视图
    page.locator("#practiceSettlementRetry").click()
    assert page.evaluate("window.__completeCalls") == 2
    page.evaluate(
        """()=>{window.__resolveComplete({
          session:Object.assign(JSON.parse(JSON.stringify(window.__baseSession())),{status:'completed'}),
          report:{sessionId:'ps-loading',resultLabel:'模拟考试结果：PASS',passed:true,scorePercent:90,passPercent:60,overallBand:'target',
            counts:{total:10,answered:10,correct:9,wrong:1,unanswered:0},
            domainWeights:{people:50,process:50},
            domains:{people:{weight:50,total:5,answered:5,correct:5,wrong:0,unanswered:0,scorePercent:100,performanceBand:'aboveTarget'},
                     process:{weight:50,total:5,answered:5,correct:4,wrong:1,unanswered:0,scorePercent:80,performanceBand:'target'}},
            wrongQuestionIds:[],durationMs:60000,official:false,disclaimer:'幻谱模拟判定'}
        })}"""
    )
    page.wait_for_function("document.body.dataset.practiceView === 'result'")
    assert loading.is_hidden()

    # 收尾：全程不允许未处理 Promise 错误
    errors = page.evaluate("window.__pageErrors||[]")
    assert not errors, errors
    browser.close()

print("practice-challenge-loading-browser-ok")
