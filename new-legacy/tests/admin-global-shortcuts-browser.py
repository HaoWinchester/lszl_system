#!/usr/bin/env python3
"""End-to-end coverage for the global shortcut bar on every admin page."""

from __future__ import annotations

import json
import os
from urllib.parse import urljoin

from playwright.sync_api import BrowserContext, Page, sync_playwright


BASE_URL = os.environ.get("KG_TEST_BASE_URL", "http://127.0.0.1:8765/")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
ADMIN_PAGES = [
    "admin-console.html",
    "admin-operations.html",
    "admin-settings.html",
    "admin-subjects.html",
    "course-admin.html",
    "feedback-management.html",
    "message-management.html",
    "paper-management.html",
    "question-bank.html",
    "system-settings.html",
    "teacher-workbench.html",
    "user-management.html",
]


def seed_role(context: BrowserContext, role: str) -> None:
    username = f"shortcut-{role}"
    payload = json.dumps({"username": username, "role": role}, ensure_ascii=False)
    context.add_init_script(
        f"""
        (() => {{
          const {{username, role}} = {payload};
          const user = {{
            username,
            displayName: role === 'admin' ? '快捷栏管理员' : '快捷栏教师',
            role,
            status: 'active',
            subject: 'PMP',
            source: 'shortcut-browser-test'
          }};
          localStorage.setItem('kg_local_users_v1', JSON.stringify({{[username]: user}}));
          localStorage.setItem('kg_local_current_user_v1', username);
          localStorage.removeItem('kg_global_shortcuts_position_v1');
          localStorage.removeItem('kg_global_shortcuts_layout_v1');
        }})()
        """
    )


def open_page(page: Page, filename: str) -> None:
    response = page.goto(urljoin(BASE_URL, filename), wait_until="domcontentloaded")
    assert response is not None and response.ok, (filename, response.status if response else None)
    page.locator("#kgGlobalShortcuts").wait_for(state="visible")


def assert_collapsed_shortcuts(page: Page, filename: str) -> None:
    shortcuts = page.locator("#kgGlobalShortcuts")
    assert shortcuts.count() == 1, filename
    assert "is-collapsed" in (shortcuts.get_attribute("class") or ""), filename
    assert page.locator("#kgGlobalShortcutsToggle").is_visible(), filename
    assert page.evaluate(
        "getComputedStyle(document.querySelector('#kgGlobalShortcuts')).position"
    ) == "fixed", filename


def expand(page: Page) -> None:
    page.locator("#kgGlobalShortcutsToggle").click()
    page.locator('#kgGlobalShortcuts:not(.is-collapsed)').wait_for(state="visible")


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, executable_path=CHROME)

    admin_context = browser.new_context(viewport={"width": 1440, "height": 960})
    seed_role(admin_context, "admin")
    admin_page = admin_context.new_page()
    admin_page.set_default_timeout(15_000)

    for admin_filename in ADMIN_PAGES:
        open_page(admin_page, admin_filename)
        assert_collapsed_shortcuts(admin_page, admin_filename)
        expand(admin_page)
        for shortcut_id in ["home", "bank", "users", "settings"]:
            assert admin_page.locator(
                f'[data-global-shortcut="{shortcut_id}"]'
            ).is_visible(), (admin_filename, shortcut_id)

    open_page(admin_page, "admin-console.html")
    expand(admin_page)
    admin_page.locator('[data-global-shortcut="bank"]').click()
    admin_page.wait_for_url("**/teacher-workbench.html")
    assert admin_page.locator("#kgGlobalShortcuts").count() == 1
    assert admin_page.locator("#kgGlobalShortcuts").is_visible()
    admin_context.close()

    teacher_context = browser.new_context(viewport={"width": 1440, "height": 960})
    seed_role(teacher_context, "teacher")
    teacher_page = teacher_context.new_page()
    teacher_page.set_default_timeout(15_000)
    open_page(teacher_page, "teacher-workbench.html")
    expand(teacher_page)
    assert teacher_page.locator('[data-global-shortcut="bank"]').is_visible()
    assert teacher_page.locator('[data-global-shortcut="users"]').count() == 0
    assert teacher_page.locator('[data-global-shortcut="settings"]').count() == 0
    teacher_context.close()

    browser.close()

print(f"admin-global-shortcuts-browser-ok pages={len(ADMIN_PAGES)}")
