#!/usr/bin/env python3
"""练习模式新功能浏览器测试：

1. 题目标记：标记按钮切换、答题卡 is-marked + legend、保存退出后恢复仍在。
2. 显示答案开关：仅 practice 非 reviewing 显示；开启后未答题锁定并中性回放答案；
   关闭后恢复可作答；恢复会话后开关状态保留。
3. 随机顺序恢复：沿用服务端冻结题序与 currentIndex，答题卡题号与显示顺序一致。
"""
from pathlib import Path
import re

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ARGS = ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]

SCRIPTS = [
    "src/111-practice-session-core.js",
    "src/115-practice-mode-policy.js",
    "src/112-practice-answer-sheet.js",
    "src/113-practice-result-report.js",
    "src/116-practice-session-save.js",
    "src/117-question-answer-set.js",
    "src/114-practice-draft-state.js",
    "src/118-revenge-entry-policy.js",
    "src/118-question-materials.js",
    "src/100-practice-mode.js",
    "src/practice/practice-answer-page.js",
]


def body_html():
    source = (ROOT / "practice-mode.html").read_text(encoding="utf-8")
    match = re.search(r"<body([^>]*)>([\s\S]*)</body>", source, re.I)
    return match.group(1), re.sub(r"<script[\s\S]*?</script>", "", match.group(2), flags=re.I)


def sheet_numbers(page):
    return page.evaluate(
        "()=>Array.from(document.querySelectorAll('#practiceAnswerSheet [data-question-id]')).map(b=>b.dataset.questionId)"
    )


