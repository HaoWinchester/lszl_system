"""Cross-account proof for multi-question personal cards and mistake transitions."""

from __future__ import annotations

import os
import time
from pathlib import Path
from urllib.parse import quote

from playwright.sync_api import APIRequestContext, BrowserContext, Page, sync_playwright


BASE = os.environ.get("E2E_BASE_URL", "http://127.0.0.1:8000").rstrip("/")
PASSWORD = "test1234"
LEGAL_VERSION = "2026-08-13-v1"


def assert_ok(response, label: str) -> dict:
    assert response.ok, (label, response.status, response.text())
    return response.json()


def login(request: APIRequestContext, username: str, password: str) -> None:
    assert_ok(
        request.post(
            BASE + "/api/v1/auth/login",
            data={"username": username, "password": password, "acceptedTermsVersion": LEGAL_VERSION},
        ),
        f"login {username}",
    )


def logout(request: APIRequestContext) -> None:
    response = request.post(BASE + "/api/v1/auth/logout")
    assert response.ok, (response.status, response.text())


def create_student(admin: APIRequestContext, username: str) -> None:
    assert_ok(
        admin.post(
            BASE + "/api/v1/users",
            data={"username": username, "password": PASSWORD, "role": "student", "subject": "PMP"},
        ),
        f"create {username}",
    )


def publish_fixture(admin: APIRequestContext, stamp: str) -> tuple[dict, list[dict]]:
    bank = assert_ok(
        admin.post(
            BASE + "/api/v1/banks",
            data={"name": f"多题资产 E2E 题库 {stamp}", "subject": "PMP", "visibility": "published"},
        ),
        "create bank",
    )["bank"]
    questions = []
    for index in range(3):
        created = assert_ok(
            admin.post(
                BASE + f"/api/v1/banks/{quote(bank['id'])}/questions",
                data={
                    "title": f"多题资产验证题 {index + 1} {stamp}",
                    "type": "single_choice",
                    "subject": "PMP",
                    "difficulty": "基础",
                    "domain": "整合",
                    "stemParts": [{"text": f"第 {index + 1} 题请选择正确答案。"}],
                    "options": [
                        {"id": "A", "text": "正确选项", "correct": True},
                        {"id": "B", "text": "错误选项", "correct": False},
                    ],
                    "correctAnswer": "A",
                    "analysis": "A 为服务端保存的标准答案。",
                },
            ),
            f"create question {index + 1}",
        )["question"]
        published = assert_ok(
            admin.put(BASE + f"/api/v1/questions/{quote(created['id'])}", data={"scope": "public"}),
            f"publish question {index + 1}",
        )["question"]
        questions.append(published)

    release = {
        "id": f"release-assets-{stamp}",
        "releaseId": f"release-assets-{stamp}",
        "paperId": f"paper-assets-{stamp}",
        "version": 1,
        "name": f"多题资产 E2E 试卷 {stamp}",
        "title": f"多题资产 E2E 试卷 {stamp}",
        "subject": "PMP",
        "status": "published",
        "publishedAt": int(time.time() * 1000),
        "publishedBy": "admin",
        "enabledModes": ["multi_question_canvas"],
        "modeConfigVersion": 2,
        "accessPolicy": {"accessLevel": "free"},
        "totalCount": len(questions),
        "configuredCount": len(questions),
        "questions": [
            {"bankId": bank["id"], "questionId": question["id"], "order": index + 1}
            for index, question in enumerate(questions)
        ],
        "questionSnapshots": [
            {
                "bankId": bank["id"],
                "bankName": bank["name"],
                "bankSubject": "PMP",
                "questionId": question["id"],
                "question": question,
            }
            for question in questions
        ],
    }
    published = assert_ok(
        admin.post(BASE + "/api/v1/paper-releases/publish-payload", data=release),
        "publish relational paper release",
    )["release"]
    assert published["releaseId"] == release["releaseId"]
    assert published["questionCount"] == len(questions)
    return release, questions


def withdraw_fixture(admin: APIRequestContext, paper_id: str) -> None:
    assert_ok(
        admin.post(BASE + f"/api/v1/paper-releases/papers/{quote(paper_id)}/withdraw-all"),
        "withdraw relational paper release",
    )


