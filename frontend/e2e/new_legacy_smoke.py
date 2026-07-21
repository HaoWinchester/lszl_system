import os
from pathlib import Path

from playwright.sync_api import sync_playwright


BASE = os.environ.get("E2E_BASE_URL", "http://127.0.0.1:5173").rstrip("/")


def wait_frame(page, selector: str):
    page.wait_for_selector("iframe")
    frame = page.frame_locator("iframe")
    frame.locator(selector).wait_for(state="visible", timeout=15_000)
    return frame


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    console_errors: list[str] = []
    page_errors: list[str] = []
    http_errors: list[str] = []
    page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
    page.on("pageerror", lambda error: page_errors.append(error.stack or str(error)) if len(page_errors) < 8 else None)
    page.on("response", lambda response: http_errors.append(f"{response.status} {response.url}") if response.status >= 400 and response.status != 401 else None)

    try:
        print("smoke: guest learning path", flush=True)
        page.goto(BASE + "/")
        page.wait_for_load_state("networkidle")
        learning = wait_frame(page, ".gl-app")
        assert learning.locator(".gl-path-node").count() >= 12
        assert learning.locator(".gl-stage-switch").is_visible()

        print("smoke: login and guided node", flush=True)
        page.goto(BASE + "/login")
        page.wait_for_load_state("networkidle")
        page.get_by_label("用户名").fill("admin")
        page.get_by_label("密码").fill("admin123")
        page.get_by_role("button", name="登录", exact=True).click()
        page.wait_for_url(BASE + "/")
        page.wait_for_load_state("networkidle")
        learning = wait_frame(page, ".gl-app")
        learning.locator(".gl-node-button").first.click()
        page.wait_for_url("**/learning/node?node=**")
        node = wait_frame(page, ".gln-activity")
        assert node.locator("#glnFooterActions button").count() == 1

        print("smoke: training", flush=True)
        page.goto(BASE + "/training", wait_until="domcontentloaded")
        training = wait_frame(page, ".question-training-app")
        assert training.locator("#questionModal").is_visible()

        print("smoke: workspace", flush=True)
        page.goto(BASE + "/workspace", wait_until="domcontentloaded")
        workspace = wait_frame(page, ".qw-app")
        assert workspace.locator("#qwWorkspaceSelect").is_visible()
        assert workspace.locator("#qwCreateWorkspaceBtn").is_enabled()

        for route, selector, stylesheet in [
            ("/files", ".fm-app", "file-manager.css"),
            ("/question-bank", ".qb-app", "question-bank-admin.css"),
            ("/users", ".um-app", "user-management.css"),
            ("/settings", ".ss-app", "system-settings.css"),
        ]:
            print(f"smoke: management {route}", flush=True)
            page.goto(BASE + route)
            page.wait_for_load_state("networkidle")
            page.locator(selector).wait_for(state="visible", timeout=15_000)
            assert page.locator(f'link[href*="/new-legacy/styles/{stylesheet}"]').count() == 1

        screenshot = Path("/tmp/new-legacy-integrated-settings.png")
        page.screenshot(path=str(screenshot), full_page=False, timeout=10_000)
        assert screenshot.exists()

        print("smoke: iframe logout", flush=True)
        page.goto(BASE + "/training", wait_until="domcontentloaded")
        training = wait_frame(page, ".question-training-app")
        training.locator("#authLogoutBtn").click()
        page.wait_for_url(BASE + "/login")

        assert not page_errors, page_errors
        assert not http_errors, http_errors
        filtered_console = [
            message for message in console_errors
            if "favicon" not in message.lower() and "401 (unauthorized)" not in message.lower()
        ]
        assert not filtered_console, filtered_console
    except Exception:
        failure = Path("/tmp/new-legacy-smoke-failure.png")
        try:
            page.screenshot(path=str(failure), full_page=False, timeout=5_000)
        except Exception as screenshot_error:
            print({"screenshot_error": str(screenshot_error)}, flush=True)
        print({
            "url": page.url,
            "console_errors": console_errors,
            "page_errors": page_errors,
            "http_errors": http_errors,
            "screenshot": str(failure),
        })
        raise
    finally:
        browser.close()
