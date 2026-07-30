"""Visual smoke check for the production user-center dialog.

Set E2E_BASE_URL, E2E_USERNAME, and E2E_PASSWORD before running.
"""

import os
from pathlib import Path

from playwright.sync_api import sync_playwright


base_url = os.environ.get("E2E_BASE_URL", "http://127.0.0.1:5173").rstrip("/")
username = os.environ["E2E_USERNAME"]
password = os.environ["E2E_PASSWORD"]
release = os.environ.get("E2E_RELEASE_VERSION")
output = Path(os.environ.get("E2E_SCREENSHOT", "/tmp/user-center.png"))

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(viewport={"width": 1440, "height": 1000})
    page = context.new_page()
    errors: list[str] = []
    page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
    try:
        login = context.request.post(base_url + "/api/v1/auth/login", data={"username": username, "password": password})
        assert login.ok, (login.status, login.text())
        page.goto(base_url + "/index.html?mode=free", wait_until="networkidle")
        page.evaluate("window.KGUserCenter.open()")
        page.locator("#userCenterModal.show .uc-dialog").wait_for(state="visible")
        assert page.locator(".uc-form-grid .uc-field").count() >= 6
        assert page.locator("#ucWechatBox.uc-binding-card").is_visible()
        assert page.locator("#ucSubscriptionBox.uc-membership-card").is_visible()
        assert page.locator(".uc-password-card").is_visible()
        assert page.locator("#ucNoteCount").inner_text().endswith("/500")
        assert page.locator("#userCenterCloseBtn.dialog-close .modal-close-icon").is_visible()
        if release:
            assert page.evaluate("window.__KG_DIRECT_BOOTSTRAP__?.releaseVersion") == release
        page.screenshot(path=str(output), full_page=False)
        assert output.exists()
        assert not [entry for entry in errors if "favicon" not in entry.lower()], errors
        print(f"user center: PASS screenshot={output}")
    finally:
        context.close()
        browser.close()
