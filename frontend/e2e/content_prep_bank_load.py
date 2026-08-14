"""Browser regression for loading a whole Content Prep bank by selection."""

import os
import re
import time
from uuid import uuid4

from playwright.sync_api import APIRequestContext, Page, sync_playwright


BASE = os.environ.get("E2E_BASE_URL", "http://127.0.0.1:8000").rstrip("/")
ADMIN_PASSWORD = os.environ.get("E2E_ADMIN_PASSWORD", "jbgsnmm~123")


def assert_ok(response, label: str) -> dict:
    assert response.ok, (label, response.status, response.text())
    return response.json()


def login(request: APIRequestContext) -> None:
    assert_ok(
        request.post(
            BASE + "/api/v1/auth/login",
            data={
                "username": "admin",
                "password": ADMIN_PASSWORD,
                "acceptedTermsVersion": "2026-08-13-v1",
            },
        ),
        "login admin",
    )


def question(question_id: str, title: str) -> dict:
    return {
        "id": question_id,
        "title": title,
        "type": "single_choice",
        "subject": "PMP",
        "difficulty": "基础",
        "domain": "题库载入",
        "topic": "选择即载入",
        "tags": ["内部使用"],
        "scope": "internal",
        "stage": "基础练习",
        "stemParts": [{"text": "选择题库后应如何载入已有题目？"}],
        "options": [
            {"id": "A", "text": "逐个手输题目 ID", "correct": False},
            {"id": "B", "text": "一次载入整个题库", "correct": True},
        ],
        "correctAnswer": "B",
        "analysis": "题库选择会读取该题库的全部题目到共享草稿。",
        "clues": [],
        "concepts": [],
        "reasoningSteps": [],
        "keyPath": {"answerId": "B"},
        "metadata": {},
        "status": {"contentReady": True},
        "lifecycle": {"status": "active"},
    }


def create_bank(request: APIRequestContext, stamp: str, name: str) -> dict:
    return assert_ok(
        request.post(
            BASE + "/api/v1/content-prep/banks",
            data={
                "name": name,
                "subject": "PMP",
                "description": "Content Prep 题库选择载入回归",
                "visibility": "private",
                "creatorId": "creator_001",
            },
        ),
        "create bank",
    )["bank"]


