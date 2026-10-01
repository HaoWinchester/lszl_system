#!/usr/bin/env python3
"""做题页标记区工具与左侧导航浏览器测试：

1. 左侧导航收起/展开：点击把手后侧栏滑出屏幕左侧、aria 状态同步；移动端不提供收起。
2. 标记区新增「评论」「弹幕开关」按钮：与标记按钮同显隐；弹幕开关切换本机偏好文案；
   评论按钮从页面底部打开讨论抽屉（类短视频评论区，数据走后端接口）。
"""
from pathlib import Path
import json
import re

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ARGS = ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]

SCRIPTS = [
    "src/28-device-preferences.js",
    "src/111-practice-session-core.js",
    "src/115-practice-mode-policy.js",
    "src/112-practice-answer-sheet.js",
    "src/113-practice-result-report.js",
    "src/116-practice-session-save.js",
    "src/117-question-answer-set.js",
    "src/114-practice-draft-state.js",
    "src/118-revenge-entry-policy.js",
    "src/118-question-materials.js",
    "src/119-question-comments.js",
    "src/100-practice-mode.js",
    "src/practice/practice-answer-page.js",
]


def body_html():
    source = (ROOT / "practice-mode.html").read_text(encoding="utf-8")
    match = re.search(r"<body([^>]*)>([\s\S]*)</body>", source, re.I)
    return match.group(1), re.sub(r"<script[\s\S]*?</script>", "", match.group(2), flags=re.I)


