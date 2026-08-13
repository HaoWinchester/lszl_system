"""Browser regression for the P4.5.15 flow/related canvas status indicator."""

import os

from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("E2E_BASE_URL", "http://127.0.0.1:5173").rstrip("/")


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    try:
        context = browser.new_context(viewport={"width": 1440, "height": 900})
        page = context.new_page()
        page.goto(BASE_URL + "/index.html?mode=free", wait_until="networkidle")
        chooser = page.locator("#learningEntryModal")
        if chooser.count() and chooser.is_visible():
            chooser.locator('[data-learning-entry-choice="知识图谱"]').click()
            chooser.wait_for(state="hidden")

        page.wait_for_function("() => typeof window.KGGraphFlowMode?.set === 'function'")
        page.evaluate(
            """() => {
                document.body.dataset.graphInteractionMode = 'efficient';
                window.KGGraphFlowMode.set(true, { render: true, silent: true });
            }"""
        )
        indicator = page.locator(".graph-mode-indicator.flow")
        indicator.wait_for(state="visible")
        assert "心流状态" in indicator.inner_text()
        assert "退出" in indicator.inner_text()
        assert "退出心流" not in indicator.inner_text()
        assert indicator.locator("strong").evaluate("el => getComputedStyle(el).color") == "rgb(255, 255, 255)"
        assert indicator.locator("span").evaluate("el => getComputedStyle(el).color") == "rgb(255, 255, 255)"
        indicator.locator("[data-graph-mode-exit]").click()
        indicator.wait_for(state="hidden")
        print("P4.5.15 flow indicator: PASS")
    finally:
        browser.close()
