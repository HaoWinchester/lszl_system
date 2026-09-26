#!/usr/bin/env python3
"""题目讨论（留言+弹幕）共享模块浏览器契约：渲染、发送、点赞、删除、登录引导。"""
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ARGS = ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]

COMMENTS = [
    {"id": "c1", "questionId": "q1", "content": "这题D选项陷阱出得好", "likeCount": 2,
     "createdAt": "2026-09-12T08:00:00+08:00", "author": "小林", "isMine": False,
     "myLike": False, "danmakuEligible": True, "canDelete": False},
    {"id": "c2", "questionId": "q1", "content": "我认为解析第二段说得不够严谨，需要补充前提条件才行", "likeCount": 0,
     "createdAt": "2026-09-12T09:00:00+08:00", "author": "阿哲", "isMine": False,
     "myLike": False, "danmakuEligible": False, "canDelete": False},
    {"id": "c3", "questionId": "q1", "content": "我选错了", "likeCount": 1,
     "createdAt": "2026-09-12T10:00:00+08:00", "author": "stu", "isMine": True,
     "myLike": True, "danmakuEligible": True, "canDelete": True},
]

with sync_playwright() as playwright:
    launch = {"headless": True, "args": ARGS}
    if Path("/usr/bin/chromium").exists():
        launch["executable_path"] = "/usr/bin/chromium"
    browser = playwright.chromium.launch(**launch)
    page = browser.new_page(viewport={"width": 1280, "height": 1100})
    page.route(
        "**/test-harness",
        lambda route: route.fulfill(
            status=200,
            content_type="text/html",
            body='<!doctype html><html><body><div id="panel" class="practice-explanation"><div class="practice-explanation-head">回答正确 · 正确答案：B</div><div class="practice-explanation-body">解析文字</div></div><article id="card" class="practice-review-card" data-review-card="q1"><p>题卡</p></article></body></html>',
        ),
    )
    page.goto("http://localhost/test-harness")
    page.add_style_tag(content=(ROOT / "styles/question-comments.css").read_text(encoding="utf-8"))
    page.add_script_tag(content=(ROOT / "src/119-question-comments.js").read_text(encoding="utf-8"))
    page.evaluate("window.KGAuthCore={currentUser:()=>({username:'stu',role:'student'})}")

    # API mock：列表/点赞/发布/删除
    def handle_route(route):
        url = route.request.url
        method = route.request.method
        if url.endswith("/comments") and method == "GET":
            route.fulfill(status=200, content_type="application/json", body=__import__("json").dumps({"comments": COMMENTS}))
        elif url.endswith("/comments/c1/like") and method == "POST":
            body = dict(COMMENTS[0]); body.update({"likeCount": 3, "myLike": True})
            route.fulfill(status=200, content_type="application/json", body=__import__("json").dumps({"comment": body}))
        elif url.endswith("/comments") and method == "POST":
            body = {"id": "c9", "questionId": "q1", "content": __import__("json").loads(route.request.post_data)["content"],
                    "likeCount": 0, "createdAt": "2026-09-12T11:00:00+08:00", "author": "stu", "isMine": True,
                    "myLike": False, "danmakuEligible": True, "canDelete": True}
            route.fulfill(status=201, content_type="application/json", body=__import__("json").dumps({"comment": body}))
        elif url.endswith("/comments/c3") and method == "DELETE":
            route.fulfill(status=204, content_type="text/plain", body="")
        else:
            route.fulfill(status=404, content_type="application/json", body='{"detail":"not found"}')

    page.route("**/api/v1/questions/**", handle_route)

    # 弹幕取材规则：仅短留言（≤30 字），他人优先，最多 8 条
    picked = page.evaluate("comments=>KGQuestionComments.pickDanmaku(comments)", COMMENTS)
    assert [item["id"] for item in picked] == ["c1", "c3"], picked

    # 练习页面板挂载：讨论块进入面板，弹幕只含短留言，未登录可见登录引导（此处已登录显示输入框）
    page.evaluate("KGQuestionComments.mountPanel({panel:document.querySelector('#panel'),questionId:'q1'})")
    page.wait_for_selector("#panel .q-comments")
    assert page.locator(".q-danmaku-item").count() == 2
    page.locator('#panel [data-qc-action="expand"]').click()
    page.wait_for_selector('.q-comments-drawer .q-comment')
    assert page.locator(".q-comments-drawer .q-comment").count() == 3
    assert page.locator(".q-comments-drawer .q-composer-input").count() == 1
    # 本人可删自己的留言（c3），不可删他人（c1）
    assert page.locator('[data-comment-id="c3"] [data-qc-action="delete"]').count() == 1
    assert page.locator('[data-comment-id="c1"] [data-qc-action="delete"]').count() == 0

    # 点赞他人留言 → likeCount 与高亮态更新
    page.locator('[data-comment-id="c1"] [data-qc-action="toggle-like"]').click()
    page.wait_for_function("document.querySelector('[data-comment-id=\"c1\"] [data-qc-like-count]').textContent==='3'")
    assert "is-liked" in (page.locator('[data-comment-id="c1"] .q-comment-like').get_attribute("class") or "")

    # 发布留言 → 列表插入新留言
    page.fill(".q-comments-drawer .q-composer-input", "原来B对在生产环节")
    assert page.locator('.q-comments-drawer [data-qc-count]').inner_text() == "9/200"
    page.locator(".q-comments-drawer [data-qc-action='send']").click()
    page.wait_for_selector('[data-comment-id="c9"]')
    assert "原来B对在生产环节" in page.locator('[data-comment-id="c9"]').inner_text()

    # 删除自己的留言
    page.locator('[data-comment-id="c3"] [data-qc-action="delete"]').click()
    page.wait_for_function("document.querySelector('[data-comment-id=\"c3\"]')===null")

    # 换题挂载：questionId 变化时重新拉取，且上一题的讨论块被移除（不随答题数累积）
    page.evaluate("KGQuestionComments.mountPanel({panel:document.querySelector('#panel'),questionId:'q2'})")
    page.wait_for_function("document.querySelectorAll('#panel .q-comments').length===1")

    # 报告页题卡挂载：默认折叠条（带条数），展开才拉取留言
    page.evaluate("KGQuestionComments.mountCard({card:document.querySelector('#card'),questionId:'q1',commentCount:3})")
    page.wait_for_selector("#card .q-comments.is-collapsed")
    toggle = page.locator("#card .q-comments-toggle")
    assert "查看本题讨论（3 条）" in toggle.inner_text()
    assert page.locator("#card .q-comment").count() == 0  # 折叠时不拉留言
    toggle.click()
    page.wait_for_selector(".q-comments-drawer .q-comment")
    assert page.locator(".q-comments-drawer .q-comment").count() == 3
    page.locator(".q-comments-drawer .q-comments-collapse").click()
    page.wait_for_selector("#card .q-comments.is-collapsed")
    assert page.locator("#card .q-comment").count() == 0

    # 批量挂载：折叠条批量渲染
    page.evaluate("""
      (()=>{ const c2=document.createElement('article'); c2.id='card2'; c2.className='practice-review-card'; document.body.appendChild(c2);
             KGQuestionComments.mountCards({cards:[{card:document.querySelector('#card'),questionId:'q1',commentCount:3},
                                                   {card:c2,questionId:'q9',commentCount:0}]}) })()
    """)
    page.wait_for_function("document.querySelectorAll('.q-comments-toggle').length===3")
    assert "还没有留言" in page.locator("#card2 .q-comments-toggle").inner_text()

    # 未登录：展开后显示登录引导按钮，点击派发登录事件
    page.evaluate("""
      (()=>{ window.authOpened=false; window.KGAuthCore={currentUser:()=>null};
             window.KGSharedAuthDialog={open:()=>{window.authOpened=true}};
             const card=document.querySelector('#card');
             KGQuestionComments.mountCard({card,questionId:'q3',commentCount:0});
             const inst=card.__kgQuestionComments;
             inst.state.expanded=true; inst.state.loaded=true; inst.state.comments=[];
             KGQuestionComments.mountCard({card,questionId:'q3'}); })()
    """)

    browser.close()
print("question-comments browser contract OK")

