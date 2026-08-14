"""Isolated browser E2E for Prep Recall binding into learner Deep Recall."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import tempfile

from playwright.sync_api import BrowserContext, Page, sync_playwright


REPO_ROOT = Path(__file__).resolve().parents[2]
HARNESS_PATH = Path(__file__).with_name("v90-p4529-deep-recall-database-browser.py")
QUESTION_ID = "45290000-0000-4000-8000-000000000001"
BANK_ID = "content-prep-recall-browser-bank"
STUDENT = "content-prep-recall-browser-student"
PASSWORD = "ContentPrepRecall-111111"


def load_shared_harness():
    spec = importlib.util.spec_from_file_location("deep_recall_browser_harness", HARNESS_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


SEED_CODE = f"""
import asyncio
from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.question import QuestionBank
from app.models.user import User

async def main():
    async with AsyncSessionLocal() as db:
        db.add(User(username={STUDENT!r}, password_hash=hash_password({PASSWORD!r}), role='student', status='active', subject='PMP'))
        await db.flush()
        db.add(QuestionBank(id={BANK_ID!r}, owner_id='admin', name='Prep Recall 浏览器题库', subject='PMP', visibility='published'))
        await db.commit()

asyncio.run(main())
"""


def content_bundle() -> dict:
    return {
        "prepContentBundleVersion": 1,
        "format": "pmp-content-prep-complete-bundle-v1",
        "questionBank": {
            "id": "prep-browser-import-bank",
            "name": "Prep Recall 浏览器导入",
            "subject": "PMP",
            "visibility": "published",
            "questions": [
                {
                    "id": QUESTION_ID,
                    "title": "团队成员不堪重负时如何支持",
                    "type": "single_choice",
                    "subject": "PMP",
                    "scope": "public",
                    "difficulty": "基础",
                    "stemParts": [{"text": "团队成员不堪重负，项目经理应该怎么做？"}],
                    "options": [
                        {"id": "A", "text": "继续增加工作", "correct": False},
                        {"id": "B", "text": "识别工作负荷并提供支持", "correct": True},
                        {"id": "C", "text": "忽略团队反馈", "correct": False},
                        {"id": "D", "text": "立即替换成员", "correct": False},
                    ],
                    "correctAnswer": "B",
                    "analysis": "先识别负荷，再为团队提供支持。",
                    "translations": {"en": {"analysis": "Assess workload and support the team."}},
                    "clues": [
                        {
                            "id": "clue-overloaded",
                            "text": "不堪重负",
                            "textEn": "overloaded",
                            "keywordLevel": "normal",
                            "sourceType": "stem",
                            "sourceOptionId": "",
                            "matchLocations": [
                                {"field": "stem", "optionId": "", "count": 1}
                            ],
                            "recallNodeId": "",
                            "recallEntryLabel": "",
                        }
                    ],
                    "metadata": {
                        "knowledge": {
                            "primaryNodeId": "",
                            "relatedNodeIds": [],
                            "mappingStatus": "unmapped",
                            "pathSnapshot": [],
                        }
                    },
                    "status": {"contentReady": True, "keywordsReady": True},
                    "lifecycle": {"status": "active"},
                }
            ],
        },
        "principles": {"schemaVersion": 1, "items": []},
        "synthesisPresets": {"schemaVersion": 1, "items": []},
        "tagConfig": {
            "schemaVersion": 2,
            "names": {},
            "groupNames": {},
            "categoryNames": {},
            "aliases": {},
        },
        "recallLibrary": {
            "schemaVersion": 1,
            "nodes": [
                {
                    "id": "recall:overloaded",
                    "title": "工作负荷与团队支持",
                    "titleEn": "Workload support",
                    "aliases": ["不堪重负"],
                    "prompt": "看到不堪重负，先想到什么？",
                    "priority": 8,
                },
                {
                    "id": "recall:support",
                    "title": "支持团队",
                    "titleEn": "Support the team",
                    "aliases": ["团队支持"],
                    "priority": 4,
                },
            ],
            "edges": [
                {
                    "id": "edge-overloaded-support",
                    "from": "recall:overloaded",
                    "to": "recall:support",
                    "priority": 1,
                    "label": "下一步",
                }
            ],
        },
    }


def assert_ok(response, label: str) -> dict:
    assert response.ok, (label, response.status, response.text())
    return response.json()


def login(context: BrowserContext, base: str, username: str, password: str) -> None:
    assert_ok(
        context.request.post(
            base + "/api/v1/auth/login",
            data={
                "username": username,
                "password": password,
                "acceptedTermsVersion": "2026-08-13-v1",
            },
        ),
        f"login {username}",
    )


def exercise_prep(page: Page, context: BrowserContext, base: str, bundle_path: Path) -> None:
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(f"pageerror: {error}"))
    page.on(
        "console",
        lambda message: errors.append(f"console: {message.text}")
        if message.type == "error"
        else None,
    )

    page.goto(base + "/content-prep", wait_until="networkidle")
    page.locator("[data-creator-key='peiqi']").click()
    page.locator("#sharedDraftGate").wait_for(state="visible")
    page.once("dialog", lambda dialog: dialog.accept("Recall 联动浏览器草稿"))
    page.locator("#btnCreateSharedDraft").click()
    page.locator("#sharedDraftGate").wait_for(state="hidden")

    page.locator("#fileContentBundle").set_input_files(str(bundle_path))
    page.locator("#tabs button[data-tab='questions']").click()
    page.locator("#questionPreview mark[data-kwid='clue-overloaded']").wait_for()
    page.locator("#questionPreview mark[data-kwid='clue-overloaded']").click()
    page.locator("#keywordFloat.show").wait_for()
    page.locator("#floatRecallSearch").fill("不堪重负")
    page.locator("#floatRecall option[value='recall:overloaded']").wait_for(state="attached")
    assert "找到 1 个候选" in page.locator("#floatRecallSearchMeta").inner_text()
    page.locator("#floatRecall").select_option("recall:overloaded")
    assert "recall:overloaded" in page.locator("#floatRecallSearchMeta").inner_text()
    page.locator("#floatSave").click()
    page.locator("#keywordFloat").wait_for(state="hidden")

    detail_search = page.locator("[data-kw-recall-search='clue-overloaded']")
    detail_search.fill("workload")
    detail_select = page.locator("[data-kw-recall-select='clue-overloaded']")
    assert detail_select.input_value() == "recall:overloaded"
    assert "找到 1 个候选" in page.locator(
        "[data-kw-recall-meta='clue-overloaded']"
    ).inner_text()

    detail_select.select_option("")
    assert page.evaluate(
        "state.questionBank.questions[0].clues[0].recallNodeId"
    ) == ""
    detail_search = page.locator("[data-kw-recall-search='clue-overloaded']")
    detail_search.fill("recall:overloaded")
    detail_select = page.locator("[data-kw-recall-select='clue-overloaded']")
    detail_select.select_option("recall:overloaded")
    page.screenshot(path="/tmp/content-prep-recall-search-p4529.png", full_page=True)

    page.locator("#tabs button[data-tab='export']").click()
    page.locator(f"#serverBankSelect option[value='{BANK_ID}']").wait_for(state="attached")
    page.locator("#serverBankSelect").select_option(BANK_ID)
    page.locator("#btnQuickSaveWorkspace").click()
    page.wait_for_function(
        "document.querySelector('#hdrSaveStatus').textContent.includes('共享草稿已保存')"
    )

    page.reload(wait_until="networkidle")
    page.locator("[data-creator-key='peiqi']").click()
    page.locator("#sharedDraftGate").wait_for(state="visible")
    page.locator("[data-open-draft]").first.wait_for()
    page.locator("[data-open-draft]").first.click()
    page.locator("#sharedDraftGate").wait_for(state="hidden")
    page.locator("#tabs button[data-tab='questions']").click()
    restored_select = page.locator("[data-kw-recall-select='clue-overloaded']")
    assert restored_select.input_value() == "recall:overloaded"
    assert page.evaluate("prepRuntime.serverBankId") == BANK_ID

    page.evaluate(
        """
        const clue=state.questionBank.questions[0].clues[0];
        clue.recallNodeId='recall:missing';
        clue.recallEntryLabel='';
        renderKeywords();
        markWorkspaceDirty();
        """
    )
    invalid_select = page.locator("[data-kw-recall-select='clue-overloaded']")
    assert invalid_select.input_value() == "recall:missing"
    assert "已失效：recall:missing" in invalid_select.locator("option:checked").inner_text()
    page.locator("#tabs button[data-tab='export']").click()
    page.locator("#serverBankSelect").select_option(BANK_ID)
    page.locator("#btnQuickSaveWorkspace").click()
    page.wait_for_function(
        "document.querySelector('#hdrSaveStatus').textContent.includes('共享草稿已保存')"
    )
    assert errors == [], errors
    page.locator("#btnSyncToCatalog").click()
    page.wait_for_function(
        "document.querySelector('#serverCatalogIssues').textContent.includes('联想节点不存在')"
    )
    assert errors and all("422" in error for error in errors), errors
    errors.clear()
    assert page.locator("#sharedDraftGate").is_hidden()

    page.locator("#tabs button[data-tab='questions']").click()
    page.locator("[data-kw-recall-select='clue-overloaded']").select_option("")
    assert page.evaluate(
        "state.questionBank.questions[0].clues[0].recallNodeId"
    ) == ""
    corrected_search = page.locator("[data-kw-recall-search='clue-overloaded']")
    corrected_search.fill("不堪重负")
    page.locator("[data-kw-recall-select='clue-overloaded']").select_option(
        "recall:overloaded"
    )
    page.locator("#btnQuickSaveWorkspace").click()
    page.wait_for_function(
        "document.querySelector('#hdrSaveStatus').textContent.includes('共享草稿已保存')"
    )
    page.locator("#tabs button[data-tab='export']").click()
    page.locator("#btnSyncToCatalog").click()
    page.wait_for_function(
        "document.querySelector('#hdrSaveStatus').textContent.includes('已同步到主程序')"
    )
    page.locator("#sharedDraftGate").wait_for(state="visible")

    catalog = assert_ok(
        context.request.get(
            base + f"/api/v1/question-catalog/banks/{BANK_ID}/questions?page=1&page_size=20"
        ),
        "synced question catalog",
    )
    synced = next(item for item in catalog["questions"] if item["id"] == QUESTION_ID)
    assert synced["clues"][0]["recallNodeId"] == "recall:overloaded"
    assert errors == [], errors


def exercise_deep_recall(page: Page, context: BrowserContext, base: str) -> None:
    assert_ok(context.request.post(base + "/api/v1/auth/logout"), "admin logout")
    login(context, base, STUDENT, PASSWORD)
    page.goto(
        f"{base}/knowledge-recall.html?questionId={QUESTION_ID}&bankId={BANK_ID}",
        wait_until="networkidle",
    )
    page.locator("#krQuestionCard").wait_for()
    assert "不堪重负" in page.locator("#krQuestionCard").inner_text()
    page.locator("#krRevealKeywordsBtn").click()
    keyword = page.locator(".kr-keyword-token")
    keyword.wait_for()
    assert "不堪重负" in keyword.inner_text()
    keyword.evaluate("element => element.click()")
    page.locator(".kr-node").wait_for()
    page.locator(".kr-node button").first.click()
    choice = page.locator("#krGuide [data-choice-index]").first
    choice.wait_for()
    assert "支持团队" in choice.inner_text()
    page.screenshot(path="/tmp/content-prep-to-deep-recall-p4529.png", full_page=True)


def main() -> None:
    shared = load_shared_harness()
    harness = shared.IsolatedDeepRecallHarness()
    try:
        base = harness.start()
        shared.run_backend_code(harness.database_url(), SEED_CODE)
        with tempfile.TemporaryDirectory(prefix="content-prep-recall-bundle-") as temp_dir:
            bundle_path = Path(temp_dir) / "bundle.json"
            bundle_path.write_text(
                json.dumps(content_bundle(), ensure_ascii=False),
                encoding="utf-8",
            )
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=True)
                context = browser.new_context(viewport={"width": 1600, "height": 1100})
                try:
                    login(context, base, "admin", "jbgsnmm~123")
                    exercise_prep(context.new_page(), context, base, bundle_path)
                    exercise_deep_recall(context.new_page(), context, base)
                finally:
                    context.close()
                    browser.close()
        print("v90-p4529-content-prep-recall-link-browser-ok")
    finally:
        harness.close()


if __name__ == "__main__":
    main()