def wait_workspace(page: Page) -> None:
    page.goto(BASE + "/question-workspace.html", wait_until="networkidle")
    page.locator(".qw-app").wait_for(state="visible")
    page.wait_for_function("window.KGMultiQuestionWorkspace?.getState?.().readonly === false")
    page.wait_for_function(
        "document.querySelector('#qwPaperSelect option')?.textContent?.includes('可用 3/3 题')",
        timeout=15_000,
    )


def card_payload(title: str, content: str) -> dict:
    return {
        "title": title,
        "synthesisType": "principle",
        "content": content,
        "tags": ["跨画布", "E2E"],
        "status": "draft",
        "sourceQuestionRefs": [],
    }


def drag_question_batch(page: Page, row_index: int, x: int, y: int) -> None:
    page.evaluate(
        """({index,x,y})=>{
          const source=[...document.querySelectorAll('#qwQuestionList .qw-question-item')][index];
          const target=document.getElementById('qwCanvasViewport');
          if(!source||!target)throw new Error('drag fixture unavailable');
          const transfer=new DataTransfer();
          source.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:transfer}));
          target.dispatchEvent(new DragEvent('dragenter',{bubbles:true,cancelable:true,dataTransfer:transfer,clientX:x,clientY:y}));
          target.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:transfer,clientX:x,clientY:y}));
          target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer,clientX:x,clientY:y}));
          source.dispatchEvent(new DragEvent('dragend',{bubbles:true,cancelable:true,dataTransfer:transfer}));
        }""",
        {"index": row_index, "x": x, "y": y},
    )


def set_drawer_open(page: Page, drawer_id: str, button_id: str, open_: bool) -> None:
    hidden = page.locator(drawer_id).is_hidden()
    if hidden == open_:
        page.locator(button_id).click()
    page.locator(drawer_id).wait_for(state="visible" if open_ else "hidden")


def click_option(question_card, option_key: str) -> None:
    question_card.locator(f'[data-qw-option-key="{option_key}"]').evaluate("element=>element.click()")


def answer_and_wait(page: Page, question_card, option_key: str) -> None:
    with page.expect_response(
        lambda response: response.url.endswith("/api/v1/learning/practice/answers")
        and response.request.method == "POST"
    ) as response_info:
        click_option(question_card, option_key)
    response = response_info.value
    assert response.ok, (response.status, response.text())


