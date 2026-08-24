import os
import time
from uuid import uuid4

from playwright.sync_api import APIRequestContext, Page, sync_playwright


BASE = os.environ.get("E2E_BASE_URL", "http://127.0.0.1:8000").rstrip("/")
CREATORS = {
    "creator_001": "波塞冬",
    "creator_002": "狗娃",
    "creator_003": "阿浩",
    "creator_004": "杰瑞",
    "creator_005": "天才",
    "creator_006": "女帝",
}


def assert_ok(response, label: str) -> dict:
    assert response.ok, (label, response.status, response.text())
    return response.json()


def login(request: APIRequestContext, username: str, password: str) -> None:
    assert_ok(
        request.post(
            BASE + "/api/v1/auth/login",
            data={"username": username, "password": password, "acceptedTermsVersion": "2026-08-13-v1"},
        ),
        f"login {username}",
    )


def question(question_id: str, title: str, *, scope: str) -> dict:
    public = scope == "public"
    return {
        "id": question_id,
        "title": title,
        "type": "single_choice",
        "subject": "PMP",
        "difficulty": "基础",
        "domain": "整合",
        "topic": "即时入库",
        "tags": ["基础练习", "可公开" if public else "内部使用"],
        "scope": scope,
        "stage": "基础练习",
        "stemParts": [{"text": "题目录入成功后，系统应当何时允许查看？"}],
        "options": [
            {"id": "A", "text": "下一次部署后", "correct": False},
            {"id": "B", "text": "事务提交后立即", "correct": True},
        ],
        "correctAnswer": "B",
        "analysis": "上传事务提交后，正式题库立即可查询。",
        "clues": [],
        "concepts": [{"id": "catalog", "title": "统一题目目录"}],
        "reasoningSteps": [{"id": "step-1", "content": "确认事务已提交"}],
        "keyPath": {"answerId": "B"},
        "metadata": {
            "tagPaths": [
                {"groupId": "usage", "categoryId": "stage", "label": "基础练习"},
                {
                    "groupId": "source",
                    "categoryId": "scope",
                    "label": "可公开" if public else "内部使用",
                },
            ]
        },
        "status": {"contentReady": True},
        "lifecycle": {"status": "active"},
    }


def upload(
    request: APIRequestContext,
    *,
    stamp: str,
    bank_id: str,
    questions: list[dict],
    key: str,
) -> dict:
    return assert_ok(
        request.post(
            BASE + "/api/v1/content-prep/batches",
            data={
                "idempotencyKey": key,
                "clientInstanceId": f"playwright-{stamp}",
                "targetBankId": bank_id,
                "creatorId": "creator_001",
                "prepVersion": "0.4.0",
                "workspaceVersion": "4",
                "questions": [
                    {"question": item, "baseRevision": None, "lockToken": None}
                    for item in questions
                ],
                "principles": {},
                "synthesisPresets": {},
                "tagConfig": {},
            },
        ),
        f"upload {key}",
    )


def select_creator(page: Page) -> None:
    cards = page.locator("[data-creator-key]")
    assert cards.count() == 6
    ids = set(cards.locator(".creator-id").all_inner_texts())
    names = set(cards.locator(".creator-name").all_inner_texts())
    assert ids == set(CREATORS)
    assert names == set(CREATORS.values())
    page.locator('[data-creator-key="peiqi"]').click()
    page.locator("#creatorGate").wait_for(state="hidden")


