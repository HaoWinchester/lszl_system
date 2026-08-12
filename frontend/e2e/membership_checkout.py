"""Browser regression for the embedded Native-payment membership checkout.

Usage:
  E2E_BASE_URL=http://127.0.0.1:8000 E2E_RELEASE_VERSION=v9.0-p4.1.42 \
    python3 frontend/e2e/membership_checkout.py
"""

import os
from pathlib import Path

from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("E2E_BASE_URL", "http://127.0.0.1:5173").rstrip("/")
USERNAME = os.environ.get("E2E_USERNAME", "学生")
PASSWORD = os.environ.get("E2E_PASSWORD", "111111")
RELEASE = os.environ.get("E2E_RELEASE_VERSION")
SCREENSHOT = os.environ.get("E2E_SCREENSHOT")


def dismiss_learning_entry_chooser(page) -> None:
    """Existing onboarding can cover the top-right membership trigger on a fresh context."""
    chooser = page.locator("#learningEntryModal")
    if chooser.count() and chooser.is_visible():
        chooser.locator('[data-learning-entry-choice="知识图谱"]').click()
        chooser.wait_for(state="hidden")


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    try:
        # A guest can inspect database-backed plans, but choosing a paid plan
        # closes the plan overlay before opening the login dialog.
        guest_context = browser.new_context(viewport={"width": 1440, "height": 1000})
        guest = guest_context.new_page()
        guest.goto(BASE_URL + "/index.html?mode=free", wait_until="networkidle")
        dismiss_learning_entry_chooser(guest)
        guest.locator("#upgradeMemberBtn").click()
        guest.locator("#userSubscriptionDetailModal.show .plans-grid").wait_for(state="visible")
        assert "待配置" not in guest.locator("#userSubscriptionDetailBody").inner_text()
        guest.locator('[data-buy-plan="monthly"]').click()
        guest.locator("#authModal.show").wait_for(state="visible")
        assert not guest.locator("#userSubscriptionDetailModal").evaluate(
            "element => element.classList.contains('show')"
        )
        guest_context.close()

        # A student selects directly into a same-page checkout. The plan
        # carousel must remain usable while the selected plan and the QR
        # checkout stay visibly linked.
        context = browser.new_context(viewport={"width": 1440, "height": 1000})
        login = context.request.post(
            BASE_URL + "/api/v1/auth/login", data={"username": USERNAME, "password": PASSWORD}
        )
        assert login.ok, (login.status, login.text())
        page = context.new_page()
        page.goto(BASE_URL + "/index.html?mode=free", wait_until="networkidle")
        dismiss_learning_entry_chooser(page)
        page.locator("#upgradeMemberBtn").click()
        carousel = page.locator(".membership-ui .plans-grid")
        carousel.wait_for(state="visible")
        page.locator('[data-buy-plan="monthly"]').click()
        checkout = page.locator(".membership-ui .membership-checkout")
        checkout.wait_for(state="visible")
        assert carousel.is_visible()
        assert page.locator('.membership-ui .plan-card.checkout-selected[data-plan-id="monthly"]').count() == 1
        assert "月度会员" in checkout.inner_text()
        checkout.locator(".kg-native-pay-qr").wait_for(state="visible")
        assert "确认订阅申请" not in page.locator("#userSubscriptionDetailBody").inner_text()
        if SCREENSHOT:
            page.screenshot(path=str(Path(SCREENSHOT)), full_page=False)
        assert checkout.locator("#nativePayRefreshBtn").count() == 0
        assert checkout.locator("#nativePayCancelOrderBtn").count() == 0
        assert checkout.locator("#nativePayCloseBtn").count() == 0
        assert checkout.locator(".qr-frame").evaluate(
            "element => Math.round(element.getBoundingClientRect().width)"
        ) >= 200
        if RELEASE:
            assert page.evaluate("window.__KG_DIRECT_BOOTSTRAP__?.releaseVersion") == RELEASE
        print("membership checkout: PASS")
    finally:
        browser.close()
