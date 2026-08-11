import os
import time
from pathlib import Path
from urllib.parse import quote

from playwright.sync_api import Dialog, sync_playwright


BASE = os.environ.get("E2E_BASE_URL", "http://127.0.0.1:5173").rstrip("/")
EXPECTED_RELEASE = os.environ.get("E2E_RELEASE_VERSION", "v8.6.0")
ACCOUNTS = {
    "佩奇007": "admin",
    "老师": "teacher",
    "学生": "student",
    "乔治008": "viewer",
}


def login_api(context, username: str) -> None:
    response = context.request.post(
        BASE + "/api/v1/auth/login",
        data={"username": username, "password": "111111"},
    )
    assert response.ok, (username, response.status, response.text())
    me = context.request.get(BASE + "/api/v1/auth/me")
    assert me.ok, (username, me.status, me.text())
    assert me.json()["user"]["username"] == username
    assert me.json()["user"]["role"] == ACCOUNTS[username]


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)

    for username in ACCOUNTS:
        account_context = browser.new_context()
        try:
            login_api(account_context, username)
        finally:
            account_context.close()

    context = browser.new_context(viewport={"width": 1440, "height": 900})
    page = context.new_page()
    console_errors: list[str] = []
    page_errors: list[str] = []
    http_errors: list[str] = []
    dialog_answers: list[str] = []

    def handle_dialog(dialog: Dialog) -> None:
        if dialog.type == "prompt":
            assert dialog_answers, f"unexpected prompt: {dialog.message}"
            dialog.accept(dialog_answers.pop(0))
        else:
            dialog.accept()

    def record_response(response) -> None:
        if response.status < 400 or response.status in {401, 409}:
            return
        try:
            detail = response.text()
        except Exception:
            detail = ""
        http_errors.append(f"{response.status} {response.url} {detail}")

    page.on("dialog", handle_dialog)
    page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
    page.on("pageerror", lambda error: page_errors.append(error.stack or str(error)) if len(page_errors) < 12 else None)
    page.on("response", record_response)

    try:
        print("smoke: guest learning entry lands on practice mode", flush=True)
        page.goto(BASE + "/learning-path.html", wait_until="networkidle")
        assert page.url == BASE + "/practice-mode.html"
        page.locator(".practice-app").wait_for(state="visible")
        page.locator("#practiceEmpty").wait_for(state="visible")
        assert "暂时没有可练习的已发布试卷" in page.locator("#practiceEmpty").inner_text()
        assert page.locator(".gl-app").count() == 0
        assert not page.locator("#authModal").is_visible()
        assert page.locator("iframe").count() == 0

        print("smoke: original login UI backed by FastAPI session", flush=True)
        page.goto(BASE + "/login", wait_until="networkidle")
        assert "/practice-mode.html?auth=login" in page.url
        page.locator(".practice-app").wait_for(state="visible")
        page.wait_for_function("""() => {
          const empty = document.getElementById('practiceEmpty')
          const hasPaper = document.querySelectorAll('#practicePaperLibrary [data-paper-id]').length > 0
          return (empty && !empty.hidden) || hasPaper
        }""")
        if page.locator("#practiceEmpty").is_visible():
            assert "暂时没有可练习的已发布试卷" in page.locator("#practiceEmpty").inner_text()
        page.locator("#authModal.show").wait_for(state="visible")
        page.locator("#authCloseBtn").click()
        page.locator("#authModal").wait_for(state="hidden")
        page.locator("#authStatus").click()
        page.locator("#accountMenuSessionBtn").click()
        page.locator("#authModal.show").wait_for(state="visible")
        page.locator("#authUsername").fill("佩奇007")
        page.locator("#authPassword").fill("111111")
        page.locator("#authDoLoginBtn").click()
        page.wait_for_function("window.__KG_DIRECT_BOOTSTRAP__?.authenticated === true")
        page.locator("#authModal").wait_for(state="hidden")
        assert "佩奇007" in page.locator("#authStatus").inner_text()

        print("smoke: PostgreSQL state survives a full reload", flush=True)
        # v9 把默认入口开关从 #glDefaultMode checkbox 重构为菜单；这里直接走 server-backed
        # localStorage 验证同一份持久化语义，避免绑定易变的开关 DOM。
        state_key = "kg_default_entry_mode_v1"
        original = page.evaluate("k => localStorage.getItem(k)", state_key)
        next_value = "free" if original != "free" else "guided"
        with page.expect_response(lambda response: response.url.endswith("/api/v1/runtime/state") and response.request.method == "PUT"):
            page.evaluate("({k, v}) => localStorage.setItem(k, v)", {"k": state_key, "v": next_value})
        page.reload(wait_until="networkidle")
        assert page.evaluate("k => localStorage.getItem(k)", state_key) == next_value
        with page.expect_response(lambda response: response.url.endswith("/api/v1/runtime/state") and response.request.method == "PUT"):
            page.evaluate("({k, v}) => localStorage.setItem(k, v)", {"k": state_key, "v": original or ""})

        print("smoke: admin page reads and writes real backend users", flush=True)
        page.goto(BASE + "/users", wait_until="networkidle")
        page.locator(".um-app").wait_for(state="visible")
        page.locator("#umListToolsToggle").click()
        for username in ACCOUNTS:
            page.locator("#umSearchInput").fill(username)
            page.locator(f'.um-user-item[data-user="{username}"]').wait_for(state="visible")
        page.locator("#umSearchInput").fill("")

        temporary_user = f"验收账号{int(time.time())}"
        dialog_answers.extend([temporary_user, "111111"])
        page.locator("#umAddUserBtn").click()
        page.locator("#umSearchInput").fill(temporary_user)
        page.locator(f'.um-user-item[data-user="{temporary_user}"]').wait_for(state="visible")
        created = context.request.get(BASE + "/api/v1/users/" + quote(temporary_user))
        assert created.ok, (created.status, created.text())

        page.locator("#umDeleteUserBtn").click()
        page.locator(f'.um-user-item[data-user="{temporary_user}"]').wait_for(state="detached")
        listed = context.request.get(BASE + "/api/v1/users?page=1&page_size=200")
        assert listed.ok
        assert temporary_user not in {item["username"] for item in listed.json()["users"]}
        assert not dialog_answers

        print("smoke: retired training alias redirects to practice mode", flush=True)
        page.goto(BASE + "/training", wait_until="networkidle")
        assert page.url.startswith(BASE + "/practice-mode.html")
        assert "retiredMode=single_deep_study" in page.url
        page.locator(".practice-app").wait_for(state="visible", timeout=15_000)
        assert page.locator(".question-training-app").count() == 0
        assert page.locator("iframe").count() == 0
        assert page.evaluate("window.__KG_DIRECT_BOOTSTRAP__?.releaseVersion") == EXPECTED_RELEASE

        print("smoke: all remaining stable aliases are direct original pages", flush=True)
        routes = [
            ("/graph", ".app"),
            ("/workspace", ".qw-app"),
            ("/files", ".fm-app"),
            ("/question-bank", ".qb-app"),
            ("/recall", ".kr-app"),
            ("/users", ".um-app"),
            ("/settings", ".ss-app"),
            ("/content-prep", "#prepApp"),
            ("/learning/placement-test", ".glp-main"),
        ]
        for route, selector in routes:
            page.goto(BASE + route, wait_until="networkidle")
            page.locator(selector).wait_for(state="visible", timeout=15_000)
            assert page.locator("iframe").count() == 0, route
            assert page.evaluate("window.__KG_DIRECT_BOOTSTRAP__?.releaseVersion") == EXPECTED_RELEASE

        page.goto(BASE + "/learning/node?node=awareness-keywords", wait_until="networkidle")
        page.locator(".gln-main").wait_for(state="visible")
        assert page.locator("iframe").count() == 0

        print("smoke: non-admin receives the original permission-denied surface", flush=True)
        teacher_context = browser.new_context(viewport={"width": 1280, "height": 800})
        try:
            login_api(teacher_context, "老师")
            teacher_page = teacher_context.new_page()
            teacher_page.goto(BASE + "/content-prep", wait_until="domcontentloaded")
            teacher_page.locator("#prepApp").wait_for(state="visible")
        finally:
            teacher_context.close()

        student_context = browser.new_context(viewport={"width": 1280, "height": 800})
        try:
            login_api(student_context, "学生")
            student_page = student_context.new_page()
            student_page.goto(BASE + "/content-prep", wait_until="domcontentloaded")
            assert student_page.locator("#prepApp").count() == 0
            assert "无权访问" in student_page.locator("body").inner_text()
            denied = student_page.goto(BASE + "/users", wait_until="domcontentloaded")
            assert denied and denied.status == 403
            assert "无权访问" in student_page.locator("body").inner_text()
            assert student_page.locator("iframe").count() == 0
        finally:
            student_context.close()

        screenshot = Path("/tmp/new-legacy-direct-settings.png")
        page.goto(BASE + "/settings", wait_until="networkidle")
        page.screenshot(path=str(screenshot), full_page=False)
        assert screenshot.exists()

        assert not page_errors, page_errors
        assert not http_errors, http_errors
        filtered_console = [
            message for message in console_errors
            if "favicon" not in message.lower()
            and "401 (unauthorized)" not in message.lower()
            and "409 (conflict)" not in message.lower()
        ]
        assert not filtered_console, filtered_console
        print(f"smoke: PASS screenshot={screenshot}", flush=True)
    except Exception:
        failure = Path("/tmp/new-legacy-direct-smoke-failure.png")
        try:
            page.screenshot(path=str(failure), full_page=False, timeout=5_000)
        except Exception as screenshot_error:
            print({"screenshot_error": str(screenshot_error)}, flush=True)
        print(
            {
                "url": page.url,
                "console_errors": console_errors,
                "page_errors": page_errors,
                "http_errors": http_errors,
                "screenshot": str(failure),
            },
            flush=True,
        )
        raise
    finally:
        context.close()
        browser.close()
