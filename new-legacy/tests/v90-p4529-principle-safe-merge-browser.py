"""Browser E2E for P4.5.29 G1: principle bundle dual-format + safe merge (diff 6-8).

Loads the built dist/content-prep.html standalone (API stubbed), imports
principle payloads through the real file input + dialog flow, and asserts:

1. kg / pmp bundle both import through the same safe-merge path
2. conflicts default to keep-existing (no silent overwrite / delete)
3. explicit take-incoming resolution overwrites after review
4. legacy principle-library JSON merges alone (no preset pairing error)
5. unknown format is rejected with a fixed error, state unchanged
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "content-prep-studio" / "dist" / "content-prep.html"

EXISTING = {
    "principles": {"schemaVersion": 1, "items": [
        {"id": "p-keep", "name": "保持不变", "status": "active", "confusablePrincipleIds": []},
        {"id": "p-rename", "name": "旧名称", "status": "active", "confusablePrincipleIds": []},
    ]},
    "synthesisPresets": {"schemaVersion": 1, "items": [
        {"id": "s-keep", "principleId": "p-keep", "title": "原则：保持不变", "content": "保持", "status": "active", "version": 1},
        {"id": "s-rename", "principleId": "p-rename", "title": "原则：旧名称", "content": "旧", "status": "active", "version": 1},
    ]},
}

INCOMING_KG = {
    "principleCardBundleVersion": 1, "format": "kg-principle-card-bundle-v1",
    "principles": {"schemaVersion": 1, "items": [
        {"id": "p-keep", "name": "保持不变", "status": "active", "confusablePrincipleIds": []},
        {"id": "p-rename", "name": "新名称", "status": "active", "confusablePrincipleIds": []},
        {"id": "p-new", "name": "全新原则", "status": "active", "confusablePrincipleIds": []},
    ]},
    "synthesisPresets": {"schemaVersion": 1, "items": [
        {"id": "s-keep", "principleId": "p-keep", "title": "原则：保持不变", "content": "保持", "status": "active", "version": 1},
        {"id": "s-rename", "principleId": "p-rename", "title": "原则：新名称", "content": "新", "status": "active", "version": 1},
        {"id": "s-new", "principleId": "p-new", "title": "原则：全新原则", "content": "全新", "status": "active", "version": 1},
    ]},
}

INCOMING_PMP = {
    "format": "pmp-principle-preset-bundle-v1",
    "principles": [{"id": "p-pmp", "name": "PMP 新原则", "status": "active", "confusablePrincipleIds": []}],
    "presets": [{"id": "s-pmp", "principleId": "p-pmp", "title": "原则：PMP 新原则", "content": "pmp", "status": "active", "version": 1}],
}

LEGACY_LIBRARY = {
    "schemaVersion": 1,
    "items": [{"id": "p-legacy", "name": "价值交付第一", "status": "active", "confusablePrincipleIds": []}],
}

UNKNOWN_FORMAT = {"format": "mystery-bundle-v99", "principles": [{"id": "p-x", "name": "x"}]}


def state_principles(page):
    return page.evaluate("() => JSON.parse(JSON.stringify(state.principles))")


def set_existing(page):
    page.evaluate("existing => {"
                  "state.principles = existing.principles;"
                  "state.synthesisPresets = existing.synthesisPresets;"
                  "}", EXISTING)


def import_payload(page, dialogs, payload, action="accept"):
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
        json.dump(payload, handle, ensure_ascii=False)
        path = handle.name
    page.set_input_files("#filePrincipleCardBundle", path)
    page.wait_for_timeout(200)


def run() -> None:
    dialogs: list[str] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = browser.new_page(viewport={"width": 1360, "height": 900})
        page.on("dialog", lambda dialog: (dialogs.append(dialog.message), dialog.accept()))
        page.route("**/api/**", lambda route: route.fulfill(status=200, content_type="application/json", body="{}"))
        page.goto(DIST.as_uri())
        page.wait_for_timeout(400)

        # 1) kg bundle: conflict defaults to keep-existing
        set_existing(page)
        import_payload(page, dialogs, INCOMING_KG)
        assert any("3 项" in message or "项原则" in message or "冲突" in message for message in dialogs), dialogs
        dialogs.clear()
        principles = state_principles(page)
        ids = sorted(item["id"] for item in principles["items"])
        assert ids == ["p-keep", "p-new", "p-rename"], ids
        rename = next(item for item in principles["items"] if item["id"] == "p-rename")
        assert rename["name"] == "旧名称", rename  # 默认保留现有，不静默覆盖
        preset_rename = page.evaluate("() => state.synthesisPresets.items.find(s => s.id === 's-rename')")
        assert preset_rename["title"] == "原则：旧名称", preset_rename
        preset_new = page.evaluate("() => state.synthesisPresets.items.find(s => s.id === 's-new')")
        assert preset_new and preset_new["principleId"] == "p-new"  # 新增原则的归纳卡随合并进入

        # 2) pmp bundle top-level arrays import through the same path
        set_existing(page)
        dialogs.clear()
        import_payload(page, dialogs, INCOMING_PMP)
        principles = state_principles(page)
        assert any(item["id"] == "p-pmp" for item in principles["items"]), principles
        assert any(item["id"] == "p-keep" for item in principles["items"]), "pmp 导入也不能清掉已有原则"

        # 3) legacy principle library merges alone (no preset pairing error)
        set_existing(page)
        dialogs.clear()
        import_payload(page, dialogs, LEGACY_LIBRARY)
        principles = state_principles(page)
        assert any(item["id"] == "p-legacy" for item in principles["items"]), principles
        assert len(page.evaluate("() => state.synthesisPresets.items")) == 2

        # 4) unknown format rejected, state unchanged
        set_existing(page)
        before = state_principles(page)
        dialogs.clear()
        import_payload(page, [], UNKNOWN_FORMAT)
        page.wait_for_timeout(200)
        assert any("不支持的原则与归纳卡文件格式" in message for message in dialogs), dialogs
        assert state_principles(page) == before, "未知格式导入后状态必须保持不变"

        browser.close()
    print("v90-p4529 principle safe merge browser: passed")


if __name__ == "__main__":
    run()
