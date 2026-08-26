import json
import os

from playwright.sync_api import sync_playwright


base_url = os.environ.get("KG_E2E_BASE_URL", "http://127.0.0.1:4173")

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page()
    requests = []
    page_errors = []
    page.on("request", lambda request: requests.append(request.url))
    page.on("pageerror", lambda error: page_errors.append(error.stack or str(error)))

    page.goto(f"{base_url}/index.html", wait_until="networkidle")
    page.wait_for_function(
        "document.documentElement.dataset.homeGraphState === 'ready'",
        timeout=15_000,
    )

    bundle_requests = [url for url in requests if "/bundles/" in url]
    auth_requests = [url for url in requests if "/api/v1/auth/me" in url]
    deferred = [
        url
        for url in bundle_requests
        if any(name in url for name in ("home-file-library", "home-question", "home-secondary"))
    ]
    if page_errors:
        print(json.dumps({"page_errors": page_errors}, ensure_ascii=False, indent=2))
    assert page.locator("#authStatus").is_visible()
    assert len(auth_requests) == 1, auth_requests
    assert not deferred, deferred
    assert not page_errors, page_errors
    assert any("home-shell.js" in url for url in bundle_requests), bundle_requests
    assert any("home-graph.js" in url for url in bundle_requests), bundle_requests
    assert not any("home-graph.css" in url for url in bundle_requests), bundle_requests

    with page.expect_response(lambda response: "home-file-library.js" in response.url):
        page.locator("#graphFileAddBtn").click()
    page.wait_for_function("KGHomepageLoader.state('fileLibrary') === 'ready'")
    if page.locator("#authModal.show").count():
        page.locator("#authCloseBtn").click()

    page.locator("#authStatus").click()
    with page.expect_response(lambda response: "home-secondary.js" in response.url):
        page.locator("#accountMenuUserCenterBtn").click()
    page.wait_for_function("KGHomepageLoader.state('secondary') === 'ready'")
    unexpected_errors = [error for error in page_errors if "服务器请求失败（404）" not in error]
    assert not unexpected_errors, unexpected_errors

    print(json.dumps({
        "auth_requests": len(auth_requests),
        "bundle_requests": bundle_requests,
        "graph_state": page.locator("html").get_attribute("data-home-graph-state"),
        "deferred_requests": deferred,
        "file_library_state": page.evaluate("KGHomepageLoader.state('fileLibrary')"),
        "secondary_state": page.evaluate("KGHomepageLoader.state('secondary')"),
    }, ensure_ascii=False, indent=2))
    browser.close()
