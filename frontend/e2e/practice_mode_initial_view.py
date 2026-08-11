import os

from playwright.sync_api import sync_playwright


BASE = os.environ.get("E2E_BASE_URL", "http://127.0.0.1:5173").rstrip("/")


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    try:
        page.goto(BASE + "/practice-mode.html", wait_until="networkidle")
        page.locator(".practice-app").wait_for(state="visible")

        assert page.locator("#practiceLobbyTitle").inner_text() == "选择练习模式"
        page.locator("#practicePaperLibrary").wait_for(state="attached")
        page.locator("#practiceHistoryOpenBtn").wait_for(state="visible")
        assert page.locator("iframe").count() == 0

        print("practice-mode-initial-view: PASS", flush=True)
    finally:
        browser.close()
