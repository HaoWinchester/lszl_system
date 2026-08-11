import os

from playwright.sync_api import sync_playwright


BASE = os.environ.get("E2E_BASE_URL", "http://127.0.0.1:8000").rstrip("/")


def freeze_catalog(page) -> None:
    # Keep the real page in its pre-catalog state. The regression was hidden by
    # tests that waited for networkidle and only observed the final lobby state.
    page.route(
        "**/question-catalog-adapter.js*",
        lambda route: route.fulfill(
            status=200,
            content_type="application/javascript",
            body="window.KGQuestionCatalogAdapter={ready:new Promise(()=>{})};",
        ),
    )


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)

    guest = browser.new_context(viewport={"width": 1440, "height": 900})
    guest_page = guest.new_page()
    freeze_catalog(guest_page)
    try:
        response = guest.request.get(BASE + "/practice-mode.html")
        assert response.ok
        response_html = response.text()
        assert response_html.index("kg-practice-guest-first-paint-style") < response_html.index("<body")

        guest_page.goto(BASE + "/", wait_until="domcontentloaded")
        assert guest_page.url == BASE + "/practice-mode.html"
        guest_page.locator(".practice-app").wait_for(state="visible")

        assert guest_page.evaluate("window.__KG_DIRECT_BOOTSTRAP__?.authenticated") is False
        assert guest_page.locator("#practiceEmpty").is_visible()
        assert "暂时没有可练习的已发布试卷" in guest_page.locator("#practiceEmpty").inner_text()
        assert not guest_page.locator(".practice-library").is_visible()
        assert not guest_page.locator(".practice-setup-card").is_visible()
        assert not guest_page.locator(".practice-mode-grid").is_visible()
        assert not guest_page.locator("#authModal").is_visible()
    finally:
        guest.close()

    ready_guest = browser.new_context(viewport={"width": 1440, "height": 900})
    ready_page = ready_guest.new_page()
    try:
        ready_page.goto(BASE + "/practice-mode.html", wait_until="networkidle")
        ready_page.locator("#practiceEmpty").wait_for(state="visible")
        assert not ready_page.evaluate(
            'document.documentElement.classList.contains("kg-practice-guest-first-paint")'
        )
    finally:
        ready_guest.close()

    authenticated = browser.new_context(viewport={"width": 1440, "height": 900})
    login = authenticated.request.post(
        BASE + "/api/v1/auth/login",
        data={"username": "佩奇007", "password": "111111"},
    )
    assert login.ok, (login.status, login.text())
    authenticated_page = authenticated.new_page()
    freeze_catalog(authenticated_page)
    try:
        authenticated_page.goto(BASE + "/", wait_until="domcontentloaded")
        assert authenticated_page.url == BASE + "/practice-mode.html"
        assert authenticated_page.evaluate("window.__KG_DIRECT_BOOTSTRAP__?.authenticated") is True
        assert not authenticated_page.evaluate(
            'document.documentElement.classList.contains("kg-practice-guest-first-paint")'
        )
        assert not authenticated_page.locator("#practiceEmpty").is_visible()
        assert authenticated_page.locator(".practice-setup-card").is_visible()
    finally:
        authenticated.close()
        browser.close()

    print("practice-guest-first-paint: PASS", flush=True)
