"""Shared teaching workspace E2E with process-isolated infrastructure.

The script builds an isolated candidate release, creates and migrates a unique
PostgreSQL database, starts a local backend, and removes both exact resources
on exit. It never serves or mutates the active release or shared dev database.

    python3 frontend/e2e/shared_teacher_workspace.py
"""

from __future__ import annotations

import argparse
import atexit
import getpass
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
from collections.abc import Callable
from urllib.error import URLError
from urllib.parse import quote
from urllib.request import urlopen
from uuid import uuid4

from playwright.sync_api import APIRequestContext, BrowserContext, Page, sync_playwright


REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = REPO_ROOT / "backend"
ACTIVE_RELEASE_ROOT = REPO_ROOT / "frontend" / "new-legacy-releases"
BASE = ""
ADMIN_USERNAME = os.environ.get("E2E_ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.environ.get("E2E_ADMIN_PASSWORD", "jbgsnmm~123")
TEST_PASSWORD = "Task7-111111"
SHARED_KEYS = (
    "kg_assessment_papers_v1",
    "kg_course_config_drafts_v1",
    "kg_learning_tasks_v1",
)
PERSONAL_SUBJECT_KEY = "kg_teacher_workbench_subject_v1"


def file_count(root: Path) -> int:
    return sum(1 for path in root.rglob("*") if path.is_file())


class IsolatedE2EHarness:
    """Own the disposable release, database, and backend process exactly."""

    def __init__(self) -> None:
        self.database_name = f"kg_task7_e2e_{os.getpid()}_{uuid4().hex[:12]}"
        self.pg_host = os.environ.get("KG_E2E_PGHOST", "/tmp")
        self.pg_user = os.environ.get("KG_E2E_PGUSER", getpass.getuser())
        self.release_temp: tempfile.TemporaryDirectory[str] | None = None
        self.server: subprocess.Popen[bytes] | None = None
        self.database_created = False
        self.closed = False
        atexit.register(self.close)

    def _postgres(self, command: str, *, check: bool = True) -> subprocess.CompletedProcess[str]:
        args = [command, "--host", self.pg_host, "--username", self.pg_user]
        if command == "dropdb":
            args.extend(["--if-exists", "--force"])
        args.append(self.database_name)
        return subprocess.run(
            args,
            cwd=BACKEND_ROOT,
            check=check,
            capture_output=True,
            text=True,
        )

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
                cwd=BACKEND_ROOT,
                env=server_env,
                check=True,
                capture_output=True,
                text=True,
            )

            self.release_temp = tempfile.TemporaryDirectory(prefix="kg-task7-release-")
            release_root = Path(self.release_temp.name)
            subprocess.run(
                [
                    "node",
                    str(REPO_ROOT / "frontend" / "scripts" / "manage-new-legacy.js"),
                    "update",
                    str(REPO_ROOT / "new-legacy"),
                    "--root",
                    str(release_root),
                    "--skip-browser",
                ],
                cwd=REPO_ROOT,
                check=True,
                capture_output=True,
                text=True,
            )
            pointer = json.loads((release_root / "current.json").read_text(encoding="utf-8"))
            candidate_site = release_root / pointer["site"]
            active_pointer = json.loads(
                (ACTIVE_RELEASE_ROOT / "current.json").read_text(encoding="utf-8")
            )
            active_site = ACTIVE_RELEASE_ROOT / active_pointer["site"]
            candidate_files = file_count(candidate_site)
            active_files = file_count(active_site)
            assert candidate_files >= active_files, (candidate_files, active_files)
            for relative in (
                "admin-console.html",
                "teacher-workbench.html",
                "content-prep-studio/dist/content-prep.html",
            ):
                assert (candidate_site / relative).is_file(), relative

            port = self._free_port()
            base = f"http://127.0.0.1:{port}"
            server_env["NEW_LEGACY_RELEASE_ROOT"] = str(release_root)
            self.server = subprocess.Popen(
                [
                    str(BACKEND_ROOT / ".venv" / "bin" / "uvicorn"),
                    "app.main:app",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    str(port),
                ],
                cwd=BACKEND_ROOT,
                env=server_env,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            deadline = time.monotonic() + 45
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
                "task7-isolated-server "
                f"db={self.database_name} releaseRoot={release_root} "
                f"version={pointer['version']} candidateFiles={candidate_files} "
                f"activeFiles={active_files} base={base}",
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
        errors: list[str] = []
        if self.server is not None and self.server.poll() is None:
            self.server.terminate()
            try:
                self.server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.server.kill()
                self.server.wait(timeout=5)
        if self.database_created:
            result = self._postgres("dropdb", check=False)
            if result.returncode != 0:
                errors.append(result.stderr.strip() or "dropdb failed")
            self.database_created = False
        if self.release_temp is not None:
            release_path = Path(self.release_temp.name)
            self.release_temp.cleanup()
            if release_path.exists():
                errors.append(f"release root remains: {release_path}")
            self.release_temp = None
        if errors:
            raise RuntimeError("; ".join(errors))


def assert_ok(response, label: str) -> dict:
    assert response.ok, (label, response.status, response.text())
    return response.json()


def cleanup_ok(response, label: str, *, allow_not_found: bool = False) -> None:
    allowed = {200, 404} if allow_not_found else {200}
    if response.status not in allowed:
        raise AssertionError((label, response.status, response.text()))


def login(context: BrowserContext, username: str, password: str) -> None:
    assert_ok(
        context.request.post(
            BASE + "/api/v1/auth/login",
            data={
                "username": username,
                "password": password,
                "acceptedTermsVersion": "2026-08-13-v1",
            },
        ),
        f"login {username}",
    )


def create_context(browser, username: str, password: str) -> BrowserContext:
    context = browser.new_context(viewport={"width": 1440, "height": 1000})
    login(context, username, password)
    return context


def runtime_state(request: APIRequestContext) -> dict:
    return assert_ok(request.get(BASE + "/api/v1/runtime/state"), "runtime state")


def decoded_rows(state: dict, key: str) -> list[dict]:
    raw = (state.get("storage") or {}).get(key, "[]")
    try:
        value = json.loads(raw)
    except (TypeError, ValueError):
        value = []
    return value if isinstance(value, list) else []


def write_runtime_value(
    request: APIRequestContext,
    key: str,
    value_factory: Callable[[dict], str],
    *,
    operation: str = "setItem",
) -> dict:
    for _attempt in range(4):
        state = runtime_state(request)
        value = value_factory(state)
        mutation = {"operation": operation, "key": key}
        if operation == "setItem":
            mutation["value"] = value
        response = request.put(
            BASE + "/api/v1/runtime/state",
            data={
                "page": "teacher-workbench.html",
                "namespace": "teacher",
                "operation": operation,
                "key": key,
                "value": value if operation == "setItem" else None,
                "storage": {key: value} if operation == "setItem" else {},
                "snapshotMode": "merge",
                "mutations": [mutation],
                "requestId": f"task7-runtime-{uuid4().hex}",
                "revision": state["revision"],
                "contentRevision": state["contentRevision"],
            },
        )
        if response.status == 409:
            continue
        return assert_ok(response, f"write runtime {key}")
    raise AssertionError(f"runtime CAS did not settle for {key}")


def append_shared_row(request: APIRequestContext, key: str, row: dict) -> None:
    def value(state: dict) -> str:
        rows = [item for item in decoded_rows(state, key) if item.get("id") != row["id"]]
        rows.append(row)
        return json.dumps(rows, ensure_ascii=False, separators=(",", ":"))

    write_runtime_value(request, key, value)


def remove_shared_row(request: APIRequestContext, key: str, row_id: str) -> None:
    def value(state: dict) -> str:
        rows = [item for item in decoded_rows(state, key) if item.get("id") != row_id]
        return json.dumps(rows, ensure_ascii=False, separators=(",", ":"))

    write_runtime_value(request, key, value)


def write_personal_subject(request: APIRequestContext, subject: str) -> None:
    write_runtime_value(request, PERSONAL_SUBJECT_KEY, lambda _state: subject)


def remove_personal_subject(request: APIRequestContext, expected: str) -> None:
    state = runtime_state(request)
    if (state.get("storage") or {}).get(PERSONAL_SUBJECT_KEY) != expected:
        return
    write_runtime_value(
        request,
        PERSONAL_SUBJECT_KEY,
        lambda _state: "",
        operation="removeItem",
    )


def question_payload(title: str, *, configured: bool) -> dict:
    return {
        "title": title,
        "type": "single_choice",
        "subject": "PMP",
        "difficulty": "基础",
        "domain": "共享工作区",
        "topic": "跨教师协作",
        "tags": ["Task7 E2E"],
        "scope": "internal",
        "stemParts": [{"text": f"{title} 应选择哪一项？"}],
        "options": [
            {"id": "A", "text": "账号本地副本", "correct": False},
            {"id": "B", "text": "服务器公共题池", "correct": True},
        ],
        "correctAnswer": "B",
        "analysis": "管理员与教师共同维护服务器公共题池。",
        "clues": ([{"text": "公共题池", "sourceMode": "quick"}] if configured else []),
        "concepts": [{"id": "shared-workspace", "title": "公共工作区"}],
        "reasoningSteps": [{"id": "step-1", "content": "读取服务器目录"}],
        "keyPath": {"answerId": "B"},
        "metadata": {},
        "status": {"contentReady": True},
        "lifecycle": {"status": "active"},
    }


def prep_question(question_id: str, title: str) -> dict:
    return {"id": question_id, **question_payload(title, configured=False)}


def manager_workbench_snapshot(page: Page) -> dict:
    page.wait_for_function(
        "() => window.KGQuestionCatalogAdapter && window.KGQuestionCatalogAdapter.snapshot().catalogRevision"
    )
    page.wait_for_function(
        "() => Number(document.getElementById('wbQuestionCount')?.textContent) === "
        "window.KGQuestionCatalogAdapter.snapshot().questions.filter(question => "
        "question?.lifecycle?.status !== 'deleted' && !question?.deletedAt).length"
    )
    return page.evaluate(
        """() => ({
          questions:Number(document.getElementById('wbQuestionCount').textContent),
          pending:Number(document.getElementById('wbTrainingPendingCount').textContent),
          paperDrafts:Number(document.getElementById('wbPaperDraftCount').textContent),
          publishedPapers:Number(document.getElementById('wbPublishedPaperCount').textContent),
          banks:Number(document.body.dataset.sharedBankCount||0),
          courses:Number(document.body.dataset.sharedCourseCount||0),
          tasks:Number(document.body.dataset.sharedTaskCount||0),
          subject:window.KGAppStorage?.readString?.('kg_teacher_workbench_subject_v1','')||'',
          catalog:window.KGQuestionCatalogAdapter.snapshot(),
        })"""
    )


def select_creator(page: Page) -> None:
    page.locator('[data-creator-key="peiqi"]').click()
    page.locator("#creatorGate").wait_for(state="hidden")


def configure_prep_question(page: Page, bank_id: str, payload: dict) -> None:
    page.locator(f'#serverBankSelect option[value="{bank_id}"]').wait_for(state="attached")
    page.evaluate(
        """([bankId,payload]) => {
          const normalized=QuestionService.normalize(payload,0,payload.subject||'PMP');
          normalized.serverRevision=null;
          normalized.serverContentHash='';
          normalized.lastSyncedAt='';
          state.questionBank={...state.questionBank,subject:payload.subject||'PMP',questions:[normalized]};
          state.currentQuestionId=normalized.id;
          prepRuntime.serverBankId=bankId;
          prepRuntime.lastIdempotencyKey='';
          prepRuntime.lastUploadFingerprint='';
          refreshAll();
          markWorkspaceDirty();
        }""",
        [bank_id, payload],
    )
    # Selecting after replacing the in-memory question list exercises the real
    # change handler that recomputes the sync button's prerequisites.
    page.locator("#serverBankSelect").select_option(bank_id)
    page.locator("#btnSyncToCatalog").wait_for(state="visible")
    button_state = page.evaluate(
        """() => ({
          disabled:document.getElementById('btnSyncToCatalog').disabled,
          actor:Boolean(prepRuntime.serverActor),
          creator:Boolean(prepRuntime.creatorProfile),
          bankId:prepRuntime.serverBankId,
          questions:state.questionBank.questions.length,
          currentQuestionId:state.currentQuestionId,
          lease:prepRuntime.editLeaseState,
        })"""
    )
    assert not button_state["disabled"], button_state


def click_prep_sync(page: Page):
    with page.expect_response(
        lambda response: response.url.endswith("/api/v1/content-prep/batches")
        and response.request.method == "POST"
    ) as response_info:
        page.locator("#btnSyncToCatalog").click()
    return response_info.value


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--question-paper-only",
        action="store_true",
        help="run the isolated question/paper CRUD, persistence, and cleanup matrix",
    )
    parser.add_argument(
        "--assert-no-runtime",
        action="store_true",
        help="fail if question or paper management requests Runtime state/bootstrap",
    )
    return parser.parse_args()


