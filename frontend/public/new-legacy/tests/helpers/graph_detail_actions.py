"""Checks for accessible graph detail actions and the card practice entry."""
from playwright.sync_api import expect


def assert_detail_actions(page):
    practice = page.locator('#detailPanel #graphPracticeBtn')
    expect(practice).to_have_count(1)
    expect(practice).to_be_visible()
    expect(practice).to_have_attribute('aria-label', '做题')
    expect(practice).to_have_text('')
    expect(practice.locator('svg')).to_have_count(1)
    expect(page.locator('#detailPanel #toggleSourceBtn')).to_have_count(0)
    expect(page.locator('#detailPanel #editFromDetailBtn')).to_have_count(1)
    expect(page.locator('#detailPanel #deleteNodeFromDetailBtn')).to_have_count(1)


def open_card_practice(page):
    assert_detail_actions(page)
    page.locator('#graphPracticeBtn').click()
