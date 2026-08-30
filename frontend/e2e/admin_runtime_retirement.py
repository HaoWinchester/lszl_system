"""12-page teacher/admin Runtime retirement matrix on disposable infrastructure.

Use ``--isolated`` to build a candidate under a temporary ``--root`` with a
unique PostgreSQL database.  Only this disposable mode edits an existing
subject through the DOM.  ``--base-url`` instead tests a deployed target with
explicit, dedicated E2E credentials; it creates only randomly named,
hard-deletable fixtures and cleans partial fixtures in ``finally`` without
mutating existing subjects, papers, banks, or system settings.
"""

from __future__ import annotations

import argparse
import atexit
from contextlib import contextmanager
from dataclasses import dataclass
import getpass
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
from urllib.error import URLError
from urllib.parse import quote, urlparse
from urllib.request import urlopen
from uuid import uuid4

from playwright.sync_api import BrowserContext, Page, sync_playwright

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = REPO_ROOT / "backend"


class IsolatedE2EHarness:
    def __init__(self) -> None:
        self.database_name = f"kg_task7_retirement_{os.getpid()}_{uuid4().hex[:10]}"
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
        return subprocess.run(args, cwd=BACKEND_ROOT, check=check, capture_output=True, text=True)

    def _database_url(self) -> str:
        return f"postgresql+asyncpg://{quote(self.pg_user, safe='')}@/{self.database_name}?host={quote(self.pg_host, safe='/')}"

    @staticmethod
    def _free_port() -> int:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
            listener.bind(("127.0.0.1", 0))
            return int(listener.getsockname()[1])

    def start(self) -> str:
        try:
            self._postgres("createdb")
            self.database_created = True
            environment = dict(os.environ)
            environment["DATABASE_URL"] = self._database_url()
            subprocess.run(
                [str(BACKEND_ROOT / ".venv" / "bin" / "alembic"), "upgrade", "head"],
                cwd=BACKEND_ROOT,
                env=environment,
                check=True,
                capture_output=True,
                text=True,
            )
            self.release_temp = tempfile.TemporaryDirectory(prefix="kg-task7-runtime-release-")
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
            candidate = release_root / pointer["site"]
            active_root = REPO_ROOT / "frontend" / "new-legacy-releases"
            active_pointer = json.loads((active_root / "current.json").read_text(encoding="utf-8"))
            active = active_root / active_pointer["site"]
            candidate_count = sum(1 for path in candidate.rglob("*") if path.is_file())
            active_count = sum(1 for path in active.rglob("*") if path.is_file())
            assert candidate_count >= active_count, (candidate_count, active_count)
            for page in PAGES:
                assert (candidate / page).is_file(), page
            port = self._free_port()
            base = f"http://127.0.0.1:{port}"
            environment["NEW_LEGACY_RELEASE_ROOT"] = str(release_root)
            self.server = subprocess.Popen(
                [str(BACKEND_ROOT / ".venv" / "bin" / "uvicorn"), "app.main:app", "--host", "127.0.0.1", "--port", str(port)],
                cwd=BACKEND_ROOT,
                env=environment,
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
            print(f"task7-isolated-server db={self.database_name} releaseRoot={release_root} version={pointer['version']} candidateFiles={candidate_count} activeFiles={active_count} base={base}", flush=True)
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
        if self.database_created:
            result = self._postgres("dropdb", check=False)
            if result.returncode != 0:
                raise RuntimeError(result.stderr.strip() or "dropdb failed")
            self.database_created = False
        if self.release_temp is not None:
            path = Path(self.release_temp.name)
            self.release_temp.cleanup()
            if path.exists():
                raise RuntimeError(f"release root remains: {path}")
            self.release_temp = None


PAGES = (
    "admin-console.html",
    "admin-operations.html",
    "admin-settings.html",
    "admin-subjects.html",
    "content-center.html",
    "course-admin.html",
    "teacher-workbench.html",
    "question-bank.html",
    "paper-management.html",
    "feedback-management.html",
    "message-management.html",
    "system-settings.html",
)
RETIRED_KEYS = {
    "kg_course_config_drafts_v1",
    "kg_course_config_active_release_v1",
    "kg_course_config_releases_v1",
    "kg_learning_tasks_v1",
    "kg_assessment_papers_v1",
}
PASSWORD = "Task7-111111"


@dataclass
class Audit:
    runtime_requests: list[str]
    page_errors: list[str]
    console_errors: list[str]
    http_errors: list[tuple[int, str]]


def ok(response, label: str) -> dict:
    assert response.ok, (label, response.status, response.text())
    return response.json()


def login(context: BrowserContext, base: str, username: str, password: str) -> None:
    ok(
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


def admin_login(context: BrowserContext, base: str, username: str = "admin", configured_password: str = "") -> str:
    candidates = (configured_password,) if configured_password else ("admin123", "jbgsnmm~123")
    for password in candidates:
        response = context.request.post(
            base + "/api/v1/auth/login",
            data={
                "username": username,
                "password": password,
                "acceptedTermsVersion": "2026-08-13-v1",
            },
        )
        if response.ok:
            return password
    raise AssertionError(f"admin login failed: {username}")


def create_user(context: BrowserContext, base: str, username: str, role: str) -> None:
    ok(
        context.request.post(
            base + "/api/v1/users",
            data={
                "username": username,
                "password": PASSWORD,
                "role": role,
                "status": "active",
                "display_name": username,
                "subject": "PMP",
                "source": "task7-runtime-retirement-e2e",
            },
        ),
        f"create {role}",
    )


def bind(context: BrowserContext, audit: Audit) -> None:
    context.on(
        "request",
        lambda request: audit.runtime_requests.append(f"{request.method} {request.url}")
        if "/api/v1/runtime" in request.url or "server-state-bootstrap.js" in request.url
        else None,
    )
    context.on("response", lambda response: audit.http_errors.append((response.status, response.url)) if response.status >= 400 else None)

    def observe(page: Page) -> None:
        page.on("pageerror", lambda error: audit.page_errors.append(str(error)))
        page.on(
            "console",
            lambda message: audit.console_errors.append(message.text)
            if message.type == "error" and "favicon" not in message.text.lower() and not message.text.startswith("Failed to load resource: the server responded with a status of ")
            else None,
        )

    context.on("page", observe)


def storage_audit(
    page: Page,
    page_name: str,
    *,
    allow_absent_direct_bootstrap: bool = False,
) -> None:
    result = page.evaluate(
        """() => ({
          keys:Array.from({length:localStorage.length},(_,index)=>localStorage.key(index)).filter(Boolean),
          nativeSet:/\\[native code\\]/.test(String(Storage.prototype.setItem)),
          nativeGet:/\\[native code\\]/.test(String(Storage.prototype.getItem)),
          legacyStorage:typeof window.KGServerStateStorage,
          directBootstrap:{
            present:typeof window.__KG_DIRECT_BOOTSTRAP__==='object'&&window.__KG_DIRECT_BOOTSTRAP__!==null,
            storage:window.__KG_DIRECT_BOOTSTRAP__?.storage,
            revision:window.__KG_DIRECT_BOOTSTRAP__?.revision,
            contentRevision:window.__KG_DIRECT_BOOTSTRAP__?.contentRevision,
          },
        })"""
    )
    assert result["nativeSet"] and result["nativeGet"], (page_name, result)
    assert result["legacyStorage"] == "undefined", (page_name, result)
    assert RETIRED_KEYS.isdisjoint(result["keys"]), (page_name, result["keys"])
    direct_bootstrap = result["directBootstrap"]
    if allow_absent_direct_bootstrap and not direct_bootstrap["present"]:
        return
    assert direct_bootstrap == {
        "present": True,
        "storage": None,
        "revision": 0,
        "contentRevision": 0,
    }, (page_name, result)


def expected_http_error(status: int, url: str) -> bool:
    path = urlparse(url).path
    if status == 401:
        return path in {"/api/v1/auth/me", "/api/v1/engagement/unread-summary", "/api/v1/paper-releases/catalog"}
    if status == 503:
        return path == "/api/v1/course-management/drafts"
    if status == 403:
        return path in {"/admin-console.html", "/admin-operations.html"} or path.startswith("/api/v1/system/logs") or path.startswith("/api/v1/engagement/admin/")
    return False


def open_page(context: BrowserContext, base: str, page_name: str) -> Page:
    page = context.new_page()
    response = page.goto(base + "/" + page_name, wait_until="domcontentloaded")
    assert response is not None and response.status < 500, (page_name, response.status if response else None)
    page.wait_for_function("() => window.__KG_DIRECT_BOOTSTRAP__?.authenticated === true", timeout=20_000)
    page.locator("body").wait_for(state="visible")
    page.wait_for_timeout(250)
    storage_audit(page, page_name)
    return page


def exercise_login_logout(context: BrowserContext, base: str, username: str, password: str) -> None:
    login(context, base, username, password)


def exercise_native_login_logout(context: BrowserContext, base: str, username: str, password: str) -> None:
    page = open_page(context, base, "admin-console.html")
    page.locator("#adminAccountTrigger").click()
    page.locator("#adminAccountLogoutBtn").click()
    page.wait_for_url("**/index.html")
    page.wait_for_function("() => typeof window.__KG_DIRECT_BOOTSTRAP__ === 'object'", timeout=20_000)
    storage_audit(page, "native logout redirect")
    page.goto(base + "/practice-mode.html?auth=login", wait_until="domcontentloaded")
    page.wait_for_function("() => typeof window.__KG_DIRECT_BOOTSTRAP__ === 'object'", timeout=20_000)
    storage_audit(page, "native login page")
    page.locator("#authModal.show").wait_for(state="visible", timeout=20_000)
    page.locator("#authUsername").fill(username)
    page.locator("#authPassword").fill(password)
    if page.locator("#authLegalConsent").count():
        page.locator("#authLegalConsent").check()
    page.locator("#authDoLoginBtn").click()
    page.locator("#authModal").wait_for(state="hidden", timeout=20_000)
    page.wait_for_function("username => window.KGAuthCore?.currentUsername?.() === username", arg=username)
    storage_audit(page, "native login/logout")
    page.close()
    me = ok(context.request.get(base + "/api/v1/auth/me"), f"me {username}")
    assert me["user"]["username"] == username
    response = context.request.post(base + "/api/v1/auth/logout")
    assert response.ok, (response.status, response.text())
    assert context.request.get(base + "/api/v1/auth/me").status == 401
    login(context, base, username, password)


def create_domain_fixtures(
    admin: BrowserContext,
    teacher: BrowserContext,
    base: str,
    fixture: dict,
    *,
    disposable_environment: bool,
) -> dict:
    token = uuid4().hex[:8]
    course_name = f"Task7 API 课程 {token}"
    draft = ok(
        admin.request.post(
            base + "/api/v1/course-management/drafts",
            data={"name": course_name, "structure": {"subjectId": "subject-pmp", "stages": [], "parts": [], "nodes": []}},
        ),
        "create course draft",
    )["draft"]
    fixture.update({"draft": draft, "courseName": course_name})
    teacher_draft = ok(
        teacher.request.post(
            base + "/api/v1/course-management/drafts",
            data={"name": f"Task7 教师课程 {token}", "structure": {"subjectId": "subject-pmp", "stages": [], "parts": [], "nodes": []}},
        ),
        "create teacher course draft",
    )["draft"]
    fixture["teacherDraft"] = teacher_draft
    course_name += " 已保存"
    draft = ok(
        admin.request.put(
            base + f"/api/v1/course-management/drafts/{draft['id']}",
            data={"name": course_name, "revision": draft["revision"]},
        ),
        "update course draft",
    )["draft"]
    fixture.update({"draft": draft, "courseName": course_name})

    if disposable_environment:
        fixture["bank"] = ok(
            teacher.request.post(
                base + "/api/v1/banks",
                data={"name": f"Task7 题库 {token}", "subject": "PMP", "description": "Runtime retirement E2E"},
            ),
            "create bank",
        )["bank"]
        fixture["paper"] = ok(
            teacher.request.post(
                base + "/api/v1/papers",
                data={"name": f"Task7 试卷 {token}", "subject": "PMP", "questions": []},
            ),
            "create paper",
        )["paper"]
        fixture["feedback"] = ok(
            teacher.request.post(
                base + "/api/v1/engagement/feedback",
                data={"type": "suggestion", "title": f"Task7 反馈 {token}", "detail": "验证关系型反馈摘要", "page": "admin-console.html"},
            ),
            "create feedback",
        )
        settings = ok(admin.request.get(base + "/api/v1/system/wechat-config"), "read system config")["config"]
        ok(admin.request.put(base + "/api/v1/system/wechat-config", data=settings), "write system config")
    fixture["message"] = ok(
        admin.request.post(
            base + "/api/v1/engagement/admin/messages",
            data={"title": f"Task7 消息 {token}", "body": "验证关系型消息摘要", "audience": {"type": "all"}},
        ),
        "create message",
    )
    return fixture


def wait_for_draft_name(context: BrowserContext, base: str, draft_id: str, expected_name: str) -> dict:
    deadline = time.monotonic() + 20
    last: dict = {}
    while time.monotonic() < deadline:
        response = context.request.get(base + f"/api/v1/course-management/drafts/{draft_id}")
        if response.ok:
            last = response.json().get("draft", {})
            if last.get("name") == expected_name:
                return last
        time.sleep(0.2)
    raise AssertionError(f"draft {draft_id} did not persist DOM name {expected_name!r}; last={last!r}")


def select_course_fixture(page: Page, draft: dict) -> None:
    page.wait_for_function(
        "id => [...document.querySelectorAll('#caCourseSelect option')].some(option => option.value === id)",
        arg=draft["id"],
    )
    page.locator("#caCourseSelect").select_option(draft["id"])
    page.wait_for_function(
        "name => document.getElementById('caCourseName')?.value === name",
        arg=draft["name"],
    )


def verify_existing_subject_dom_persistence(page: Page, *, allow_existing_subject_write: bool) -> None:
    if not allow_existing_subject_write:
        return
    page.locator("#adminEditSubjectBtn").click()
    original_name = page.locator("#adminSubjectNameZh").input_value()
    name = original_name + " Task7 DOM"
    page.locator("#adminSubjectNameZh").fill(name)
    with page.expect_response(lambda response: response.url.endswith("/api/v1/content-prep/shared-content") and response.request.method == "PUT") as saved:
        page.locator("#adminSubjectDialogSubmit").click()
    assert saved.value.ok, saved.value.text()
    page.reload(wait_until="domcontentloaded")
    page.wait_for_function("name => document.body.innerText.includes(name)", arg=name)
    storage_audit(page, "admin-subjects.html edited reload")
    page.locator("#adminEditSubjectBtn").click()
    page.locator("#adminSubjectNameZh").fill(original_name)
    with page.expect_response(lambda response: response.url.endswith("/api/v1/content-prep/shared-content") and response.request.method == "PUT") as restored:
        page.locator("#adminSubjectDialogSubmit").click()
    assert restored.value.ok, restored.value.text()
    page.reload(wait_until="domcontentloaded")
    page.wait_for_function("name => document.body.innerText.includes(name)", arg=original_name)
    storage_audit(page, "admin-subjects.html restored reload")


def verify_admin_pages(
    context: BrowserContext,
    base: str,
    fixture: dict,
    all_pages: bool,
    *,
    allow_existing_subject_write: bool,
) -> None:
    pages = PAGES if all_pages else PAGES[:7]
    for page_name in pages:
        page = open_page(context, base, page_name)
        body = page.locator("body").inner_text()
        assert "管理数据加载失败" not in body and "课程与任务数据加载失败" not in body, (page_name, body[:500])
        if page_name == "admin-console.html":
            page.wait_for_function("() => document.getElementById('adminSubjectCount')?.textContent !== '—'")
        if page_name == "admin-settings.html":
            assert page.locator("#adminSnapshotBtn").is_disabled()
            assert "已退役" in page.locator("#adminSnapshotCount").inner_text()
        if page_name == "admin-subjects.html":
            page.wait_for_function("() => !document.getElementById('adminEditSubjectBtn')?.disabled")
            assert page.locator("#adminDeleteSubjectBtn").is_disabled(), "permanent subject deletion must stay blocked without a transactional typed API"
            verify_existing_subject_dom_persistence(
                page,
                allow_existing_subject_write=allow_existing_subject_write,
            )
        if page_name == "course-admin.html":
            course_requests: list[str] = []
            interaction_errors: list[str] = []
            page.on("request", lambda request: course_requests.append(f"{request.method} {request.url}") if "/api/v1/course-management/" in request.url else None)
            page.on("pageerror", lambda error: interaction_errors.append(str(error)))
            api_state = page.evaluate("""() => ({
                hasApi: typeof window.KGCourseManagementApi?.saveDraft === 'function',
                hasQueue: typeof window.KGCourseManagementApi?.createDraftSaveQueue === 'function',
                drafts: window.KGCourseManagementApi?.listDrafts?.().map(item => ({id:item.id,name:item.name,revision:item.revision})) || []
            })""")
            assert api_state["hasApi"] and api_state["hasQueue"], api_state
            select_course_fixture(page, fixture["draft"])
            next_name = fixture["courseName"] + " DOM"
            page.locator("#caCourseName").fill(next_name)
            page.locator("#caSaveBtn").click()
            page.wait_for_timeout(1_000)
            assert any(item.startswith("PUT ") and fixture["draft"]["id"] in item for item in course_requests), {
                "api": api_state,
                "requests": course_requests,
                "toast": page.locator("#caToast").inner_text(),
                "selected": page.locator("#caCourseSelect").input_value(),
                "input": page.locator("#caCourseName").input_value(),
                "pageErrors": interaction_errors,
            }
            fixture["draft"] = wait_for_draft_name(context, base, fixture["draft"]["id"], next_name)
            fixture["courseName"] = next_name
            page.reload(wait_until="domcontentloaded")
            page.wait_for_function(
                "name => [...document.querySelectorAll('#caCourseSelect option')].some(option => option.textContent.includes(name))",
                arg=fixture["courseName"],
            )
            storage_audit(page, page_name + " reload")
        page.close()


def verify_teacher_and_student(browser, base: str, teacher_name: str, teacher_password: str, student_name: str, student_password: str, fixture: dict, audit: Audit) -> None:
    teacher = browser.new_context(viewport={"width": 1280, "height": 900})
    bind(teacher, audit)
    login(teacher, base, teacher_name, teacher_password)
    overview = open_page(teacher, base, "admin-console.html")
    overview.wait_for_function("() => document.getElementById('adminSubjectCount')?.textContent !== '—'")
    assert "管理数据加载失败" not in overview.locator("body").inner_text()
    overview.close()
    operations = teacher.new_page()
    response = operations.goto(base + "/admin-operations.html", wait_until="domcontentloaded")
    assert response is not None
    if response.status < 400:
        operations.wait_for_function("() => window.__KG_DIRECT_BOOTSTRAP__?.authenticated === true", timeout=20_000)
        assert "无权查看操作记录" in operations.locator("body").inner_text()
    else:
        assert response.status == 403 and "无权访问" in operations.locator("body").inner_text()
    storage_audit(
        operations,
        "teacher admin-operations",
        allow_absent_direct_bootstrap=response.status == 403,
    )
    operations.close()
    for page_name in ("admin-subjects.html", "content-center.html", "course-admin.html", "question-bank.html", "paper-management.html"):
        page = open_page(teacher, base, page_name)
        assert "无权访问" not in page.locator("body").inner_text(), page_name
        page.close()
    workbench = open_page(teacher, base, "teacher-workbench.html")
    workbench.locator('a[href="course-admin.html"]').first.click()
    workbench.wait_for_url("**/course-admin.html")
    storage_audit(workbench, "teacher-workbench to course-admin navigation")
    select_course_fixture(workbench, fixture["teacherDraft"])
    next_name = f"Task7 教师 DOM {uuid4().hex[:6]}"
    workbench.locator("#caCourseName").fill(next_name)
    workbench.locator("#caSaveBtn").click()
    fixture["teacherDraft"] = wait_for_draft_name(teacher, base, fixture["teacherDraft"]["id"], next_name)
    workbench.reload(wait_until="domcontentloaded")
    workbench.wait_for_function("name => document.getElementById('caCourseName')?.value === name", arg=next_name)
    storage_audit(workbench, "teacher-workbench to course write")
    workbench.close()
    teacher.close()

    student = browser.new_context(viewport={"width": 1280, "height": 900})
    bind(student, audit)
    login(student, base, student_name, student_password)
    denied = student.new_page()
    response = denied.goto(base + "/admin-console.html", wait_until="domcontentloaded")
    assert response is not None
    if response.status < 400:
        denied.wait_for_function("() => window.__KG_DIRECT_BOOTSTRAP__?.authenticated === true", timeout=20_000)
        assert "无权访问管理后台" in denied.locator("body").inner_text()
    else:
        assert response.status == 403 and "无权访问" in denied.locator("body").inner_text()
    storage_audit(
        denied,
        "student admin-console",
        allow_absent_direct_bootstrap=response.status == 403,
    )
    denied.close()
    student.close()


def verify_failure_recovery(context: BrowserContext, base: str) -> None:
    failed = {"used": False}

    def fail_once(route) -> None:
        if not failed["used"]:
            failed["used"] = True
            route.fulfill(status=503, content_type="application/json", body='{"detail":"planned e2e failure"}')
        else:
            route.continue_()

    page = context.new_page()
    page.route("**/api/v1/course-management/drafts", fail_once)
    page.goto(base + "/course-admin.html", wait_until="domcontentloaded")
    page.wait_for_function("() => document.getElementById('caToast')?.textContent.includes('加载失败')", timeout=20_000)
    storage_audit(page, "course-admin planned API failure")
    page.unroute("**/api/v1/course-management/drafts", fail_once)
    page.reload(wait_until="domcontentloaded")
    page.wait_for_function("() => document.querySelectorAll('#caCourseSelect option').length > 0", timeout=20_000)
    storage_audit(page, "course-admin failure recovery")
    page.close()


def cleanup(admin: BrowserContext, teacher: BrowserContext, base: str, fixture: dict) -> None:
    if draft := fixture.get("draft"):
        draft = ok(admin.request.get(base + f"/api/v1/course-management/drafts/{draft['id']}"), "refresh admin draft")["draft"]
        response = admin.request.delete(
            base + f"/api/v1/course-management/drafts/{draft['id']}",
            data={"revision": draft["revision"]},
        )
        assert response.ok, (response.status, response.text())
    if teacher_draft := fixture.get("teacherDraft"):
        teacher_draft = ok(teacher.request.get(base + f"/api/v1/course-management/drafts/{teacher_draft['id']}"), "refresh teacher draft")["draft"]
        response = teacher.request.delete(
            base + f"/api/v1/course-management/drafts/{teacher_draft['id']}",
            data={"revision": teacher_draft["revision"]},
        )
        assert response.ok, (response.status, response.text())
    if bank := fixture.get("bank"):
        response = teacher.request.delete(base + f"/api/v1/banks/{bank['id']}")
        assert response.ok, (response.status, response.text())
    if paper := fixture.get("paper"):
        response = teacher.request.delete(base + f"/api/v1/papers/{paper['id']}?revision={paper['revision']}")
        assert response.ok, (response.status, response.text())
    if message := fixture.get("message"):
        response = admin.request.delete(base + f"/api/v1/engagement/admin/messages/{message['id']}")
        assert response.status == 204, (response.status, response.text())


@contextmanager
def domain_fixture_scope(
    admin: BrowserContext,
    teacher: BrowserContext,
    base: str,
    *,
    disposable_environment: bool,
):
    fixture: dict = {}
    try:
        create_domain_fixtures(
            admin,
            teacher,
            base,
            fixture,
            disposable_environment=disposable_environment,
        )
        yield fixture
    finally:
        cleanup(admin, teacher, base, fixture)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--base-url",
        help="test a deployed target read-only except for randomly named hard-deletable E2E fixtures (requires dedicated admin/teacher/student credentials)",
    )
    parser.add_argument("--isolated", action="store_true", help="build a disposable release root, database, and local server")
    parser.add_argument("--all-pages", action="store_true", help="run all 12 pages")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    assert args.isolated or args.base_url, "use --isolated locally or provide --base-url for a deployed target"
    harness = IsolatedE2EHarness() if args.isolated else None
    base = harness.start() if harness else args.base_url.rstrip("/")
    audit = Audit([], [], [], [])
    playwright = sync_playwright().start()
    browser = playwright.chromium.launch(headless=True)
    admin = browser.new_context(viewport={"width": 1440, "height": 1000})
    teacher = browser.new_context(viewport={"width": 1440, "height": 1000})
    bind(admin, audit)
    bind(teacher, audit)
    try:
        admin_username = os.environ.get("E2E_ADMIN_USERNAME", "admin")
        configured_password = os.environ.get("E2E_ADMIN_PASSWORD", "")
        if harness:
            teacher_name = f"task7-teacher-{uuid4().hex[:10]}"
            student_name = f"task7-student-{uuid4().hex[:10]}"
            teacher_password = student_password = PASSWORD
        else:
            assert configured_password, "external mode requires E2E_ADMIN_PASSWORD"
            teacher_name = os.environ.get("E2E_TEACHER_USERNAME", "")
            teacher_password = os.environ.get("E2E_TEACHER_PASSWORD", "")
            student_name = os.environ.get("E2E_STUDENT_USERNAME", "")
            student_password = os.environ.get("E2E_STUDENT_PASSWORD", "")
            assert all((teacher_name, teacher_password, student_name, student_password)), "external mode requires dedicated E2E_TEACHER_* and E2E_STUDENT_* credentials"
        admin_password = admin_login(admin, base, admin_username, configured_password)
        if harness:
            create_user(admin, base, teacher_name, "teacher")
            create_user(admin, base, student_name, "student")
        exercise_login_logout(admin, base, admin_username, admin_password)
        exercise_login_logout(teacher, base, teacher_name, teacher_password)
        exercise_native_login_logout(admin, base, admin_username, admin_password)
        with domain_fixture_scope(
            admin,
            teacher,
            base,
            disposable_environment=bool(harness),
        ) as fixture:
            verify_admin_pages(
                admin,
                base,
                fixture,
                args.all_pages,
                allow_existing_subject_write=bool(harness),
            )
            verify_failure_recovery(admin, base)
            verify_teacher_and_student(browser, base, teacher_name, teacher_password, student_name, student_password, fixture, audit)
        assert not audit.runtime_requests, audit.runtime_requests
        assert not audit.page_errors, audit.page_errors
        assert not audit.console_errors, audit.console_errors
        unexpected_http_errors = [item for item in audit.http_errors if not expected_http_error(*item)]
        assert not unexpected_http_errors, unexpected_http_errors
        print(
            f"admin-runtime-retirement-ok pages={12 if args.all_pages else 7} "
            f"runtimeRequests=0 pageErrors=0 consoleErrors={len(audit.console_errors)}",
            flush=True,
        )
    finally:
        teacher.close()
        admin.close()
        browser.close()
        playwright.stop()
        if harness:
            harness.close()


if __name__ == "__main__":
    main()