def create_shared_draft(page: Page, title: str) -> str:
    page.locator("#sharedDraftGate").wait_for(state="visible")
    page.once("dialog", lambda dialog: dialog.accept(title))
    page.locator("#btnCreateSharedDraft").click()
    page.locator("#sharedDraftGate").wait_for(state="hidden")
    draft_id = page.evaluate("prepRuntime.draftId")
    assert draft_id
    return draft_id


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    guest = browser.new_context()
    admin = browser.new_context()
    teacher = browser.new_context()
    student = browser.new_context()
    viewer = browser.new_context()
    stamp = str(int(time.time() * 1000))
    bank_ids: list[str] = []
    draft_id = ""
    try:
        guest_response = guest.request.get(BASE + "/content-prep", max_redirects=0)
        assert guest_response.status == 200
        assert 'id="prepApp"' in guest_response.text()

        login(student.request, "学生", "111111")
        login(viewer.request, "乔治008", "111111")
        for role_context, role in [(student, "student"), (viewer, "viewer")]:
            denied = role_context.request.get(BASE + "/content-prep")
            assert denied.status == 403, (role, denied.status, denied.text())

        login(admin.request, "admin", "jbgsnmm~123")
        login(teacher.request, "老师", "111111")
        for role_context in (admin, teacher):
            allowed = role_context.request.get(BASE + "/content-prep")
            assert allowed.ok, (allowed.status, allowed.text())

        private_bank = assert_ok(
            admin.request.post(
                BASE + "/api/v1/content-prep/banks",
                data={
                    "name": f"Prep 私有题库 {stamp}",
                    "subject": "PMP",
                    "description": "验证已有题库选择与内部题隔离",
                    "visibility": "private",
                    "creatorId": "creator_001",
                },
            ),
            "create private bank",
        )["bank"]
        bank_ids.append(private_bank["id"])

        prep_page = admin.new_page()
        prep_page.goto(BASE + "/content-prep", wait_until="networkidle")
        select_creator(prep_page)
        draft_title = f"Prep 共享草稿 {stamp}"
        draft_id = create_shared_draft(prep_page, draft_title)
        prep_page.locator('#tabs [data-tab="export"]').click()
        prep_page.locator("#serverBankSelect").wait_for(state="visible")
        prep_page.locator(
            f'#serverBankSelect option[value="{private_bank["id"]}"]'
        ).wait_for(state="attached")
        prep_page.locator("#serverBankSelect").select_option(private_bank["id"])

        ui_bank_name = f"Prep 页面新建题库 {stamp}"
        prep_page.once("dialog", lambda dialog: dialog.accept(ui_bank_name))
        prep_page.locator("#btnCreateServerBank").click()
        prep_page.wait_for_function(
            "name => [...document.querySelectorAll('#serverBankSelect option')].some(option => option.textContent.includes(name))",
            arg=ui_bank_name,
        )
        ui_bank_id = prep_page.locator("#serverBankSelect").input_value()
        assert ui_bank_id and ui_bank_id != private_bank["id"]
        bank_ids.append(ui_bank_id)
        prep_page.locator("#serverBankSelect").select_option(private_bank["id"])

        round_trip = prep_page.evaluate(
            """() => {
              const bundle=PMPPrepServices.ExportService.completeBundle();
              const imported=PMPPrepServices.ImportService.completeBundle(bundle);
              return {format:bundle.format,name:imported.questionBank.name,count:imported.questionBank.questions.length};
            }"""
        )
        assert round_trip["format"] == "pmp-content-prep-complete-bundle-v1"
        assert round_trip["name"]

        prep_page.locator("#btnQuickSaveWorkspace").click()
        prep_page.wait_for_function("() => prepRuntime.draftRevision >= 2 && !prepRuntime.dirty")
        prep_page.reload(wait_until="networkidle")
        select_creator(prep_page)
        prep_page.wait_for_function(
            "draftId => prepRuntime.draftId === draftId || !document.querySelector('#sharedDraftGate').classList.contains('hidden')",
            arg=draft_id,
        )
        if prep_page.locator("#sharedDraftGate").is_visible():
            prep_page.locator(f'[data-open-draft="{draft_id}"]').wait_for(state="visible")
            prep_page.locator(f'[data-open-draft="{draft_id}"]').click()
            prep_page.locator("#sharedDraftGate").wait_for(state="hidden")
        prep_page.wait_for_function(
            "bankId => prepRuntime.serverBankId === bankId",
            arg=private_bank["id"],
        )
        prep_page.locator('#tabs [data-tab="export"]').click()
        prep_page.locator("#btnSyncToCatalog").wait_for(state="visible")
        assert prep_page.locator("#btnSyncToCatalog").inner_text() == "确认同步到主程序"

        private_question_id = str(uuid4())
        private_title = f"Prep 上传后立即可见 {stamp}"
        private_upload = upload(
            admin.request,
            stamp=stamp,
            bank_id=private_bank["id"],
            questions=[question(private_question_id, private_title, scope="internal")],
            key=f"private-{stamp}",
        )
        assert private_upload["questions"][0]["revision"] == 1

        published_bank = assert_ok(
            admin.request.post(
                BASE + "/api/v1/content-prep/banks",
                data={
                    "name": f"Prep 公开题库 {stamp}",
                    "subject": "PMP",
                    "description": "验证 public/internal 学习可见性",
                    "visibility": "published",
                    "creatorId": "creator_001",
                },
            ),
            "create published bank",
        )["bank"]
        bank_ids.append(published_bank["id"])
        public_question_id = str(uuid4())
        internal_question_id = str(uuid4())
        upload(
            admin.request,
            stamp=stamp,
            bank_id=published_bank["id"],
            questions=[
                question(public_question_id, f"公开学习题 {stamp}", scope="public"),
                question(internal_question_id, f"发布库内部题 {stamp}", scope="internal"),
            ],
            key=f"published-{stamp}",
        )

        teacher_catalog = assert_ok(
            admin.request.get(
                BASE + "/api/v1/question-catalog/bootstrap?mode=managed&include_questions=true"
            ),
            "managed catalog",
        )
        managed_ids = {item["id"] for item in teacher_catalog["questions"]}
        assert {private_question_id, public_question_id, internal_question_id} <= managed_ids
        learning_catalog = assert_ok(
            student.request.get(
                BASE + "/api/v1/question-catalog/bootstrap?mode=learning&include_questions=true"
            ),
            "learning catalog",
        )
        learning_ids = {item["id"] for item in learning_catalog["questions"]}
        assert public_question_id in learning_ids
        assert private_question_id not in learning_ids
        assert internal_question_id not in learning_ids

        teacher_page = admin.new_page()
        teacher_page.goto(
            BASE + f"/question-bank?bankId={private_bank['id']}&questionId={private_question_id}",
            wait_until="networkidle",
        )
        teacher_page.wait_for_function(
            "([id, title]) => window.KGQuestionBankAdminAPI?.getCurrentQuestion?.()?.id === id "
            "&& document.getElementById('questionTitleInput')?.value === title",
            arg=[private_question_id, private_title],
        )
        current = teacher_page.evaluate("window.KGQuestionBankAdminAPI.getCurrentQuestion()")
        assert current["creatorId"] == "creator_001"
        assert current["creatorName"] == "波塞冬"
        assert current["revision"] == 1
        print("content-prep-question-bank-e2e-ok")
    finally:
        if draft_id:
            admin.request.delete(BASE + f"/api/v1/content-prep/drafts/{draft_id}")
        for bank_id in reversed(bank_ids):
            admin.request.delete(BASE + f"/api/v1/banks/{bank_id}")
        guest.close()
        admin.close()
        teacher.close()
        student.close()
        viewer.close()
        browser.close()
