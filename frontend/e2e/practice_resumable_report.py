#!/usr/bin/env python3
"""Real FastAPI/PostgreSQL/browser proof for resumable PMP practice reports."""

import asyncio
import os
from pathlib import Path
import sys
from uuid import uuid4

from playwright.sync_api import sync_playwright
from sqlalchemy import delete

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.core.security import hash_password, now_utc  # noqa: E402
from app.db.session import AsyncSessionLocal  # noqa: E402
from app.models.paper_release import PaperRelease, PaperReleaseQuestion  # noqa: E402
from app.models.question import Question, QuestionBank  # noqa: E402
from app.models.subscription import Subscription  # noqa: E402
from app.models.training import LearningEvent, PracticeMistake, PracticeSession, TrainingProgress  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services import question_catalog_service  # noqa: E402


BASE_URL = os.environ.get("PRACTICE_E2E_BASE_URL", "http://127.0.0.1:53765")
PASSWORD = "practice-e2e-pass"
TOKEN = uuid4().hex[:10]
IDS = {
    "teacher": f"practice-e2e-teacher-{TOKEN}",
    "student": f"practice-e2e-student-{TOKEN}",
    "other": f"practice-e2e-other-{TOKEN}",
    "bank": f"practice-e2e-bank-{TOKEN}",
    "paper": f"practice-e2e-paper-{TOKEN}",
    "release": f"practice-e2e-release-{TOKEN}",
}


async def seed() -> None:
    async with AsyncSessionLocal() as db:
        db.add_all([
            User(username=IDS["teacher"], password_hash=hash_password(PASSWORD), role="teacher", status="active"),
            User(username=IDS["student"], password_hash=hash_password(PASSWORD), role="student", status="active"),
            User(username=IDS["other"], password_hash=hash_password(PASSWORD), role="student", status="active"),
        ])
        await db.flush()
        db.add(QuestionBank(
            id=IDS["bank"], source_id=f"source-{IDS['bank']}", owner_id=IDS["teacher"],
            name=f"PMP E2E 题库 {TOKEN}", subject="PMP", visibility="published",
            created_by=IDS["teacher"], updated_by=IDS["teacher"],
        ))
        await db.flush()
        domains = ["people"] * 25 + ["process"] * 30 + ["business-environment"] * 5
        questions = []
        for index, domain in enumerate(domains):
            question = Question(
                id=f"practice-e2e-q-{TOKEN}-{index:03d}", source_id=f"practice-e2e-source-{TOKEN}-{index:03d}",
                bank_id=IDS["bank"], title=f"E2E 模拟题 {index + 1}", subject="PMP", scope="internal",
                stem_parts=[{"text": f"E2E 第 {index + 1} 题：请选择正确答案。"}],
                options=[{"id": "A", "text": "正确答案", "correct": True}, {"id": "B", "text": "干扰项", "correct": False}],
                correct_answer="A", analysis=f"E2E 第 {index + 1} 题解析",
                content_metadata={"subjectFacets": [{"dimensionId": "exam-domain", "valueId": domain}]},
                created_by=IDS["teacher"], updated_by=IDS["teacher"],
            )
            db.add(question)
            questions.append(question)
        await db.flush()
        db.add(PaperRelease(
            id=IDS["release"], paper_id=IDS["paper"], version=1, status="published",
            name=f"PMP 可恢复模拟卷 {TOKEN}", subject="PMP", publisher_id=IDS["teacher"],
            access_level="free", enabled_modes=["practice_mode"], allowed_roles=["student"],
            release_metadata={}, source_payload={}, question_count=60, published_at=now_utc(),
        ))
        await db.flush()
        for index, question in enumerate(questions):
            db.add(PaperReleaseQuestion(
                release_id=IDS["release"], order_index=index, bank_id=IDS["bank"],
                question_id=question.id, snapshot=question_catalog_service.question_to_payload(question),
            ))
        await db.commit()


