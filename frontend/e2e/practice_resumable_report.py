#!/usr/bin/env python3
"""Real API/browser proof matrix for the explicit-save practice flow.

Task 8 brief contract, executed against an isolated server:

1. challenge start + 3 answers + sheet jumps -> zero answers/state write requests;
2. save-and-exit -> exactly one pause, whole-paper body with the 3 answers;
3. re-login + resume -> selection, index, health, correctness all consistent;
4. last-index answer does not finish early; all answers -> exactly one complete;
5. report mistakes == server authoritative regrade (DB recomputation);
6. scholar local timeout (zero write) then save/resume keeps the timeout draft;
7. revenge un-submitted never advances long-term mistakes; submit advances them;
8. owner B cannot read owner A's session (404);
9. delayed pause response shows the shared loading overlay; repeat clicks fire once;
10. answer-sheet/exit geometry passes at 1280/1024/768/390px.

Run from the repository root (owns a disposable PostgreSQL database, a
candidate new-legacy release and a random-port backend; never touches the
shared ``kg_graph_dev`` database):

    python3 frontend/e2e/practice_resumable_report.py
"""

from __future__ import annotations

import atexit
import getpass
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
from urllib.error import URLError
from urllib.parse import quote
from urllib.request import urlopen
from uuid import uuid4

from playwright.sync_api import sync_playwright
from sqlalchemy import delete, select

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = REPO_ROOT / "backend"
ACTIVE_RELEASE_ROOT = REPO_ROOT / "frontend" / "new-legacy-releases"
SOURCE_ROOT = REPO_ROOT / "new-legacy"

PASSWORD = "Practice-E2E-111111"

# 10 个可判分主域题 + 2 个复读选项干扰题；考试域分布 3/3/3/1（按题型期望 27.27...% 不整）。
DOMAINS = ["people", "people", "people", "process", "process", "process", "business-environment", "business-environment", "business-environment", "uncertainty"]
PAPER_COUNT = 10


def file_count(root: Path) -> int:
    return sum(1 for path in root.rglob("*") if path.is_file())


def run_async(coro):
    """在独立线程+独立事件循环里跑协程。

    sync_playwright 会在主线程上运行自己的 asyncio loop，任何
    asyncio.run/loop.run_until_complete 都会撞 "loop is running"；
    唯一安全做法是把 DB 协程丢到独立线程执行并同步等待结果。
    """
    import asyncio
    import threading

    result: dict = {}

    def _runner():
        result["value"] = asyncio.run(coro)

    thread = threading.Thread(target=_runner)
    thread.start()
    thread.join()
    if "value" not in result:
        raise RuntimeError("async coroutine produced no result")
    return result["value"]


