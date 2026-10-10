#!/usr/bin/env python3
"""做题页「我的收藏」浏览器测试：

1. 大厅「我的收藏」入口打开抽屉，列表渲染收藏的题目与解析（数据走后端 stub）。
2. 取消收藏按钮从列表移除条目并刷新统计。
3. Escape / 遮罩点击关闭抽屉；未登录提示登录后查看。
"""
from pathlib import Path
import base64
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
    "src/120-question-favorites.js",
    "src/100-practice-mode.js",
    "src/practice/practice-answer-page.js",
]

FAVORITES = [
    dict(questionId="q1", stemText="以下哪个是正确选项？", analysis="因为 A 符合定义。", type="single_choice", favoritedAt="2026-10-05T08:30:00+08:00"),
    dict(questionId="q2", stemText="第二道收藏题的题干", analysis="", type="multiple_choice", favoritedAt="2026-10-04T09:00:00+08:00"),
]


def body_html():
    source = (ROOT / "practice-mode.html").read_text(encoding="utf-8")
    match = re.search(r"<body([^>]*)>([\s\S]*)</body>", source, re.I)
    return match.group(1), re.sub(r"<script[\s\S]*?</script>", "", match.group(2), flags=re.I)


def harness(page):
    removed = page.__dict__.setdefault("removed", set())

    def list_favorites(route):
        items = [item for item in FAVORITES if item["questionId"] not in removed]
        route.fulfill(content_type="application/json", body=json.dumps({"favorites": items, "nextCursor": None}))

    def toggle_favorite(route):
        # toggle 视为「取消收藏」：从 stub 列表移除，便于驱动刷新断言。
        removed.add(route.request.url.split("/question-favorites/")[1].split("/toggle")[0])
        route.fulfill(content_type="application/json", body=json.dumps({"favorited": False}))

    page.route("**/api/v1/question-favorites", list_favorites)
    page.route("**/api/v1/question-favorites?*", list_favorites)
    page.route("**/api/v1/question-favorites/status*", lambda r: r.fulfill(content_type="application/json", body=json.dumps({"status": {}})))
    page.route("**/api/v1/question-favorites/*/toggle", toggle_favorite)
    page.route("**/api/v1/question-favorites/detail?*", lambda r: r.fulfill(content_type="application/json", body=json.dumps({
        "questionId": "q1", "stemParts": [{"text": "查看图表，选择正确选项。"}], "favorited": True,
        "images": [{"url": "/api/v1/question-assets/favorite-diagram", "alt": "题目关系图"}],
        "material": {"id": "case-1", "title": "案例材料", "text": "案例正文", "images": [
            {"url": "/api/v1/question-assets/favorite-case", "alt": "案例趋势图"}]},
    })))
    page.route("**/api/v1/question-assets/*", lambda r: r.fulfill(content_type="image/png", body=base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=")))
    page.route(
        "**/api/v1/questions/q1/comments",
        lambda r: r.fulfill(content_type="application/json", body=json.dumps({"comments": [], "nextCursor": None})),
    )
    attrs, body = body_html()
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
      const question=(index)=>({id:'q'+index,title:'题目 '+index,type:'single_choice',stemParts:[{text:'题干'}],options:[{id:'A',text:'正确选项',correct:true}],correctAnswer:'A',analysis:'解析'});
      const allRefs=Array.from({length:10},(_,o)=>({questionId:'q'+(o+1),bankId:'bank-1',orderIndex:o,domain:'people',question:question(o+1)}));
      let session=null,seq=0;
      const norm=()=>JSON.parse(JSON.stringify(session));
      window.KGAuthCore={currentUser:()=>({username:'student-1',role:'student'})};
      window.KGPracticeLearningApi={stats:()=>({}),active:()=>[],refresh:async()=>({}),getPaperProgress:async()=>({modes:{}}),getRevengeSummary:async()=>({stats:{}}),
        getSession:async()=>null,
        enterSession:async input=>{const refs=JSON.parse(JSON.stringify(allRefs));session={id:'ps-'+(++seq),paperId:null,releaseId:null,mode:input.mode,status:'active',revision:1,questions:refs,questionOrder:refs.map(({question,...r})=>r),answers:{},runtimeState:{currentIndex:0,order:input.order,health:3,streak:0,experience:0,durationMs:0},stats:{total:10,answered:0,correct:0,wrong:0,unanswered:10,experience:0,durationMs:0}};return {resumed:false,session:norm()}},
        updateState:async(id,input)=>({}),pauseSession:async()=>({}),abandonSession:async()=>({}),completeSession:async()=>{throw new Error('x')},
        getReport:async()=>null,listSessions:async()=>[],clearSessions:async()=>{}};
      window.__catalog=[{id:'paper-1',paperId:'paper-1',releaseId:'release-1',version:1,name:'PMP 模拟卷',subject:'PMP',status:'published',questionCount:10,totalCount:10,accessPolicy:{accessLevel:'free'}}];
      window.KGPublishedPaperRepository={listCatalogEntries:()=>window.__catalog};
      window.KGPaperAccessService={inspect:()=>({allowed:true,accessLevel:'free'})};
      window.KGQuestionCatalogAdapter={ready:Promise.resolve()};
      window.KGLearningLoading={show:()=>{},hide:()=>{}};
      window.KGActivitySchemaV1={getPracticeAutoExplain:()=>false,getLanguageMode:()=>'zh',setPracticeAutoExplain:()=>{},setLanguageMode:()=>{}};
    }"""
    )
    for stylesheet in ["styles/main.css", "styles/practice-mode.css", "styles/question-materials.css", "styles/answer-page.css", "styles/question-comments.css"]:
        page.add_style_tag(content=(ROOT / stylesheet).read_text(encoding="utf-8"))
    for script in SCRIPTS:
        page.add_script_tag(content=(ROOT / script).read_text(encoding="utf-8"))
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
    page.wait_for_timeout(120)


with sync_playwright() as playwright:
    launch = {"headless": True, "args": ARGS}
    if Path("/usr/bin/chromium").exists():
        launch["executable_path"] = "/usr/bin/chromium"
    browser = playwright.chromium.launch(**launch)
    page = browser.new_page(viewport={"width": 1440, "height": 960})
    page.set_default_timeout(10000)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    harness(page)

    # 大厅入口打开抽屉，列表渲染题目与解析
    assert page.locator('#practiceFavoritesOpenBtn').is_visible()
    page.locator('#practiceFavoritesOpenBtn').click()
    page.wait_for_function("document.getElementById('practiceFavoritesDrawer').hidden===false")
    page.wait_for_function("document.querySelectorAll('#practiceFavoritesList .practice-favorite-card').length===2")
    assert page.locator('#practiceFavoritesList .practice-favorite-card').count() == 2
    first = page.locator('.practice-favorite-card[data-favorite-item="q1"]')
    assert '以下哪个是正确选项？' in first.locator('.practice-favorite-stem').inner_text()
    assert '因为 A 符合定义。' in first.locator('.practice-favorite-analysis').inner_text()
    # 无解析的第二道题不渲染解析块
    assert page.locator('.practice-favorite-card[data-favorite-item="q2"] .practice-favorite-analysis').count() == 0
    assert '共收藏 2 道题' in page.locator('#practiceFavoritesSummary').inner_text()

    # 收藏详情展示题图与案例图片，点击放大且关闭后仍可继续查看详情。
    first.locator('[data-favorite-open]').click()
    detail = page.get_by_role('dialog', name='收藏题目详情')
    detail.wait_for(state='visible')
    assert '案例正文' in detail.inner_text()
    assert detail.locator('.qm-image img').count() == 2
    for image in detail.locator('.qm-image img').all():
        image.scroll_into_view_if_needed()
        image.wait_for(state='visible')
        image.evaluate('(image) => image.decode()')
        assert image.evaluate('(image) => image.naturalWidth > 0')
    detail.get_by_role('button', name='放大图表：题目关系图').click()
    assert page.locator('dialog.qm-image-dialog').is_visible()
    assert page.locator('dialog.qm-image-dialog img').get_attribute('alt') == '题目关系图'
    page.get_by_role('button', name='关闭图表', exact=True).click()
    page.locator('dialog.qm-image-dialog').wait_for(state='detached')
    assert page.locator('dialog.qm-image-dialog').count() == 0
    assert detail.is_visible()
    detail.get_by_role('button', name='放大图表：案例趋势图').click()
    page.locator('dialog.qm-image-dialog').wait_for(state='visible')
    page.keyboard.press('Escape')
    page.locator('dialog.qm-image-dialog').wait_for(state='detached')
    assert detail.is_visible()
    assert page.locator('#practiceFavoritesDrawer').is_visible()
    detail.get_by_role('button', name='关闭题目详情', exact=True).click()
    assert not detail.is_visible()

    # 取消收藏：列表移除并刷新统计
    page.locator('.practice-favorite-card[data-favorite-item="q1"] [data-favorite-remove]').click()
    page.wait_for_function("document.querySelectorAll('#practiceFavoritesList .practice-favorite-card').length===1")
    assert page.locator('.practice-favorite-card[data-favorite-item="q2"]').count() == 1
    assert '共收藏 1 道题' in page.locator('#practiceFavoritesSummary').inner_text()

    # Escape 关闭抽屉
    page.keyboard.press('Escape')
    page.wait_for_function("document.getElementById('practiceFavoritesDrawer').hidden===true")

    # 遮罩点击关闭
    page.locator('#practiceFavoritesOpenBtn').click()
    page.wait_for_function("document.getElementById('practiceFavoritesDrawer').hidden===false")
    page.locator('#practiceFavoritesDrawer').click(position={"x": 5, "y": 5})
    page.wait_for_function("document.getElementById('practiceFavoritesDrawer').hidden===true")

    # 清空收藏后：空态提示
    page.locator('#practiceFavoritesOpenBtn').click()
    page.wait_for_function("document.getElementById('practiceFavoritesDrawer').hidden===false")
    page.locator('.practice-favorite-card[data-favorite-item="q2"] [data-favorite-remove]').click()
    page.wait_for_function("document.getElementById('practiceFavoritesEmpty').hidden===false")
    assert '收藏' in page.locator('#practiceFavoritesEmpty').inner_text()
    page.keyboard.press('Escape')

    assert not errors, errors
    page.close()

    # 未登录：入口提示登录后查看
    page2 = browser.new_page(viewport={"width": 1440, "height": 960})
    page2.set_default_timeout(10000)
    errors2 = []
    page2.on("pageerror", lambda error: errors2.append(str(error)))
    page2.__dict__["removed"] = set()
    harness(page2)
    page2.evaluate("window.KGAuthCore={currentUser:()=>null}")
    page2.locator('#practiceFavoritesOpenBtn').click()
    page2.wait_for_function("document.getElementById('practiceFavoritesDrawer').hidden===false")
    assert '登录' in page2.locator('#practiceFavoritesSummary').inner_text()
    assert not errors2, errors2
    page2.close()
    browser.close()

print("practice-favorites-browser-ok")