async def cleanup() -> None:
    async with AsyncSessionLocal() as db:
        await db.execute(delete(LearningEvent).where(LearningEvent.owner_id.in_([IDS["student"], IDS["other"]])))
        await db.execute(delete(PracticeMistake).where(PracticeMistake.release_id == IDS["release"]))
        await db.execute(delete(TrainingProgress).where(TrainingProgress.release_id == IDS["release"]))
        await db.execute(delete(PracticeSession).where(PracticeSession.release_id == IDS["release"]))
        await db.execute(delete(PaperReleaseQuestion).where(PaperReleaseQuestion.release_id == IDS["release"]))
        await db.execute(delete(PaperRelease).where(PaperRelease.id == IDS["release"]))
        await db.execute(delete(Question).where(Question.bank_id == IDS["bank"]))
        await db.execute(delete(QuestionBank).where(QuestionBank.id == IDS["bank"]))
        await db.execute(delete(Subscription).where(Subscription.username.in_([IDS["student"], IDS["other"]])))
        await db.execute(delete(User).where(User.username.in_([IDS["teacher"], IDS["student"], IDS["other"]])))
        await db.commit()


def login(request, username: str) -> None:
    response = request.post(
        f"{BASE_URL}/api/v1/auth/login",
        data={"username": username, "password": PASSWORD, "acceptedTermsVersion": "2026-08-13-v1"},
    )
    assert response.status == 200, response.text()


