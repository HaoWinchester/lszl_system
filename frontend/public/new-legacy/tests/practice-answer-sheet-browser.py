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
# Task 6：折叠单实例答题卡与退出弹窗纵向等宽布局。
#   * 答题卡默认关闭；唯一入口 #practiceAnswerSheetMobileBtn 全宽度可见；
#   * 桌面（>=1024px）右上入口开右侧抽屉；窄屏开底部圆角抽屉；
#   * 题号切题 / 关闭按钮 / 遮罩 / Escape 后抽屉关闭且焦点回到入口；
#   * 反复开关不产生第二实例；
#   * 1280/1024/768/390px 下 #practiceExitConfirm 三按钮纵向等宽、不越界、不重叠。
# ---------------------------------------------------------------------------


def sheet_roots(page):
    return page.evaluate("()=>document.querySelectorAll('[aria-label=\"答题概览\"]').length")


def assert_sheet_closed(page):
    assert page.locator("#practiceAnswerSheetDrawer").is_hidden()
    assert not page.locator("#practiceAnswerSheet").is_visible()


def open_sheet(page):
    page.locator("#practiceAnswerSheetMobileBtn").click()
    # 等待抽屉滑入动画（0.22s）结束，避免测量到中间态位置
    page.wait_for_timeout(320)
    assert page.locator("#practiceAnswerSheetDrawer").is_visible()


def jump_via_sheet(page, selector_suffix):
    """答题卡已折叠进抽屉：先开抽屉再点击题号/交卷；跳题路径自身会关闭抽屉。"""
    open_sheet(page)
    page.locator(f"#practiceAnswerSheet {selector_suffix}").first.click()
    page.wait_for_timeout(80)


def close_via(page, how):
    if how == "close":
        page.locator("#practiceAnswerSheetDrawerClose").click()
    elif how == "backdrop":
        page.evaluate(
            "()=>document.getElementById('practiceAnswerSheetDrawer').dispatchEvent(new MouseEvent('click',{bubbles:true}))"
        )
    elif how == "escape":
        page.keyboard.press("Escape")
    else:
        raise ValueError(how)
    page.wait_for_timeout(80)
    assert_sheet_closed(page)
    focused = page.evaluate("()=>document.activeElement?.id||''")
    assert focused == "practiceAnswerSheetMobileBtn", focused
    assert page.locator("#practiceAnswerSheetMobileBtn").get_attribute("aria-expanded") == "false"


def exit_dialog_rows(page):
    return page.evaluate(
        """()=>{
          const dialog=document.querySelector('#practiceExitConfirm .practice-exit-dialog');
          const content=dialog.getBoundingClientRect();
          const buttons=Array.from(dialog.querySelectorAll(':scope > div > button:not([hidden])')).map(button=>{
            const rect=button.getBoundingClientRect();
            return {x:rect.x,y:rect.y,width:rect.width,right:rect.right,height:rect.height};
          });
          return {contentX:content.x,contentRight:content.right,buttons};
        }"""
    )


