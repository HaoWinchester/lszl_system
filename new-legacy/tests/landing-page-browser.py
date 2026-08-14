#!/usr/bin/env python3

from pathlib import Path
from tempfile import TemporaryDirectory

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
PAGE_URL = (ROOT / "landing.html").resolve().as_uri()
ARGS = ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]


def launch_options() -> dict:
    options: dict = {"headless": True, "args": ARGS}
    for executable in (Path("/usr/bin/chromium"), Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")):
        if executable.exists():
            options["executable_path"] = str(executable)
            break
    return options


def assert_product_tabs(page) -> None:
    workspace = page.locator('[data-product-tab="workspace"]')
    workspace.click()
    assert workspace.get_attribute("aria-selected") == "true"
    assert workspace.get_attribute("tabindex") == "0"
    assert page.locator('[data-product-panel="workspace"]').is_visible()
    assert not page.locator('[data-product-panel="graph"]').is_visible()

    workspace.press("ArrowRight")
    recall = page.locator('[data-product-tab="recall"]')
    assert recall.get_attribute("aria-selected") == "true"
    assert recall.evaluate("el => document.activeElement === el")

    recall.press("Home")
    graph = page.locator('[data-product-tab="graph"]')
    assert graph.get_attribute("aria-selected") == "true"
    assert graph.evaluate("el => document.activeElement === el")

    graph.click()
    assert graph.get_attribute("aria-selected") == "true"
    assert page.locator('[data-product-panel="graph"]').is_visible()


def assert_faq(page) -> None:
    triggers = page.locator("[data-faq-trigger]")
    first = triggers.nth(0)
    second = triggers.nth(1)
    first.click()
    expect(first).to_have_attribute("aria-expanded", "true")
    assert first.locator("xpath=..").get_attribute("open") is not None
    first.click()
    expect(first).to_have_attribute("aria-expanded", "false")
    assert first.locator("xpath=..").get_attribute("open") is None
    second.click()
    expect(second).to_have_attribute("aria-expanded", "true")


def assert_image_failure_recovery(page) -> None:
    graph_image = page.locator('[data-product-panel="graph"] [data-product-image]')
    graph_image.evaluate("image => image.dispatchEvent(new Event('error'))")
    fallback = page.locator('[data-product-panel="graph"] [data-image-fallback]')
    assert fallback.is_visible()
    assert fallback.locator('a[href="/graph"]').is_visible()
    assert graph_image.get_attribute("hidden") is not None


def assert_primary_button_labels_are_visible(page) -> None:
    for selector, label, background, hover_background in (
        (".landing-header-cta", "进入知识图谱", "rgb(21, 60, 52)", "rgb(14, 45, 39)"),
        (".landing-button-accent", "免费进入知识图谱", "rgb(231, 98, 56)", "rgb(201, 76, 39)"),
        (".landing-closing-button", "进入知识图谱", "rgb(21, 60, 52)", "rgb(14, 45, 39)"),
    ):
        button = page.locator(selector)
        expect(button).to_contain_text(label)
        colors = button.evaluate(
            "el => ({foreground: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor})"
        )
        assert colors["foreground"] == "rgb(255, 255, 255)", f"{label} 的文字未以白色显示: {colors}"
        assert colors["background"] == background, f"{label} 的背景色异常: {colors}"
        button.hover()
        page.wait_for_timeout(220)
        actual_hover_background = button.evaluate("el => getComputedStyle(el).backgroundColor")
        assert actual_hover_background == hover_background, f"{label} 的悬停反馈异常: {actual_hover_background}"


def assert_mobile_menu_and_layout(page) -> None:
    page.set_viewport_size({"width": 390, "height": 844})
    page.wait_for_timeout(80)
    toggle = page.locator("[data-landing-nav-toggle]")
    nav = page.locator("[data-landing-nav]")
    assert toggle.is_visible()
    assert not nav.is_visible()

    toggle.click()
    assert toggle.get_attribute("aria-expanded") == "true"
    assert nav.is_visible()
    page.keyboard.press("Escape")
    assert toggle.get_attribute("aria-expanded") == "false"
    assert not nav.is_visible()

    toggle.click()
    page.mouse.click(380, 800)
    assert not nav.is_visible()

    dimensions = page.evaluate(
        """() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          title: document.querySelector('h1').getBoundingClientRect(),
          cta: document.querySelector('.landing-button-accent').getBoundingClientRect()
        })"""
    )
    assert dimensions["scrollWidth"] <= dimensions["clientWidth"] + 1, dimensions
    assert dimensions["title"]["left"] >= 0 and dimensions["title"]["right"] <= 391, dimensions
    assert dimensions["cta"]["left"] >= 0 and dimensions["cta"]["right"] <= 391, dimensions


def assert_reduced_motion(browser) -> None:
    page = browser.new_page(viewport={"width": 1280, "height": 800}, reduced_motion="reduce")
    page.goto(PAGE_URL, wait_until="load")
    page.wait_for_timeout(80)
    reveal = page.locator("[data-reveal]").first
    style = reveal.evaluate("el => ({opacity:getComputedStyle(el).opacity, transform:getComputedStyle(el).transform})")
    assert style["opacity"] == "1", style
    assert style["transform"] in {"none", "matrix(1, 0, 0, 1, 0, 0)"}, style
    page.close()


def assert_no_script_fallback(browser) -> None:
    context = browser.new_context(java_script_enabled=False, viewport={"width": 1280, "height": 800})
    page = context.new_page()
    page.goto(PAGE_URL, wait_until="load")

    panels = page.locator("[data-product-panel]")
    assert panels.count() == 4
    for index in range(panels.count()):
        assert panels.nth(index).is_visible(), f"产品能力面板 {index + 1} 在无脚本模式下不可见"

    first_faq = page.locator("[data-faq-trigger]").first
    first_faq.click()
    assert first_faq.locator("xpath=..").get_attribute("open") is not None
    assert page.locator('a[href="/graph"]').count() >= 3

    page.set_viewport_size({"width": 390, "height": 844})
    assert page.locator("[data-landing-nav]").is_visible(), "无脚本移动端导航不可见"
    assert not page.locator("[data-landing-nav-toggle]").is_visible(), "无脚本模式不应显示无效的菜单按钮"
    context.close()


def main() -> None:
    with sync_playwright() as playwright, TemporaryDirectory(prefix="huanpu-landing-") as output:
        browser = playwright.chromium.launch(**launch_options())
        page = browser.new_page(viewport={"width": 1440, "height": 960})
        errors: list[str] = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
        page.goto(PAGE_URL, wait_until="load")
        page.wait_for_timeout(120)

        assert page.title() == "幻谱｜PMP 知识图谱学习平台"
        assert page.locator('a[href="/graph"]').count() >= 3
        assert_primary_button_labels_are_visible(page)
        assert_product_tabs(page)
        assert_faq(page)
        assert_image_failure_recovery(page)
        page.screenshot(path=str(Path(output) / "landing-desktop.png"), full_page=True)
        assert_mobile_menu_and_layout(page)
        page.screenshot(path=str(Path(output) / "landing-mobile.png"), full_page=True)
        assert not errors, errors
        page.close()

        assert_reduced_motion(browser)
        assert_no_script_fallback(browser)
        browser.close()

    print("landing-page-browser-ok")


if __name__ == "__main__":
    main()
