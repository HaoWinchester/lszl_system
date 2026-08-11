"""Browser regression: global shortcut hints must not use native-title dwell time."""

from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


def tooltip_opacity_after_first_tenth_second(page, selector: str) -> float:
    target = page.locator(selector)
    box = target.bounding_box()
    assert box is not None
    page.mouse.move(900, 500)
    page.wait_for_timeout(120)
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.wait_for_timeout(100)
    return float(page.evaluate(
        """selector => getComputedStyle(document.querySelector(selector), '::after').opacity""",
        selector,
    )
    )


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, executable_path=CHROME)
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.set_content("<!doctype html><html><body></body></html>")
    page.add_style_tag(content=(ROOT / "styles" / "global-shortcuts.css").read_text(encoding="utf-8"))
    page.add_script_tag(content=(ROOT / "src" / "39-global-shortcuts.js").read_text(encoding="utf-8"))
    page.wait_for_selector("#kgGlobalShortcuts", state="attached", timeout=2_000)
    page.evaluate("document.getElementById('kgGlobalShortcuts').classList.remove('is-collapsed')")
    selector = '#kgGlobalShortcuts [data-global-shortcut="home"]'
    page.wait_for_selector(selector, state="visible", timeout=10_000)

    assert page.locator(selector).get_attribute("title") is None
    assert page.locator(selector).get_attribute("data-tooltip") == "首页"
    assert page.locator(selector).get_attribute("aria-label") == "首页"
    assert page.evaluate(
        """selector => getComputedStyle(document.querySelector(selector), '::after').transitionDelay""",
        selector,
    ) == "0s"

    first = tooltip_opacity_after_first_tenth_second(page, selector)
    second = tooltip_opacity_after_first_tenth_second(page, selector)
    assert first >= 0.95, first
    assert second >= 0.95, second
    print(f"global-shortcut-tooltip-speed-browser-ok first={first:.2f} second={second:.2f}")
    browser.close()