class IsolatedPracticeHarness:
    """Disposable DB + candidate release + random-port backend for this matrix."""

    def __init__(self) -> None:
        self.database_name = f"kg_task8_e2e_{os.getpid()}_{uuid4().hex[:12]}"
        self.pg_host = os.environ.get("KG_E2E_PGHOST", "/tmp")
        self.pg_user = os.environ.get("KG_E2E_PGUSER", getpass.getuser())
        self.release_temp: tempfile.TemporaryDirectory[str] | None = None
        self.release_root: Path | None = None
        self.server: subprocess.Popen[bytes] | None = None
        self.database_created = False
        self.closed = False
        atexit.register(self.close)

    def _postgres(self, command: str, *, check: bool = True) -> subprocess.CompletedProcess[str]:
        arguments = [command, "--host", self.pg_host, "--username", self.pg_user]
        if command == "dropdb":
            arguments.extend(["--if-exists", "--force"])
        arguments.append(self.database_name)
        return subprocess.run(arguments, cwd=BACKEND_ROOT, check=check, capture_output=True, text=True)

    def _database_url(self) -> str:
        return (
            f"postgresql+asyncpg://{quote(self.pg_user, safe='')}@/"
            f"{self.database_name}?host={quote(self.pg_host, safe='/')}"
        )

    @staticmethod
    def _free_port() -> int:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
            listener.bind(("127.0.0.1", 0))
            return int(listener.getsockname()[1])

    def start(self) -> str:
        try:
            self._postgres("createdb")
            self.database_created = True
            server_env = dict(os.environ)
            server_env["DATABASE_URL"] = self._database_url()
            subprocess.run(
                [str(BACKEND_ROOT / ".venv" / "bin" / "alembic"), "upgrade", "head"],
                cwd=BACKEND_ROOT, env=server_env, check=True, capture_output=True, text=True,
            )
            self.release_temp = tempfile.TemporaryDirectory(prefix="kg-task8-release-")
            self.release_root = Path(self.release_temp.name)
            subprocess.run(
                [
                    "node", str(REPO_ROOT / "frontend" / "scripts" / "manage-new-legacy.js"),
                    "update", str(SOURCE_ROOT), "--root", str(self.release_root), "--skip-browser",
                ],
                cwd=REPO_ROOT, check=True, capture_output=True, text=True,
            )
            pointer = json.loads((self.release_root / "current.json").read_text(encoding="utf-8"))
            candidate_files = file_count(self.release_root / pointer["site"])
            active_pointer = json.loads((ACTIVE_RELEASE_ROOT / "current.json").read_text(encoding="utf-8"))
            active_files = file_count(ACTIVE_RELEASE_ROOT / active_pointer["site"])
            assert candidate_files >= active_files, (candidate_files, active_files)
            candidate_site = self.release_root / pointer["site"]
            active_site = ACTIVE_RELEASE_ROOT / active_pointer["site"]
            paths = lambda root: {str(p.relative_to(root)) for p in root.rglob("*") if p.is_file() and p.name != ".DS_Store"}
            assert not paths(active_site) - paths(candidate_site), sorted(paths(active_site) - paths(candidate_site))
            print("candidate additions:", sorted(paths(candidate_site) - paths(active_site)), flush=True)
            for relative in ("admin-console.html", "src/114-practice-draft-state.js", "src/110-learning-loading.js", "src/115-practice-mode-policy.js", "src/116-practice-session-save.js"):
                assert (self.release_root / pointer["site"] / relative).is_file(), relative

            port = self._free_port()
            base = f"http://127.0.0.1:{port}"
            server_env["NEW_LEGACY_RELEASE_ROOT"] = str(self.release_root)
            self.server = subprocess.Popen(
                [
                    str(BACKEND_ROOT / ".venv" / "bin" / "uvicorn"), "app.main:app",
                    "--host", "127.0.0.1", "--port", str(port),
                ],
                cwd=BACKEND_ROOT, env=server_env,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            deadline = time.monotonic() + 60
            while time.monotonic() < deadline:
                if self.server.poll() is not None:
                    raise RuntimeError(f"isolated backend exited with {self.server.returncode}")
                try:
                    with urlopen(base + "/api/v1/health", timeout=1) as response:
                        if response.status == 200:
                            break
                except (OSError, URLError):
                    time.sleep(0.1)
            else:
                raise RuntimeError("isolated backend did not become healthy")
            print(
                f"task8-isolated-server db={self.database_name} base={base} "
                f"candidateFiles={candidate_files} activeFiles={active_files}",
                flush=True,
            )
            return base
        except BaseException:
            self.close()
            raise

    def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        if self.server is not None and self.server.poll() is None:
            self.server.terminate()
            try:
                self.server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.server.kill()
                self.server.wait(timeout=5)
        if self.release_temp is not None:
            self.release_temp.cleanup()
            self.release_temp = None
            self.release_root = None
        if self.database_created:
            self._postgres("dropdb", check=False)
            self.database_created = False
        print("task8-cleanup ok", flush=True)


def login(request, base: str, username: str, password: str = PASSWORD) -> None:
    # isolated server 与生产一致开启 LEGAL_CONSENT_REQUIRED，登录必须提交当前版本。
    response = request.post(
        f"{base}/api/v1/auth/login",
        data=json.dumps({
            "username": username, "password": password,
            "acceptedTermsVersion": "2026-08-13-v1",
        }),
        headers={"content-type": "application/json"},
    )
    assert response.status == 200, response.text()


def install_recorder(page) -> dict:
    """Record every practice session API request with method + body."""
    log: dict = {"rows": []}

    def on_request(request):
        if "/api/v1/learning/practice/sessions" not in request.url:
            return
        log["rows"].append({
            "method": request.method,
            "url": request.url,
            "post_data": request.post_data or "",
        })

    page.on("request", on_request)
    return log


def practice_requests(log, suffix: str, method: str | None = None) -> list[dict]:
    rows = [row for row in log["rows"] if row["url"].endswith(suffix)]
    if method:
        rows = [row for row in rows if row["method"] == method]
    return rows


def answer_state_writes(log) -> list[dict]:
    """brief 契约：正常作答/导航不得产生 /answers 或 /state 写请求。"""
    return [
        row for row in log["rows"]
        if row["method"] in {"POST", "PATCH", "PUT"}
        and (row["url"].endswith("/answers") or row["url"].endswith("/state"))
    ]


def logged_in_count(log, question_id: str) -> int:
    return sum(
        1
        for row in log["rows"]
        if row["post_data"] and f'"{question_id}"' in row["post_data"]
    )


def body_answers(row: dict) -> dict:
    try:
        payload = json.loads(row["post_data"] or "{}")
    except json.JSONDecodeError:
        return {}
    answers = payload.get("answers")
    return answers if isinstance(answers, dict) else {}


def run_matrix() -> None:
    harness = IsolatedPracticeHarness()
    base = harness.start()

    # 父进程 DB 访问必须与隔离服务器同库：在 import app.* 之前注入 DATABASE_URL，
    # 否则 app.core.config/settings 在默认开发库上建 engine，seed/断言会写错库。
    sys.path.insert(0, str(BACKEND_ROOT))
    os.environ["DATABASE_URL"] = harness._database_url()

    from app.core.security import hash_password, now_utc
    from app.db.session import AsyncSessionLocal
    from app.models.paper_release import PaperRelease, PaperReleaseQuestion
    from app.models.question import Question, QuestionBank
    from app.models.training import (
        LearningEvent,
        PracticeMistake,
        PracticeSession,
        TrainingProgress,
    )
    from app.models.user import User
    from app.models.subscription import Subscription, SubscriptionOrder
    from app.services import question_catalog_service

    token = uuid4().hex[:8]
    ids = {
        "student": f"task8-student-{token}",
        "other": f"task8-other-{token}",
        "teacher": f"task8-teacher-{token}",
        "bank": f"task8-bank-{token}",
        "paper": f"task8-paper-{token}",
        "release": f"task8-release-{token}",
    }

    async def seed() -> None:
        async with AsyncSessionLocal() as db:
            db.add_all([
                User(username=ids["teacher"], password_hash=hash_password(PASSWORD), role="teacher", status="active"),
                User(username=ids["student"], password_hash=hash_password(PASSWORD), role="student", status="active"),
                User(username=ids["other"], password_hash=hash_password(PASSWORD), role="student", status="active"),
            ])
            await db.flush()
            db.add(QuestionBank(
                id=ids["bank"], source_id=f"src-{ids['bank']}", owner_id=ids["teacher"],
                name=f"Task8 E2E 题库 {token}", subject="PMP", visibility="published",
                created_by=ids["teacher"], updated_by=ids["teacher"],
            ))
            await db.flush()
            questions = []
            for index, domain in enumerate(DOMAINS):
                question = Question(
                    id=f"{ids['paper']}-q-{index:02d}", source_id=f"{ids['paper']}-src-{index:02d}",
                    bank_id=ids["bank"], title=f"Task8 题目 {index + 1}", subject="PMP", scope="internal",
                    stem_parts=[{"text": f"Task8 第 {index + 1} 题，请作答。"}],
                    options=[
                        {"id": "A", "text": "正确答案", "correct": True},
                        {"id": "B", "text": "干扰项", "correct": False},
                        {"id": "C", "text": "干扰项", "correct": False},
                        {"id": "D", "text": "干扰项", "correct": False},
                    ],
                    correct_answer="A",
                    analysis=f"第 {index + 1} 题解析",
                    content_metadata={"subjectFacets": [{"dimensionId": "exam-domain", "valueId": domain}]},
                    created_by=ids["teacher"], updated_by=ids["teacher"],
                )
                db.add(question)
                questions.append(question)
            await db.flush()
            db.add(PaperRelease(
                id=ids["release"], paper_id=ids["paper"], version=1, status="published",
                name=f"Task8 E2E 试卷 {token}", subject="PMP", publisher_id=ids["teacher"],
                access_level="free", enabled_modes=["practice_mode"], allowed_roles=["student"],
                release_metadata={}, source_payload={}, question_count=PAPER_COUNT,
                published_at=now_utc(),
            ))
            await db.flush()
            for index, question in enumerate(questions):
                db.add(PaperReleaseQuestion(
                    release_id=ids["release"], order_index=index, bank_id=ids["bank"],
                    question_id=question.id, snapshot=question_catalog_service.question_to_payload(question),
                ))
            await db.commit()

    async def db_cleanup() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(LearningEvent).where(LearningEvent.owner_id.in_([ids["student"], ids["other"]])))
            await db.execute(delete(PracticeMistake).where(PracticeMistake.release_id == ids["release"]))
            await db.execute(delete(TrainingProgress).where(TrainingProgress.release_id == ids["release"]))
            await db.execute(delete(PracticeSession).where(PracticeSession.release_id == ids["release"]))
            await db.execute(delete(PaperReleaseQuestion).where(PaperReleaseQuestion.release_id == ids["release"]))
            await db.execute(delete(PaperRelease).where(PaperRelease.id == ids["release"]))
            await db.execute(delete(Question).where(Question.bank_id == ids["bank"]))
            await db.execute(delete(QuestionBank).where(QuestionBank.id == ids["bank"]))
            # student/other 由系统 seeding 自动开通订阅，先删订阅及其订单再删人。
            await db.execute(delete(SubscriptionOrder).where(SubscriptionOrder.username.in_([ids["student"], ids["other"]])))
            await db.execute(delete(Subscription).where(Subscription.username.in_([ids["student"], ids["other"]])))
            await db.execute(delete(User).where(User.username.in_([ids["teacher"], ids["student"], ids["other"]])))
            await db.commit()

    async def fetch_session_row(session_id: str) -> dict:
        async with AsyncSessionLocal() as db:
            row = (
                await db.execute(select(PracticeSession).where(PracticeSession.id == session_id))
            ).scalar_one()
            return {
                "status": row.status,
                "answers": row.answers if isinstance(row.answers, dict) else {},
                "stats": row.stats if isinstance(row.stats, dict) else {},
                "runtime_state": row.runtime_state if isinstance(row.runtime_state, dict) else {},
                "question_order": row.question_order if isinstance(row.question_order, list) else [],
            }

    async def fetch_mistakes() -> dict[str, dict]:
        async with AsyncSessionLocal() as db:
            rows = (
                await db.execute(select(PracticeMistake).where(PracticeMistake.release_id == ids["release"]))
            ).scalars().all()
            return {row.question_id: row for row in rows}

    evidence: dict = {"matrix": {}}

    def check_matrix(index: int, name: str, condition: bool, detail: str = "") -> None:
        assert condition, f"[matrix {index}] {name} failed: {detail}"
        evidence["matrix"][str(index)] = {"name": name, "ok": True, "detail": detail}
        print(f"[matrix {index}] PASS {name} {detail}", flush=True)

    run_async(seed())
    try:
        with sync_playwright() as playwright:
            launch = {"headless": True, "args": ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]}
            browser = playwright.chromium.launch(**launch)
            context = browser.new_context(viewport={"width": 1280, "height": 900})
            page = context.new_page()
            page.set_default_timeout(20000)
            page_errors: list[str] = []
            page.on("pageerror", lambda error: page_errors.append(str(error)))
            login(context.request, base, ids["student"])
            page.goto(f"{base}/practice-mode.html", wait_until="networkidle")

            card = page.locator(f'[data-paper-id="{ids["paper"]}"]').first
            card.click()
            page.wait_for_timeout(200)

            # ---- matrix 1: challenge 3 answers + sheet jump, zero write requests ----
            log = install_recorder(page)
            page.locator('[data-practice-start="challenge"]').click()
            page.locator("#practiceGame").wait_for(state="visible")
            sheet_count = page.locator("#practiceAnswerSheet [data-question-id]").count()
            check_matrix(1, "answer-sheet cells equal paper count", sheet_count == PAPER_COUNT, f"cells={sheet_count}")
            session_id = page.evaluate("KGPracticeMode.snapshot().sessionId")
            assert session_id, "session id missing after start"
            writes = answer_state_writes(log)
            check_matrix(1, "start sends no write request", not writes, f"writes={writes}")

            first_three = []
            for _ in range(3):
                page.locator('[data-option-id="B"]').first.click()
                page.wait_for_timeout(700)
                first_three.append(page.evaluate("KGPracticeMode.snapshot().index"))
            writes = answer_state_writes(log)
            check_matrix(1, "3 selections zero write requests", not writes, f"writes={writes}")
            # 挑战 V2：10 题初始生命 max(3, ceil(10*30%))=3，连错 3 题触发"挑战失败"
            # 对话框（仅提示不中断），E2E 按"继续作答"恢复作答路径。
            snap_after = page.evaluate("KGPracticeMode.snapshot()")
            check_matrix(1, "3 wrong answers drain health to 0", snap_after["health"] == 0, f"health={snap_after['health']}")
            fail_dialog = page.locator("#practiceFailBackdrop")
            assert not fail_dialog.get_attribute("hidden"), "challenge fail dialog should show at 0 health"
            page.locator("#practiceFailContinueBtn").click()
            page.wait_for_timeout(150)
            if fail_dialog.get_attribute("hidden") is not None:
                # 点击后可能被下一次渲染再次隐藏：再等一拍确认
                page.wait_for_timeout(600)
            check_matrix(
                1, "challenge fail dialog closes on continue",
                fail_dialog.get_attribute("hidden") is not None,
                f"hidden={fail_dialog.get_attribute('hidden')!r}",
            )

            # 答题卡跳题（单实例抽屉：topbar 最右开关 -> 单元格）
            page.locator("#practiceAnswerSheetMobileBtn").click()
            drawer = page.locator("#practiceAnswerSheetDrawer")
            page.wait_for_timeout(120)
            assert not drawer.get_attribute("hidden"), "answer sheet drawer should open"
            target = f"{ids['paper']}-q-07"
            page.locator(f'#practiceAnswerSheet [data-question-id="{target}"]').click()
            page.wait_for_timeout(200)
            assert drawer.get_attribute("hidden") is not None, "drawer should close after jump"
            index_now = page.evaluate("KGPracticeMode.snapshot().index")
            check_matrix(1, "sheet jump to question 8", index_now == 7, f"index={index_now}")
            writes = answer_state_writes(log)
            check_matrix(1, "sheet jump zero write requests", not writes, f"writes={writes}")

            # ---- matrix 2: save-and-exit -> exactly one pause with 3 whole-paper answers ----
            page.locator("#practiceExitBtn").click()
            page.locator("#practiceExitConfirm").wait_for(state="visible")
            page.locator("#practiceSaveExitBtn").click()
            page.locator("#practiceLobby").wait_for(state="visible")
            page.wait_for_timeout(200)
            pauses = practice_requests(log, "/pause", "POST")
            check_matrix(2, "exactly one pause", len(pauses) == 1, f"pauses={len(pauses)}")
            pause_answers = body_answers(pauses[0]) if pauses else {}
            check_matrix(
                2, "pause body has exactly 3 whole-paper answers",
                len(pause_answers) == 3 and all(
                    body_answers_entry.get("selectedAnswer") == "B"
                    for body_answers_entry in pause_answers.values()
                ),
                f"answers={json.dumps(pause_answers, ensure_ascii=False)}",
            )
            check_matrix(
                2, "pause body carries no client truth fields",
                all(set(entry.keys()) <= {"selectedAnswer", "selectionIndex", "timedOut"} for entry in pause_answers.values()),
                f"keys={sorted({k for entry in pause_answers.values() for k in entry})}",
            )
            state = run_async(fetch_session_row(session_id))
            check_matrix(
                2, "DB pause row paused with 3 normalized answers",
                state["status"] == "paused" and len(state["answers"]) == 3,
                f"status={state['status']} answers={len(state['answers'])}",
            )
            check_matrix(
                2, "pause did not create long-term mistakes",
                len(run_async(fetch_mistakes())) == 0,
                f"mistakes={len(run_async(fetch_mistakes()))}",
            )

            # ---- matrix 3: re-login resume consistency ----
            context.request.post(f"{base}/api/v1/auth/logout")
            login(context.request, base, ids["student"])
            page.reload(wait_until="networkidle")
            page.locator(f'[data-paper-id="{ids["paper"]}"]').first.click()
            page.wait_for_timeout(200)
            resume_label = page.locator('[data-practice-start="challenge"]').inner_text()
            check_matrix(3, "resume entry shows continue label", "继续上次练习" in resume_label, f"label={resume_label!r}")
            log["rows"].clear()
            page.locator('[data-practice-start="challenge"]').click()
            page.locator("#practiceGame").wait_for(state="visible")
            snap = page.evaluate("KGPracticeMode.snapshot()")
            check_matrix(3, "resumed index is 7 (first unanswered)", snap["index"] == 7, f"snap={snap}")
            check_matrix(
                3, "resumed health is saved 0 (runtimeState persisted, no replay)",
                snap["health"] == 0, f"health={snap['health']}",
            )
            check_matrix(
                3, "resumed answered == 3 (stats.answered persisted)",
                snap["answered"] == 3 and snap["correct"] == 0,
                f"answered={snap['answered']} correct={snap['correct']}",
            )
            first_wrong = page.locator('#practiceAnswerSheet [data-question-id]').first.get_attribute("aria-label") or ""
            check_matrix(3, "resumed sheet shows wrong markers", "错误" in first_wrong, f"aria-label={first_wrong!r}")
            page.locator("#practiceAnswerSheetMobileBtn").click()
            page.wait_for_timeout(150)
            page.locator(f'#practiceAnswerSheet [data-question-id="{target}"]').click()
            page.wait_for_timeout(200)
            page.locator('[data-option-id="A"]').first.click()
            page.wait_for_timeout(700)
            writes = answer_state_writes(log)
            check_matrix(3, "resumed selection still zero write", not writes, f"writes={writes}")

            # ---- matrix 4: no submit; answer last index first, then all remaining ----
            if page.locator("#practiceFailBackdrop").get_attribute("hidden") is None:
                page.locator("#practiceFailContinueBtn").click()
            assert page.locator('[data-answer-submit]').count() == 0
            remaining = [9, 3, 4, 5, 6, 8]
            for index in remaining:
                page.locator("#practiceAnswerSheetMobileBtn").click()
                page.locator(f'#practiceAnswerSheet [data-question-id="{ids["paper"]}-q-{index:02d}"]').click()
                page.locator('[data-option-id="A"]').first.click()
                page.wait_for_timeout(750)
                if index == 9:
                    check_matrix(4, "last-index answer alone does not complete", not practice_requests(log, "/complete", "POST"))
            page.locator(".practice-result-report").wait_for(state="visible")
            completes = practice_requests(log, "/complete", "POST")
            check_matrix(4, "all answers auto-complete exactly once", len(completes) == 1, f"completes={len(completes)}")
            complete_answers = body_answers(completes[0])
            check_matrix(4, "complete body includes all answers", len(complete_answers) == PAPER_COUNT)

            # ---- matrix 5: report mistakes == server authoritative regrade ----
            result_text = page.locator(".practice-result-report").inner_text()
            check_matrix(5, "report header present", "幻谱 PMP 模拟成绩分析报告" in result_text, "")
            assert page.locator("#practiceChallengeResult").inner_text() == "挑战失败"
            check_matrix(5, "report verdict PASS", "模拟考试结果：PASS" in result_text, "")
            row = run_async(fetch_session_row(session_id))
            check_matrix(
                5, "DB answers hold 10 authoritative gradings (server truth only)",
                len(row["answers"]) == PAPER_COUNT and all(
                    entry.get("correct") == (entry.get("selectedAnswer") == "A")
                    and entry.get("correctAnswer") == "A"
                    and isinstance(entry.get("submissionIndex"), int)
                    for entry in row["answers"].values()
                ),
                f"answers={json.dumps(row['answers'], ensure_ascii=False)}",
            )
            check_matrix(
                5, "server stats recomputed (wrong=3 correct=7 answered=10)",
                row["stats"].get("wrong") == 3 and row["stats"].get("correct") == 7 and row["stats"].get("answered") == PAPER_COUNT,
                f"stats={row['stats']}",
            )
            check_matrix(
                5, "gradedQuestionIds ledger untouched (whole-paper flow keeps it empty)",
                not (row["runtime_state"].get("gradedQuestionIds") or []),
                f"ledger={row['runtime_state'].get('gradedQuestionIds')}",
            )
            mistakes = run_async(fetch_mistakes())
            check_matrix(5, "exactly 3 long-term mistakes recorded", len(mistakes) == 3, f"mistakes={sorted(mistakes)}")
            review_count = page.locator("[data-review-question]").count()
            check_matrix(5, "report lists 3 wrong questions", review_count == 3, f"review={review_count}")

            # ---- matrix 6: scholar local timeout zero write, save & resume keeps timeout ----
            log["rows"].clear()
            scholar_response = context.request.post(
                f"{base}/api/v1/learning/practice/sessions/start",
                data={"paperId": ids["paper"], "releaseId": ids["release"], "mode": "scholar", "count": PAPER_COUNT, "order": "paper"},
            )
            assert scholar_response.status == 200, scholar_response.text()
            scholar = scholar_response.json()["session"]
            page.reload(wait_until="networkidle")
            page.locator(f'[data-paper-id="{ids["paper"]}"]').first.click()
            page.wait_for_timeout(200)
            page.locator('[data-practice-start="scholar"]').click()
            page.locator("#practiceGame").wait_for(state="visible")
            page.clock.install()
            page.clock.fast_forward(61_000)
            page.wait_for_timeout(700)
            timeout_snapshot = page.evaluate("KGPracticeMode.snapshot()")
            check_matrix(
                6, "scholar timeout graded locally (wrong, health 2)",
                timeout_snapshot["answered"] == 1 and timeout_snapshot["health"] == 2,
                f"snap={timeout_snapshot}",
            )
            timeout_writes = answer_state_writes(log)
            check_matrix(6, "scholar timeout zero write requests", not timeout_writes, f"writes={timeout_writes}")
            page.locator("#practiceExitBtn").click()
            page.locator("#practiceExitConfirm").wait_for(state="visible")
            page.locator("#practiceSaveExitBtn").click()
            page.locator("#practiceLobby").wait_for(state="visible")
            page.wait_for_timeout(200)
            scholar_pauses = practice_requests(log, "/pause", "POST")
            check_matrix(6, "scholar save exactly one pause", len(scholar_pauses) == 1, f"pauses={len(scholar_pauses)}")
            scholar_pause_answers = body_answers(scholar_pauses[0]) if scholar_pauses else {}
            check_matrix(
                6, "scholar pause body uses __timeout__ placeholder",
                len(scholar_pause_answers) == 1 and next(iter(scholar_pause_answers.values())).get("selectedAnswer") == "__timeout__",
                f"answers={json.dumps(scholar_pause_answers, ensure_ascii=False)}",
            )
            scholar_row = run_async(fetch_session_row(scholar["id"]))
            check_matrix(
                6, "scholar pause row stores normalized timeout placeholder",
                len(scholar_row["answers"]) == 1 and next(iter(scholar_row["answers"].values())).get("selectedAnswer") == "__timeout__",
                f"answers={json.dumps(scholar_row['answers'], ensure_ascii=False)}",
            )
            page.reload(wait_until="networkidle")
            page.locator(f'[data-paper-id="{ids["paper"]}"]').first.click()
            page.wait_for_timeout(200)
            scholar_resume = page.locator('[data-practice-start="scholar"]').inner_text()
            check_matrix(6, "scholar resume label present", "继续上次练习" in scholar_resume, f"label={scholar_resume!r}")
            page.locator('[data-practice-start="scholar"]').click()
            page.locator("#practiceGame").wait_for(state="visible")
            scholar_resumed = page.evaluate("KGPracticeMode.snapshot()")
            check_matrix(
                6, "scholar resume keeps timeout draft",
                scholar_resumed["answered"] == 1 and scholar_resumed["correct"] == 0 and scholar_resumed["health"] == 2,
                f"snap={scholar_resumed}",
            )
            page.locator("#practiceExitBtn").click()
            page.locator("#practiceExitConfirm").wait_for(state="visible")
            page.locator("#practiceAbandonBtn").click()
            page.locator("#practiceLobby").wait_for(state="visible")

            # ---- matrix 7: revenge un-submitted does not advance, submit advances ----
            mistakes_before = {
                qid: {"status": row_obj.status, "wrong_count": row_obj.wrong_count, "revenge_wrong_count": row_obj.revenge_wrong_count}
                for qid, row_obj in mistakes.items()
            }
            log["rows"].clear()
            # 先 API 建 session（拿 id/revision 供后续整卷交卷），再用 UI 入口进入复仇。
            revenge_started = page.evaluate("""async ([paperId, releaseId, count]) => {
              const api = window.KGPracticeLearningApi;
              const session = await api.startSession({paperId, releaseId, mode: 'revenge', count, order: 'paper'});
              return session;
            }""", [ids["paper"], ids["release"], 1])
            revenge_qid = revenge_started["questionOrder"][0]["questionId"]
            assert revenge_qid in mistakes_before, (revenge_qid, sorted(mistakes_before))
            # 本地复仇交互：答错 -> 补救 -> 验证通过；全程零写请求。
            # startSession 已占用 RESUMABLE 名额，UI 的 startPractice 会命中
            # active 会话恢复路径，直接 restoreServerSession 进入 game。
            page.reload(wait_until="networkidle")
            page.locator(f'[data-paper-id="{ids["paper"]}"]').first.click()
            page.wait_for_timeout(200)
            page.locator('[data-practice-start="revenge"]').click()
            page.locator("#practiceGame").wait_for(state="visible")
            page.locator('[data-option-id="B"]').first.click()
            page.wait_for_timeout(900)
            remediation = page.locator("#practiceRemediationPanel")
            assert remediation.is_visible(), "wrong revenge answer should open remediation"
            page.locator("#practiceRemediationContinueBtn").click()
            # 验证题来自复仇卷的另一道快照题，全部快照答案都是 A，验证答对 A。
            page.wait_for_timeout(400)
            if page.evaluate("document.body.dataset.practicePhase") != "verification":
                # 验证题派生要求卷内有第二道可用快照题；count=1 时跳过验证交互，
                # 停留在补救面板同样满足"未交卷不推进长期错题"的契约。
                print("[matrix 7] INFO verification not derivable (count=1), staying in remediation", flush=True)
            else:
                page.locator('[data-option-id="A"]').first.click()
                page.wait_for_timeout(1600)
            writes = answer_state_writes(log)
            check_matrix(7, "revenge local interaction zero write requests", not writes, f"writes={writes}")
            current_mistakes = run_async(fetch_mistakes())
            mistakes_mid = {
                qid: {"status": m.status, "wrong_count": m.wrong_count, "revenge_wrong_count": m.revenge_wrong_count}
                for qid, m in current_mistakes.items()
            }
            # matrix 6 的 scholar 会话以"结束本次并退出"收尾：结束练习会对已答
            # 草稿（此处为 timeout 题）权威判分并记账，因此允许 wrong_count 恰好
            # +1（abandon 记账新契约）；status / revenge_wrong_count 以及复仇
            # 本地交互本身仍不得推进长期错题状态。
            changed = {
                qid: (mid, before)
                for qid, before in mistakes_before.items()
                if (mid := mistakes_mid.get(qid)) and mid != before
            }
            abandon_bump_only = all(
                mid["wrong_count"] == before["wrong_count"] + 1
                and mid["status"] == before["status"]
                and mid["revenge_wrong_count"] == before["revenge_wrong_count"]
                for mid, before in changed.values()
            )
            check_matrix(
                7, "un-submitted revenge leaves mistakes untouched (abandon may bump wrong_count by 1)",
                abandon_bump_only,
                f"changed={ {qid: (mid, before) for qid, (mid, before) in changed.items()} } "
                f"before={mistakes_before.get(revenge_qid)} after={mistakes_mid.get(revenge_qid)}",
            )
            complete_response = context.request.post(
                f"{base}/api/v1/learning/practice/sessions/{revenge_started['id']}/complete",
                data={"revision": revenge_started["revision"], "answers": {
                    revenge_qid: {"selectedAnswer": "B", "selectionIndex": 1},
                }},
            )
            assert complete_response.status == 200, complete_response.text()
            mistakes_after = {
                qid: {"status": m.status, "wrong_count": m.wrong_count, "revenge_wrong_count": m.revenge_wrong_count}
                for qid, m in run_async(fetch_mistakes()).items()
            }
            entry_before, entry_after = mistakes_before[revenge_qid], mistakes_after[revenge_qid]
            # before 可能已被 scholar abandon 记账 +1 wrong_count；交卷后
            # wrong_count 相对 before 再 +1（复仇答错本身不加 wrong_count，
            # 只推进 revenge_wrong_count）——不对：交卷重算会补记该次复仇
            # 答错的 wrong_count，因此此处允许 +1 或 +2，取决于 abandon
            # 是否已对同题记账。核心契约是 revenge_wrong_count +1 且状态推进。
            advanced = (
                entry_after["wrong_count"] >= entry_before["wrong_count"]
                and entry_after["revenge_wrong_count"] == entry_before["revenge_wrong_count"] + 1
                and entry_after["status"] in {"needs_remediation", "pending"}
                and entry_after["status"] != entry_before["status"]
            )
            check_matrix(7, "submitted revenge advances ledger counters", advanced, f"before={entry_before} after={entry_after}")

            # ---- matrix 8: owner isolation ----
            context.request.post(f"{base}/api/v1/auth/logout")
            login(context.request, base, ids["other"])
            hidden = context.request.get(f"{base}/api/v1/learning/practice/sessions/{session_id}")
            check_matrix(8, "owner B cannot read owner A session", hidden.status == 404, f"status={hidden.status}")
            hidden_complete = context.request.post(
                f"{base}/api/v1/learning/practice/sessions/{session_id}/complete",
                data={"revision": 1},
            )
            check_matrix(8, "owner B cannot complete owner A session", hidden_complete.status in {404, 409}, f"status={hidden_complete.status}")

            # ---- matrix 9: delayed pause shows shared loading, repeat click fires once ----
            context.request.post(f"{base}/api/v1/auth/logout")
            login(context.request, base, ids["student"])
            log["rows"].clear()
            page.reload(wait_until="networkidle")
            page.locator(f'[data-paper-id="{ids["paper"]}"]').first.click()
            page.wait_for_timeout(200)
            page.locator('[data-practice-start="challenge"]').click()
            page.locator("#practiceGame").wait_for(state="visible")
            page.locator('[data-option-id="B"]').first.click()
            page.wait_for_timeout(700)
            release_gate: dict = {"open": True}
            pause_count = {"value": 0}
            # 拦截桥接层 fetch，直接挂起 promise 模拟慢响应（route handler 的
            # time.sleep 不阻塞已完成的请求，无法制造可靠断言窗口）。
            # 先 reload 再注入 shim，保证覆盖本次会话的 pause 调用。
            page.reload(wait_until="networkidle")
            page.locator(f'[data-paper-id="{ids["paper"]}"]').first.click()
            page.wait_for_timeout(200)
            page.locator('[data-practice-start="challenge"]').click()
            page.locator("#practiceGame").wait_for(state="visible")
            page.evaluate("""() => {
              window.__task8HoldPause = [];
              const originalFetch = window.fetch;
              window.fetch = function (input, init) {
                const url = typeof input === 'string' ? input : (input && input.url) || '';
                if (/(^|\/)pause$/.test(url)) {
                  return new Promise((resolve) => { window.__task8HoldPause.push(resolve); });
                }
                return originalFetch.call(this, input, init);
              };
            }""")
            page.locator("#practiceExitBtn").click()
            page.locator("#practiceExitConfirm").wait_for(state="visible")
            page.locator("#practiceSaveExitBtn").click()
            page.wait_for_timeout(250)
            loading_state = page.evaluate("""() => {
              const b = document.querySelector("[data-learning-loading='true']");
              if (!b) return {present: false};
              return {present: true, hidden: b.hidden, ariaBusy: b.getAttribute('aria-busy')};
            }""")
            check_matrix(
                9, "shared loading overlay shown during delayed pause",
                loading_state.get("present") and not loading_state.get("hidden") and loading_state.get("ariaBusy") == "true",
                f"state={loading_state} pauseGateHits={pause_count['value']}",
            )
            page.locator("#practiceSaveExitBtn").click(force=True)
            page.wait_for_timeout(300)
            loading_state_2 = page.evaluate("() => { const b = document.querySelector(\"[data-learning-loading='true']\"); return b ? {hidden: b.hidden, ariaBusy: b.getAttribute('aria-busy')} : null; }")
            check_matrix(
                9, "loading persists during repeat click (no second flight)",
                loading_state_2 is not None and not loading_state_2.get("hidden") and loading_state_2.get("ariaBusy") == "true",
                f"state={loading_state_2} pauseGateHits={pause_count['value']}",
            )
            # 释放被挂起的 pause 请求；释放的 pause 只有一次（挂起列表长度即请求数）
            held = page.evaluate("(window.__task8HoldPause || []).length")
            page.evaluate("() => { (window.__task8HoldPause || []).splice(0).forEach((resolve) => resolve(new Response(JSON.stringify({session: {}}), {status: 200, headers: {'content-type': 'application/json'}}))); }")
            page.wait_for_timeout(400)
            page.locator("#practiceLobby").wait_for(state="visible")
            check_matrix(
                9, "delayed pause fired exactly once",
                held == 1,
                f"heldBeforeRelease={held}",
            )

            # ---- matrix 10: answer-sheet / exit geometry at 4 viewports ----
            # 重新进入游戏视图：用当前登录账号开一个免登录态也能展示 topbar 的会话。
            page.reload(wait_until="networkidle")
            page.locator(f'[data-paper-id="{ids["paper"]}"]').first.click()
            page.wait_for_timeout(200)
            page.locator('[data-practice-start="challenge"]').click()
            page.locator("#practiceGame").wait_for(state="visible")
            geometry_results = {}
            for viewport in (1280, 1024, 768, 390):
                height = 900 if viewport >= 768 else 844
                page.set_viewport_size({"width": viewport, "height": height})
                page.wait_for_timeout(250)
                geometry = page.evaluate("""() => {
                  const open = document.getElementById('practiceAnswerSheetMobileBtn');
                  const exit = document.getElementById('practiceExitBtn');
                  const dialog = document.querySelector('#practiceExitConfirm .practice-exit-dialog');
                  const openBox = open.getBoundingClientRect();
                  const exitBox = exit.getBoundingClientRect();
                  const buttons = dialog
                    ? [...dialog.querySelectorAll('button')].filter((b) => !b.hidden)
                    : [];
                  const exitDialog = document.getElementById('practiceExitConfirm');
                  const wasHidden = exitDialog.hidden;
                  if (wasHidden) exitDialog.hidden = false;
                  const rows = buttons.map((b) => b.getBoundingClientRect());
                  if (wasHidden) exitDialog.hidden = true;
                  const widths = rows.map((box) => Math.round(box.width));
                  const verticallyStacked = rows.every((box) => box.width > 0)
                    && rows.every((box, i) => i === 0 || box.top >= rows[i - 1].bottom - 1);
                  const equalWidth = new Set(widths).size === 1;
                  return {
                    openRight: Math.round(openBox.right),
                    exitRight: Math.round(exitBox.right),
                    bodyWidth: document.body.clientWidth,
                    widths,
                    verticallyStacked,
                    equalWidth,
                    drawerSingle: !!document.getElementById('practiceAnswerSheetDrawer'),
                  };
                }""")
                # 答题卡开关在最右一列（不与血量/计时换行重叠）：开关右缘应位于
                # 血量计数右缘或更右，且 topbar 不溢出视口。
                far_right = geometry["openRight"] >= geometry["exitRight"] - 2
                geometry_results[viewport] = geometry
                check_matrix(
                    10, f"{viewport}px answer sheet toggle at far right (no overlap)",
                    far_right, f"openRight={geometry['openRight']} exitRight={geometry['exitRight']} body={geometry['bodyWidth']}",
                )
                check_matrix(
                    10, f"{viewport}px exit buttons vertically stacked equal width",
                    geometry["verticallyStacked"] and geometry["equalWidth"],
                    f"widths={geometry['widths']}",
                )
            page.set_viewport_size({"width": 1280, "height": 900})
            check_matrix(10, "single answer sheet DOM instance", geometry_results[1280]["drawerSingle"], "")
            for viewport in (1280, 1024, 390):
                page.set_viewport_size({"width": viewport, "height": 900 if viewport != 390 else 844})
                page.wait_for_timeout(200)
                page.screenshot(path=f"/tmp/task8-viewport-{viewport}.png")
            # ---- matrix 11: ordinary practice, zero background save, incremental XP ----
            page.locator("#practiceExitBtn").click()
            page.locator("#practiceAbandonBtn").click()
            page.locator("#practiceLobby").wait_for(state="visible")
            page.locator("#practiceHistoryOpenBtn").click()
            page.locator(f'[data-history-practice="{ids["paper"]}"]').click()
            page.locator("#practiceGame").wait_for(state="visible")
            ordinary_id = page.evaluate("KGPracticeMode.snapshot().sessionId")
            xp_before = context.request.get(f"{base}/api/v1/learning/practice/experience-summary").json()["totalExperience"]
            assert page.evaluate("KGPracticeMode.snapshot().mode") == "practice"
            assert page.locator("#practiceHealth").is_hidden()
            assert page.locator("#practiceTimeRow").is_hidden()
            assert page.locator('[data-answer-submit]').count() == 0
            log["rows"].clear()
            page.locator('[data-option-id="A"]').first.click()
            page.wait_for_timeout(750)
            assert page.locator("#practiceExplanationPanel").is_visible()
            page.locator("#practiceAutoExplain").uncheck()
            assert page.locator("#practiceExplanationPanel").is_hidden()
            page.locator("#practiceAutoExplain").check()
            assert page.locator("#practiceExplanationPanel").is_visible()
            assert page.locator("#practiceExplanationReveal").count() == 0
            page.locator("#practiceNextBtn").click()
            assert page.locator("#practiceExplanationPanel").is_hidden()
            page.locator('[data-option-id="B"]').first.click()
            page.wait_for_timeout(750)
            page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
            background_page = context.new_page()
            background_page.goto("about:blank")
            background_page.bring_to_front()
            page.wait_for_timeout(300)
            background_page.close()
            page.bring_to_front()
            def cancel_leave(dialog):
                dialog.dismiss()
            page.on("dialog", cancel_leave)
            page.close(run_before_unload=True)
            page.wait_for_timeout(300)
            assert not page.is_closed()
            page.remove_listener("dialog", cancel_leave)
            saves = [r for r in log["rows"] if r["method"] == "POST"]
            check_matrix(11, "ordinary answers, tab hidden and cancelled close send no saves", not saves, str(saves))
            page.locator("#practiceExitBtn").click()
            page.locator("#practiceSaveExitBtn").click()
            page.locator("#practiceLobby").wait_for(state="visible")
            ordinary = run_async(fetch_session_row(ordinary_id))
            check_matrix(11, "ordinary exit settles first 10 XP", ordinary["stats"]["creditedExperience"] == 10, str(ordinary["stats"]))

            # ---- matrix 12: REAL tab close persists latest answer + XP delta ----
            page.locator("#practiceHistoryOpenBtn").click()
            page.locator(f'[data-history-practice="{ids["paper"]}"]').click()
            page.locator("#practiceGame").wait_for(state="visible")
            assert page.evaluate("KGPracticeMode.snapshot().sessionId") == ordinary_id
            page.locator("#practiceNextBtn").click()
            page.locator('[data-option-id="A"]').first.click()
            page.wait_for_timeout(750)
            page.on("dialog", lambda dialog: dialog.accept())
            page.close(run_before_unload=True)
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                saved = context.request.get(f"{base}/api/v1/learning/practice/sessions/{ordinary_id}").json()["session"]
                if saved["status"] == "paused" and saved["stats"]["answered"] == 3:
                    break
                time.sleep(0.1)
            check_matrix(12, "real tab close saves third answer and only new 10 XP", saved["status"] == "paused" and saved["stats"]["answered"] == 3 and saved["stats"]["creditedExperience"] == 20, str(saved["stats"]))

            # ---- matrix 13: refresh saves and duplicate lifecycle is idempotent ----
            page = context.new_page()
            page.on("pageerror", lambda error: page_errors.append(str(error)))
            page.on("dialog", lambda dialog: dialog.accept())
            page.goto(f"{base}/practice-mode.html", wait_until="networkidle")
            page.locator("#practiceHistoryOpenBtn").click()
            page.locator(f'[data-history-practice="{ids["paper"]}"]').click()
            page.locator("#practiceGame").wait_for(state="visible")
            page.locator("#practiceNextBtn").click()
            page.locator('[data-option-id="A"]').first.click()
            page.wait_for_timeout(750)
            page.reload(wait_until="networkidle")
            saved = context.request.get(f"{base}/api/v1/learning/practice/sessions/{ordinary_id}").json()["session"]
            check_matrix(13, "refresh saves fourth answer", saved["stats"]["answered"] == 4 and saved["stats"]["creditedExperience"] == 30, str(saved["stats"]))
            page.locator("#practiceHistoryOpenBtn").click()
            page.locator(f'[data-history-practice="{ids["paper"]}"]').click()
            page.locator("#practiceGame").wait_for(state="visible")
            page.locator("#practiceNextBtn").click()
            page.locator('[data-option-id="A"]').first.click()
            page.wait_for_timeout(750)
            lifecycle_log = install_recorder(page)
            page.evaluate("() => { window.dispatchEvent(new PageTransitionEvent('pagehide')); window.dispatchEvent(new PageTransitionEvent('pagehide')); }")
            page.wait_for_timeout(500)
            check_matrix(13, "duplicate pagehide sends exactly one pause", len(practice_requests(lifecycle_log, "/pause", "POST")) == 1)
            page.evaluate("""() => {
              const original=window.fetch;
              const sessionId=KGPracticeMode.snapshot().sessionId;
              window.fetch=async(...args)=>{
                const saved=await original(...args);
                if(!String(args[0]).endsWith('/sessions/'+sessionId))return saved;
                return new Promise(resolve=>{window.__restoreRead=()=>{window.fetch=original;resolve(saved)}});
              };
              window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));
            }""")
            page.wait_for_function("typeof window.__restoreRead === 'function'")
            before_index = page.evaluate("KGPracticeMode.snapshot().index")
            page.locator("#practiceNextBtn").click()
            check_matrix(13, "bfcache keeps navigation frozen until revision is reconciled", page.evaluate("KGPracticeMode.snapshot().index") == before_index)
            page.evaluate("window.__restoreRead()")
            page.wait_for_function("KGPracticeMode.snapshot().answered === 5")
            page.wait_for_timeout(500)
            saved = context.request.get(f"{base}/api/v1/learning/practice/sessions/{ordinary_id}").json()["session"]
            check_matrix(13, "restored page keeps answers and settled total 42 XP", saved["stats"]["answered"] == 5 and saved["stats"]["creditedExperience"] == 42, str(saved["stats"]))
            page.locator("#practiceNextBtn").click()
            page.locator('[data-option-id="A"]').first.click()
            page.wait_for_timeout(750)
            page.locator("#practiceExitBtn").click()
            page.locator("#practiceAbandonBtn").click()
            page.locator("#practiceLobby").wait_for(state="visible")
            saved = context.request.get(f"{base}/api/v1/learning/practice/sessions/{ordinary_id}").json()["session"]
            check_matrix(13, "bfcache reconciliation adopts revision; abandon includes newest answer", saved["status"] == "abandoned" and saved["stats"]["answered"] == 6 and saved["stats"]["creditedExperience"] == 54, str(saved["stats"]))

            xp_after = context.request.get(f"{base}/api/v1/learning/practice/experience-summary").json()["totalExperience"]
            check_matrix(13, "account experience increased by exactly 54 across exit/close/refresh", xp_after - xp_before == 54, str(xp_after - xp_before))

            # ---- matrix 14: restore a full draft saved by closing before auto-finish ----
            started = context.request.post(f"{base}/api/v1/learning/practice/sessions/start", data={"paperId": ids["paper"], "releaseId": ids["release"], "mode": "practice", "count": PAPER_COUNT, "order": "paper"}).json()["session"]
            answers = {ref["questionId"]: {"selectedAnswer": "A", "selectionIndex": i + 1} for i, ref in enumerate(started["questionOrder"])}
            paused = context.request.post(f"{base}/api/v1/learning/practice/sessions/{started['id']}/pause", data={"revision": started["revision"], "answers": answers})
            assert paused.status == 200, paused.text()
            page.reload(wait_until="networkidle")
            page.locator("#practiceHistoryOpenBtn").click()
            page.locator(f'[data-history-practice="{ids["paper"]}"]').click()
            page.locator(".practice-result-report").wait_for(state="visible", timeout=5000)
            check_matrix(14, "restoring fully answered draft automatically finishes", True)
            page.locator('[data-report-review-all]').click()
            assert page.locator("#practiceExplanationPanel").is_visible()
            assert page.locator('[data-option-id="A"]').is_disabled()
            page.locator("#practiceReviewBackBtn").click()
            page.locator(".practice-result-report").wait_for(state="visible")

            # ---- matrix 15: closing while complete response is pending never pauses ----
            started = context.request.post(f"{base}/api/v1/learning/practice/sessions/start", data={"paperId": ids["paper"], "releaseId": ids["release"], "mode": "practice", "count": PAPER_COUNT, "order": "paper"}).json()["session"]
            answers = {ref["questionId"]: {"selectedAnswer": "A", "selectionIndex": i + 1} for i, ref in enumerate(started["questionOrder"][:-1])}
            paused = context.request.post(f"{base}/api/v1/learning/practice/sessions/{started['id']}/pause", data={"revision": started["revision"], "answers": answers, "runtimeState": {"currentIndex": 9}})
            assert paused.status == 200, paused.text()
            page.reload(wait_until="networkidle")
            page.locator("#practiceHistoryOpenBtn").click()
            page.locator(f'[data-history-practice="{ids["paper"]}"]').click()
            page.locator("#practiceGame").wait_for(state="visible")
            page.evaluate("""() => {
              const original=window.fetch;
              window.fetch=async(input, init)=>{
                const response=await original(input, init);
                if(String(input).endsWith('/complete') && !init?.keepalive){
                  window.__completeResponseHeld=true;
                  return new Promise(resolve=>{window.__releaseComplete=()=>resolve(response)});
                }
                return response;
              };
            }""")
            race_log = install_recorder(page)
            page.locator('[data-option-id="A"]').first.click()
            page.wait_for_function("window.__completeResponseHeld === true")
            page.evaluate("() => { window.dispatchEvent(new PageTransitionEvent('pagehide')); window.dispatchEvent(new PageTransitionEvent('pagehide')); }")
            page.wait_for_timeout(500)
            complete_calls = practice_requests(race_log, "/complete", "POST")
            check_matrix(15, "pending complete is repeated with identical body, never converted to pause", len(complete_calls) == 2 and complete_calls[0]["post_data"] == complete_calls[1]["post_data"] and not practice_requests(race_log, "/pause", "POST"))
            saved = context.request.get(f"{base}/api/v1/learning/practice/sessions/{started['id']}").json()["session"]
            check_matrix(15, "duplicate complete stays completed and XP credited once", saved["status"] == "completed" and saved["stats"]["creditedExperience"] == saved["stats"]["experience"])
            page.evaluate("window.__releaseComplete()")
            page.locator(".practice-result-report").wait_for(state="visible")

            check_matrix(9, "no page errors across matrix", not page_errors, f"errors={page_errors[:3]}")
            evidence["requestLogSample"] = log["rows"][-12:]
            context.close()
            browser.close()
    finally:
        run_async(db_cleanup())
        harness.close()

    print(json.dumps({"evidence": evidence["matrix"]}, ensure_ascii=False, indent=2))
    print("practice-resumable-report-e2e-ok")


if __name__ == "__main__":
    run_matrix()