def upload_questions(
    request: APIRequestContext, stamp: str, bank_id: str, questions: list[dict]
) -> None:
    response = request.post(
        BASE + "/api/v1/content-prep/batches",
        data={
            "idempotencyKey": f"bank-load-{stamp}",
            "clientInstanceId": f"bank-load-{stamp}",
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
    )
    assert_ok(response, "upload source questions")


def choose_creator(page: Page) -> None:
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


def wait_for_status(page: Page, text: str) -> None:
    page.wait_for_function(
        "expected => document.getElementById('serverCatalogStatus').textContent.includes(expected)",
        arg=text,
        timeout=10_000,
    )


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()
    stamp = str(int(time.time() * 1000))
    bank_ids: list[str] = []
    try:
        login(context.request)
        populated = create_bank(context.request, stamp, f"选择载入题库 {stamp}")
        empty = create_bank(context.request, stamp, f"选择载入空题库 {stamp}")
        bank_ids.extend([populated["id"], empty["id"]])
        question_ids = [str(uuid4()), str(uuid4())]
        upload_questions(
            context.request,
            stamp,
            populated["id"],
            [
                question(question_ids[0], f"选择载入第一题 {stamp}"),
                question(question_ids[1], f"选择载入第二题 {stamp}"),
            ],
        )

        page = context.new_page()
        page.goto(BASE + "/content-prep", wait_until="networkidle")
        choose_creator(page)
        create_shared_draft(page, f"整库载入共享草稿 {stamp}")
        page.locator(
            f'#serverSourceBankSelect option[value="{populated["id"]}"]'
        ).wait_for(state="attached")

        bank_questions_pattern = re.compile(
            rf".*/api/v1/question-catalog/banks/{re.escape(populated['id'])}/questions\\?.*"
        )
        intercepted_requests: list[str] = []

        def abort_bank_load(route) -> None:
            intercepted_requests.append(route.request.url)
            route.abort()

        page.route(bank_questions_pattern, abort_bank_load)
        page.locator("#serverSourceBankSelect").select_option(populated["id"])
        page.wait_for_timeout(300)
        assert intercepted_requests, page.locator("#serverCatalogStatus").inner_text()
        wait_for_status(page, "无法连接服务器")
        assert page.locator("#serverSourceBankSelect").input_value() == ""
        assert page.locator("#serverSourceBankSelect").is_enabled()
        page.unroute(bank_questions_pattern)

        page.locator("#serverSourceBankSelect").select_option(populated["id"])
        wait_for_status(page, "已载入 2 道题目")
        assert page.evaluate(
            "ids => state.questionBank.questions.length === ids.length && ids.every(id => state.questionBank.questions.some(question => question.id === id))",
            question_ids,
        )
        assert "已载入 2 道题目" in page.locator("#serverCatalogStatus").inner_text()
        assert page.locator("#serverSourceBankSelect").input_value() == populated["id"]
        assert page.evaluate("() => prepRuntime.dirty") is False
        assert page.evaluate("() => prepRuntime.draftRevision >= 2")

        loaded_ids = page.evaluate(
            "() => state.questionBank.questions.map(question => question.id)"
        )

        page.locator('button[data-tab="questions"]').click()
        page.locator("#btnNewQuestion").click()
        assert page.evaluate("() => state.questionBank.questions.some(question => question.id === state.currentQuestionId)")
        page.locator('button[data-tab="base"]').click()
        page.once("dialog", lambda dialog: dialog.dismiss())
        page.locator("#serverSourceBankSelect").select_option(empty["id"])
        wait_for_status(page, "已取消载入")
        assert len(page.evaluate("() => state.questionBank.questions")) == len(loaded_ids) + 1
        assert page.evaluate("() => state.questionBank.questions.some(question => question.id === state.currentQuestionId)")
        assert page.locator("#serverSourceBankSelect").input_value() == populated["id"]

        page.once("dialog", lambda dialog: dialog.accept())
        page.locator("#serverSourceBankSelect").select_option(empty["id"])
        wait_for_status(page, "该题库暂无题目")
        assert len(page.evaluate("() => state.questionBank.questions")) == len(loaded_ids) + 1
        assert page.evaluate("() => state.questionBank.questions.some(question => question.id === state.currentQuestionId)")
        assert page.locator("#serverSourceBankSelect").input_value() == populated["id"]
        assert page.locator("#serverSourceBankSelect").is_enabled()

        page.locator('button[data-tab="questions"]').click()
        page.once("dialog", lambda dialog: dialog.accept())
        page.locator("#btnDeleteQuestion").click()
        page.wait_for_function(
            "count => state.questionBank.questions.length === count", arg=len(loaded_ids)
        )
        page.locator('button[data-tab="base"]').click()
        page.locator("#btnQuickSaveWorkspace").click()
        page.wait_for_function("() => !prepRuntime.dirty && prepRuntime.draftRevision >= 3")

        page.locator('button[data-tab="export"]').click()
        page.locator('#tab-export.active').wait_for(state="visible")
        page.locator("#btnSyncToCatalog").click()
        wait_for_status(page, "已同步到主程序")
        page.locator("#sharedDraftGate").wait_for(state="visible")
        server_questions = assert_ok(
            context.request.get(
                BASE
                + f'/api/v1/question-catalog/banks/{populated["id"]}/questions?page_size=200'
            ),
            "reload populated bank",
        )["questions"]
        assert {item["id"] for item in server_questions} == set(question_ids)
        assert all(item["revision"] == 1 for item in server_questions), server_questions
        print("content-prep-bank-load-e2e-ok")
    finally:
        for bank_id in reversed(bank_ids):
            context.request.delete(BASE + f"/api/v1/banks/{bank_id}")
        context.close()
        browser.close()
