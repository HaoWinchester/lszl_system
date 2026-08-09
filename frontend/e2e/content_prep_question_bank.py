import os
import time

from playwright.sync_api import sync_playwright


BASE = os.environ.get("E2E_BASE_URL", "http://127.0.0.1:8000").rstrip("/")


def assert_ok(response, label: str) -> dict:
    assert response.ok, (label, response.status, response.text())
    return response.json()


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()
    stamp = str(int(time.time() * 1000))
    bank_id = ""
    try:
        assert_ok(
            context.request.post(
                BASE + "/api/v1/auth/login",
                data={"username": "admin", "password": "admin123"},
            ),
            "admin login",
        )
        bank = assert_ok(
            context.request.post(
                BASE + "/api/v1/content-prep/banks",
                data={
                    "name": f"Prep 即时入库 E2E {stamp}",
                    "subject": "PMP",
                    "description": "验证上传成功后立即进入正式题库",
                    "visibility": "private",
                    "creatorId": "creator_001",
                },
            ),
            "create content prep bank",
        )["bank"]
        bank_id = bank["id"]
        question_id = f"q-prep-e2e-{stamp}"
        title = f"Prep 上传后立即可见 {stamp}"
        batch_idempotency = f"prep-e2e-{stamp}"
        upload = assert_ok(
            context.request.post(
                BASE + "/api/v1/content-prep/batches",
                data={
                    "idempotencyKey": batch_idempotency,
                    "clientInstanceId": f"playwright-{stamp}",
                    "targetBankId": bank_id,
                    "creatorId": "creator_001",
                    "prepVersion": "0.4.0",
                    "workspaceVersion": "1",
                    "questions": [
                        {
                            "question": {
                                "id": question_id,
                                "title": title,
                                "type": "single_choice",
                                "subject": "PMP",
                                "difficulty": "基础",
                                "domain": "整合",
                                "topic": "即时入库",
                                "tags": ["内部使用", "基础练习"],
                                "stage": "基础练习",
                                "stemParts": [{"text": "题目录入成功后，系统应当何时允许教师查看？"}],
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
                                        {"groupId": "source", "categoryId": "scope", "label": "内部使用"},
                                    ]
                                },
                                "status": {"contentReady": True},
                                "lifecycle": {"status": "active"},
                            },
                            "baseRevision": None,
                            "lockToken": None,
                        }
                    ],
                    "principles": {},
                    "synthesisPresets": {},
                    "tagConfig": {},
                },
            ),
            "upload content prep batch",
        )
        assert upload["questions"][0]["questionId"] == question_id
        assert upload["questions"][0]["revision"] == 1

        batch = assert_ok(
            context.request.get(BASE + f"/api/v1/content-prep/batches/{upload['batchId']}"),
            "read committed batch",
        )["batch"]
        assert batch["status"] == "committed"

        page = context.new_page()
        page.goto(
            BASE + f"/question-bank?bankId={bank_id}&questionId={question_id}",
            wait_until="networkidle",
        )
        page.wait_for_function(
            "([id, title]) => window.KGQuestionBankAdminAPI?.getCurrentQuestion?.()?.id === id "
            "&& document.getElementById('questionTitleInput')?.value === title",
            arg=[question_id, title],
        )
        current = page.evaluate("window.KGQuestionBankAdminAPI.getCurrentQuestion()")
        assert current["id"] == question_id
        assert current["title"] == title
        assert current["creatorId"] == "creator_001"
        assert current["creatorName"] == "波塞冬"
        assert current["revision"] == 1
        print("content-prep-question-bank-e2e-ok")
    finally:
        if bank_id:
            context.request.delete(BASE + f"/api/v1/banks/{bank_id}")
        context.close()
        browser.close()
