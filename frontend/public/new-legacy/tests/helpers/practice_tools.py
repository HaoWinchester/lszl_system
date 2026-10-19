"""Exercise floating answer tools through their visible user entry."""
from playwright.sync_api import expect


def open_tools(page):
    nav = page.locator('#practiceSideNav')
    if nav.is_hidden():
        page.locator('#practiceSideToggle').click()
    expect(nav).to_be_visible()


def click_tool(page, selector):
    open_tools(page)
    page.locator(selector).click()
    expect(page.locator('#practiceSideNav')).to_be_hidden()
