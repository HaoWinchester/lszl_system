"""Browser regression check for member purchase and canvas utility surfaces.

Usage:
  E2E_BASE_URL=https://example.com E2E_USERNAME=student E2E_PASSWORD=secret \
    python3 frontend/e2e/membership_center_visual.py
"""

import os
from pathlib import Path

from playwright.sync_api import sync_playwright


base_url = os.environ.get("E2E_BASE_URL", "http://127.0.0.1:5173").rstrip("/")
username = os.environ.get("E2E_USERNAME", "学生")
password = os.environ.get("E2E_PASSWORD", "111111")
release = os.environ.get("E2E_RELEASE_VERSION")
output = Path(os.environ.get("E2E_SCREENSHOT", "/tmp/membership-center.png"))

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    try:
        # Visitor: plans are read from the public database API, selecting one
        # closes the membership overlay before the authentication dialog opens.
        visitor = browser.new_context(viewport={"width": 1440, "height": 1000})
        guest = visitor.new_page()
        guest.goto(base_url + "/index.html?mode=free", wait_until="networkidle")
        guest.locator("#upgradeMemberBtn").click()
        guest.locator("#userSubscriptionDetailModal.show .membership-ui .plans-grid").wait_for(state="visible")
        assert "待配置" not in guest.locator("#userSubscriptionDetailBody").inner_text()
        guest.locator('[data-buy-plan="monthly"]').click()
        guest.locator("#authModal.show").wait_for(state="visible")
        assert not guest.locator("#userSubscriptionDetailModal").evaluate(
            "element => element.classList.contains('show')"
        )
        assert guest.locator("#authModal").evaluate(
            "element => Number(getComputedStyle(element).zIndex || 0) > 0"
        )
        visitor.close()

        # The Deep Recall utility is a real, keyboard-focusable search panel.
        recall_context = browser.new_context(viewport={"width": 1440, "height": 1000})
        recall = recall_context.new_page()
        recall.goto(base_url + "/knowledge-recall.html", wait_until="networkidle")
        recall.locator("#krNodeSearchBtn").click()
        recall.locator("#krNodeSearchPanel:not([hidden])").wait_for(state="visible")
        recall.locator("#krNodeSearchInput").fill("不存在的知识点")
        assert "未找到" in recall.locator("#krNodeSearchResults").inner_text()
        recall.locator("#krNodeSearchCloseBtn").click()
        assert recall.locator("#krNodeSearchPanel").evaluate("element => element.hidden")
        recall_context.close()

        # Changing the canvas page theme redraws the global rail. It must keep
        # its full body instead of returning to the former collapsed chevron.
        canvas_context = browser.new_context(viewport={"width": 1440, "height": 1000})
        canvas = canvas_context.new_page()
        canvas.goto(base_url + "/question-workspace.html", wait_until="networkidle")
        rail = canvas.locator("#kgGlobalShortcuts")
        rail.wait_for(state="visible")
        assert rail.locator(".kg-global-shortcuts-body").is_visible()
        assert "is-collapsed" not in (rail.get_attribute("class") or "")
        assert rail.evaluate("element => getComputedStyle(element).backgroundColor") == "rgb(31, 41, 55)"
        canvas.evaluate("window.dispatchEvent(new CustomEvent('kg-role-theme-change'))")
        canvas.locator("#kgGlobalShortcuts .kg-global-shortcuts-body").wait_for(state="visible")
        assert "is-collapsed" not in (canvas.locator("#kgGlobalShortcuts").get_attribute("class") or "")
        canvas_context.close()

        # A student goes directly from selecting a paid plan to the Native QR
        # screen—there is no intermediate approval step to click through.
        context = browser.new_context(viewport={"width": 1440, "height": 1000})
        page = context.new_page()
        console_errors: list[str] = []
        page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
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
        page.locator('[data-buy-plan="monthly"]').click()
        page.locator(".kg-native-pay-qr").wait_for(state="visible")
        assert "确认订阅申请" not in page.locator("#userSubscriptionDetailBody").inner_text()
        page.locator("#nativePayCancelOrderBtn").click()
        page.locator("#nativePayCancelOrderBtn").click()
        page.locator(".membership-ui .plans-grid").wait_for(state="visible")
        if release:
            assert page.evaluate("window.__KG_DIRECT_BOOTSTRAP__?.releaseVersion") == release
        page.screenshot(path=str(output), full_page=False)
        assert output.exists()
        filtered = [message for message in console_errors if "favicon" not in message.lower()]
        assert not filtered, filtered
        print(f"membership UI: PASS screenshot={output}")
    finally:
        browser.close()