def assert_exit_dialog_geometry(rows):
    buttons = rows["buttons"]
    assert len(buttons) == 3, buttons
    for button in buttons:
        assert button["x"] >= rows["contentX"] - 0.5, (button, rows["contentX"])
        assert button["right"] <= rows["contentRight"] + 0.5, (button, rows["contentRight"])
    widths = [round(button["width"], 3) for button in buttons]
    assert max(widths) - min(widths) < 1.0, widths
    ordered = sorted(buttons, key=lambda item: item["y"])
    assert [round(item["y"]) for item in ordered] == sorted(round(item["y"]) for item in buttons)
    for first, second in zip(ordered, ordered[1:]):
        assert second["y"] >= first["y"] + first["height"] - 0.5, (first, second)


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
          const allRefs=Array.from({length:30},(_,offset)=>({questionId:'q'+(offset+1),bankId:'bank-1',mistakeId:'mistake-'+(offset+1),orderIndex:offset,domain:offset<12?'people':offset<27?'process':'business-environment',question:question(offset+1)}));
          const fullRefs=allRefs.slice(0,10);
          const sessionRefs=(count=10)=>allRefs.slice(0,count).map(ref=>({...ref,question:JSON.parse(JSON.stringify(ref.question))}));
          let session=null;
          let report=null;
          let sequence=0;
          const normalize=()=>JSON.parse(JSON.stringify(session));
          window.__supersedeSession=()=>{if(session)session.releaseId='release-v1-superseded'};
          window.__writes=[];
          window.__conflictNext=false;
          window.__pauseFailNext=false;
          window.__completeCalls=[];
          window.__revengeStats={active:10,pending:9,needsRemediation:1,verificationDue:0,mastered:0};
          const record=(name,body)=>{window.__writes.push({name,body:JSON.parse(JSON.stringify(body||{}))})};
          // 记录每个已被显式保存过的会话，供后续按模式恢复
          window.__pausedSnapshots={};
          window.__findResumable=filters=>Object.values(window.__pausedSnapshots).filter(s=>!filters?.mode||s.mode===filters.mode);
          const refFor=qid=>session.questions.find(item=>item.questionId===qid);
          window.KGAuthCore={currentUser:()=>({username:'student-1',role:'student'})};
          window.KGPracticeLearningApi={
            stats:()=>JSON.parse(JSON.stringify(window.__revengeStats)),active:()=>[],refresh:async()=>({}),
            getActiveSessions:async filters=>session&&['active','paused'].includes(session.status)&&(!filters?.mode||filters.mode===session.mode)&&(!filters?.releaseId||filters.releaseId===session.releaseId)?[normalize()]:[],
            getSession:async id=>window.__pausedSnapshots[id]?JSON.parse(JSON.stringify(window.__pausedSnapshots[id])):(session?normalize():null),
            startSession:async input=>{record('start',input);const refs=sessionRefs(input.mode==='revenge'?input.count:10);const total=refs.length;session={id:'ps-'+(++sequence),paperId:input.mode==='revenge'?null:input.paperId,releaseId:input.mode==='revenge'?null:input.releaseId,mode:input.mode,status:'active',revision:1,questions:refs,questionOrder:refs.map(({question,...ref})=>ref),answers:{},runtimeState:{currentIndex:0,order:input.order,health:input.mode==='challenge'?3:3,streak:0,experience:0,durationMs:0},stats:{total,answered:0,correct:0,wrong:0,unanswered:total,experience:0,durationMs:0}};return normalize()},
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
              if(window.__completeFailNext){window.__completeFailNext=false;throw new Error('temporary completion failure')}
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
          window.__catalog=[{id:'paper-1',paperId:'paper-1',releaseId:'release-1',version:1,name:'PMP 模拟卷',subject:'PMP',status:'published',questionCount:10,totalCount:10,accessPolicy:{accessLevel:'free'}}];
          window.KGPublishedPaperRepository={listCatalogEntries:()=>window.__catalog};
          window.KGPaperAccessService={inspect:()=>({allowed:true,accessLevel:'free'})};
          window.KGQuestionCatalogAdapter={ready:Promise.resolve()};
          window.KGLearningLoading={show:()=>{},hide:()=>{}};
          window.KGActivitySchemaV1={getPracticeAutoExplain:()=>window.__autoExplain!==false,getLanguageMode:()=>window.__lang||'zh',setPracticeAutoExplain:value=>{window.__autoExplain=value},setLanguageMode:value=>{window.__lang=value;window.dispatchEvent(new CustomEvent('kg:question-language-mode'))}};
          window.KGFreeModeLanguage={};
          window.fetch=async(url,options={})=>{
            record('fetch',{url:String(url)});
            return new Response('{}',{status:200,headers:{'content-type':'application/json'}});
          };
        }"""
    )
    for stylesheet in ["styles/main.css", "styles/practice-mode.css"]:
        page.add_style_tag(content=(ROOT / stylesheet).read_text(encoding="utf-8"))
    for script in ["src/111-practice-session-core.js", "src/115-practice-mode-policy.js", "src/112-practice-answer-sheet.js", "src/113-practice-result-report.js", "src/116-practice-session-save.js", "src/114-practice-draft-state.js", "src/118-revenge-entry-policy.js", "src/100-practice-mode.js"]:
        page.add_script_tag(content=(ROOT / script).read_text(encoding="utf-8"))
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
    page.wait_for_timeout(120)

    # 普通练习从历史进入；可重做，无生命/时间，解析由统一开关控制。
    page.evaluate("KGPracticeLearningApi.listSessions=async()=>[{sessionId:'old-round',paperId:'paper-1',paperName:'PMP 模拟卷',mode:'challenge',answered:10,correct:8,status:'completed',createdAt:new Date().toISOString(),reportAvailable:false}]")
    page.locator('#practiceHistoryOpenBtn').click()
    for width in (1280, 390):
        page.set_viewport_size({"width": width, "height": 900})
        page.wait_for_timeout(200)
        progress = page.locator('.practice-history-row.is-paper > div:first-child > span')
        assert progress.is_visible()
        assert "已答 10 题" in progress.inner_text()
        assert page.locator('.practice-history-row').evaluate("el => el.scrollWidth <= el.clientWidth + 1")
        page.screenshot(path=f"/tmp/practice-history-{width}.png")
    page.set_viewport_size({"width": 1280, "height": 900})
    page.locator('[data-history-practice]').first.click()
    assert page.evaluate('KGPracticeMode.snapshot().mode') == 'practice'
    assert page.locator('#practiceHealth').is_hidden()
    assert page.locator('#practiceTimeRow').is_hidden()
    assert page.locator('#practiceExplanationPanel').is_hidden()
    page.evaluate('window.__writes=[]')
    page.locator('[data-option-id="B"]').click()
    page.wait_for_timeout(700)
    assert page.evaluate('KGPracticeMode.snapshot().index') == 0
    assert page.locator('#practiceExplanationPanel').is_visible()
    assert page.locator('#practiceExplanationReveal').count() == 0
    page.locator('#practiceAutoExplain').uncheck()
    assert page.locator('#practiceExplanationPanel').is_hidden()
    page.locator('#practiceAutoExplain').check()
    assert page.locator('#practiceExplanationPanel').is_visible()
    page.locator('#practiceNextBtn').click()
    assert page.locator('#practiceExplanationPanel').is_hidden()
    page.locator('#practicePrevBtn').click()
    assert page.locator('[data-option-id="B"]').is_disabled()
    assert page.locator('#practiceExplanationPanel').is_visible()
    assert writes(page) == []
    page.locator('#practiceExitBtn').click()
    page.locator('#practiceSaveExitBtn').click()
    page.wait_for_timeout(200)
    page.evaluate('KGPracticeLearningApi.listSessions=async()=>[]')

    # ---------- challenge：作答与导航零写请求 ----------
    page.locator('[data-practice-start="challenge"]').click()
    page.wait_for_timeout(200)
    assert page.locator("#practiceGame").is_visible(), page.evaluate("document.body.dataset.practiceView")

    # 隐藏的兼容 DOM 也必须遵守模式策略，不能绕过入口提前交卷。
    before_complete = names(page).count('complete')
    page.evaluate("document.getElementById('practiceSubmitAnywayBtn').click()")
    page.wait_for_timeout(100)
    assert names(page).count('complete') == before_complete

    # ---------- Task 6：答题卡单实例默认关闭，桌面 1280px 无常驻预留 ----------
    assert sheet_roots(page) == 1
    assert not page.locator("#practiceAnswerSheetMobile").count()
    assert page.locator("#practiceAnswerSheetMobileBtn").is_visible()
    assert page.locator("#practiceAnswerSheetMobileBtn").get_attribute("aria-expanded") == "false"
    assert_sheet_closed(page)
    question_card_box = page.locator("#practiceQuestionCard").bounding_box()
    game_box = page.locator("#practiceGame").bounding_box()
    assert question_card_box["width"] <= game_box["width"] + 0.5, (question_card_box, game_box)
    sheet_gutter = (game_box["x"] + game_box["width"]) - (question_card_box["x"] + question_card_box["width"])
    assert abs(sheet_gutter) < 1.0, (sheet_gutter, question_card_box, game_box)

    # 桌面 1280px：开关与语言切换同一行（topbar 单行、无换行）且位于最右
    # topbar 为 align-items:center 的单行 grid，按钮高度不同（34/26），用垂直中心判断是否同排
    toggle_box = page.locator("#practiceAnswerSheetMobileBtn").bounding_box()
    language_box = page.locator("#practiceLanguageCycle").bounding_box()
    toggle_center_y = toggle_box["y"] + toggle_box["height"] / 2
    language_center_y = language_box["y"] + language_box["height"] / 2
    assert abs(toggle_center_y - language_center_y) <= 2.0, (toggle_box, language_box)
    assert toggle_box["x"] >= language_box["x"], (toggle_box, language_box)
    assert toggle_box["x"] + toggle_box["width"] >= language_box["x"] + language_box["width"] - 1.0, (
        toggle_box, language_box,
    )

    # 桌面右上入口打开右侧抽屉；反复开关不出现第二实例
    open_sheet(page)
    assert sheet_roots(page) == 1
    drawer_box = page.locator("#practiceAnswerSheetDrawer .practice-drawer").bounding_box()
    viewport_width = page.evaluate("()=>window.innerWidth")
    viewport_height = page.evaluate("()=>window.innerHeight")
    drawer_right = drawer_box["x"] + drawer_box["width"]
    assert drawer_right >= viewport_width - 1.5, (drawer_box, viewport_width)
    assert drawer_box["y"] <= 1.5 and drawer_box["height"] >= viewport_height * 0.6, drawer_box
    sheet_in_drawer = page.evaluate(
        "()=>document.querySelector('#practiceAnswerSheet').closest('#practiceAnswerSheetDrawer')!==null"
    )
    assert sheet_in_drawer
    assert page.locator("#practiceAnswerSheet [data-question-id]").count() == 10

    # 点击题号切题并统一关闭抽屉
    page.locator('#practiceAnswerSheet [data-question-id="q4"]').click()
    page.wait_for_timeout(100)
    assert "第 4 道题" in page.locator("#practiceQuestionStem").inner_text()
    assert_sheet_closed(page)
    assert page.locator("#practiceAnswerSheetMobileBtn").get_attribute("aria-expanded") == "false"
    # 切题后焦点策略：题号点击后焦点自然留在入口按钮（关闭路径不强制，但抽屉必须关）
    open_sheet(page)
    close_via(page, "close")
    open_sheet(page)
    close_via(page, "escape")
    open_sheet(page)
    close_via(page, "backdrop")
    # 反复开关仍只有一个实例
    assert sheet_roots(page) == 1

    # 回到第 1 题，保持既有流程假设（未答题从 q2 继续）
    open_sheet(page)
    page.locator('#practiceAnswerSheet [data-question-id="q1"]').click()
    page.wait_for_timeout(100)
    assert_sheet_closed(page)
    assert "第 1 道题" in page.locator("#practiceQuestionStem").inner_text()

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
    # 挑战回看也不展示解析或单独按钮。
    assert page.locator("#practiceExplanationReveal").count() == 0
    assert page.locator("#practiceExplanationPanel").is_hidden()
    for question_id in ["q4", "q7"]:
        jump_via_sheet(page, f'[data-question-id="{question_id}"]')
        assert_sheet_closed(page)
    page.wait_for_timeout(150)
    assert "第 7 道题" in page.locator("#practiceQuestionStem").inner_text()
    assert writes(page) == [], writes(page)
    assert "错误" in (page.locator('#practiceAnswerSheet [data-question-id="q1"]').get_attribute("aria-label") or "")
    # 答题卡跳到已答题 q7 会自动展开解析；跳到未答题 q4 后面板收起
    assert page.locator("#practiceExplanationPanel").is_hidden()

    # q7 本地判错：立即锁定选项与答题卡错误标记（反馈推进期间仍可见）；
    # 挑战模式不再自动弹解析（面板保持 hidden，仅答题卡跳回该题才展开）
    page.locator('[data-option-id="B"]').click()
    page.wait_for_timeout(100)
    assert "is-wrong" in (page.locator('[data-option-id="B"]').get_attribute("class") or "")
    assert page.locator("#practiceExplanationPanel").is_hidden(), page.locator("#practiceExplanationPanel").inner_text()
    assert "错误" in (page.locator('#practiceAnswerSheet [data-question-id="q7"]').get_attribute("aria-label") or "")
    page.wait_for_timeout(600)

    # 答题卡跳回已答题 q7：自动展开该题解析
    jump_via_sheet(page, '[data-question-id="q7"]')
    assert page.locator("#practiceExplanationPanel").is_hidden()
    # 答题卡跳到未答题：面板收起（不留旧题内容），选项可作答
    jump_via_sheet(page, '[data-question-id="q2"]')
    assert page.locator("#practiceExplanationPanel").is_hidden()
    assert page.locator("#practiceOptions button[disabled]").count() == 0

    # 挑战无交卷入口；不能打开旧确认框。
    open_sheet(page)
    assert page.locator('#practiceAnswerSheet [data-answer-submit]').count() == 0
    close_via(page, "close")
    assert names(page).count("complete") == 0

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
    assert set(pause_body["answers"].keys()) == {'q1', 'q7'}, sorted(pause_body["answers"].keys())
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
    assert page.locator("#practiceExplanationPanel").is_hidden()
    assert page.locator("#practiceExplanationReveal").count() == 0

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

    # 学霸计时器到期后推进到下一题：解析面板不出现（无遗留内容/按钮）
    page.evaluate("window.__writes=[]")
    page.wait_for_timeout(200)
    assert page.locator("#practiceExplanationPanel").is_hidden()
    assert not page.locator("#practiceExplanationReveal").count()

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

    # ---------- revenge 入口：题量独立、完整统计、规则浮层 ----------
    page.evaluate("""()=>{
      window.__catalog=[{id:'paper-large',paperId:'paper-large',releaseId:'release-large',version:1,name:'大题量试卷',subject:'PMP',status:'published',questionCount:180,totalCount:180,accessPolicy:{accessLevel:'free'}}];
      window.KGPracticeLearningApi.getActiveSessions=async()=>[];
      window.__revengeStats={active:1,pending:1,needsRemediation:0,verificationDue:0,mastered:0};
      window.KGPracticeMode.showLobby();
    }""")
    page.wait_for_timeout(100)
    # 普通练习选择 60 题，复仇只有 1 题时仍自动发送 count=1。
    page.locator('label:has([name="practiceCount"][value="60"])').click()
    assert page.locator('#practiceRevengeActiveCount').inner_text() == '1'
    assert '全部 1 题' in page.locator('#practiceRevengeCountSummary').inner_text()
    assert page.locator('#practiceRevengeCountOptions').is_hidden()

    rule_trigger = page.locator('#practiceRevengeRuleTrigger')
    rule_tooltip = page.locator('#practiceRevengeRuleTooltip')
    rule_trigger.hover()
    assert rule_tooltip.is_visible()
    assert '跨试卷、跨版本和历史无版本' in rule_tooltip.inner_text()
    page.mouse.move(5, 5)
    page.wait_for_timeout(50)
    assert rule_tooltip.is_hidden()
    rule_trigger.focus()
    assert rule_tooltip.is_visible()
    page.keyboard.press('Escape')
    assert rule_tooltip.is_hidden()
    page.locator('body').click(position={"x": 6, "y": 6})
    rule_trigger.click()
    assert rule_tooltip.is_visible()
    page.locator('body').click(position={"x": 6, "y": 6})
    assert rule_tooltip.is_hidden()

    page.evaluate('window.__writes=[]')
    page.locator('[data-practice-start="revenge"]').click()
    page.wait_for_timeout(180)
    assert writes(page)[0] == {"name": "start", "body": {"mode": "revenge", "count": 1, "order": "paper"}}, writes(page)
    assert page.evaluate('KGPracticeMode.snapshot().questionCount') == 1
    page.locator('#practiceExitBtn').click()
    page.locator('#practiceAbandonBtn').click()
    page.wait_for_timeout(120)

    # 14 题默认 10，20 禁用，可切换为全部 14 题。
    page.evaluate("""()=>{window.__revengeStats={active:14,pending:1,needsRemediation:1,verificationDue:12,mastered:3};window.KGPracticeMode.showLobby();window.__writes=[]}""")
    page.wait_for_timeout(100)
    assert page.locator('#practiceRevengeActiveCount').inner_text() == '14'
    assert page.locator('#practiceRevengeVerificationCount').inner_text() == '12'
    assert page.locator('[name="practiceRevengeCount"][value="10"]').is_checked()
    assert page.locator('[name="practiceRevengeCount"][value="20"]').is_disabled()
    page.locator('label:has([name="practiceRevengeCount"][value="14"])').click()
    page.locator('[data-practice-start="revenge"]').click()
    page.wait_for_timeout(180)
    assert writes(page)[0]["body"]["count"] == 14, writes(page)
    assert page.evaluate('KGPracticeMode.snapshot().questionCount') == 14
    page.locator('#practiceExitBtn').click()
    page.locator('#practiceAbandonBtn').click()
    page.wait_for_timeout(120)

    # 29 题可以选择本次 20 题。
    page.evaluate("""()=>{window.__revengeStats={active:29,pending:10,needsRemediation:4,verificationDue:15,mastered:0};window.KGPracticeMode.showLobby();window.__writes=[]}""")
    page.wait_for_timeout(100)
    page.locator('label:has([name="practiceRevengeCount"][value="20"])').click()
    page.locator('[data-practice-start="revenge"]').click()
    page.wait_for_timeout(180)
    assert writes(page)[0]["body"]["count"] == 20, writes(page)
    page.locator('#practiceExitBtn').click()
    page.locator('#practiceAbandonBtn').click()
    page.wait_for_timeout(120)

    # 后续复仇整卷交互沿用 10 题固定夹具。
    page.evaluate("""()=>{window.__catalog=[];window.__revengeStats={active:10,pending:9,needsRemediation:1,verificationDue:0,mastered:0};window.KGPracticeMode.showLobby()}""")
    page.wait_for_timeout(100)

    # ---------- revenge：本地推进补救/验证，不调用长期错题写路由 ----------
    page.evaluate("""()=>{
      window.__workingStartSession=window.KGPracticeLearningApi.startSession;
      window.KGPracticeLearningApi.startSession=async input=>{
        window.__writes.push({name:'start',body:JSON.parse(JSON.stringify(input))});
        throw Object.assign(new Error('damaged history'),{detail:{code:'REVENGE_SNAPSHOT_UNAVAILABLE',unavailableCount:2}});
      };
      window.__writes=[];
    }""")
    page.locator('[data-practice-start="revenge"]').click()
    page.wait_for_timeout(250)
    assert "历史错题内容暂不可用" in page.locator("#practiceToast").inner_text()
    assert page.locator('[data-practice-start="revenge"]').get_attribute("aria-busy") == "false"
    assert not page.locator('[data-practice-start="revenge"]').is_disabled()
    assert page.locator("#practiceLobby").is_visible()
    page.evaluate("""()=>{
      window.KGPracticeLearningApi.startSession=window.__workingStartSession;
      window.__writes=[];
    }""")
    page.evaluate("window.__writes=[]")
    page.locator('[data-practice-start="revenge"]').click()
    page.wait_for_timeout(300)
    revenge = page.evaluate("window.KGPracticeMode.snapshot()")
    assert revenge["mode"] == "revenge" and revenge["sessionId"], revenge
    assert revenge["view"] == "game"
    revenge_writes_before = writes(page)
    assert revenge_writes_before == [
        {"name": "start", "body": {"mode": "revenge", "count": 10, "order": "paper"}}
    ], revenge_writes_before

    # ---------- 复仇作答交互：答对停留看解析，手动下一题后再验证答错补救 ----------
    # mock 复仇题目正确答案 A；答对后超过旧 520ms 延迟仍停留当前题。
    page.evaluate("window.__writes=[]")
    page.locator('[data-option-id="A"]').click()
    page.wait_for_timeout(700)
    assert writes(page) == [], writes(page)
    assert page.evaluate("window.KGPracticeMode.snapshot().index") == 0
    assert page.locator("#practiceExplanationPanel").is_visible()
    assert "回答正确" in page.locator("#practiceExplanationHead").inner_text()
    assert "第 1 题解析" in page.locator("#practiceExplanationBody").inner_text()

    # 只有点击既有“下一题”按钮后才进入第二题，新题不提前显示解析。
    page.locator("#practiceNextBtn").click()
    assert page.evaluate("window.KGPracticeMode.snapshot().index") == 1
    assert page.locator("#practiceExplanationPanel").is_hidden()

    # 结束本轮后重新开始，避免已答对题进入后续验证题夹具。
    page.locator("#practiceExitBtn").click()
    page.locator("#practiceAbandonBtn").click()
    page.wait_for_timeout(120)
    page.evaluate("window.__writes=[]")
    page.locator('[data-practice-start="revenge"]').click()
    page.wait_for_timeout(180)
    revenge = page.evaluate("window.KGPracticeMode.snapshot()")
    assert revenge["index"] == 0

    # 第一题故意答错（选 B）触发既有补救分支。
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
    open_sheet(page)
    assert sheet_roots(page) == 1
    assert page.locator("#practiceAnswerSheet [data-question-id]").count() == 10
    # 底部圆角抽屉：贴住视口左右；backdrop 的 align-items:flex-end 把面板锚定在视口底缘
    mobile_drawer = page.locator("#practiceAnswerSheetDrawer .practice-drawer").bounding_box()
    assert abs(mobile_drawer["x"]) <= 1.5, mobile_drawer
    assert abs((mobile_drawer["y"] + mobile_drawer["height"]) - 844) <= 2.0, (mobile_drawer, 844)
    assert mobile_drawer["width"] >= 389, mobile_drawer
    close_via(page, "close")
    page.set_viewport_size({"width": 1440, "height": 960})
    page.wait_for_timeout(100)

    # ---------- Task 6：退出弹窗三按钮纵向等宽几何断言（1280/1024/768/390px） ----------
    for viewport_width, viewport_height in [(1280, 900), (1024, 768), (768, 900), (390, 844)]:
        page.set_viewport_size({"width": viewport_width, "height": viewport_height})
        page.wait_for_timeout(80)
        assert page.locator("#practiceGame").is_visible(), page.evaluate("document.body.dataset.practiceView")
        page.locator("#practiceExitBtn").click()
        page.wait_for_timeout(60)
        assert not page.locator("#practiceExitConfirm").get_attribute("hidden")
        try:
            assert_exit_dialog_geometry(exit_dialog_rows(page))
        finally:
            page.locator("#practiceExitCancel").click()
            page.wait_for_timeout(40)
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

    # 全局复仇会话不绑定试卷：换成另一份当前试卷后，仍应恢复同一会话。
    page.evaluate(
        """()=>{
          window.__catalog=[{id:'paper-2',paperId:'paper-2',releaseId:'release-2',version:1,name:'另一份试卷',subject:'PMP',status:'published',questionCount:10,totalCount:10,accessPolicy:{accessLevel:'free'}}];
          window.KGPracticeLearningApi.getActiveSessions=async filters=>window.__findResumable(filters);
          window.KGPracticeMode.showLobby();
        }"""
    )
    page.wait_for_timeout(120)
    revenge_start_button = page.locator('[data-practice-start="revenge"]')
    assert revenge_start_button.inner_text() == f'继续上次复仇 {len(revenge_answers)}/10'
    resumed_revenge = page.evaluate(
        """()=>{
          window.__writes=[];
          return window.KGPracticeMode.startPractice('revenge').then(()=>window.KGPracticeMode.snapshot());
        }"""
    )
    assert resumed_revenge["sessionId"] == revenge["sessionId"], resumed_revenge

    page.set_viewport_size({"width": 1440, "height": 960})
    page.wait_for_timeout(100)
    page.evaluate("window.__writes=[]")
    # 恢复最初显式保存过的挑战会话（mock 返回带整卷草稿的 paused 快照）
    resume_challenge = page.evaluate(
        """()=>{
          const api=window.KGPracticeLearningApi;
          window.__catalog=[{id:'paper-1',paperId:'paper-1',releaseId:'release-1',version:1,name:'PMP 模拟卷',subject:'PMP',status:'published',questionCount:10,totalCount:10,accessPolicy:{accessLevel:'free'}}];
          window.KGPracticeMode.showLobby();
          api.getActiveSessions=async filters=>window.__findResumable(filters).filter(s=>s.mode==='challenge');
          return window.KGPracticeMode.startPractice('challenge').then(()=>window.KGPracticeMode.snapshot());
        }"""
    )
    page.wait_for_timeout(200)
    assert resume_challenge["sessionId"] == saved_session_id, resume_challenge
    assert resume_challenge["answered"] == 2, resume_challenge
    page.evaluate("window.__writes=[]")
    page.evaluate('window.__completeFailNext=true')
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
        assert view == "game", "answer-sheet navigation must not be interrupted by a checkpoint"
        current_id = page.evaluate("()=>{const el=document.querySelector('#practiceAnswerSheet [aria-current=step]');return el?el.dataset.questionId:null}")
        if current_id != jump_target:
            jump_via_sheet(page, f'[data-question-id="{jump_target}"]')
            page.wait_for_timeout(100)
        page.locator("#practiceOptions button:not([disabled])").first.click()
        page.wait_for_timeout(620)

    page.wait_for_timeout(700)
    assert page.locator('#practiceSettlementRetry').is_visible()
    assert page.locator('#practiceGame').is_visible()
    page.locator('#practiceSettlementRetry').click()
    page.wait_for_timeout(200)
    complete_writes = [write for write in writes(page) if write["name"] == "complete"]
    assert len(complete_writes) == 2, writes(page)
    complete_body = complete_writes[-1]["body"]
    assert set(complete_body["answers"].keys()) == {'q%d' % i for i in range(1, 11)}, sorted(complete_body["answers"].keys())
    assert page.locator("#practiceResult").is_visible(), page.evaluate("document.body.dataset.practiceView")
    assert names(page).count("pause") + names(page).count("state") + names(page).count("answers") == 0, writes(page)
    # 交卷成功清除 dirty
    prevented_after_complete = page.evaluate("()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented}")
    assert prevented_after_complete is False

    assert not errors, errors
    browser.close()

print("practice-answer-sheet-browser-ok")
