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


# ---------------------------------------------------------------------------
# 全部走同一个 mock 后端：window.__writes 记录所有生命周期写请求。
# 新契约（本地即时判题）：
#   * 作答 / 导航 / 答题卡跳题 / 学霸超时 => __writes 保持不变；
#   * 保存退出      => 恰好一条 pause，body.answers 覆盖全部选择；
#   * 明确点击交卷  => 恰好一条 complete，body.answers 为整卷载荷；
#   * dirty 时 beforeunload 拦截；保存/交卷成功后不再拦截。
# ---------------------------------------------------------------------------


def writes(page):
    return page.evaluate("window.__writes")


def names(page):
    return [write["name"] for write in writes(page)]


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
          const fullRefs=Array.from({length:10},(_,offset)=>({questionId:'q'+(offset+1),bankId:'bank-1',mistakeId:'mistake-'+(offset+1),orderIndex:offset,domain:offset<4?'people':offset<9?'process':'business-environment',question:question(offset+1)}));
          const sessionRefs=()=>fullRefs.map(ref=>({...ref,question:JSON.parse(JSON.stringify(ref.question))}));
          let session=null;
          let report=null;
          let sequence=0;
          const normalize=()=>JSON.parse(JSON.stringify(session));
          window.__supersedeSession=()=>{if(session)session.releaseId='release-v1-superseded'};
          window.__writes=[];
          window.__conflictNext=false;
          window.__pauseFailNext=false;
          window.__completeCalls=[];
          const record=(name,body)=>{window.__writes.push({name,body:JSON.parse(JSON.stringify(body||{}))})};
          // 记录每个已被显式保存过的会话，供后续按模式恢复
          window.__pausedSnapshots={};
          window.__findResumable=filters=>Object.values(window.__pausedSnapshots).filter(s=>!filters?.mode||s.mode===filters.mode);
          const refFor=qid=>session.questions.find(item=>item.questionId===qid);
          window.KGAuthCore={currentUser:()=>({username:'student-1',role:'student'})};
          window.KGPracticeLearningApi={
            stats:()=>({active:3,pending:2,needsRemediation:1,mastered:0}),active:()=>[],refresh:async()=>({}),
            getActiveSessions:async filters=>session&&['active','paused'].includes(session.status)&&(!filters?.mode||filters.mode===session.mode)&&(!filters?.releaseId||filters.releaseId===session.releaseId)?[normalize()]:[],
            getSession:async id=>window.__pausedSnapshots[id]?JSON.parse(JSON.stringify(window.__pausedSnapshots[id])):(session?normalize():null),
            startSession:async input=>{session={id:'ps-'+(++sequence),paperId:input.paperId,releaseId:input.releaseId,mode:input.mode,status:'active',revision:1,questions:sessionRefs(),questionOrder:fullRefs.map(({question,...ref})=>ref),answers:{},runtimeState:{currentIndex:0,order:input.order,health:input.mode==='challenge'?3:3,streak:0,experience:0,durationMs:0},stats:{total:10,answered:0,correct:0,wrong:0,unanswered:10,experience:0,durationMs:0}};return normalize()},
            updateState:async(id,input)=>{record('state',input);if(input.revision!==session.revision)throw Object.assign(new Error('stale revision'),{status:409});session.runtimeState={...session.runtimeState,...input.runtimeState};session.revision+=1;return normalize()},
            answerSession:async(id,input)=>{record('answers',input);throw Object.assign(new Error('legacy per-question route must not be called'),{status:500})},
            pauseSession:async(id,input)=>{
              record('pause',input);
              if(window.__pauseFailNext){window.__pauseFailNext=false;throw Object.assign(new Error('offline'),{status:503})}
              if(input.revision!==session.revision)throw Object.assign(new Error('stale revision'),{status:409});
              Object.keys(input.answers||{}).forEach((qid)=>{
                const value=input.answers[qid];
                session.answers[qid]={questionId:qid,selectedAnswer:value.timedOut?'__timeout__':value.selectedAnswer,correctAnswer:'A',correct:(value.timedOut?'__timeout__':value.selectedAnswer)==='A',timedOut:value.timedOut===true};
                const ref=refFor(qid);if(ref)ref.question=fullRefs.find(item=>item.questionId===qid).question;
              });
              const values=Object.values(session.answers);
              session.stats={...session.stats,answered:values.length,correct:values.filter(item=>item.correct).length,wrong:values.filter(item=>!item.correct).length,unanswered:10-values.length};
              session.runtimeState={...session.runtimeState,...(input.runtimeState||{})};
              session.status='paused';session.revision+=1;window.__pausedSnapshots[session.id]=JSON.parse(JSON.stringify(session));return normalize();
            },
            abandonSession:async(id,input)=>{record('abandon',input);session.status='abandoned';session.revision+=1;return normalize()},
            completeSession:async(id,input)=>{
              record('complete',input);
              if(window.__completeCalls.length)return {session:normalize(),report};
              window.__completeCalls.push(input);
              if(input.revision!==session.revision)throw Object.assign(new Error('stale revision'),{status:409});
              Object.keys(input.answers||{}).forEach((qid)=>{
                const value=input.answers[qid];
                session.answers[qid]={questionId:qid,selectedAnswer:value.timedOut?'__timeout__':value.selectedAnswer,correctAnswer:'A',correct:(value.timedOut?'__timeout__':value.selectedAnswer)==='A',timedOut:value.timedOut===true};
                const ref=refFor(qid);if(ref)ref.question=fullRefs.find(item=>item.questionId===qid).question;
              });
              const values=Object.values(session.answers);
              session.stats={...session.stats,answered:values.length,correct:values.filter(item=>item.correct).length,wrong:values.filter(item=>!item.correct).length,unanswered:10-values.length};
              session.runtimeState={...session.runtimeState,...(input.runtimeState||{})};
              session.status='completed';session.revision+=1;
              const correctCount=values.filter(i=>i.correct).length;
              report={sessionId:session.id,resultLabel:'模拟考试结果：FAIL',passed:false,scorePercent:Math.round(correctCount*10),passPercent:60,overallBand:'needsImprovement',counts:{total:10,answered:values.length,correct:correctCount,wrong:values.length-correctCount,unanswered:10-values.length},domainWeights:{people:42,process:50,'business-environment':8},domains:{people:{weight:42,total:4,answered:4,correct:4,wrong:0,unanswered:0,scorePercent:100,performanceBand:'aboveTarget'},process:{weight:50,total:5,answered:5,correct:5,wrong:0,unanswered:0,scorePercent:100,performanceBand:'aboveTarget'},'business-environment':{weight:8,total:1,answered:1,correct:1,wrong:0,unanswered:0,scorePercent:100,performanceBand:'aboveTarget'}},wrongQuestionIds:[],durationMs:1000,official:false,disclaimer:'幻谱模拟判定，不代表 PMI 官方考试成绩'};
              return {session:normalize(),report};
            },
            getReport:async()=>JSON.parse(JSON.stringify(report)),
            listSessions:async()=>[],clearSessions:async()=>{},
          };
          // 旧逐题路由在这个前端里绝不允许被调用
          window.KGPracticeLearningApi.answer=async input=>{record('answers',input);throw new Error('/answers must not be called')};
          window.__defaultActiveSessions=window.KGPracticeLearningApi.getActiveSessions;
          window.KGPracticeLearningApi.upsertWrong=async input=>{record('upsertWrong',input);throw new Error('/mistakes must not be called during practice')};
          window.KGPracticeLearningApi.answerRevenge=async input=>{record('revengeAnswer',input);throw new Error('revenge answer must stay local until submission')};
          window.KGPublishedPaperRepository={listCatalogEntries:()=>[{id:'paper-1',paperId:'paper-1',releaseId:'release-1',version:1,name:'PMP 模拟卷',subject:'PMP',status:'published',questionCount:10,totalCount:10,accessPolicy:{accessLevel:'free'}}]};
          window.KGPaperAccessService={inspect:()=>({allowed:true,accessLevel:'free'})};
          window.KGQuestionCatalogAdapter={ready:Promise.resolve()};
          window.KGLearningLoading={show:()=>{},hide:()=>{}};
          window.KGActivitySchemaV1={getPracticeAutoExplain:()=>true,getLanguageMode:()=> 'zh',setPracticeAutoExplain:()=>{}};
          window.KGFreeModeLanguage={};
          window.fetch=async(url,options={})=>{
            record('fetch',{url:String(url)});
            return new Response('{}',{status:200,headers:{'content-type':'application/json'}});
          };
        }"""
    )
    for stylesheet in ["styles/main.css", "styles/practice-mode.css"]:
        page.add_style_tag(content=(ROOT / stylesheet).read_text(encoding="utf-8"))
    for script in ["src/111-practice-session-core.js", "src/112-practice-answer-sheet.js", "src/113-practice-result-report.js", "src/114-practice-draft-state.js", "src/100-practice-mode.js"]:
        page.add_script_tag(content=(ROOT / script).read_text(encoding="utf-8"))
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
    page.wait_for_timeout(120)

    # ---------- challenge：作答与导航零写请求 ----------
    page.locator('[data-practice-start="challenge"]').click()
    page.wait_for_timeout(200)
    assert page.locator("#practiceGame").is_visible(), page.evaluate("document.body.dataset.practiceView")

    page.evaluate("window.__writes=[]")
    page.locator('[data-option-id="B"]').click()
    page.wait_for_timeout(150)
    assert writes(page) == [], writes(page)
    assert "is-wrong" in (page.locator('[data-option-id="B"]').get_attribute("class") or "")
    assert "第 7 道题" not in page.locator("#practiceQuestionStem").inner_text()

    # 下一题 / 上一题 / 答题卡跳题全部零写请求
    page.locator("#practiceNextBtn").click()
    page.wait_for_timeout(120)
    page.locator("#practicePrevBtn").click()
    page.wait_for_timeout(120)
    assert writes(page) == [], writes(page)
    for question_id in ["q4", "q7"]:
        page.locator(f'#practiceAnswerSheet [data-question-id="{question_id}"]').click()
    page.wait_for_timeout(150)
    assert "第 7 道题" in page.locator("#practiceQuestionStem").inner_text()
    assert writes(page) == [], writes(page)
    assert "错误" in (page.locator('#practiceAnswerSheet [data-question-id="q1"]').get_attribute("aria-label") or "")

    # q7 本地判错：立即锁定选项、展示解析与答题卡错误标记（反馈推进期间仍可见）
    page.locator('[data-option-id="B"]').click()
    page.wait_for_timeout(100)
    assert "is-wrong" in (page.locator('[data-option-id="B"]').get_attribute("class") or "")
    assert "正确答案：A" in page.locator("#practiceExplanationPanel").inner_text()
    assert "错误" in (page.locator('#practiceAnswerSheet [data-question-id="q7"]').get_attribute("aria-label") or "")
    page.wait_for_timeout(600)
    assert page.locator("#practiceOptions button[disabled]").count() > 0 or "第 8 道题" in page.locator("#practiceQuestionStem").inner_text()

    # 未答确认弹窗路径：交卷按钮 -> 提示还有未答 -> 返回第一道未答题
    page.locator('#practiceAnswerSheet [data-answer-submit]').click()
    page.wait_for_timeout(80)
    assert page.locator("#practiceSubmitConfirm").is_visible()
    assert "未作答" in page.locator("#practiceSubmitMessage").inner_text()
    page.locator("#practiceSubmitReturnBtn").click()
    page.wait_for_timeout(150)
    assert "第 2 道题" in page.locator("#practiceQuestionStem").inner_text(), page.locator("#practiceQuestionStem").inner_text()
    assert names(page).count("complete") == 0, writes(page)

    # 把剩余 8 题答完（复习路径只经本地判题）：答完最后一题仍停留 game
    while True:
        answered_ids = page.evaluate(
            "()=>Array.from(document.querySelectorAll('#practiceAnswerSheet [data-question-id]')).filter(b=>b.className.includes('is-correct')||b.className.includes('is-wrong')).map(b=>b.dataset.questionId)"
        )
        if len(answered_ids) >= 10:
            break
        jump_target = page.evaluate(
            "()=>{const b=Array.from(document.querySelectorAll('#practiceAnswerSheet [data-question-id]')).find(el=>!el.className.includes('is-correct')&&!el.className.includes('is-wrong'));return b?b.dataset.questionId:null}"
        )
        assert jump_target, answered_ids
        view = page.evaluate("document.body.dataset.practiceView")
        if view == "checkpoint":
            page.locator("#practiceCheckpointContinue").click()
            page.wait_for_timeout(120)
            view = page.evaluate("document.body.dataset.practiceView")
        current_id = page.evaluate("()=>{const el=document.querySelector('#practiceAnswerSheet [aria-current=step]');return el?el.dataset.questionId:null}")
        if current_id != jump_target:
            page.locator(f'#practiceAnswerSheet [data-question-id="{jump_target}"]').click()
            page.wait_for_timeout(100)
        page.locator("#practiceOptions button:not([disabled])").first.click()
        page.wait_for_timeout(620)

    # 全部答完仍停留在 game（不自动交卷），且没有新的写请求
    page.wait_for_timeout(1200)
    assert page.locator("#practiceGame").is_visible(), page.evaluate("document.body.dataset.practiceView")
    assert not page.locator("#practiceResult").is_visible()
    assert names(page) == [], writes(page)

    # dirty 时原生离开提醒
    prevented_dirty = page.evaluate("()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented}")
    assert prevented_dirty is True

    # ---------- 保存退出：恰好一次 pause，整卷 answers、运行时状态齐全 ----------
    page.evaluate("window.__pauseFailNext=true")
    page.locator("#practiceExitBtn").click()
    page.locator("#practiceSaveExitBtn").click()
    page.wait_for_timeout(250)
    failed_pause_writes = [write for write in writes(page) if write["name"] == "pause"]
    assert len(failed_pause_writes) == 1, writes(page)
    saved_session_id = page.evaluate("window.KGPracticeMode.snapshot().sessionId")
    page.wait_for_timeout(50)
    # 失败后保持做题视图与 dirty（再次触发仍拦截）
    still_dirty = page.evaluate("()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented}")
    view_after_fail = page.evaluate("document.body.dataset.practiceView")
    page.locator("#practiceExitCancel").click()

    page.locator("#practiceExitBtn").click()
    page.locator("#practiceSaveExitBtn").click()
    page.wait_for_timeout(250)
    pause_writes = [write for write in writes(page) if write["name"] == "pause"]
    assert len(pause_writes) == 2, writes(page)
    pause_body = pause_writes[-1]["body"]
    assert set(pause_body["answers"].keys()) == {'q%d' % i for i in range(1, 11)}, sorted(pause_body["answers"].keys())
    assert all(answer.get("selectionIndex") >= 1 for answer in pause_body["answers"].values())
    assert set(pause_body.keys()) >= {"revision", "answers", "runtimeState"}
    q1_entry = pause_body["answers"]["q1"]
    assert q1_entry["selectedAnswer"] == "B" and q1_entry["selectionIndex"] == 1 and "correct" not in q1_entry
    assert page.locator("#practiceLobby").is_visible(), page.evaluate("document.body.dataset.practiceView")
    # 保存成功清除 dirty
    prevented_clean = page.evaluate("()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented}")
    assert prevented_clean is False

    # ---------- 恢复会话：服务端草稿在题目与答题卡回放本地判题结果 ----------
    page.evaluate("window.__writes=[]")
    page.locator('[data-practice-start="challenge"]').click()
    page.wait_for_timeout(300)
    resumed = page.evaluate("window.KGPracticeMode.snapshot()")
    assert resumed["sessionId"] == saved_session_id, resumed
    q1_class = page.locator('#practiceAnswerSheet [data-question-id="q1"]').get_attribute("class") or ""
    assert "is-wrong" in q1_class, q1_class
    assert "错误" in (page.locator('#practiceAnswerSheet [data-question-id="q1"]').get_attribute("aria-label") or "")

    # ---------- scholar：本地超时不调用 /answers，剩余时间进入 runtimeState ----------
    page.evaluate("window.__writes=[]")
    scholar = page.evaluate(
        """()=>{
          window.KGPracticeLearningApi.getActiveSessions=async()=>[];
          return window.KGPracticeMode.startPractice('scholar').then(()=>window.KGPracticeMode.snapshot());
        }"""
    )
    page.wait_for_timeout(200)
    assert scholar["mode"] == "scholar", scholar
    page.wait_for_timeout(450)
    # 学霸计时器到期：本地锁定并记为超时草稿；绝不出现 /answers 写请求
    assert all(write["name"] != "answers" for write in writes(page)), writes(page)
    timeout_states = page.evaluate("()=>({view:document.body.dataset.practiceView,feedback:document.querySelector('#practiceFeedback').textContent,classes:document.querySelector('#practiceOptions').className})")
    assert timeout_states["view"] == "game"
    deadline_snapshot = page.evaluate("window.KGPracticeMode.snapshot()")
    assert deadline_snapshot["mode"] == "scholar"

    page.locator("#practiceExitBtn").click()
    page.locator("#practiceSaveExitBtn").click()
    page.wait_for_timeout(250)
    scholar_pauses = [write for write in writes(page) if write["name"] == "pause"]
    assert len(scholar_pauses) == 1, writes(page)
    assert all(write["name"] != "answers" and write["name"] != "state" for write in writes(page)), writes(page)
    scholar_answers = scholar_pauses[-1]["body"]["answers"]
    timed_out_entries = [entry for entry in scholar_answers.values() if entry.get("timedOut")]
    if timed_out_entries:
        assert all(entry["selectedAnswer"] == "__timeout__" for entry in timed_out_entries), scholar_answers

    # ---------- revenge：本地推进补救/验证，不调用长期错题写路由 ----------
    page.evaluate("""()=>{
      window.KGPracticeLearningApi.getActiveSessions=async()=>[];
      window.KGPracticeMode.showLobby();
    }""")
    page.wait_for_timeout(100)
    page.evaluate("window.__writes=[]")
    page.locator('[data-practice-start="revenge"]').click()
    page.wait_for_timeout(300)
    revenge = page.evaluate("window.KGPracticeMode.snapshot()")
    assert revenge["mode"] == "revenge" and revenge["sessionId"], revenge
    assert revenge["view"] == "game"
    revenge_writes_before = writes(page)
    assert revenge_writes_before == [], revenge_writes_before

    # ---------- 复仇作答交互：真实点击选项，零写请求 + 本地反馈 ----------
    # mock 复仇题目正确答案 A；故意答错（选 B）触发补救分支
    page.evaluate("window.__writes=[]")
    page.locator('[data-option-id="B"]').click()
    page.wait_for_timeout(100)
    assert writes(page) == [], writes(page)
    assert "is-wrong" in (page.locator('[data-option-id="B"]').get_attribute("class") or "")
    assert "is-correct" in (page.locator('[data-option-id="A"]').get_attribute("class") or "")
    # 答错触发补救面板
    page.wait_for_timeout(600)
    remediation_visible = page.locator("#practiceRemediationPanel").is_visible()
    assert remediation_visible, page.evaluate("document.body.dataset.practiceView")

    # 本地验证题派生：点击"开始验证"后可作答另一道题，仍然零写请求
    page.locator("#practiceRemediationContinueBtn").click()
    page.wait_for_timeout(200)
    verification_active = page.evaluate("()=>document.body.dataset.practicePhase==='verification'")
    if verification_active:
        page.evaluate("window.__writes=[]")
        page.locator('[data-option-id="B"]').click()
        page.wait_for_timeout(100)
        assert writes(page) == [], writes(page)
        assert "is-wrong" in (page.locator('[data-option-id="B"]').get_attribute("class") or "")
        page.wait_for_timeout(800)

    # ---------- 移动端答题卡抽屉回归（复仇会话保持 active） ----------
    page.set_viewport_size({"width": 390, "height": 844})
    page.wait_for_timeout(120)
    assert page.locator("#practiceGame").is_visible(), page.evaluate("document.body.dataset.practiceView")
    assert page.locator("#practiceAnswerSheetMobileBtn").is_visible()
    page.locator("#practiceAnswerSheetMobileBtn").click()
    page.wait_for_timeout(80)
    assert page.locator("#practiceAnswerSheetDrawer").is_visible()
    assert page.locator("#practiceAnswerSheetMobile [data-question-id]").count() == 10
    page.locator("#practiceAnswerSheetDrawerClose").click()
    page.wait_for_timeout(60)
    assert page.locator("#practiceAnswerSheetDrawer").is_hidden()
    page.set_viewport_size({"width": 1440, "height": 960})
    page.wait_for_timeout(100)

    # 保存退出复仇会话：恰好一次 pause 且带上 runtimeState（含可能的复仇阶段）
    page.evaluate("window.__writes=[]")
    page.locator("#practiceExitBtn").click()
    page.locator("#practiceSaveExitBtn").click()
    page.wait_for_timeout(250)
    revenge_pauses = [write for write in writes(page) if write["name"] == "pause"]
    assert len(revenge_pauses) == 1, writes(page)
    assert all(write["name"] not in ("answers", "state", "revengeAnswer", "upsertWrong", "remediation", "verification") for write in writes(page)), writes(page)
    pause_body = revenge_pauses[-1]["body"]
    assert "runtimeState" in pause_body
    # 本地选择进入整卷载荷：包含刚才答错的那道题，且带合法 selectionIndex、无客户端真值
    revenge_answers = pause_body["answers"]
    assert len(revenge_answers) >= 1, revenge_answers
    assert all("correct" not in entry and entry.get("selectionIndex") >= 1 for entry in revenge_answers.values()), revenge_answers
    wrong_entries = [entry for entry in revenge_answers.values() if entry.get("selectedAnswer") == "B"]
    assert wrong_entries, revenge_answers
    # 若进入了补救/验证阶段，runtimeState 带上对应 phase 快照供恢复
    revenge_runtime = pause_body["runtimeState"]
    if verification_active:
        assert revenge_runtime.get("revengeState", {}).get("phase") in ("remediation", "verification"), revenge_runtime
    assert page.locator("#practiceLobby").is_visible(), page.evaluate("document.body.dataset.practiceView")

    page.set_viewport_size({"width": 1440, "height": 960})
    page.wait_for_timeout(100)
    page.evaluate("window.__writes=[]")
    # 恢复最初显式保存过的挑战会话（mock 返回带整卷草稿的 paused 快照）
    resume_challenge = page.evaluate(
        """()=>{
          const api=window.KGPracticeLearningApi;
          api.getActiveSessions=async filters=>window.__findResumable(filters).filter(s=>s.mode==='challenge');
          return window.KGPracticeMode.startPractice('challenge').then(()=>window.KGPracticeMode.snapshot());
        }"""
    )
    page.wait_for_timeout(200)
    assert resume_challenge["sessionId"] == saved_session_id, resume_challenge
    assert resume_challenge["answered"] == 10, resume_challenge
    page.evaluate("window.__writes=[]")
    # 整卷已答：答题卡交卷按钮直接提交（无未答确认框）
    page.locator('#practiceAnswerSheet [data-answer-submit]').click()
    page.wait_for_timeout(400)
    complete_writes = [write for write in writes(page) if write["name"] == "complete"]
    assert len(complete_writes) == 1, writes(page)
    complete_body = complete_writes[0]["body"]
    assert set(complete_body["answers"].keys()) == {'q%d' % i for i in range(1, 11)}, sorted(complete_body["answers"].keys())
    assert page.locator("#practiceResult").is_visible(), page.evaluate("document.body.dataset.practiceView")
    assert names(page).count("pause") + names(page).count("state") + names(page).count("answers") == 0, writes(page)
    # 交卷成功清除 dirty
    prevented_after_complete = page.evaluate("()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented}")
    assert prevented_after_complete is False

    assert not errors, errors
    browser.close()

print("practice-answer-sheet-browser-ok")
