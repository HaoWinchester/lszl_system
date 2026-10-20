"""Interact with the application's real Promise-based dialog controls."""

from playwright.sync_api import expect


def respond_app_dialog(page, *, value=None, accept=True, message=None):
    dialog = page.locator("dialog.kg-dialog[open]")
    expect(dialog).to_be_visible()
    if message is not None:
        expect(dialog.locator("[data-dialog-message]")).to_contain_text(message)
    field = dialog.locator("[data-dialog-input]")
    if value is not None:
        expect(field).to_be_visible()
        field.fill(value)
    else:
        expect(field).to_be_hidden()
    dialog.locator("[data-dialog-accept]" if accept else "[data-dialog-cancel]").click()
