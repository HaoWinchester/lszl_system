import os
import time
from uuid import uuid4

from playwright.sync_api import APIRequestContext, Page, sync_playwright


BASE = os.environ.get("E2E_BASE_URL", "http://127.0.0.1:8000").rstrip("/")


def assert_ok(response, label: str) -> dict:
    assert response.ok, (label, response.status, response.text())
    return response.json()


def login(request: APIRequestContext, username: str, password: str) -> None:
    assert_ok(
        request.post(
            BASE + "/api/v1/auth/login",
            data={"username": username, "password": password},
        ),
        f"login {username}",
    )


def question(question_id: str, title: str) -> dict:
    return {
        "id": question_id,
        "title": title,
        "type": "single_choice",
        "subject": "PMP",
        "difficulty": "基础",
        "domain": "协作编辑",
        "topic": "单题锁",
        "tags": ["内部使用"],
        "scope": "internal",
        "stemParts": [{"text": f"{title} 应如何处理？"}],
        "options": [
            {"id": "A", "text": "同时覆盖", "correct": False},
            {"id": "B", "text": "按单题租约串行编辑", "correct": True},
        ],
        "correctAnswer": "B",
        "analysis": "同一道题只允许一个编辑租约，不同题互不阻塞。",
        "clues": [],
        "concepts": [],
        "reasoningSteps": [],
        "keyPath": {"answerId": "B"},
        "metadata": {},
        "status": {"contentReady": True},
        "lifecycle": {"status": "active"},
    }


def upload_payload(stamp: str, bank_id: str, questions: list[dict], key: str) -> dict:
    return {
        "idempotencyKey": key,
        "clientInstanceId": f"seed-{stamp}",
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
    }


def choose_creator_and_load(page: Page, question_id: str) -> None:
    page.goto(BASE + "/content-prep", wait_until="networkidle")
    page.locator('[data-creator-key="peiqi"]').click()
    page.locator("#creatorGate").wait_for(state="hidden")
    page.locator("#serverQuestionIdInput").fill(question_id)
    page.locator("#btnLoadServerQuestion").click()
    page.wait_for_function(
        "id => window.PMPPrepQuestionLocks?.snapshot?.().questionId === id",
        arg=question_id,
    )
    page.locator('#tabs [data-tab="questions"]').click()
    page.locator('#tab-questions [data-qfield="title"]').wait_for(state="visible")


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    owner = browser.new_context()
    admin = browser.new_context()
    stamp = str(int(time.time() * 1000))
    bank_id = ""
    question_ids = [str(uuid4()) for _ in range(4)]
    try:
        login(owner.request, "老师", "111111")
        login(admin.request, "admin", "jbgsnmm~123")
        bank = assert_ok(
            owner.request.post(
                BASE + "/api/v1/content-prep/banks",
                data={
                    "name": f"单题锁 E2E {stamp}",
                    "subject": "PMP",
                    "description": "并发、离线和幂等验收",
                    "visibility": "private",
                    "creatorId": "creator_001",
                },
            ),
            "create lock bank",
        )["bank"]
        bank_id = bank["id"]
        seeded_questions = [
            question(question_id, f"并发测试题 {index}")
            for index, question_id in enumerate(question_ids, start=1)
        ]
        assert_ok(
            owner.request.post(
                BASE + "/api/v1/content-prep/batches",
                data=upload_payload(stamp, bank_id, seeded_questions[:3], f"seed-{stamp}"),
            ),
            "seed lock questions",
        )

        first_client = f"owner-{stamp}"
        second_client = f"admin-{stamp}"
        first_lock = assert_ok(
            owner.request.post(
                BASE + f"/api/v1/content-prep/locks/{question_ids[0]}",
                data={"clientInstanceId": first_client, "creatorId": "creator_001"},
            ),
            "first editor acquires question one",
        )
        occupied = admin.request.post(
            BASE + f"/api/v1/content-prep/locks/{question_ids[0]}",
            data={"clientInstanceId": second_client, "creatorId": "creator_002"},
        )
        assert occupied.status == 409, (occupied.status, occupied.text())
        assert occupied.json()["detail"]["code"] == "LOCKED_BY_OTHER"

        second_lock = assert_ok(
            admin.request.post(
                BASE + f"/api/v1/content-prep/locks/{question_ids[1]}",
                data={"clientInstanceId": second_client, "creatorId": "creator_002"},
            ),
            "second editor acquires a different question",
        )
        assert second_lock["questionId"] == question_ids[1]

        assert_ok(
            admin.request.delete(
                BASE + f"/api/v1/content-prep/locks/{question_ids[0]}/force"
            ),
            "admin force unlock",
        )
        stale_save = owner.request.put(
            BASE + f"/api/v1/content-prep/questions/{question_ids[0]}",
            data={
                "idempotencyKey": f"stale-save-{stamp}",
                "clientInstanceId": first_client,
                "creatorId": "creator_001",
                "prepVersion": "0.4.0",
                "workspaceVersion": "4",
                "question": seeded_questions[0],
                "baseRevision": 1,
                "lockToken": first_lock["lockToken"],
                "principles": {},
                "synthesisPresets": {},
                "tagConfig": {},
            },
        )
        assert stale_save.status == 409, (stale_save.status, stale_save.text())

        repeat_payload = upload_payload(
            stamp,
            bank_id,
            [seeded_questions[3]],
            f"repeat-{stamp}",
        )
        repeated_first = assert_ok(
            owner.request.post(BASE + "/api/v1/content-prep/batches", data=repeat_payload),
            "first idempotent upload",
        )
        repeated_second = assert_ok(
            owner.request.post(BASE + "/api/v1/content-prep/batches", data=repeat_payload),
            "repeated idempotent upload",
        )
        assert repeated_first["batchId"] == repeated_second["batchId"]
        catalog = assert_ok(
            owner.request.get(
                BASE + f"/api/v1/question-catalog/banks/{bank_id}/questions?page_size=100"
            ),
            "read deduplicated catalog",
        )
        assert sum(row["id"] == question_ids[3] for row in catalog["questions"]) == 1

        offline_page = owner.new_page()
        choose_creator_and_load(offline_page, question_ids[2])
        offline_page.wait_for_function(
            "() => window.PMPPrepQuestionLocks.snapshot().mode === 'server-editable'"
        )
        offline_page.context.set_offline(True)
        offline_page.evaluate("() => window.PMPPrepQuestionLocks.reconfirm()")
        offline_page.wait_for_function(
            "() => window.PMPPrepQuestionLocks.snapshot().mode === 'offline-unsynced'"
        )
        offline_title = f"离线草稿 {stamp}"
        offline_page.locator('[data-qfield="title"]').fill(offline_title)
        offline_page.locator("#btnQuickSaveWorkspace").click()
        offline_page.wait_for_function(
            "title => prepDbGet().then(row => row?.workspace?.questionBank?.questions?.some(q => q.title === title))",
            arg=offline_title,
        )
        offline_page.context.set_offline(False)
        offline_page.locator("#btnReconfirmQuestionLock").click()
        offline_page.wait_for_function(
            "() => window.PMPPrepQuestionLocks.snapshot().mode === 'server-editable'"
        )
        offline_page.close()

        print("content-prep-concurrency-e2e-ok")
    finally:
        if bank_id:
            for question_id in question_ids:
                admin.request.delete(BASE + f"/api/v1/content-prep/locks/{question_id}/force")
            admin.request.delete(BASE + f"/api/v1/banks/{bank_id}")
        owner.close()
        admin.close()
        browser.close()