def run_browser() -> None:
    with sync_playwright() as playwright:
        launch = {"headless": True, "args": ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]}
        if Path("/usr/bin/chromium").exists():
            launch["executable_path"] = "/usr/bin/chromium"
        browser = playwright.chromium.launch(**launch)
        context = browser.new_context(viewport={"width": 1440, "height": 960})
        page = context.new_page()
        page.set_default_timeout(15000)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        login(context.request, IDS["student"])
        page.goto(f"{BASE_URL}/practice-mode.html", wait_until="networkidle")
        card = page.locator(f'[data-paper-id="{IDS["paper"]}"]').first
        card.click()
        page.locator('[name="practiceCount"][value="60"]').check(force=True)

        page.locator('[data-practice-start="challenge"]').click()
        page.locator("#practiceGame").wait_for(state="visible")
        assert page.locator("#practiceAnswerSheet [data-question-id]").count() == 60
        session_id = page.evaluate("KGPracticeMode.snapshot().sessionId")
        assert session_id

        seventh = f"practice-e2e-q-{TOKEN}-006"
        page.locator(f'#practiceAnswerSheet [data-question-id="{seventh}"]').click()
        page.wait_for_timeout(160)
        failed_once = {"value": False}

        def fail_first_answer(route):
            if not failed_once["value"]:
                failed_once["value"] = True
                route.abort()
            else:
                route.continue_()

        page.route("**/api/v1/learning/practice/sessions/*/answers", fail_first_answer)
        page.locator('[data-option-id="B"]').click()
        page.wait_for_timeout(180)
        assert page.locator('[data-option-id="B"]').is_enabled()
        assert "is-pending" in (page.locator('[data-option-id="B"]').get_attribute("class") or "")
        page.unroute("**/api/v1/learning/practice/sessions/*/answers", fail_first_answer)
        page.locator('[data-option-id="B"]').click()
        page.wait_for_timeout(180)
        assert page.locator('[data-option-id="B"]').is_disabled()
        assert "正确答案：A" in page.locator("#practiceExplanationPanel").inner_text()

        page.locator("#practiceExitBtn").click()
        page.route("**/api/v1/learning/practice/sessions/*/pause", lambda route: route.abort(), times=1)
        page.locator("#practiceSaveExitBtn").click()
        page.wait_for_timeout(180)
        assert page.locator("#practiceGame").is_visible()
        assert page.locator("#practiceExitConfirm").is_visible()
        page.unroute("**/api/v1/learning/practice/sessions/*/pause")
        page.locator("#practiceSaveExitBtn").click()
        page.locator("#practiceLobby").wait_for(state="visible")

        context.request.post(f"{BASE_URL}/api/v1/auth/logout")
        login(context.request, IDS["student"])
        page.reload(wait_until="networkidle")
        page.locator(f'[data-paper-id="{IDS["paper"]}"]').first.click()
        page.locator('[data-practice-start="challenge"]').click()
        page.locator("#practiceGame").wait_for(state="visible")
        assert "错误" in (page.locator(f'#practiceAnswerSheet [data-question-id="{seventh}"]').get_attribute("aria-label") or "")

        page.locator("#practiceAnswerSheet [data-answer-submit]").click()
        assert page.locator("#practiceSubmitConfirm").is_visible()
        assert "59 题未作答" in page.locator("#practiceSubmitMessage").inner_text()
        page.locator("#practiceSubmitAnywayBtn").click()
        page.locator(".practice-result-report").wait_for(state="visible")
        result_text = page.locator(".practice-result-report").inner_text()
        assert "幻谱 PMP 模拟成绩分析报告" in result_text
        assert "模拟考试结果：FAIL" in result_text
        assert "人员 42%" in page.locator(".practice-report-pie").text_content()
        assert page.locator('[data-review-question]').count() == 1
        page.locator('[data-review-question]').click()
        assert page.locator("#practiceReviewBackBtn").is_visible()
        assert page.locator('[data-option-id="B"]').is_disabled()
        assert page.locator("#practiceAnswerSheet [data-question-id]").count() == 1
        page.locator("#practiceReviewBackBtn").click()
        assert page.locator(".practice-result-report").is_visible()

        detail = context.request.get(f"{BASE_URL}/api/v1/learning/practice/sessions/{session_id}").json()["session"]
        retry = context.request.post(
            f"{BASE_URL}/api/v1/learning/practice/sessions/{session_id}/complete",
            data={"revision": detail["revision"] - 1},
        )
        assert retry.status == 200
        context.request.post(f"{BASE_URL}/api/v1/auth/logout")
        login(context.request, IDS["other"])
        hidden = context.request.get(f"{BASE_URL}/api/v1/learning/practice/sessions/{session_id}")
        assert hidden.status == 404

        for mode in ["challenge", "scholar"]:
            response = context.request.post(
                f"{BASE_URL}/api/v1/learning/practice/sessions/start",
                data={"paperId": IDS["paper"], "releaseId": IDS["release"], "mode": mode, "count": 60, "order": "paper"},
            )
            assert response.status == 200, (mode, response.text())
            created = response.json()["session"]
            assert created["mode"] == mode and created["domainWeights"] == {"people": 42, "process": 50, "business-environment": 8}
            abandoned = context.request.post(
                f"{BASE_URL}/api/v1/learning/practice/sessions/{created['id']}/abandon",
                data={"revision": created["revision"]},
            )
            assert abandoned.status == 200
        no_revenge = context.request.post(
            f"{BASE_URL}/api/v1/learning/practice/sessions/start",
            data={"paperId": IDS["paper"], "releaseId": IDS["release"], "mode": "revenge", "count": 60, "order": "paper"},
        )
        assert no_revenge.status == 422
        assert no_revenge.json()["detail"]["code"] == "NO_REVENGE_QUESTIONS"

        context.request.post(f"{BASE_URL}/api/v1/auth/logout")
        login(context.request, IDS["student"])
        revenge_response = context.request.post(
            f"{BASE_URL}/api/v1/learning/practice/sessions/start",
            data={"paperId": IDS["paper"], "releaseId": IDS["release"], "mode": "revenge", "count": 60, "order": "paper"},
        )
        assert revenge_response.status == 200, revenge_response.text()
        revenge = revenge_response.json()["session"]
        assert revenge["mode"] == "revenge" and revenge["stats"]["total"] == 1
        abandoned = context.request.post(
            f"{BASE_URL}/api/v1/learning/practice/sessions/{revenge['id']}/abandon",
            data={"revision": revenge["revision"]},
        )
        assert abandoned.status == 200
        assert not errors, errors
        context.close()
        browser.close()


if __name__ == "__main__":
    asyncio.run(seed())
    try:
        run_browser()
    finally:
        asyncio.run(cleanup())
    print("practice-resumable-report-e2e-ok")
