"""Checks for intentionally hidden graph detail entries and retained internals."""
from playwright.sync_api import expect


def assert_reduced_detail_actions(page):
    practice = page.locator('#detailPanel #graphPracticeBtn')
    expect(practice).to_have_count(1)
    expect(practice).to_have_attribute('hidden', '')
    expect(practice).to_be_hidden()
    expect(page.locator('#detailPanel #toggleSourceBtn')).to_have_count(0)
    expect(page.locator('#detailPanel #editFromDetailBtn')).to_have_count(1)
    expect(page.locator('#detailPanel #deleteNodeFromDetailBtn')).to_have_count(1)


def open_retained_practice(page):
    # This is a component regression only. The product entry stays hidden;
    # no test claims that a user can reach this drawer through the detail UI.
    assert_reduced_detail_actions(page)
    page.locator('#graphPracticeBtn').evaluate('(button) => button.click()')