def test_workflow(browser, username_a: str, username_b: str, release: dict, questions: list[dict]) -> None:
    context_a: BrowserContext = browser.new_context(viewport={"width": 1440, "height": 900})
    context_b: BrowserContext = browser.new_context(viewport={"width": 1440, "height": 900})
    page: Page | None = None
    console_errors: list[str] = []
    page_errors: list[str] = []
    http_errors: list[str] = []

    def record_response(response) -> None:
        if response.status < 400 or response.status in {401, 404, 409, 500}:
            return
        http_errors.append(f"{response.status} {response.url}")

    try:
        login(context_a.request, username_a, PASSWORD)
        login(context_b.request, username_b, PASSWORD)
        learner_catalog = assert_ok(
            context_a.request.get(BASE + "/api/v1/paper-releases/catalog"),
            "learner release catalog",
        )
        assert release["releaseId"] in {
            row["releaseId"] for row in learner_catalog["releases"]
        }
        learner_questions = assert_ok(
            context_a.request.get(
                BASE + f"/api/v1/paper-releases/{quote(release['releaseId'])}/questions?limit=10"
            ),
            "learner release questions",
        )
        assert learner_questions["total"] == 3
        assert len(learner_questions["questions"]) == 3
        page = context_a.new_page()
        page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.on("response", record_response)
        wait_workspace(page)

        # Select three released questions, drag the selected batch once, then prove duplicate skip.
        page.locator("#qwQuestionDockBtn").click()
        page.wait_for_function(
            "document.querySelectorAll('#qwQuestionList .qw-question-item').length >= 3",
            timeout=15_000,
        )
        rows = page.locator("#qwQuestionList .qw-question-item")
        assert rows.count() == 3
        for index in range(3):
            rows.nth(index).locator("[data-qw-question-select]").check()
        drag_question_batch(page, 0, 720, 430)
        page.wait_for_timeout(450)
        assert page.locator('.qw-question-card[data-node-type="question-reference"]').count() == 3
        boxes = page.locator('.qw-question-card[data-node-type="question-reference"]').evaluate_all(
            "els=>els.map(el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})"
        )
        for left_index, left in enumerate(boxes):
            for right in boxes[left_index + 1:]:
                assert left["x"] + left["w"] <= right["x"] or right["x"] + right["w"] <= left["x"] or left["y"] + left["h"] <= right["y"] or right["y"] + right["h"] <= left["y"], boxes
        page.locator("#qwQuestionDrawerClose").click()
        page.locator("#qwQuestionDockBtn").click()
        drag_question_batch(page, 0, 900, 650)
        page.wait_for_timeout(250)
        assert page.locator('.qw-question-card[data-node-type="question-reference"]').count() == 3
        page.locator("#qwQuestionDrawerClose").click()

        # Create a global personal card from workspace A and prove reload persistence.
        title_a = f"跨画布原则 {release['releaseId']}"
        page.locator("#qwNewSynthesisBtn").click()
        page.locator("#qwSynthesisTitle").fill(title_a)
        page.locator("#qwSynthesisContent").fill("工作区 A 创建的全局原则。")
        page.locator("#qwSaveSynthesisBtn").click()
        page.locator(f'.qw-synthesis-card:has-text("{title_a}")').wait_for(state="visible")
        page.evaluate("()=>KGCanvasWorkspaceAdapter.flush()")
        card = assert_ok(context_a.request.get(BASE + "/api/v1/learning/personal-cards"), "list cards A")["cards"][0]
        card_id = card["id"]
        page.reload(wait_until="networkidle")
        page.locator(f'.qw-synthesis-card:has-text("{title_a}")').wait_for(state="visible")

        # Workspace B inserts the same card; editing it hydrates workspace A on reopen.
        workspace_a = page.evaluate("KGMultiQuestionWorkspace.activeWorkspaceId()")
        page.once("dialog", lambda dialog: dialog.accept("全局卡工作区 B"))
        page.locator("#qwCreateWorkspaceBtn").click()
        page.wait_for_function("previous=>KGMultiQuestionWorkspace.activeWorkspaceId()!==previous", arg=workspace_a)
        workspace_b = page.evaluate("KGMultiQuestionWorkspace.activeWorkspaceId()")
        set_drawer_open(page, "#qwPersonalCardsDrawer", "#qwPersonalCardsBtn", True)
        page.locator(f'[data-card-id="{card_id}"] [data-card-action="insert"]').click()
        page.locator(f'.qw-synthesis-card:has-text("{title_a}")').wait_for(state="visible")
        set_drawer_open(page, "#qwPersonalCardsDrawer", "#qwPersonalCardsBtn", True)
        page.locator(f'[data-card-id="{card_id}"] [data-card-action="edit"]').click()
        title_b = title_a + " · 已更新"
        page.locator("#qwPersonalCardEditorTitleInput").fill(title_b)
        page.locator("#qwPersonalCardEditorContent").fill("工作区 B 编辑后，A 应自动读取新内容。")
        page.locator("#qwPersonalCardEditorSave").click()
        page.locator("#qwPersonalCardEditor").wait_for(state="hidden")
        page.evaluate("id=>KGMultiQuestionWorkspace.loadWorkspace(id)", workspace_a)
        page.locator(f'.qw-synthesis-card:has-text("{title_b}")').wait_for(state="visible")
        assert "工作区 B 编辑后" in page.locator(f'.qw-synthesis-card:has-text("{title_b}")').inner_text()

        # Archive/restore propagates to existing nodes and duplicate insert is rejected.
        set_drawer_open(page, "#qwPersonalCardsDrawer", "#qwPersonalCardsBtn", True)
        page.locator(f'[data-card-id="{card_id}"] [data-card-action="archive"]').click()
        page.wait_for_function("title=>[...document.querySelectorAll('.qw-synthesis-card')].some(node=>node.innerText.includes(title)&&node.innerText.includes('已归档'))", arg=title_b)
        page.locator('[data-personal-card-filter="archived"]').click()
        page.locator(f'[data-card-id="{card_id}"] [data-card-action="restore"]').click()
        page.locator('[data-personal-card-filter="active"]').click()
        before_count = page.locator('.qw-synthesis-card').count()
        page.locator(f'[data-card-id="{card_id}"] [data-card-action="insert"]').click()
        page.wait_for_timeout(150)
        assert page.locator('.qw-synthesis-card').count() == before_count

        # Server-graded wrong -> delayed verification -> active transitions update
        # drawer counts without reload. A first correct retry intentionally stays
        # active until the 24-hour verification window has elapsed.
        question_id = questions[0]["id"]
        question_node_id = page.evaluate(
            "questionId=>Object.values(KGMultiQuestionWorkspace.activeWorkspace().nodes).find(node=>node.questionId===questionId)?.id||''",
            question_id,
        )
        assert question_node_id
        question_card = page.locator(f'[data-node-id="{question_node_id}"]')
        answer_and_wait(page, question_card, "B")
        page.wait_for_function("document.getElementById('qwMistakesCount')?.textContent === '1'")
        set_drawer_open(page, "#qwMistakesDrawer", "#qwMistakesBtn", True)
        assert page.locator(f'[data-mistake-id]:has-text("{questions[0]["title"]}")').is_visible()
        set_drawer_open(page, "#qwMistakesDrawer", "#qwMistakesBtn", False)
        answer_and_wait(page, question_card, "A")
        page.wait_for_function("document.getElementById('qwMistakesCount')?.textContent === '1'")
        verification_overview = assert_ok(
            context_a.request.get(BASE + "/api/v1/learning/practice/overview"),
            "verification overview A",
        )
        verification_mistake = next(
            row
            for row in verification_overview["mistakes"]
            if row["questionId"] == question_id
            and row["releaseId"] == release["releaseId"]
        )
        assert verification_mistake["status"] == "verification_due"
        assert verification_overview["stats"]["verificationWaiting"] == 1
        set_drawer_open(page, "#qwMistakesDrawer", "#qwMistakesBtn", True)
        page.locator('[data-mistake-filter="mastered"]').click()
        assert page.locator(
            f'[data-mistake-id]:has-text("{questions[0]["title"]}")'
        ).count() == 0
        page.locator('[data-mistake-filter="active"]').click()
        assert page.locator(
            f'[data-mistake-id]:has-text("{questions[0]["title"]}")'
        ).is_visible()
        set_drawer_open(page, "#qwMistakesDrawer", "#qwMistakesBtn", False)
        answer_and_wait(page, question_card, "B")
        page.wait_for_function("document.getElementById('qwMistakesCount')?.textContent === '1'")
        overview_a = assert_ok(context_a.request.get(BASE + "/api/v1/learning/practice/overview"), "overview A")
        mistake = next(row for row in overview_a["mistakes"] if row["questionId"] == question_id and row["releaseId"] == release["releaseId"])
        assert mistake["status"] == "pending" and mistake["wrongCount"] == 2

        # Student B owns no assets and cannot read A's ids.
        assert assert_ok(context_b.request.get(BASE + "/api/v1/learning/personal-cards"), "cards B")["cards"] == []
        assert assert_ok(context_b.request.get(BASE + "/api/v1/learning/practice/overview"), "mistakes B")["mistakes"] == []
        assert context_b.request.get(BASE + f"/api/v1/learning/personal-cards/{quote(card_id)}").status == 404
        workspaces_b = assert_ok(context_b.request.get(BASE + "/api/v1/workspaces"), "workspaces B")
        assert workspace_a not in {item["id"] for item in workspaces_b["workspaces"]}
        assert context_b.request.post(BASE + f"/api/v1/learning/practice/mistakes/{quote(mistake['id'])}/revenge-answer", data={"correct": True, "selectedAnswer": "A"}).status == 404

        # Explicit 409 keeps edited text until reload; simulated 500 shows retry and UI remains usable.
        set_drawer_open(page, "#qwPersonalCardsDrawer", "#qwPersonalCardsBtn", True)
        page.locator(f'[data-card-id="{card_id}"] [data-card-action="edit"]').click()
        fresh = assert_ok(context_a.request.get(BASE + f"/api/v1/learning/personal-cards/{quote(card_id)}"), "fresh card")["card"]
        external_title = title_b + " · 服务端新版"
        assert_ok(
            context_a.request.put(
                BASE + f"/api/v1/learning/personal-cards/{quote(card_id)}",
                data={"title": external_title, "revision": fresh["revision"]},
            ),
            "external card update",
        )
        local_unsaved_title = title_b + " · 本地未保存"
        page.locator("#qwPersonalCardEditorTitleInput").fill(local_unsaved_title)
        page.locator("#qwPersonalCardEditorSave").click()
        page.locator("#qwPersonalCardConflict").wait_for(state="visible")
        assert page.locator("#qwPersonalCardEditorTitleInput").input_value() == local_unsaved_title
        page.locator("#qwPersonalCardConflictReload").click()
        page.wait_for_function(
            "title=>document.getElementById('qwPersonalCardEditorTitleInput')?.value===title",
            arg=external_title,
        )
        page.locator("#qwPersonalCardEditorDismiss").click()
        set_drawer_open(page, "#qwPersonalCardsDrawer", "#qwPersonalCardsBtn", False)
        page.evaluate("""()=>{
          const original=window.fetch.bind(window);window.__assetsOriginalFetch=original;window.__failNextAnswer=true;
          window.fetch=(url,options)=>{
            if(window.__failNextAnswer&&String(url).includes('/learning/practice/answers')){
              window.__failNextAnswer=false;return Promise.resolve(new Response(JSON.stringify({detail:'模拟 500'}),{status:500,headers:{'content-type':'application/json'}}));
            }
            return original(url,options);
          };
        }""")
        click_option(question_card, "A")
        retry = question_card.locator(
            '[data-qw-option-sync-error] [data-qw-option-retry]'
        )
        retry.wait_for(state="visible", timeout=10_000)
        with page.expect_response(
            lambda response: response.url.endswith("/api/v1/learning/practice/answers")
            and response.status == 200
        ):
            retry.evaluate("element=>element.click()")
        question_card.locator('[data-qw-option-sync-error]').wait_for(state="detached")
        assert not page_errors, page_errors
        filtered_console = [message for message in console_errors if "500 (Internal Server Error)" not in message and "409 (Conflict)" not in message and "favicon" not in message.lower()]
        assert not filtered_console, filtered_console
        assert not http_errors, http_errors
        assert workspace_b != workspace_a
    except Exception:
        if page is not None:
            try:
                failure = Path("/tmp/multi-question-learning-assets-failure.png")
                page.screenshot(path=str(failure), full_page=False, timeout=5_000)
                diagnostics = page.evaluate("""()=>({
                  bootstrap: window.__KG_DIRECT_BOOTSTRAP__,
                  workspace: window.KGMultiQuestionWorkspace?.getState?.(),
                  releases: window.KGPaperReleaseApi?.catalog?.().map(row=>({
                    paperId:row.paperId,releaseId:row.releaseId,totalCount:row.totalCount,
                    enabledModes:row.enabledModes,status:row.status,availability:row.availability
                  })),
                  apiError: String(window.KGPaperReleaseApi?.error?.()||''),
                  questionRows: document.querySelectorAll('#qwQuestionList .qw-question-item').length,
                  paperOptions: [...document.querySelectorAll('#qwPaperSelect option')].map(option=>option.textContent),
                })""")
                print({"url": page.url, "screenshot": str(failure), "console": console_errors, "pageErrors": page_errors, "httpErrors": http_errors, "diagnostics": diagnostics}, flush=True)
            except Exception:
                pass
        raise
    finally:
        context_a.close()
        context_b.close()


def main() -> None:
    stamp = str(int(time.time() * 1000))
    username_a = f"mq_assets_a_{stamp}"
    username_b = f"mq_assets_b_{stamp}"
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        admin = browser.new_context()
        release: dict | None = None
        try:
            login(admin.request, "admin", "jbgsnmm~123")
            create_student(admin.request, username_a)
            create_student(admin.request, username_b)
            release, questions = publish_fixture(admin.request, stamp)
            test_workflow(browser, username_a, username_b, release, questions)
        finally:
            if release is not None:
                withdraw_fixture(admin.request, release["paperId"])
            admin.close()
            browser.close()
    print("multi-question-learning-assets-e2e-ok")


if __name__ == "__main__":
    main()
