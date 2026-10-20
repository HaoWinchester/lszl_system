"""Explicit responses to one expected application dialog, never auto-confirm."""
from playwright.sync_api import expect

def respond_dialog(page, expected, text=None, accept=True):
    dialog=page.locator('dialog.kg-dialog[open]')
    expect(dialog).to_be_visible()
    message=dialog.locator('[data-dialog-message]').inner_text()
    assert expected in message, (expected,message)
    if text is not None:
        dialog.locator('[data-dialog-input]').fill(text)
    dialog.locator('[data-dialog-accept]' if accept else '[data-dialog-cancel]').click()
    return message
