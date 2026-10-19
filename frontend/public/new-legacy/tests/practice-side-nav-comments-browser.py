#!/usr/bin/env python3
"""做题页标记区工具与左侧导航浏览器测试：

1. 左侧导航收起/展开：点击把手后侧栏滑出屏幕左侧、aria 状态同步；移动端不提供收起。
2. 标记区新增「评论」「弹幕开关」按钮：与标记按钮同显隐；弹幕开关切换本机偏好文案；
   评论按钮从页面底部打开讨论抽屉（类短视频评论区，数据走后端接口）。
"""
from helpers.practice_tools import click_tool, open_tools
from pathlib import Path
import json
import re

from playwright.sync_api import sync_playwright, expect

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
    "src/120-question-favorites.js",
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
    if Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome').exists():
        launch['channel'] = 'chrome'
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
        # 题目收藏 stub：toggle 返回切换后的状态；status 全部未收藏。
        favorite_state = {"favorited": False}
        page.route(
            "**/api/v1/question-favorites/status*",
            lambda r: r.fulfill(content_type="application/json", body=json.dumps({"status": {}})),
        )
        page.route(
            "**/api/v1/question-favorites/counts*",
            lambda r: r.fulfill(content_type="application/json", body=json.dumps({"counts": {"q1": 3}})),
        )
        page.route(
            "**/api/v1/question-comments/counts*",
            lambda r: r.fulfill(content_type="application/json", body=json.dumps({"counts": {"q1": 7}})),
        )
        page.route(
            "**/api/v1/question-favorites/*/toggle",
            lambda r: (favorite_state.update(favorited=not favorite_state["favorited"]),
                       r.fulfill(content_type="application/json", body=json.dumps({"questionId": "q1", "favorited": favorite_state["favorited"]}))),
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

        assert page.locator('#practiceSideToggle').get_attribute('aria-expanded') == 'false'
        assert page.locator('#practiceSideNav').is_hidden(), 'tools start collapsed on desktop and mobile'
        page.locator('#practiceSideToggle').click()
        # 标记区工具同显隐（侧栏「标记」已换成「收藏」）
        for selector in ['#practiceMarkToggle', '#practiceCommentBtn', '#practiceDanmakuToggle', '#practiceFavoriteBtn']:
            assert page.locator(selector).is_visible(), selector
        assert page.locator('#practiceDanmakuToggle').inner_text() == '弹幕开'

        # 弹幕开关切换本机偏好
        click_tool(page, '#practiceDanmakuToggle')
        assert page.locator('#practiceDanmakuToggle').inner_text() == '弹幕关'
        click_tool(page, '#practiceDanmakuToggle')
        assert page.locator('#practiceDanmakuToggle').inner_text() == '弹幕开'

        # 评论按钮：从页面底部打开讨论抽屉
        click_tool(page, '#practiceCommentBtn')
        page.wait_for_selector('.q-comments-drawer')
        box = page.locator('.q-comments-drawer').bounding_box()
        assert box is not None, '讨论抽屉必须真实渲染'
        assert box['y'] + box['height'] >= viewport['height'] - 2, '评论抽屉应贴页面底部'
        assert page.locator('.q-comments-drawer .q-comment[data-comment-id="c1"]').count() == 1
        page.locator('[data-qc-action="collapse"]').click()
        assert page.locator('.q-comments-drawer').count() == 0

        # 侧栏「收藏」按钮：toggle 切换高亮（题目收藏存后端，异步响应后同步按钮态）
        assert page.locator('#practiceFavoriteBtn').get_attribute('aria-pressed') == 'false'
        click_tool(page, '#practiceFavoriteBtn')
        page.wait_for_function("document.getElementById('practiceFavoriteBtn').getAttribute('aria-pressed')==='true'")
        click_tool(page, '#practiceFavoriteBtn')
        page.wait_for_function("document.getElementById('practiceFavoriteBtn').getAttribute('aria-pressed')==='false'")

        open_tools(page)
        # 侧栏角标：当前题的评论数与收藏数
        page.wait_for_function("document.getElementById('practiceCommentCount').textContent==='7'")
        assert page.locator('#practiceCommentCount').is_visible()
        page.wait_for_function("document.getElementById('practiceFavoriteCount').textContent==='3'")
        assert page.locator('#practiceFavoriteCount').is_visible()

        # 答题后：解析面板只保留答案与解析，不再内嵌弹幕/收藏/讨论评论区
        page.evaluate("window.KGActivitySchemaV1.getPracticeAutoExplain=()=>true")
        page.locator('#practiceOptions .practice-option[data-option-id="B"]').click()
        page.wait_for_timeout(200)
        assert page.locator('#practiceExplanationPanel').is_visible()
        assert page.locator('#practiceExplanationPanel .q-comments').count() == 0
        assert page.locator('#practiceExplanationPanel .q-danmaku').count() == 0
        # 弹幕层仍要在解析可见时播放（mountDanmaku 挂到视口层，不依赖内嵌面板）
        page.wait_for_selector('body > .q-danmaku .q-danmaku-item')

        # Same collapsed circle and accessible controls on desktop and touch widths.
        toggle = page.locator('#practiceSideToggle')
        expect(toggle).to_be_visible()
        expect(toggle).to_have_attribute('aria-expanded', 'false')
        box = toggle.bounding_box()
        assert box['width'] == box['height'] == 56
        assert 0 <= box['x'] and box['x'] + box['width'] <= viewport['width']
        open_tools(page)
        navbox = page.locator('#practiceSideNav').bounding_box()
        assert 0 <= navbox['x'] and navbox['x'] + navbox['width'] <= viewport['width']
        page.keyboard.press('Escape')
        expect(page.locator('#practiceSideNav')).to_be_hidden()
        expect(toggle).to_be_focused()
        open_tools(page)
        page.locator('#practiceQuestionStem').click()
        expect(page.locator('#practiceSideNav')).to_be_hidden()
        click_tool(page, '#practiceDanmakuSettingsBtn')
        expect(page.locator('#questionDanmakuSettings')).to_be_visible()
        page.keyboard.press('Escape')
        expect(page.locator('#questionDanmakuSettings')).to_have_count(0)

        # Cancelling exit keeps the answered view and its comments alive.
        click_tool(page, '#practiceExitBtn')
        page.locator('#practiceExitCancel').click()
        assert page.evaluate('document.body.dataset.practiceView') == 'game'
        assert page.locator('body > .q-danmaku .q-danmaku-item').count() == 1
        click_tool(page, '#practiceExitBtn')
        page.locator('#practiceSaveExitBtn').click()
        page.wait_for_function("document.body.dataset.practiceView==='lobby'")
        page.wait_for_timeout(100)
        assert page.locator('body > .q-danmaku').count() == 0, 'saved exit must remove viewport danmaku'
        assert page.locator('.q-comments-standalone-host').count() == 0, 'owned comment hosts must be disposed'

        for mode in ['challenge', 'scholar']:
            help = page.locator(f'.practice-mode-card.{mode} .practice-lobby-help')
            summary = help.locator('summary')
            summary.hover()
            assert help.evaluate('el=>el.open'), f'{mode} help must open on hover'
            content_box = help.locator('.practice-help-content').bounding_box()
            page.mouse.move(content_box['x']+content_box['width']/2, content_box['y']+20, steps=20)
            assert help.evaluate('el=>el.open'), 'moving into help must keep it readable'
            page.mouse.move(1, 1)
            expect(help).not_to_have_attribute('open', '')
            summary.focus()
            assert help.evaluate('el=>el.open'), 'keyboard focus reveals help'
            page.keyboard.press('Escape')
            assert not help.evaluate('el=>el.open'), 'Escape dismisses focused help'
            summary.click()
            assert help.evaluate('el=>el.open'), 'first click pins help even after focus or hover'
            page.mouse.click(1, 1)
            assert not help.evaluate('el=>el.open'), 'outside click dismisses pinned help'
            summary.click()
            assert help.evaluate('el=>el.open')
            summary.click()
            assert not help.evaluate('el=>el.open'), 'second click closes help'
        page.evaluate("KGPracticeMode.startPractice('practice')")
        page.wait_for_function("document.body.dataset.practiceView==='game'")
        page.locator('#practiceOptions .practice-option[data-option-id="B"]').click()
        page.wait_for_selector('body > .q-danmaku .q-danmaku-item')
        click_tool(page, '#practiceExitBtn')
        page.locator('#practiceAbandonBtn').click()
        page.wait_for_function("document.body.dataset.practiceView==='lobby'")
        assert page.locator('body > .q-danmaku').count() == 0, 'abandon exit also clears danmaku'
        assert not errors, errors
        page.close()
    browser.close()

print("practice-side-nav-comments-browser-ok")
