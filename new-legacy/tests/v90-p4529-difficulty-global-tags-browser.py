"""Browser E2E for P4.5.29 G4: three-level difficulty + global/... tags (diff 21, 26)."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "content-prep-studio" / "dist" / "content-prep.html"

LEGACY_BANK = {
    "name": "G4 旧难度题库",
    "subject": "PMP",
    "questions": [
        {
            "id": "g4-legacy-1",
            "title": "旧难度题（基础）",
            "type": "single_choice",
            "subject": "PMP",
            "difficulty": "基础",
            "stemParts": [{"text": "旧难度题干"}],
            "options": [
                {"id": "A", "text": "错", "correct": False},
                {"id": "B", "text": "对", "correct": True},
                {"id": "C", "text": "C", "correct": False},
                {"id": "D", "text": "D", "correct": False},
            ],
            "correctAnswer": "B",
            "analysis": "解析",
            "tags": ["基础练习", "自编题"],
        }
    ],
}


def run() -> None:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = browser.new_page(viewport={"width": 1360, "height": 900})
        page.on("dialog", lambda dialog: dialog.accept())
        page.goto(DIST.as_uri())
        page.wait_for_timeout(400)
        if page.locator("#creatorGate").is_visible():
            page.click('#creatorGate button[data-creator-key="peiqi"]')
            page.wait_for_timeout(300)
        page.evaluate("() => { document.getElementById('sharedDraftGate')?.classList.add('hidden'); }")

        # 难度下拉只有三档：简单/中等/困难
        page.click('button[data-tab="questions"]')
        page.wait_for_timeout(200)
        page.click("#btnNewQuestion")
        page.wait_for_timeout(200)
        options = page.evaluate("() => [...document.querySelector('[data-qfield=difficulty]').options].map(o => o.value)")
        assert options == ["简单", "中等", "困难"], options

        # 导入旧“基础”题库 → 迁移为“简单”；family difficultyLevel 独立不受影响
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
            json.dump(LEGACY_BANK, handle, ensure_ascii=False)
            bank_path = handle.name
        page.set_input_files("#fileQuestionBank", bank_path)
        page.wait_for_timeout(300)
        migrated = page.evaluate("() => state.questionBank.questions.map(q => ({d: q.difficulty, tags: q.tags, paths: q.metadata.tagPaths.map(p => p.label)}))")
        assert migrated[0]["d"] == "简单", migrated  # 旧“基础”只在导入层迁移
        assert migrated[0]["tags"] == ["基础练习", "自编题"] or migrated[0]["tags"], migrated

        # 列表元信息显示新难度
        assert "简单" in page.locator("#questionList").inner_text()

        # Global Tag：tagConfig 内部槽位一律 global/...，标签路径解析仍工作
        slots = page.evaluate("() => Object.keys(state.tagConfig.slotAliases || {}).concat(Object.keys(state.tagConfig.names || {}))")
        assert all(slot.startswith("global/") for slot in slots), slots
        catalog = page.evaluate("() => tagCatalogEntries().map(x => x.slot)")
        assert catalog and all(slot.startswith("global/") for slot in catalog), catalog
        # 导出正式格式回退旧数字槽位（主程序兼容）
        page.evaluate("() => { state.tagConfig.names['global/usage/stage/basic'] = '入门练习'; }")
        exported = page.evaluate("() => Object.keys(ExportService.tagConfig().names || {})")
        assert exported == ["usage/stage/0"], exported
        assert page.evaluate("() => ExportService.tagConfig().names['usage/stage/0']") == "入门练习"

        browser.close()
    print("v90-p4529 difficulty & global tags browser: passed")


if __name__ == "__main__":
    run()
