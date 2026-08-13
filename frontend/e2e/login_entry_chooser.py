"""Browser matrix for the once-per-login learning-entry chooser.

This test owns a disposable PostgreSQL database, a candidate new-legacy
release, and a random-port backend.  It deliberately never uses the shared
``kg_graph_dev`` database, the active release as a server root, or
``frontend/public/new-legacy`` as an output directory.

Run from the repository root:

    python3 frontend/e2e/login_entry_chooser.py

``E2E_BASE_URL`` is accepted only for backwards-compatible task commands and
is intentionally not used: this test always starts its own isolated server.
"""

from __future__ import annotations

import atexit
import getpass
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
from urllib.error import URLError
from urllib.parse import quote
from urllib.request import urlopen
from uuid import uuid4

from playwright.sync_api import Browser, BrowserContext, Page, Route, TimeoutError, sync_playwright


REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = REPO_ROOT / "backend"
ACTIVE_RELEASE_ROOT = REPO_ROOT / "frontend" / "new-legacy-releases"
SOURCE_ROOT = REPO_ROOT / "new-legacy"
PASSWORD = "Task5-Chooser-111111"
ADMIN_USERNAME = "admin"
ADMIN_PASSWORD = "jbgsnmm~123"
CHOICES = (
    ("知识图谱", "index.html"),
    ("知识回忆", "knowledge-recall.html"),
    ("知识归纳", "question-workspace.html"),
    ("知识巩固", "practice-mode.html"),
)
ROLES = ("admin", "teacher", "student", "viewer")
ERROR_TEXT = "该学习页面暂时不可用，请稍后重试"


def file_count(root: Path) -> int:
    return sum(1 for path in root.rglob("*") if path.is_file())