def assert_mark_layout(page):
    stem = page.locator('#practiceQuestionStem')
    original = stem.inner_html()
    button = page.locator('#practiceMarkToggle')
    for width in [320, 360, 390, 430, 768, 800, 801, 1440]:
        page.set_viewport_size({"width": width, "height": 740})
        for content in ['项目经理下一步应该怎么做？', '项目经理正在协调多个团队完成项目，面对需求变更与资源限制，需要结合沟通记录判断下一步行动。' * 8]:
            stem.evaluate('(el, text) => el.textContent = text', content)
            for _ in range(2):
                mark_box = button.bounding_box()
                stem_box = stem.bounding_box()
                assert mark_box['y'] + mark_box['height'] <= stem_box['y'], (
                    f'{width}px 标记按钮遮挡题干', mark_box, stem_box
                )
                assert mark_box['x'] >= 0 and mark_box['x'] + mark_box['width'] <= width
                pressed = button.get_attribute('aria-pressed')
                button.click()
                assert button.get_attribute('aria-pressed') != pressed
    stem.evaluate('(el, html) => el.innerHTML = html', original)
    page.set_viewport_size({"width": 1440, "height": 960})


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
          const allRefs=Array.from({length:10},(_,offset)=>({questionId:'q'+(offset+1),bankId:'bank-1',orderIndex:offset,domain:'people',question:question(offset+1)}));
          let session=null,sequence=0;
          window.__pausedSnapshots={};
          const normalize=()=>JSON.parse(JSON.stringify(session));
          window.KGAuthCore={currentUser:()=>({username:'student-1',role:'student'})};
          window.KGPracticeLearningApi={
            stats:()=>({}),active:()=>[],refresh:async()=>({}),
            getPaperProgress:async()=>({modes:{}}),getRevengeSummary:async()=>({stats:{}}),
            getSession:async id=>window.__pausedSnapshots[id]?JSON.parse(JSON.stringify(window.__pausedSnapshots[id])):(session?normalize():null),
            enterSession:async input=>{
              const rows=session&&['active','paused'].includes(session.status)?[normalize()]:[];
              const found=rows.find(item=>item.mode===input.mode&&(input.mode==='revenge'||item.paperId===input.paperId));
              if(found){session=JSON.parse(JSON.stringify(found));return {resumed:true,session:normalize()}}
              const refs=JSON.parse(JSON.stringify(allRefs));
              session={id:'ps-seed-'+(++sequence),paperId:input.paperId||null,releaseId:input.releaseId||null,mode:input.mode,status:'active',revision:1,questions:refs,questionOrder:refs.map(({question,...ref})=>ref),answers:{},runtimeState:{currentIndex:0,order:input.order,health:3,streak:0,experience:0,durationMs:0},stats:{total:10,answered:0,correct:0,wrong:0,unanswered:10,experience:0,durationMs:0}};
              return {resumed:false,session:normalize()}
            },
            updateState:async(id,input)=>{session.runtimeState={...session.runtimeState,...input.runtimeState};session.revision+=1;return normalize()},
            pauseSession:async(id,input)=>{
              Object.keys(input.answers||{}).forEach(qid=>{session.answers[qid]={questionId:qid,selectedAnswer:input.answers[qid].selectedAnswer,correctAnswer:'A',correct:input.answers[qid].selectedAnswer==='A'}});
              session.runtimeState={...session.runtimeState,...(input.runtimeState||{})};
              session.status='paused';session.revision+=1;
              window.__pausedSnapshots[session.id]=JSON.parse(JSON.stringify(session));return normalize();
            },
            abandonSession:async(id,input)=>{session.status='abandoned';session.revision+=1;return normalize()},
            completeSession:async()=>{throw new Error('not needed')},
            getReport:async()=>null,
            listSessions:async()=>[],clearSessions:async()=>{},
          };
          window.__catalog=[{id:'paper-1',paperId:'paper-1',releaseId:'release-1',version:1,name:'PMP 模拟卷',subject:'PMP',status:'published',questionCount:10,totalCount:10,accessPolicy:{accessLevel:'free'}}];
          window.KGPublishedPaperRepository={listCatalogEntries:()=>window.__catalog};
          window.KGPaperAccessService={inspect:()=>({allowed:true,accessLevel:'free'})};
          window.KGQuestionCatalogAdapter={ready:Promise.resolve()};
          window.KGLearningLoading={show:()=>{},hide:()=>{}};
          window.KGActivitySchemaV1={getPracticeAutoExplain:()=>true,getLanguageMode:()=>window.__lang||'zh',setPracticeAutoExplain:()=>{},setLanguageMode:value=>{window.__lang=value;window.dispatchEvent(new CustomEvent('kg:question-language-mode'))}};
          window.KGFreeModeLanguage={};
        }"""
    )
    for stylesheet in ["styles/main.css", "styles/practice-mode.css", "styles/focus-vega-typography.css", "styles/learning-skin.css", "styles/question-materials.css", "styles/answer-page.css"]:
        page.add_style_tag(content=(ROOT / stylesheet).read_text(encoding="utf-8"))
    for script in SCRIPTS:
        page.add_script_tag(content=(ROOT / script).read_text(encoding="utf-8"))
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
    page.wait_for_timeout(120)

    # ---------- 场景 1：practice 模式标记 + 显示答案 ----------
    page.evaluate("KGPracticeLearningApi.listSessions=async()=>[{sessionId:'old-round',paperId:'paper-1',paperName:'PMP 模拟卷',mode:'challenge',answered:10,correct:8,status:'completed',createdAt:new Date().toISOString(),reportAvailable:false}]")
    page.locator('#practiceHistoryOpenBtn').click()
    page.locator('[data-history-practice]').first.click()
    page.wait_for_timeout(250)
    assert page.evaluate('KGPracticeMode.snapshot().mode') == 'practice'

    # 显示答案开关仅在 practice 非 reviewing 可见，默认关闭
    assert page.locator('#practiceShowAnswersToggle').is_visible()
    assert not page.locator('#practiceShowAnswers').is_checked()

    # 标记按钮可见；点击后按钮态切换
    assert page.locator('#practiceMarkToggle').is_visible()
    assert page.locator('#practiceMarkToggle').inner_text() == '标记本题'
    assert_mark_layout(page)
    page.locator('#practiceMarkToggle').click()
    assert page.locator('#practiceMarkToggle').inner_text() == '取消标记'
    assert page.locator('#practiceMarkToggle').get_attribute('aria-pressed') == 'true'

    # 答题卡显示标记
    page.locator('#practiceAnswerSheetMobileBtn').click()
    page.wait_for_timeout(320)
    q1_class = page.locator('#practiceAnswerSheet [data-question-id="q1"]').get_attribute('class') or ''
    assert 'is-marked' in q1_class, q1_class
    assert '已标记' in page.locator('#practiceAnswerSheet').inner_text()
    # 点击答题卡题号跳转仍正常
    page.locator('#practiceAnswerSheet [data-question-id="q2"]').click()
    page.wait_for_timeout(120)
    assert '第 2 道题' in page.locator('#practiceQuestionStem').inner_text()

    # 显示答案开启：未答题 q2 锁定并显示正确答案与中性解析
    page.locator('#practiceShowAnswers').check()
    page.wait_for_timeout(80)
    assert page.locator('#practiceQuestionCard').evaluate(
        "el=>el.querySelectorAll('.practice-option.is-correct').length"
    ) >= 1
    assert page.locator('#practiceExplanationPanel').is_visible()
    assert '正确答案：A' in page.locator('#practiceExplanationHead').inner_text()
    assert '回答正确' not in page.locator('#practiceExplanationHead').inner_text()
    assert page.locator('#practiceOptions button[disabled]').count() == 2
    # 显示答案下作答不产生草稿
    answered_before = page.evaluate('KGPracticeMode.snapshot().answered')
    page.locator('[data-option-id="A"]').click(force=True)
    page.wait_for_timeout(80)
    assert page.evaluate('KGPracticeMode.snapshot().answered') == answered_before

    # 关闭开关：恢复可作答
    page.locator('#practiceShowAnswers').uncheck()
    page.wait_for_timeout(80)
    assert page.locator('#practiceOptions button[disabled]').count() == 0
    page.locator('[data-option-id="B"]').click()
    page.wait_for_timeout(700)
    assert page.evaluate('KGPracticeMode.snapshot().answered') == answered_before + 1

    # 保存退出 → runtimeState 带上 order/showAnswers/markedQuestionIds
    page.locator('#practiceExitBtn').click()
    page.locator('#practiceSaveExitBtn').click()
    page.wait_for_timeout(250)
    snapshots = page.evaluate("window.__pausedSnapshots")
    saved = snapshots[sorted(snapshots.keys())[-1]]
    assert saved['runtimeState']['markedQuestionIds'] == ['q1'], saved['runtimeState']
    assert saved['runtimeState']['showAnswers'] is False
    assert saved['runtimeState']['order'] == 'paper'

    # ---------- 场景 2：恢复会话，标记还原、开关还原为关闭 ----------
    page.evaluate("KGPracticeMode.showLobby()")
    page.wait_for_timeout(100)
    page.evaluate("KGPracticeMode.startPractice('practice')")
    page.wait_for_timeout(300)
    resumed = page.evaluate('KGPracticeMode.snapshot()')
    assert resumed['sessionId'] == saved['id'], resumed
    page.locator('#practiceAnswerSheetMobileBtn').click()
    page.wait_for_timeout(320)
    sheet_q1 = page.locator('#practiceAnswerSheet [data-question-id="q1"]').get_attribute('class') or ''
    assert 'is-marked' in sheet_q1, sheet_q1
    page.locator('#practiceAnswerSheetDrawerClose').click()
    page.wait_for_timeout(80)
    assert not page.locator('#practiceShowAnswers').is_checked()

    # ---------- 场景 3：随机顺序恢复（核心 bug） ----------
    # 制造一个 order=random、currentIndex=2 的已保存会话，并让 enterSession 精确恢复它
    page.evaluate(
        """()=>{
          const source=window.__pausedSnapshots[Object.keys(window.__pausedSnapshots)[0]];
          const copy=JSON.parse(JSON.stringify(source));
          copy.id='ps-random';
          copy.status='paused';
          copy.runtimeState.order='random';
          copy.runtimeState.currentIndex=2;
          copy.answers={};
          copy.stats={total:10,answered:0,correct:0,wrong:0,unanswered:10,experience:0,durationMs:0};
          copy.questions=JSON.parse(JSON.stringify(source.questions)).reverse();
          copy.questionOrder=copy.questions.map(({question,...ref})=>ref);
          window.__pausedSnapshots['ps-random']=copy;
          window.__originalEnterSession=window.KGPracticeLearningApi.enterSession;
          window.KGPracticeLearningApi.enterSession=async()=>({resumed:true,session:JSON.parse(JSON.stringify(copy))});
        }"""
    )
    page.evaluate("KGPracticeMode.showLobby()")
    page.wait_for_timeout(100)
    page.evaluate("KGPracticeMode.startPractice('practice')")
    page.wait_for_timeout(300)
    random_snapshot = page.evaluate('KGPracticeMode.snapshot()')
    assert random_snapshot['sessionId'] == 'ps-random', random_snapshot
    # 当前题仍是服务器冻结序 currentIndex=2 对应的 q8。
    assert '第 8 道题' in page.locator('#practiceQuestionStem').inner_text(), (
        page.locator('#practiceQuestionStem').inner_text()
    )
    # 完整题序和当前位置都必须与服务端保存的快照一致，不能再次洗牌。
    display_order = sheet_numbers(page)
    assert sorted(display_order) == sorted('q%d' % i for i in range(1, 11)), display_order
    assert display_order == ['q%d' % i for i in range(10, 0, -1)], display_order
    assert random_snapshot['index'] == display_order.index('q8') == 2, (
        random_snapshot['index'], display_order,
    )

    # ---------- 场景 4：challenge 模式下开关隐藏、标记可用 ----------
    # 还原 enterSession 并让 challenge 走全新会话（避免恢复 random practice 会话）
    page.evaluate(
        """()=>{
          window.KGPracticeLearningApi.enterSession=window.__originalEnterSession;
          const fresh={...window.__pausedSnapshots[Object.keys(window.__pausedSnapshots)[0]]};
          // 屏蔽 paused 快照恢复：enterSession 走新建分支（session 已 abandon）
        }"""
    )
    page.evaluate("KGPracticeLearningApi.abandonSession=async(id,input)=>{return null}")
    page.evaluate("KGPracticeMode.showLobby()")
    page.wait_for_timeout(100)
    page.evaluate("KGPracticeMode.abandonPractice ? null : null")
    page.evaluate(
        """async()=>{
          // 直接放弃当前 random practice 会话，让 challenge 新建
          if(window.KGPracticeMode.abandonPractice)await window.KGPracticeMode.abandonPractice();
        }"""
    )
    page.evaluate("KGPracticeMode.startPractice('challenge')")
    page.wait_for_timeout(300)
    assert page.evaluate('KGPracticeMode.snapshot().mode') == 'challenge', page.evaluate('KGPracticeMode.snapshot()')
    assert page.locator('#practiceShowAnswersToggle').is_hidden()
    assert page.locator('#practiceMarkToggle').is_visible()

    assert_mark_layout(page)
    # Reference design controls use the real question navigation and marked set.
    page.locator('[data-practice-action="marked"]').click()
    assert page.locator('.practice-answer-filter-empty').is_visible()
    page.locator('#practiceAnswerSheetDrawerClose').click()
    page.locator('#practiceMarkToggle').click()
    page.locator('[data-practice-action="marked"]').click()
    assert page.locator('#practiceAnswerSheet [data-question-id]').count() == 1
    assert 'is-marked' in page.locator('#practiceAnswerSheet [data-question-id]').get_attribute('class')
    page.locator('[data-answer-filter="all"]').click()
    assert page.locator('#practiceAnswerSheet [data-question-id]').count() == 10
    assert page.locator('#practiceAnswerSheet .is-marked[data-question-id]').count() == 1
    page.locator('#practiceAnswerSheetDrawerClose').click()
    before = page.locator('#practiceQuestionStem').evaluate('(el)=>parseFloat(getComputedStyle(el).fontSize)')
    page.locator('[data-practice-action="settings"]').click()
    page.locator('#practiceReadingSize').select_option('large')
    assert page.locator('#practiceQuestionStem').evaluate('(el)=>parseFloat(getComputedStyle(el).fontSize)') > before
    page.keyboard.press('Escape')
    assert page.locator('#practiceReadingSettings').is_hidden()
    page.locator('[data-practice-action="settings"]').click()
    page.locator('#practiceReadingSize').select_option('standard')
    page.locator('[data-practice-action="close-settings"]').click()
    for width in [320, 390, 768, 1024, 1360]:
        page.set_viewport_size({'width': width, 'height': 1000})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), width
        assert page.locator('#practiceMarkToggle').bounding_box()['y'] < page.locator('#practiceQuestionStem').bounding_box()['y']
    assert not errors, errors
    browser.close()

print("practice-mark-show-answers-browser-ok")
