#!/usr/bin/env python3
"""End-to-end coverage for the global shortcut bar on every admin page."""

from __future__ import annotations

import json
import os
import threading
from contextlib import contextmanager
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urljoin

from playwright.sync_api import BrowserContext, Page, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
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
        }})()
        """
    )


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args: object) -> None:
        pass


@contextmanager
def site_url():
    configured = os.environ.get("KG_TEST_BASE_URL")
    if configured:
        yield configured.rstrip("/") + "/"
        return
    server = ThreadingHTTPServer(
        ("127.0.0.1", 0), partial(QuietHandler, directory=str(ROOT))
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def open_page(page: Page, base_url: str, filename: str) -> None:
    response = page.goto(urljoin(base_url, filename), wait_until="domcontentloaded")
    assert response is not None and response.ok, (filename, response.status if response else None)
    page.locator("#kgGlobalShortcuts").wait_for(state="visible")


def assert_expanded_shortcuts(page: Page, filename: str) -> None:
    shortcuts = page.locator("#kgGlobalShortcuts")
    assert shortcuts.count() == 1, filename
    assert "is-collapsed" not in (shortcuts.get_attribute("class") or ""), filename
    assert page.locator("#kgGlobalShortcuts .kg-global-shortcuts-body").is_visible(), filename
    assert page.locator("#kgGlobalShortcutsToggle").is_visible(), filename
    assert page.evaluate(
        "getComputedStyle(document.querySelector('#kgGlobalShortcuts')).position"
    ) == "fixed", filename


def toggle_layout(page: Page) -> None:
    shortcuts = page.locator("#kgGlobalShortcuts")
    before = shortcuts.get_attribute("data-layout")
    page.locator("#kgGlobalShortcutsToggle").click()
    expected = "horizontal" if before == "vertical" else "vertical"
    page.wait_for_function(
        "expected => document.querySelector('#kgGlobalShortcuts')?.dataset.layout === expected",
        arg=expected,
    )


def drag_and_assert_persistence(page: Page, base_url: str) -> None:
    handle = page.locator("#kgGlobalShortcutsHandle .kg-global-shortcuts-title")
    box = handle.bounding_box()
    assert box is not None
    before = page.locator("#kgGlobalShortcuts").bounding_box()
    assert before is not None
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.mouse.down()
    page.mouse.move(box["x"] - 90, box["y"] - 70, steps=6)
    page.mouse.up()
    stored = page.evaluate("JSON.parse(localStorage.getItem('kg_global_shortcuts_position_v1'))")
    assert stored and isinstance(stored.get("x"), int) and isinstance(stored.get("y"), int)
    moved = page.locator("#kgGlobalShortcuts").bounding_box()
    assert moved is not None and abs(moved["x"] - before["x"]) >= 30

    page.reload(wait_until="domcontentloaded")
    page.locator("#kgGlobalShortcuts").wait_for(state="visible")
    restored = page.locator("#kgGlobalShortcuts").bounding_box()
    assert restored is not None
    assert abs(restored["x"] - stored["x"]) <= 2
    assert abs(restored["y"] - stored["y"]) <= 2


with site_url() as base_url, sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, executable_path=CHROME)

    admin_context = browser.new_context(viewport={"width": 1440, "height": 960})
    seed_role(admin_context, "admin")
    admin_page = admin_context.new_page()
    admin_page.set_default_timeout(15_000)
    admin_errors: list[str] = []
    admin_page.on("pageerror", lambda error: admin_errors.append(str(error)))

    for admin_filename in ADMIN_PAGES:
        admin_errors.clear()
        open_page(admin_page, base_url, admin_filename)
        assert_expanded_shortcuts(admin_page, admin_filename)
        for shortcut_id in ["home", "bank", "users", "settings"]:
            assert admin_page.locator(
                f'[data-global-shortcut="{shortcut_id}"]'
            ).is_visible(), (admin_filename, shortcut_id)
        assert not admin_errors, (admin_filename, admin_errors)

    open_page(admin_page, base_url, "admin-console.html")
    assert_expanded_shortcuts(admin_page, "admin-console.html")
    toggle_layout(admin_page)
    drag_and_assert_persistence(admin_page, base_url)
    admin_page.locator('[data-global-shortcut="bank"]').click()
    admin_page.wait_for_url("**/teacher-workbench.html")
    assert admin_page.locator("#kgGlobalShortcuts").count() == 1
    assert admin_page.locator("#kgGlobalShortcuts").is_visible()
    admin_context.close()

    teacher_context = browser.new_context(viewport={"width": 1440, "height": 960})
    seed_role(teacher_context, "teacher")
    teacher_page = teacher_context.new_page()
    teacher_page.set_default_timeout(15_000)
    teacher_errors: list[str] = []
    teacher_page.on("pageerror", lambda error: teacher_errors.append(str(error)))
    open_page(teacher_page, base_url, "teacher-workbench.html")
    assert_expanded_shortcuts(teacher_page, "teacher-workbench.html")
    assert teacher_page.locator('[data-global-shortcut="bank"]').is_visible()
    assert teacher_page.locator('[data-global-shortcut="users"]').count() == 0
    assert teacher_page.locator('[data-global-shortcut="settings"]').count() == 0
    assert not teacher_errors, teacher_errors
    teacher_context.close()

    browser.close()

print(f"admin-global-shortcuts-browser-ok pages={len(ADMIN_PAGES)}")