class IsolatedChooserHarness:
    """Create and remove the exact temporary resources used by this matrix."""

    def __init__(self) -> None:
        self.database_name = f"kg_task5_e2e_{os.getpid()}_{uuid4().hex[:12]}"
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
        return subprocess.run(
            arguments,
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

    def _candidate_site(self) -> tuple[Path, dict, int, int]:
        assert self.release_root is not None
        pointer = json.loads((self.release_root / "current.json").read_text(encoding="utf-8"))
        candidate_site = self.release_root / pointer["site"]
        active_pointer = json.loads((ACTIVE_RELEASE_ROOT / "current.json").read_text(encoding="utf-8"))
        active_site = ACTIVE_RELEASE_ROOT / active_pointer["site"]
        candidate_files = file_count(candidate_site)
        active_files = file_count(active_site)
        assert candidate_files >= active_files, (candidate_files, active_files)
        for relative in (
            "admin-console.html",
            "question-bank.html",
            "content-prep-studio/dist/content-prep.html",
            "src/31-learning-entry-chooser.js",
        ):
            assert (candidate_site / relative).is_file(), relative
        return candidate_site, pointer, candidate_files, active_files

    def start(self, *, mutate_chooser_away: bool = False) -> str:
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

            self.release_temp = tempfile.TemporaryDirectory(prefix="kg-task5-release-")
            self.release_root = Path(self.release_temp.name)
            subprocess.run(
                [
                    "node",
                    str(REPO_ROOT / "frontend" / "scripts" / "manage-new-legacy.js"),
                    "update",
                    str(SOURCE_ROOT),
                    "--root",
                    str(self.release_root),
                    "--skip-browser",
                ],
                cwd=REPO_ROOT,
                check=True,
                capture_output=True,
                text=True,
            )
            candidate_site, pointer, candidate_files, active_files = self._candidate_site()
            if mutate_chooser_away:
                # A RED-only mutation inside the disposable candidate proves that
                # the visibility assertion below catches a missing chooser.
                (candidate_site / "src" / "31-learning-entry-chooser.js").write_text(
                    '"use strict";\n', encoding="utf-8"
                )

            port = self._free_port()
            base = f"http://127.0.0.1:{port}"
            server_env["NEW_LEGACY_RELEASE_ROOT"] = str(self.release_root)
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
                "task5-isolated-server "
                f"db={self.database_name} releaseRoot={self.release_root} "
                f"version={pointer['version']} candidateFiles={candidate_files} "
                f"activeFiles={active_files} base={base} redMutation={mutate_chooser_away}",
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
        database_removed = not self.database_created
        if self.database_created:
            result = self._postgres("dropdb", check=False)
            if result.returncode != 0:
                errors.append(result.stderr.strip() or "dropdb failed")
            else:
                database_removed = True
            self.database_created = False
        release_removed = self.release_temp is None
        if self.release_temp is not None:
            release_path = Path(self.release_temp.name)
            self.release_temp.cleanup()
            if release_path.exists():
                errors.append(f"release root remains: {release_path}")
            else:
                release_removed = True
            self.release_temp = None
            self.release_root = None
        print(
            f"task5-cleanup dbRemoved={database_removed} releaseRemoved={release_removed}",
            flush=True,
        )
        if errors:
            raise RuntimeError("; ".join(errors))


def assert_ok(response, label: str) -> dict:
    assert response.ok, (label, response.status, response.text())
    return response.json()


def create_accounts(browser: Browser, base: str) -> dict[str, str]:
    """Use the isolated seed admin only to provision the three non-admin roles."""
    stamp = f"task5-{int(time.time() * 1000)}-{uuid4().hex[:8]}"
    usernames = {"admin": ADMIN_USERNAME}
    admin = browser.new_context()
    try:
        assert_ok(
            admin.request.post(
                base + "/api/v1/auth/login",
                data={"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD},
            ),
            "isolated admin login",
        )
        for role in ("teacher", "student", "viewer"):
            # The deployed login dialog normalizes usernames to 32 characters.
            username = f"t5{role}-{uuid4().hex[:12]}"
            assert len(username) <= 32, username
            assert_ok(
                admin.request.post(
                    base + "/api/v1/users",
                    data={
                        "username": username,
                        "password": PASSWORD,
                        "role": role,
                        "status": "active",
                        "display_name": username,
                        "subject": "PMP",
                        "source": "task5-login-entry-chooser",
                    },
                ),
                f"create {role}",
            )
            usernames[role] = username
    finally:
        admin.close()
    return usernames


def password_for(role: str) -> str:
    return ADMIN_PASSWORD if role == "admin" else PASSWORD


def is_visible_chooser(page: Page) -> bool:
    root = page.locator("#learningEntryModal")
    return root.count() == 1 and root.is_visible()


def wait_for_chooser(page: Page, role: str, phase: str) -> None:
    root = page.locator("#learningEntryModal")
    try:
        root.wait_for(state="visible", timeout=15_000)
    except TimeoutError as error:
        runtime = page.evaluate(
            """() => ({
              href: location.href,
              bootstrap: window.__KG_DIRECT_BOOTSTRAP__?.authUser || null,
              currentSession: window.KGAuthCore?.getCurrentSession?.() || null,
              consumedMarker: localStorage.getItem('kg_learning_entry_chooser_consumed_v1'),
              claimMarker: localStorage.getItem('kg_learning_entry_chooser_claim_v1'),
              chooser: typeof window.KGLearningEntryChooser?.init,
              stateStorage: typeof window.KGServerStateStorage?.flush,
            })"""
        )
        runtime["runtimeResponses"] = getattr(page, "_task5_runtime_responses", [])
        runtime["pageErrors"] = getattr(page, "_task5_page_errors", [])
        raise AssertionError((role, phase, "chooser did not become visible", runtime)) from error
    assert root.get_attribute("hidden") is None, (role, phase, "chooser is hidden")
    assert root.locator('[role="dialog"][aria-modal="true"]').is_visible(), (role, phase)
    labels = page.locator("[data-learning-entry-choice]").evaluate_all(
        "nodes => nodes.map(node => node.dataset.learningEntryChoice)"
    )
    assert labels == [choice[0] for choice in CHOICES], (role, phase, labels)
    assert root.locator("#learningEntryTitle").inner_text() == "从这里开始学习", (role, phase)
    assert page.locator('[data-learning-entry-choice="知识回忆"]').get_attribute(
        "data-description"
    ) == "主动回忆关键词与知识线索 · 深度回忆", (role, phase)


def sign_in_via_browser(
    page: Page,
    base: str,
    role: str,
    username: str,
    *,
    entry_path: str = "/practice-mode.html?auth=login",
) -> None:
    """Drive the deployed login dialog; do not seed a session through requests."""
    page.goto(base + entry_path, wait_until="networkidle")
    page.locator("#authModal.show").wait_for(state="visible", timeout=15_000)
    page.locator("#authUsername").fill(username)
    page.locator("#authPassword").fill(password_for(role))
    page.locator("#authLegalConsent").check()
    page.locator("#authDoLoginBtn").click()
    page.wait_for_function("() => window.__KG_DIRECT_BOOTSTRAP__?.authenticated === true")
    page.locator("#authModal").wait_for(state="hidden", timeout=15_000)
    authenticated = page.evaluate(
        "() => ({ username: window.__KG_DIRECT_BOOTSTRAP__?.authUser?.username, "
        "loginSessionId: window.__KG_DIRECT_BOOTSTRAP__?.authUser?.loginSessionId })"
    )
    assert authenticated["username"] == username and authenticated["loginSessionId"], authenticated


def visit_non_graph_then_graph(page: Page, base: str, role: str, phase: str) -> None:
    page.goto(base + "/file-manager.html", wait_until="networkidle")
    assert not is_visible_chooser(page), (role, phase, "chooser appeared on non-graph page")
    page.goto(base + "/index.html", wait_until="networkidle")
    wait_for_chooser(page, role, phase)


def logout_in_browser(page: Page) -> None:
    # The page executes the production browser auth implementation, which both
    # calls the backend endpoint and clears the browser-held remote session.
    logged_out = page.evaluate("""async () => window.KGAuthCore.logout({source: 'task5-e2e'})""")
    assert logged_out["ok"], logged_out
    page.wait_for_function("() => window.__KG_DIRECT_BOOTSTRAP__?.authenticated === false")


def fresh_chooser(
    browser: Browser, base: str, role: str, username: str
) -> tuple[BrowserContext, Page]:
    context = browser.new_context(viewport={"width": 1440, "height": 1000})
    page = context.new_page()
    runtime_responses: list[dict[str, object]] = []
    page_errors: list[str] = []
    def record_runtime_response(response) -> None:
        if "/api/v1/runtime/state" not in response.url:
            return
        row: dict[str, object] = {
            "status": response.status,
            "url": response.url,
            "method": response.request.method,
        }
        if response.status >= 400:
            try:
                row["body"] = response.text()
            except Exception as error:
                row["body"] = f"response body unavailable: {error}"
        runtime_responses.append(row)

    page.on("response", record_runtime_response)
    page.on("pageerror", lambda error: page_errors.append(str(error)))
    setattr(page, "_task5_runtime_responses", runtime_responses)
    setattr(page, "_task5_page_errors", page_errors)
    sign_in_via_browser(
        page,
        base,
        role,
        username,
        entry_path="/index.html?auth=login",
    )
    wait_for_chooser(page, role, "fresh-login-on-graph")
    return context, page


def assert_choice_navigation(page: Page, role: str, label: str, destination: str) -> None:
    button = page.locator(f'[data-learning-entry-choice="{label}"]')
    assert button.is_visible(), (role, label)
    if destination == "index.html":
        # This choice intentionally stays on the graph.  Observe the real
        # focus restoration instead of treating a no-op URL as a navigation.
        before_url = page.url
        button.click()
        page.locator("#learningEntryModal").wait_for(state="hidden")
        assert page.url == before_url and page.url.split("?", 1)[0].endswith("/index.html"), (
            role,
            label,
            page.url,
        )
        assert page.evaluate("() => document.activeElement?.id") == "stage", (role, label)
        return
    # ``expect_response`` misses this page's fetch-then-location.assign flow
    # in Chromium, while the page-level response event reliably observes it.
    # Register before the user action, then require the actual target GET
    # before asserting the destination URL.
    observed: list[dict[str, object]] = []

    def observe(response) -> None:
        if response.url.rstrip("/").endswith("/" + destination):
            observed.append(
                {
                    "status": response.status,
                    "url": response.url,
                    "method": response.request.method,
                }
            )

    page.on("response", observe)
    button.click()
    deadline = time.monotonic() + 15
    while not observed and time.monotonic() < deadline:
        page.wait_for_timeout(50)
    assert observed, (role, label, "did not observe target GET", page.url)
    response = observed[-1]
    assert response["status"] < 400 and response["method"] == "GET", (role, label, response)
    page.wait_for_url("**/" + destination, timeout=15_000)
    assert page.url.split("?", 1)[0].endswith("/" + destination), (role, label, page.url)


def assert_modal_can_be_dismissed(page: Page, role: str) -> None:
    root = page.locator("#learningEntryModal")
    page.keyboard.press("Escape")
    root.wait_for(state="hidden")
    assert page.evaluate("() => document.activeElement?.id") == "stage", (role, "Escape focus")


def unavailable_target(route: Route) -> None:
    route.fulfill(status=503, content_type="text/plain", body="temporarily unavailable")


def assert_unavailable_target(browser: Browser, base: str, role: str, username: str) -> None:
    context, page = fresh_chooser(browser, base, role, username)
    try:
        page.route("**/knowledge-recall.html", unavailable_target)
        button = page.locator('[data-learning-entry-choice="知识回忆"]')
        button.click()
        page.wait_for_function(
            "expected => document.getElementById('learningEntryChooserError')?.textContent === expected",
            arg=ERROR_TEXT,
        )
        assert page.locator("#learningEntryChooserError").inner_text() == ERROR_TEXT, role
        assert page.url.split("?", 1)[0].endswith("/index.html"), (role, page.url)
        assert is_visible_chooser(page) and button.is_enabled(), role
    finally:
        context.close()


def assert_two_tabs_claim_once(browser: Browser, base: str, role: str, username: str) -> None:
    context = browser.new_context(viewport={"width": 1440, "height": 1000})
    parent = context.new_page()
    try:
        sign_in_via_browser(parent, base, role, username)
        parent.goto(base + "/file-manager.html", wait_until="networkidle")
        # Two popups are issued in one trusted click task from the already
        # signed-in non-graph page, so Chromium does not block them and neither
        # tab gets a head start from test code.
        parent.evaluate("""() => {
          const trigger = document.createElement('button');
          trigger.id = 'task5ConcurrentGraphTabs';
          trigger.type = 'button';
          trigger.textContent = 'open';
          trigger.style.cssText = 'position:fixed;top:12px;left:12px;z-index:2147483647';
          trigger.addEventListener('click', () => {
            window.__task5PopupProbe = ['clicked'];
            const one = window.open('index.html?task5Concurrent=one', '_blank');
            const two = window.open('index.html?task5Concurrent=two', '_blank');
            window.__task5PopupProbe.push(Boolean(one), Boolean(two));
          });
          document.body.append(trigger);
        }""")
        parent.locator("#task5ConcurrentGraphTabs").click()
        deadline = time.monotonic() + 15
        while len(context.pages) < 3 and time.monotonic() < deadline:
            parent.wait_for_timeout(50)
        tabs = [candidate for candidate in context.pages if candidate is not parent]
        popup_probe = parent.evaluate("window.__task5PopupProbe || []")
        assert len(tabs) == 2, (role, popup_probe, len(tabs), [candidate.url for candidate in context.pages])
        for tab in tabs:
            tab.wait_for_load_state("networkidle")
        visible = [tab for tab in tabs if is_visible_chooser(tab)]
        if len(visible) != 1:
            tab_states = [
                tab.evaluate(
                    """() => ({
                      sessionId: window.KGAuthCore?.getCurrentSession?.()?.loginSessionId || '',
                      consumed: localStorage.getItem('kg_learning_entry_chooser_consumed_v1'),
                      claim: localStorage.getItem('kg_learning_entry_chooser_claim_v1'),
                      locks: typeof navigator.locks?.request,
                      visible: !document.getElementById('learningEntryModal')?.hidden,
                    })"""
                )
                for tab in tabs
            ]
            raise AssertionError((role, "exactly one chooser tab required", tab_states))
        assert visible[0].locator('[data-learning-entry-choice="知识图谱"]').is_visible()
    finally:
        context.close()


def assert_parallel_login_sessions_remain_consumed(
    browser: Browser,
    base: str,
    role: str,
    username: str,
) -> None:
    first_context, first_page = fresh_chooser(browser, base, role, username)
    second_context, second_page = fresh_chooser(browser, base, role, username)
    try:
        first_session = first_page.evaluate(
            "() => window.__KG_DIRECT_BOOTSTRAP__?.authUser?.loginSessionId || ''"
        )
        second_session = second_page.evaluate(
            "() => window.__KG_DIRECT_BOOTSTRAP__?.authUser?.loginSessionId || ''"
        )
        assert first_session and second_session and first_session != second_session, (
            role,
            first_session,
            second_session,
        )
        first_page.reload(wait_until="networkidle")
        assert not is_visible_chooser(first_page), (
            role,
            "a second login session displaced the first session's consumed claim",
        )
    finally:
        second_context.close()
        first_context.close()


def assert_red_visibility_failure() -> None:
    """Mutation-test the first behavioral assertion before green matrix work."""
    harness = IsolatedChooserHarness()
    base = harness.start(mutate_chooser_away=True)
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                usernames = create_accounts(browser, base)
                context = browser.new_context(viewport={"width": 1440, "height": 1000})
                page = context.new_page()
                try:
                    sign_in_via_browser(page, base, "admin", usernames["admin"])
                    page.goto(base + "/file-manager.html", wait_until="networkidle")
                    page.goto(base + "/index.html", wait_until="networkidle")
                    try:
                        wait_for_chooser(page, "admin", "RED mutation")
                    except (AssertionError, TimeoutError) as error:
                        print(f"task5-red: PASS assertion caught removed chooser: {error}", flush=True)
                    else:
                        raise AssertionError("RED mutation unexpectedly displayed the chooser")
                finally:
                    context.close()
            finally:
                browser.close()
    finally:
        harness.close()


def run_green_matrix() -> None:
    harness = IsolatedChooserHarness()
    base = harness.start()
    checks = 0
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                usernames = create_accounts(browser, base)
                for role in ROLES:
                    username = usernames[role]
                    context, page = fresh_chooser(browser, base, role, username)
                    try:
                        # One login session is consumed by the chooser; refresh
                        # must not make it visible again.
                        page.reload(wait_until="networkidle")
                        assert not is_visible_chooser(page), (role, "chooser repeated after refresh")
                        checks += 1

                        # Real browser logout + same-account dialog login must
                        # get a new server-issued id and a new chooser.
                        first_login_session_id = page.evaluate(
                            "() => window.__KG_DIRECT_BOOTSTRAP__?.authUser?.loginSessionId || ''"
                        )
                        assert first_login_session_id, (role, "missing first login session id")
                        logout_in_browser(page)
                        sign_in_via_browser(page, base, role, username)
                        second_login_session_id = page.evaluate(
                            "() => window.__KG_DIRECT_BOOTSTRAP__?.authUser?.loginSessionId || ''"
                        )
                        assert second_login_session_id and second_login_session_id != first_login_session_id, (
                            role,
                            first_login_session_id,
                            second_login_session_id,
                        )
                        visit_non_graph_then_graph(page, base, role, "same-account-relogin")
                        assert_modal_can_be_dismissed(page, role)
                        checks += 3
                    finally:
                        context.close()

                    for label, destination in CHOICES:
                        choice_context, choice_page = fresh_chooser(browser, base, role, username)
                        try:
                            assert_choice_navigation(choice_page, role, label, destination)
                            checks += 1
                        finally:
                            choice_context.close()

                    assert_unavailable_target(browser, base, role, username)
                    checks += 1
                    assert_two_tabs_claim_once(browser, base, role, username)
                    checks += 1
                    if role == "admin":
                        assert_parallel_login_sessions_remain_consumed(
                            browser,
                            base,
                            role,
                            username,
                        )
                        checks += 1
                    print(f"task5-role: PASS role={role}", flush=True)
            finally:
                browser.close()
    finally:
        harness.close()
    print(f"task5-green: PASS roles={len(ROLES)} choices={len(ROLES) * len(CHOICES)} checks={checks}", flush=True)


if __name__ == "__main__":
    if os.environ.get("E2E_BASE_URL"):
        print("task5: E2E_BASE_URL ignored; using a disposable isolated server", flush=True)
    assert_red_visibility_failure()
    run_green_matrix()
