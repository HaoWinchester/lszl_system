#!/usr/bin/env python3

from pathlib import Path

from playwright.sync_api import expect, sync_playwright


BASE = "http://127.0.0.1:8765"
OUTPUT = Path("/tmp/huanpu-landing-live")
OUTPUT.mkdir(parents=True, exist_ok=True)


def main() -> None:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=True,
            executable_path="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
        )
        page = browser.new_page(viewport={"width": 1440, "height": 960})
        errors: list[str] = []
        failed_responses: list[str] = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda message: errors.append(f"{message.text} @ {message.location}") if message.type == "error" else None)
        page.on("response", lambda response: failed_responses.append(f"{response.status} {response.url}") if response.status >= 400 else None)
        response = page.goto(f"{BASE}/", wait_until="networkidle")
        assert response and response.status == 200
        assert page.title() == "幻谱｜PMP 知识图谱学习平台"
        assert "__KG_DIRECT_BOOTSTRAP__" not in page.content()

        page.locator('[data-product-tab="workspace"]').click()
        expect(page.locator('[data-product-tab="workspace"]')).to_have_attribute("aria-selected", "true")
        page.locator("[data-faq-trigger]").first.click()
        expect(page.locator("[data-faq-trigger]").first).to_have_attribute("aria-expanded", "true")
        document_height = page.evaluate("() => document.documentElement.scrollHeight")
        for offset in range(0, document_height, 640):
            page.evaluate("offset => window.scrollTo(0, offset)", offset)
            page.wait_for_timeout(55)
        page.wait_for_timeout(760)
        page.evaluate("() => window.scrollTo(0, 0)")
        page.screenshot(path=str(OUTPUT / "desktop.png"), full_page=True)

        page.set_viewport_size({"width": 390, "height": 844})
        page.evaluate("() => window.scrollTo(0, 0)")
        page.locator("[data-landing-nav-toggle]").click()
        expect(page.locator("[data-landing-nav-toggle]")).to_have_attribute("aria-expanded", "true")
        dimensions = page.evaluate("() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]")
        assert dimensions[0] <= dimensions[1] + 1, dimensions
        page.screenshot(path=str(OUTPUT / "mobile.png"), full_page=True)

        checks = {
            "/graph": (307, "/index.html?mode=free"),
            "/login": (307, "/practice-mode.html?auth=login"),
        }
        request = page.context.request
        for path, (status, location) in checks.items():
            result = request.get(f"{BASE}{path}", max_redirects=0)
            assert result.status == status, (path, result.status)
            assert result.headers.get("location") == location, (path, result.headers)

        for path in ("/index.html", "/workbench.html", "/practice-mode.html", "/question-workspace.html", "/knowledge-recall.html"):
            result = request.get(f"{BASE}{path}", max_redirects=0)
            assert result.status == 200, (path, result.status)

        assert not failed_responses, failed_responses
        assert not errors, errors
        page.close()
        browser.close()

    print("landing-page-live-browser-ok")


if __name__ == "__main__":
    main()