def run_question_paper_e2e(*, assert_no_runtime: bool) -> None:
    global BASE
    isolated = IsolatedE2EHarness()
    BASE = isolated.start()
    bank_id = ""
    question_id = ""
    category_id = ""
    paper_id = ""
    paper_revision: int | None = None
    release_id = ""
    playwright = None
    browser = None
    admin = None
    teacher = None
    student = None
    runtime_requests: list[str] = []

    def watch_management_request(request) -> None:
        url = request.url
        if "/api/v1/runtime/state" in url or "server-state-bootstrap.js" in url:
            runtime_requests.append(url)

    try:
        playwright = sync_playwright().start()
        if playwright is not None:
            browser = playwright.chromium.launch(headless=True)
            admin = browser.new_context(viewport={"width": 1440, "height": 1000})
            login(admin, ADMIN_USERNAME, ADMIN_PASSWORD)
            stamp = f"{int(time.time() * 1000)}-{uuid4().hex[:8]}"
            # The database and release are disposable, so seeded identities give
            # us stable allow/deny roles without leaving user/subscription rows.
            teacher_username = "老师"
            student_username = "学生"
            teacher = create_context(browser, teacher_username, "111111")
            student = create_context(browser, student_username, "111111")
            teacher.on("request", watch_management_request)

            denied_bank = student.request.post(
                BASE + "/api/v1/banks", data={"name": f"denied-{stamp}", "subject": "PMP"}
            )
            assert denied_bank.status == 403, (denied_bank.status, denied_bank.text())
            denied_publish = student.request.post(
                BASE + "/api/v1/paper-releases/papers/not-owned/publish",
                data={"revision": 1, "enabledModes": ["practice_mode"]},
            )
            assert denied_publish.status == 403, (denied_publish.status, denied_publish.text())

            invalid_bank = teacher.request.post(
                BASE + "/api/v1/papers", data={"name": ""}
            )
            assert invalid_bank.status == 422, (invalid_bank.status, invalid_bank.text())
            bank = assert_ok(
                teacher.request.post(
                    BASE + "/api/v1/banks",
                    data={
                        "name": f"Task3 题库 {stamp}",
                        "subject": "PMP",
                        "description": "Runtime retirement browser matrix",
                        "visibility": "private",
                    },
                ),
                "create bank after validation failure",
            )["bank"]
            bank_id = bank["id"]

            question = assert_ok(
                teacher.request.post(
                    BASE + f"/api/v1/banks/{bank_id}/questions",
                    data=question_payload(f"Task3 题目 {stamp}", configured=True),
                ),
                "create question",
            )["question"]
            question_id = question["id"]
            edited_question_title = f"Task3 已编辑题目 {stamp}"
            question = assert_ok(
                teacher.request.put(
                    BASE + f"/api/v1/questions/{question_id}",
                    data={"title": edited_question_title},
                ),
                "edit question",
            )["question"]
            assert question["title"] == edited_question_title

            category = assert_ok(
                admin.request.post(
                    BASE + "/api/v1/paper-categories",
                    data={"name": f"Task3 分类 {stamp}", "description": "browser matrix"},
                ),
                "create paper category",
            )["category"]
            category_id = category["id"]
            category = assert_ok(
                admin.request.put(
                    BASE + f"/api/v1/paper-categories/{category_id}",
                    data={"revision": category["revision"], "name": f"Task3 已编辑分类 {stamp}"},
                ),
                "edit paper category",
            )["category"]

            paper = assert_ok(
                admin.request.post(
                    BASE + "/api/v1/papers",
                    data={
                        "name": f"Task3 试卷 {stamp}",
                        "subject": "PMP",
                        "categoryId": category_id,
                        "questions": [
                            {"bankId": bank_id, "questionId": question_id, "order": 1, "score": 1}
                        ],
                    },
                ),
                "create paper",
            )["paper"]
            paper_id = paper["id"]
            paper_revision = paper["revision"]
            paper = assert_ok(
                teacher.request.put(
                    BASE + f"/api/v1/papers/{paper_id}",
                    data={"revision": paper_revision, "name": f"Task3 已编辑试卷 {stamp}"},
                ),
                "edit paper",
            )["paper"]
            paper_revision = paper["revision"]

            stale = teacher.request.put(
                BASE + f"/api/v1/papers/{paper_id}/questions",
                data={"revision": paper_revision - 1, "questions": []},
            )
            assert stale.status == 409, (stale.status, stale.text())
            paper = assert_ok(
                teacher.request.get(BASE + f"/api/v1/papers/{paper_id}"),
                "reload paper after conflict",
            )["paper"]
            recovered = assert_ok(
                teacher.request.put(
                    BASE + f"/api/v1/papers/{paper_id}/questions",
                    data={
                        "revision": paper["revision"],
                        "questions": [
                            {"bankId": bank_id, "questionId": question_id, "order": 1, "score": 2}
                        ],
                    },
                ),
                "recover paper save after conflict",
            )["paper"]
            paper_revision = recovered["revision"]

            release = assert_ok(
                admin.request.post(
                    BASE + f"/api/v1/paper-releases/papers/{paper_id}/publish",
                    data={
                        "revision": paper_revision,
                        "accessLevel": "free",
                        "enabledModes": ["deep_recall"],
                        "allowedRoles": ["student"],
                        "metadata": {"source": "task3-question-paper-e2e"},
                    },
                ),
                "publish paper",
            )["release"]
            release_id = release["id"]
            assert release["status"] == "published"
            history = assert_ok(
                teacher.request.get(BASE + f"/api/v1/paper-releases/papers/{paper_id}/history"),
                "published release history",
            )["releases"]
            assert history and history[0]["id"] == release_id

            question_page = teacher.new_page()
            question_page.goto(BASE + "/question-bank.html", wait_until="networkidle")
            question_page.wait_for_function(
                "([bankId,questionId]) => { const s=window.KGQuestionCatalogAdapter?.snapshot?.(); "
                "return s?.banks?.some(row=>row.id===bankId) && s?.questions?.some(row=>row.id===questionId); }",
                arg=[bank_id, question_id],
            )
            assert question_page.locator("body").inner_text().find(edited_question_title) >= 0
            question_page.reload(wait_until="networkidle")
            question_page.wait_for_function(
                "id => window.KGQuestionCatalogAdapter?.snapshot?.().questions?.some(row=>row.id===id)",
                arg=question_id,
            )

            paper_page = teacher.new_page()
            paper_page.goto(BASE + "/paper-management.html", wait_until="networkidle")
            paper_page.wait_for_function(
                "id => window.KGPaperDraftApi?.detail?.(id).then(row=>row?.id===id)", arg=paper_id
            )
            paper_page.wait_for_function(
                "name => document.getElementById('qbPaperList')?.textContent?.includes(name)",
                arg=paper["name"],
            )
            paper_page.reload(wait_until="networkidle")
            paper_page.wait_for_function(
                "id => window.KGPaperDraftApi?.detail?.(id).then(row=>row?.id===id)", arg=paper_id
            )

            failure_page = teacher.new_page()
            failure_page.route("**/api/v1/question-catalog/bootstrap*", lambda route: route.abort())
            failure_page.goto(BASE + "/question-bank.html", wait_until="networkidle")
            failure_page.locator("#qbApiStartupError").wait_for(state="visible")
            assert "不会使用本地数据回退" in failure_page.locator("#qbApiStartupError").inner_text()
            failure_page.unroute("**/api/v1/question-catalog/bootstrap*")
            with failure_page.expect_navigation(wait_until="networkidle"):
                failure_page.locator("#qbApiStartupError [data-api-retry]").click()
            failure_page.wait_for_function(
                "id => window.KGQuestionCatalogAdapter?.snapshot?.().banks?.some(row=>row.id===id)",
                arg=bank_id,
            )

            teacher.close()
            teacher = create_context(browser, teacher_username, "111111")
            teacher.on("request", watch_management_request)
            assert assert_ok(
                teacher.request.get(BASE + f"/api/v1/questions/{question_id}"),
                "question persists after relogin",
            )["question"]["title"] == edited_question_title
            assert assert_ok(
                teacher.request.get(BASE + f"/api/v1/papers/{paper_id}"),
                "paper persists after relogin",
            )["paper"]["id"] == paper_id
            relogin_page = teacher.new_page()
            relogin_page.goto(BASE + "/paper-management.html", wait_until="networkidle")
            relogin_page.wait_for_function(
                "id => window.KGPaperDraftApi?.detail?.(id).then(row=>row?.id===id)", arg=paper_id
            )

            withdrawn = assert_ok(
                admin.request.post(
                    BASE + f"/api/v1/paper-releases/papers/{paper_id}/withdraw-all", data={}
                ),
                "withdraw paper",
            )["withdrawn"]
            assert withdrawn >= 1
            history = assert_ok(
                teacher.request.get(BASE + f"/api/v1/paper-releases/papers/{paper_id}/history"),
                "withdrawn release history",
            )["releases"]
            assert next(row for row in history if row["id"] == release_id)["status"] == "withdrawn"

            if assert_no_runtime:
                assert runtime_requests == [], runtime_requests

            paper_revision = assert_ok(
                teacher.request.get(BASE + f"/api/v1/papers/{paper_id}"),
                "reload paper before cleanup",
            )["paper"]["revision"]
            cleanup_ok(
                teacher.request.delete(
                    BASE + f"/api/v1/papers/{paper_id}?revision={paper_revision}&reason=task3_e2e_cleanup"
                ),
                "delete paper",
            )
            paper_id = ""
            cleanup_ok(
                teacher.request.delete(
                    BASE + f"/api/v1/paper-categories/{category_id}?revision={category['revision']}"
                ),
                "delete paper category",
            )
            category_id = ""
            cleanup_ok(teacher.request.delete(BASE + f"/api/v1/questions/{question_id}"), "delete question")
            question_id = ""
            cleanup_ok(teacher.request.delete(BASE + f"/api/v1/banks/{bank_id}"), "delete bank")
            bank_id = ""
            print(
                "question-paper-e2e-ok "
                "crud=bank,question,category,paper publish=1 withdraw=1 "
                f"runtimeRequests={len(runtime_requests)} refresh=2 relogin=1 cleanup=verified",
                flush=True,
            )
    finally:
        cleanup_errors: list[str] = []
        cleanup_request = admin.request if admin is not None else None
        if cleanup_request is not None:
            if paper_id:
                try:
                    cleanup_request.post(
                        BASE + f"/api/v1/paper-releases/papers/{paper_id}/withdraw-all", data={}
                    )
                    current_paper_response = cleanup_request.get(BASE + f"/api/v1/papers/{paper_id}")
                    current_paper_revision = (
                        current_paper_response.json().get("paper", {}).get("revision")
                        if current_paper_response.ok
                        else paper_revision
                    )
                    cleanup_ok(
                        cleanup_request.delete(
                            BASE + f"/api/v1/papers/{paper_id}?revision={current_paper_revision}&reason=task3_e2e_cleanup"
                        ),
                        f"delete paper {paper_id}",
                        allow_not_found=True,
                    )
                except Exception as error:
                    cleanup_errors.append(f"paper {paper_id}: {error}")
            if category_id:
                try:
                    categories_response = cleanup_request.get(BASE + "/api/v1/paper-categories")
                    current_category_revision = next(
                        (
                            row.get("revision")
                            for row in categories_response.json().get("categories", [])
                            if row.get("id") == category_id
                        ),
                        None,
                    )
                    cleanup_ok(
                        cleanup_request.delete(
                            BASE
                            + f"/api/v1/paper-categories/{category_id}?revision={current_category_revision}"
                        ),
                        f"delete category {category_id}",
                        allow_not_found=True,
                    )
                except Exception as error:
                    cleanup_errors.append(f"category {category_id}: {error}")
            if question_id:
                try:
                    cleanup_ok(
                        cleanup_request.delete(BASE + f"/api/v1/questions/{question_id}"),
                        f"delete question {question_id}",
                        allow_not_found=True,
                    )
                except Exception as error:
                    cleanup_errors.append(f"question {question_id}: {error}")
            if bank_id:
                try:
                    cleanup_ok(
                        cleanup_request.delete(BASE + f"/api/v1/banks/{bank_id}"),
                        f"delete bank {bank_id}",
                        allow_not_found=True,
                    )
                except Exception as error:
                    cleanup_errors.append(f"bank {bank_id}: {error}")
        for context in (student, teacher, admin):
            if context is not None:
                try:
                    context.close()
                except Exception:
                    pass
        if browser is not None:
            try:
                browser.close()
            except Exception:
                pass
        if playwright is not None:
            try:
                playwright.stop()
            except Exception:
                pass
        try:
            isolated.close()
        except Exception as error:
            cleanup_errors.append(f"isolated harness: {error}")
        if cleanup_errors:
            raise AssertionError("; ".join(cleanup_errors))