with sync_playwright() as playwright:
    launch = {"headless": True, "args": ARGS}
    if Path("/usr/bin/chromium").exists():
        launch["executable_path"] = "/usr/bin/chromium"
    browser = playwright.chromium.launch(**launch)
    for viewport in [{"width": 1440, "height": 960}, {"width": 390, "height": 844}]:
        page = browser.new_page(viewport=viewport)
        page.set_default_timeout(10000)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.route(
            "**/api/v1/questions/q1/comments",
            lambda r: r.fulfill(
                content_type="application/json",
                body=json.dumps({"comments": [dict(id="c1", questionId="q1", content="这题解析很清楚", author="学员", likeCount=2, danmakuEligible=True, myLike=False, myFavorite=False)], "nextCursor": None}),
            ),
        )
        attrs, body = body_html()
        # localStorage 需要真实 origin（set_content 为不透明源会禁用存储），走路由页面。
        page.route(
            "**/harness",
            lambda r: r.fulfill(
                content_type="text/html",
                body=f'<!doctype html><html><head><base href="http://localhost/"></head><body{attrs}>{body}</body></html>',
            ),
        )
        page.goto("http://localhost/harness")
        page.evaluate(
            """()=>{
          const question=(index)=>({id:'q'+index,title:'题目 '+index,type:'single_choice',stemParts:[{text:'这是第 '+index+' 道题'}],options:[{id:'A',text:'正确选项',correct:true},{id:'B',text:'错误选项'}],correctAnswer:'A',analysis:'第 '+index+' 题解析'});
          const allRefs=Array.from({length:10},(_,offset)=>({questionId:'q'+(offset+1),bankId:'bank-1',orderIndex:offset,domain:'people',question:question(offset+1)}));
          let session=null,sequence=0;
          const normalize=()=>JSON.parse(JSON.stringify(session));
          window.KGAuthCore={currentUser:()=>({username:'student-1',role:'student'})};
          window.KGPracticeLearningApi={
            stats:()=>({}),active:()=>[],refresh:async()=>({}),
            getPaperProgress:async()=>({modes:{}}),getRevengeSummary:async()=>({stats:{}}),
            getSession:async id=>(session?normalize():null),
            enterSession:async input=>{
              const refs=JSON.parse(JSON.stringify(allRefs));
              session={id:'ps-seed-'+(++sequence),paperId:input.paperId||null,releaseId:input.releaseId||null,mode:input.mode,status:'active',revision:1,questions:refs,questionOrder:refs.map(({question,...ref})=>ref),answers:{},runtimeState:{currentIndex:0,order:input.order,health:3,streak:0,experience:0,durationMs:0},stats:{total:10,answered:0,correct:0,wrong:0,unanswered:10,experience:0,durationMs:0}};
              return {resumed:false,session:normalize()}
            },
            updateState:async(id,input)=>{session.runtimeState={...session.runtimeState,...input.runtimeState};session.revision+=1;return normalize()},
            pauseSession:async(id,input)=>{session.status='paused';session.revision+=1;return normalize()},
            abandonSession:async(id,input)=>{session.status='abandoned';session.revision+=1;return normalize()},
            completeSession:async()=>{throw new Error('not needed')},
            getReport:async()=>null,listSessions:async()=>[],clearSessions:async()=>{},
          };
          window.__catalog=[{id:'paper-1',paperId:'paper-1',releaseId:'release-1',version:1,name:'PMP 模拟卷',subject:'PMP',status:'published',questionCount:10,totalCount:10,accessPolicy:{accessLevel:'free'}}];
          window.KGPublishedPaperRepository={listCatalogEntries:()=>window.__catalog};
          window.KGPaperAccessService={inspect:()=>({allowed:true,accessLevel:'free'})};
          window.KGQuestionCatalogAdapter={ready:Promise.resolve()};
          window.KGLearningLoading={show:()=>{},hide:()=>{}};
          window.KGActivitySchemaV1={getPracticeAutoExplain:()=>false,getLanguageMode:()=>'zh',setPracticeAutoExplain:()=>{},setLanguageMode:()=>{}};
          window.KGFreeModeLanguage={};
        }"""
        )
        for stylesheet in ["styles/main.css", "styles/practice-mode.css", "styles/focus-vega-typography.css", "styles/learning-skin.css", "styles/question-materials.css", "styles/answer-page.css", "styles/question-comments.css"]:
            page.add_style_tag(content=(ROOT / stylesheet).read_text(encoding="utf-8"))
        for script in SCRIPTS:
            page.add_script_tag(content=(ROOT / script).read_text(encoding="utf-8"))
        page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
        page.wait_for_timeout(120)
        page.evaluate("KGPracticeMode.startPractice('practice')")
        page.wait_for_timeout(250)
        assert page.evaluate('KGPracticeMode.snapshot().mode') == 'practice'

        # 标记区三个工具同显隐
        for selector in ['#practiceMarkToggle', '#practiceCommentBtn', '#practiceDanmakuToggle']:
            assert page.locator(selector).is_visible(), selector
        assert page.locator('#practiceDanmakuToggle').inner_text() == '弹幕开'

        # 弹幕开关切换本机偏好
        page.locator('#practiceDanmakuToggle').click()
        assert page.locator('#practiceDanmakuToggle').inner_text() == '弹幕关'
        page.locator('#practiceDanmakuToggle').click()
        assert page.locator('#practiceDanmakuToggle').inner_text() == '弹幕开'

        # 评论按钮：从页面底部打开讨论抽屉
        page.locator('#practiceCommentBtn').click()
        page.wait_for_selector('.q-comments-drawer')
        box = page.locator('.q-comments-drawer').bounding_box()
        assert box is not None, '讨论抽屉必须真实渲染'
        assert box['y'] + box['height'] >= viewport['height'] - 2, '评论抽屉应贴页面底部'
        assert page.locator('.q-comments-drawer .q-comment[data-comment-id="c1"]').count() == 1
        page.locator('[data-qc-action="collapse"]').click()
        assert page.locator('.q-comments-drawer').count() == 0

        if viewport['width'] > 600:
            # 左侧导航收起：滑出屏幕左侧（visibility/transform 生效），把手状态同步
            toggle = page.locator('#practiceSideToggle')
            assert toggle.get_attribute('aria-expanded') == 'true'
            toggle.click()
            assert 'practice-side-collapsed' in page.locator('#practiceGame').get_attribute('class')
            assert toggle.get_attribute('aria-expanded') == 'false'
            page.wait_for_timeout(400)
            collapsed = page.evaluate("(()=>{const c=getComputedStyle(document.getElementById('practiceSideNav'));return {v:c.visibility,t:c.transform}})()")
            assert collapsed['v'] == 'hidden', collapsed
            assert collapsed['t'] != 'none', collapsed
            assert toggle.inner_text() == '»'
            toggle.click()
            assert toggle.get_attribute('aria-expanded') == 'true'
            page.wait_for_timeout(400)
            expanded = page.evaluate("(()=>{const c=getComputedStyle(document.getElementById('practiceSideNav'));return {v:c.visibility,t:c.transform}})()")
            assert expanded['v'] == 'visible', expanded
            assert toggle.inner_text() == '‹'
        else:
            # 移动端导航为横向静态条，不提供收起把手
            assert page.locator('#practiceSideToggle').is_hidden()

        assert not errors, errors
        page.close()
    browser.close()

print("practice-side-nav-comments-browser-ok")
