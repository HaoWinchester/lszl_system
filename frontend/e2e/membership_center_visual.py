"""Production-safe visual and interaction check for the member purchase surface.

Usage:
  E2E_BASE_URL=https://example.com E2E_USERNAME=student E2E_PASSWORD=secret \
    python3 frontend/e2e/membership_center_visual.py
"""

import os
from pathlib import Path

from playwright.sync_api import sync_playwright


base_url = os.environ.get("E2E_BASE_URL", "http://127.0.0.1:5173").rstrip("/")
username = os.environ["E2E_USERNAME"]
password = os.environ["E2E_PASSWORD"]
release = os.environ.get("E2E_RELEASE_VERSION")
output = Path(os.environ.get("E2E_SCREENSHOT", "/tmp/membership-center.png"))

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(viewport={"width": 1440, "height": 1000})
    page = context.new_page()
    console_errors: list[str] = []
    page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
    try:
        login = context.request.post(
            base_url + "/api/v1/auth/login",
            data={"username": username, "password": password},
        )
        assert login.ok, (login.status, login.text())
        page.goto(base_url + "/index.html?mode=free", wait_until="networkidle")
        page.locator("#upgradeMemberBtn").click()
        page.locator("#userSubscriptionDetailModal.show .membership-ui .plans-grid").wait_for(state="visible")
        assert page.locator(".membership-ui .plan-card").count() >= 3
        assert page.locator(".membership-ui .redeem").is_visible()
        purchase_chevron = page.locator(".membership-ui [data-buy-plan] .i-chevron-right").first
        assert purchase_chevron.is_visible()
        assert purchase_chevron.evaluate("element => getComputedStyle(element).filter") == "brightness(0) invert(1)"
        header_alignment = page.locator(".membership-ui .modal-header").evaluate("""header => {
            const brand = header.querySelector('.brand').getBoundingClientRect()
            const close = header.querySelector('.icon-button').getBoundingClientRect()
            return Math.abs((brand.top + brand.height / 2) - (close.top + close.height / 2))
        }""")
        assert header_alignment <= 1, header_alignment
        horizontal_scroll = page.locator(".membership-ui .plans-grid").evaluate(
            "element => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight })"
        )
        assert horizontal_scroll["scrollWidth"] > horizontal_scroll["clientWidth"]
        assert horizontal_scroll["scrollHeight"] <= horizontal_scroll["clientHeight"] + 12
        if release:
            assert page.evaluate("window.__KG_DIRECT_BOOTSTRAP__?.releaseVersion") == release
        page.screenshot(path=str(output), full_page=False)
        assert output.exists()
        filtered = [message for message in console_errors if "favicon" not in message.lower()]
        assert not filtered, filtered
        print(f"membership UI: PASS screenshot={output}")
    finally:
        context.close()
        browser.close()