ARGS = parse_args()
if ARGS.assert_no_runtime and not ARGS.question_paper_only:
    raise SystemExit("--assert-no-runtime currently requires --question-paper-only")
if ARGS.question_paper_only:
    run_question_paper_e2e(assert_no_runtime=ARGS.assert_no_runtime)
    raise SystemExit(0)


harness = IsolatedE2EHarness()
BASE = harness.start()

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    admin = browser.new_context(viewport={"width": 1440, "height": 1000})
    stamp = f"{int(time.time() * 1000)}-{uuid4().hex[:8]}"
    usernames = {
        "teacher_a": f"t7教师甲-{stamp}",
        "teacher_b": f"t7教师乙-{stamp}",
        "student": f"t7学员-{stamp}",
        "viewer": f"t7访客-{stamp}",
    }
    contexts: dict[str, BrowserContext] = {}
    created_users: list[str] = []
    bank_id = ""
    created_question_ids: list[str] = []
    runtime_rows = {
        "kg_assessment_papers_v1": [f"task7-paper-draft-{stamp}", f"task7-paper-published-{stamp}"],
        "kg_course_config_drafts_v1": [f"task7-course-{stamp}"],
        "kg_learning_tasks_v1": [f"task7-task-{stamp}"],
    }
    personal_subject = f"TASK7-{stamp}"
    try:
        login(admin, ADMIN_USERNAME, ADMIN_PASSWORD)
        for role, username in (
            ("teacher", usernames["teacher_a"]),
            ("teacher", usernames["teacher_b"]),
            ("student", usernames["student"]),
            ("viewer", usernames["viewer"]),
        ):
            assert_ok(
                admin.request.post(
                    BASE + "/api/v1/users",
                    data={
                        "username": username,
                        "password": TEST_PASSWORD,
                        "role": role,
                        "status": "active",
                        "display_name": username,
                        "subject": "PMP",
                        "source": "task7-e2e",
                    },
                ),
                f"create {role}",
            )
            created_users.append(username)

        contexts = {
            name: create_context(browser, username, TEST_PASSWORD)
            for name, username in usernames.items()
        }
        teacher_a = contexts["teacher_a"]
        teacher_b = contexts["teacher_b"]

        for name in ("student", "viewer"):
            role_context = contexts[name]
            denied_page = role_context.request.get(BASE + "/teacher-workbench.html")
            assert denied_page.status == 403, (name, denied_page.status, denied_page.text())
            denied_catalog = role_context.request.get(
                BASE + "/api/v1/question-catalog/bootstrap?mode=managed"
            )
            assert denied_catalog.status == 403, (
                name,
                denied_catalog.status,
                denied_catalog.text(),
            )
            denied_write = role_context.request.post(
                BASE + "/api/v1/banks",
                data={"name": f"denied-{stamp}", "subject": "PMP"},
            )
            assert denied_write.status == 403, (name, denied_write.status, denied_write.text())
            assert_ok(
                role_context.request.get(
                    BASE + "/api/v1/question-catalog/bootstrap?mode=learning"
                ),
                f"{name} learning catalog",
            )

        for manager in (admin, teacher_a, teacher_b):
            allowed = manager.request.get(BASE + "/teacher-workbench.html")
            assert allowed.ok, (allowed.status, allowed.text())

        bank = assert_ok(
            teacher_a.request.post(
                BASE + "/api/v1/banks",
                data={
                    "name": f"Task7 共享题库 {stamp}",
                    "subject": "PMP",
                    "description": "跨教师 CRUD 与实时刷新",
                    "visibility": "private",
                },
            ),
            "teacher A creates shared bank",
        )["bank"]
        bank_id = bank["id"]
        assert bank["createdBy"] == usernames["teacher_a"]

        created = assert_ok(
            teacher_a.request.post(
                BASE + f"/api/v1/banks/{bank_id}/questions",
                data=question_payload(f"Task7 跨教师编辑题 {stamp}", configured=True),
            ),
            "teacher A creates question",
        )["question"]
        crud_question_id = created["id"]
        created_question_ids.append(crud_question_id)
        assert created["createdBy"] == usernames["teacher_a"]

        teacher_b_catalog = assert_ok(
            teacher_b.request.get(
                BASE + "/api/v1/question-catalog/bootstrap?mode=managed&include_questions=true"
            ),
            "teacher B reads teacher A catalog",
        )
        teacher_b_bank = next(row for row in teacher_b_catalog["banks"] if row["id"] == bank_id)
        assert teacher_b_bank["accessMode"] == "teacher"
        assert crud_question_id in {row["id"] for row in teacher_b_catalog["questions"]}

        edited_title = f"Task7 教师乙已编辑 {stamp}"
        edited = assert_ok(
            teacher_b.request.put(
                BASE + f"/api/v1/questions/{crud_question_id}",
                data={"title": edited_title},
            ),
            "teacher B edits teacher A question",
        )["question"]
        assert edited["title"] == edited_title
        assert edited["createdBy"] == usernames["teacher_a"]
        assert edited["updatedBy"] == usernames["teacher_b"]

        deleted = admin.request.delete(BASE + f"/api/v1/questions/{crud_question_id}")
        assert deleted.ok, (deleted.status, deleted.text())
        created_question_ids.remove(crud_question_id)
        audit = assert_ok(
            admin.request.get(BASE + "/api/v1/question-catalog/revision"),
            "teaching revision after delete",
        )
        assert audit["updatedBy"] == ADMIN_USERNAME
        assert any(
            change["entityType"] == "question"
            and change["entityId"] == crud_question_id
            and change["action"] == "deleted"
            for change in audit["changes"]
        )

        append_shared_row(
            teacher_a.request,
            "kg_assessment_papers_v1",
            {"id": runtime_rows["kg_assessment_papers_v1"][0], "title": "Task7 草稿", "status": "draft"},
        )
        append_shared_row(
            teacher_a.request,
            "kg_assessment_papers_v1",
            {"id": runtime_rows["kg_assessment_papers_v1"][1], "title": "Task7 已发布", "status": "published"},
        )
        append_shared_row(
            teacher_a.request,
            "kg_course_config_drafts_v1",
            {"id": runtime_rows["kg_course_config_drafts_v1"][0], "name": "Task7 课程草稿"},
        )
        append_shared_row(
            teacher_a.request,
            "kg_learning_tasks_v1",
            {
                "id": runtime_rows["kg_learning_tasks_v1"][0],
                "title": "Task7 学习任务",
                "status": "draft",
                "authorship": {"createdByUserId": usernames["teacher_a"]},
            },
        )
        write_personal_subject(teacher_a.request, personal_subject)

        state_a = runtime_state(teacher_a.request)
        state_b = runtime_state(teacher_b.request)
        for key, ids in runtime_rows.items():
            ids_a = {row.get("id") for row in decoded_rows(state_a, key)}
            ids_b = {row.get("id") for row in decoded_rows(state_b, key)}
            assert set(ids) <= ids_a
            assert set(ids) <= ids_b
        expected_papers = [
            row
            for row in decoded_rows(state_a, "kg_assessment_papers_v1")
            if row.get("status") != "archived" and not row.get("deletedAt")
        ]
        expected_counts = {
            "paperDrafts": sum(
                row.get("status") != "published"
                and not int(row.get("publishedVersion") or 0)
                for row in expected_papers
            ),
            "publishedPapers": sum(
                row.get("status") == "published"
                or int(row.get("publishedVersion") or 0) > 0
                for row in expected_papers
            ),
            "courses": len(decoded_rows(state_a, "kg_course_config_drafts_v1")),
            "tasks": len(decoded_rows(state_a, "kg_learning_tasks_v1")),
        }
        assert state_a["storage"][PERSONAL_SUBJECT_KEY] == personal_subject
        assert (state_b.get("storage") or {}).get(PERSONAL_SUBJECT_KEY) != personal_subject

        workbench_a = teacher_a.new_page()
        workbench_b = teacher_b.new_page()
        workbench_admin = admin.new_page()
        workbench_a.goto(BASE + "/teacher-workbench.html", wait_until="networkidle")
        workbench_b.goto(BASE + "/teacher-workbench.html", wait_until="networkidle")
        workbench_admin.goto(BASE + "/teacher-workbench.html", wait_until="networkidle")
        snapshot_a = manager_workbench_snapshot(workbench_a)
        snapshot_b = manager_workbench_snapshot(workbench_b)
        snapshot_admin = manager_workbench_snapshot(workbench_admin)
        for field in ("questions", "pending", "paperDrafts", "publishedPapers", "banks", "courses", "tasks"):
            assert snapshot_a[field] == snapshot_b[field], (field, snapshot_a[field], snapshot_b[field])
            assert snapshot_a[field] == snapshot_admin[field], (
                field,
                snapshot_a[field],
                snapshot_admin[field],
            )
        for field, expected in expected_counts.items():
            assert snapshot_a[field] == expected, (field, snapshot_a[field], expected)
            assert snapshot_b[field] == expected, (field, snapshot_b[field], expected)
            assert snapshot_admin[field] == expected, (field, snapshot_admin[field], expected)
        for snapshot in (snapshot_a, snapshot_b, snapshot_admin):
            assert bank_id in {row["id"] for row in snapshot["catalog"]["banks"]}
        assert snapshot_a["subject"] == personal_subject
        assert snapshot_b["subject"] != personal_subject

        for observer in (workbench_a, workbench_b):
            observer.evaluate(
                """() => {
                  window.__task7RemoteNotifications=[];
                  window.__task7Unsubscribe=window.KGTeachingContentSync.subscribe(detail=>window.__task7RemoteNotifications.push(detail));
                }"""
            )
        before_questions = snapshot_b["questions"]
        prep_page = teacher_a.new_page()
        prep_page.goto(BASE + "/content-prep", wait_until="networkidle")
        select_creator(prep_page)
        prep_question_id = str(uuid4())
        created_question_ids.append(prep_question_id)
        configure_prep_question(
            prep_page,
            bank_id,
            prep_question(prep_question_id, f"Task7 Content Prep 即时同步 {stamp}"),
        )
        committed = click_prep_sync(prep_page)
        assert committed.ok, (committed.status, committed.text())
        prep_page.wait_for_function(
            "() => document.getElementById('serverCatalogStatus').textContent.includes('已进入题库')"
        )
        workbench_b.wait_for_function(
            "expected => Number(document.getElementById('wbQuestionCount').textContent) === expected",
            arg=before_questions + 1,
        )
        assert workbench_b.evaluate(
            "id => window.KGQuestionCatalogAdapter.snapshot().questions.some(question=>question.id===id)",
            prep_question_id,
        )
        workbench_a.wait_for_function("() => window.__task7RemoteNotifications.length > 0")

        # A newly uploaded local question becomes server-owned. Reopen it through
        # the visible server control so the editor obtains the required lease
        # before exercising the stale-revision recovery path.
        prep_page.locator("#serverQuestionIdInput").fill(prep_question_id)
        prep_page.locator("#btnLoadServerQuestion").click()
        prep_page.wait_for_function(
            "id => window.PMPPrepQuestionLocks?.snapshot?.().questionId === id "
            "&& window.PMPPrepQuestionLocks.snapshot().mode === 'server-editable'",
            arg=prep_question_id,
        )
        prep_page.wait_for_function(
            "() => document.getElementById('serverCatalogStatus').textContent.includes('已从服务器载入')"
        )

        for observer in (workbench_a, workbench_b):
            observer.evaluate(
                """() => {
                  window.__task7RemoteNotifications.length=0;
                  window.KGTeachingContentSync.stopPolling();
                }"""
            )
        server_question = assert_ok(
            teacher_b.request.get(BASE + f"/api/v1/questions/{prep_question_id}"),
            "teacher B reads Content Prep question",
        )["question"]
        conflicting = assert_ok(
            teacher_b.request.put(
                BASE + f"/api/v1/questions/{prep_question_id}",
                data={"title": f"Task7 服务器并发编辑 {stamp}"},
            ),
            "teacher B advances the server question",
        )["question"]
        assert conflicting["revision"] == server_question["revision"] + 1
        prep_page.evaluate(
            """stamp => {
              const question=state.questionBank.questions[0];
              question.title=`Task7 本地冲突 ${stamp}`;
              question.contentHash=`task7-local-conflict-${stamp}`;
              prepRuntime.lastIdempotencyKey='';
              prepRuntime.lastUploadFingerprint='';
              markWorkspaceDirty();
              refreshAll();
            }""",
            stamp,
        )
        conflict_button_state = prep_page.evaluate(
            """() => ({
              disabled:document.getElementById('btnSyncToCatalog').disabled,
              actor:Boolean(prepRuntime.serverActor),
              creator:Boolean(prepRuntime.creatorProfile),
              bankId:prepRuntime.serverBankId,
              questionId:currentQuestion()?.id||'',
              serverRevision:currentQuestion()?.serverRevision||null,
              lease:prepRuntime.editLeaseState,
              status:document.getElementById('serverCatalogStatus').textContent,
            })"""
        )
        assert not conflict_button_state["disabled"], conflict_button_state
        conflict_response = click_prep_sync(prep_page)
        assert conflict_response.status == 409, (conflict_response.status, conflict_response.text())
        prep_page.wait_for_function(
            "() => /更新|变化|冲突/.test(document.getElementById('serverCatalogStatus').textContent)"
        )
        conflict_status = prep_page.locator("#serverCatalogStatus").inner_text()
        assert "重新" in conflict_status, conflict_status
        workbench_a.wait_for_timeout(300)
        assert workbench_a.evaluate("() => window.__task7RemoteNotifications.length") == 0
        assert "已进入题库" not in prep_page.locator("#serverCatalogStatus").inner_text()

        prep_page.locator("#btnQuickSaveWorkspace").click()
        prep_page.wait_for_function("() => prepDbGet().then(row => !!row?.workspace)")
        workbench_a.wait_for_timeout(200)
        assert workbench_a.evaluate("() => window.__task7RemoteNotifications.length") == 0

        print("shared-teacher-workspace-e2e-ok", flush=True)
    finally:
        cleanup_errors: list[str] = []
        cleanup_request = contexts.get("teacher_a", admin).request
        for key, row_ids in runtime_rows.items():
            for row_id in row_ids:
                try:
                    remove_shared_row(cleanup_request, key, row_id)
                except Exception as error:  # cleanup must continue for later exact targets
                    cleanup_errors.append(f"{key}/{row_id}: {error}")
        try:
            remove_personal_subject(cleanup_request, personal_subject)
        except Exception as error:
            cleanup_errors.append(f"personal subject: {error}")
        for question_id in created_question_ids:
            try:
                cleanup_ok(
                    admin.request.delete(
                        BASE + f"/api/v1/content-prep/locks/{question_id}/force"
                    ),
                    f"force release {question_id}",
                    allow_not_found=True,
                )
            except Exception as error:
                cleanup_errors.append(f"lock {question_id}: {error}")
        if bank_id:
            try:
                cleanup_ok(
                    admin.request.delete(BASE + f"/api/v1/banks/{bank_id}"),
                    f"delete bank {bank_id}",
                    allow_not_found=True,
                )
            except Exception as error:
                cleanup_errors.append(f"bank {bank_id}: {error}")
        for username in reversed(created_users):
            try:
                cleanup_ok(
                    admin.request.delete(BASE + f"/api/v1/users/{username}"),
                    f"delete user {username}",
                )
            except Exception as error:
                cleanup_errors.append(f"user {username}: {error}")
        try:
            remaining_banks = assert_ok(
                admin.request.get(BASE + "/api/v1/banks"),
                "verify bank cleanup",
            )["banks"]
            if bank_id and bank_id in {row["id"] for row in remaining_banks}:
                cleanup_errors.append(f"bank {bank_id} remains after cleanup")
            remaining_users = assert_ok(
                admin.request.get(BASE + "/api/v1/users?page_size=200"),
                "verify user cleanup",
            )["users"]
            remaining_usernames = {row["username"] for row in remaining_users}
            for username in created_users:
                if username in remaining_usernames:
                    cleanup_errors.append(f"user {username} remains after cleanup")
            cleanup_state = runtime_state(admin.request)
            for key, row_ids in runtime_rows.items():
                remaining_ids = {row.get("id") for row in decoded_rows(cleanup_state, key)}
                for row_id in row_ids:
                    if row_id in remaining_ids:
                        cleanup_errors.append(f"{key}/{row_id} remains after cleanup")
        except Exception as error:
            cleanup_errors.append(f"cleanup verification: {error}")
        for context in contexts.values():
            context.close()
        admin.close()
        browser.close()
        try:
            harness.close()
        except Exception as error:
            cleanup_errors.append(f"isolated harness: {error}")
        if cleanup_errors:
            raise AssertionError("; ".join(cleanup_errors))
