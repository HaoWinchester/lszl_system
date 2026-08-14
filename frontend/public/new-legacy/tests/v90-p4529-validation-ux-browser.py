from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "content-prep-studio" / "dist" / "content-prep.html"


def run() -> None:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = browser.new_page(viewport={"width": 1360, "height": 900})
        page.goto(DIST.as_uri())
        page.wait_for_timeout(300)
        if page.locator("#creatorGate").is_visible():
            page.click('#creatorGate button[data-creator-key="peiqi"]')
        page.evaluate(
            "() => document.getElementById('sharedDraftGate')?.classList.add('hidden')"
        )
        page.click('button[data-tab="questions"]')
        page.click("#btnNewQuestion")
        question_id = page.evaluate("() => state.currentQuestionId")

        # 校验行必须能回到对应题目和字段区域。
        page.click('button[data-tab="validate"]')
        page.click("#btnRunValidation")
        row = page.locator(
            f'#validationRows tr[data-question-id="{question_id}"]'
        ).first
        assert row.count() == 1, "校验结果必须携带可导航 questionId"
        row.click()
        assert page.locator('button[data-tab="questions"]').get_attribute(
            "class"
        ) and "active" in page.locator(
            'button[data-tab="questions"]'
        ).get_attribute("class")
        assert page.evaluate("() => state.currentQuestionId") == question_id

        # 输入态 Delete 只编辑文本，不得删除题目。
        title = page.locator('[data-qfield="title"]')
        title.fill("保留这道题")
        title.press("Delete")
        assert page.evaluate("() => state.questionBank.questions.length") == 1

        # 非输入态 Delete 删除当前题目；测试明确接受确认框。
        page.evaluate(
            "() => { document.activeElement?.blur(); window.confirm = () => true; }"
        )
        page.keyboard.press("Delete")
        assert page.evaluate("() => state.questionBank.questions.length") == 0

        browser.close()
    print("v90-p4529 validation UX browser: passed")


if __name__ == "__main__":
    run()
