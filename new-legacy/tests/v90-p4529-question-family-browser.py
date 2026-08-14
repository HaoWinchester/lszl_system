"""Browser E2E for P4.5.29 G3: Question Family v1 (diff 12-20, 28).

Loads dist/content-prep.html standalone and asserts:

1. question editor exposes the family panel with role/relation/grade/level/purposes
2. setting a question as root generates familyKey/Family ID (diff 12/13)
3. creating a member from the root binds relation/grade defaults and leaves
   qualityConfirmed=false (diff 16/17)
4. teacher can confirm quality; external import forces it back to false (diff 16)
5. validation center reports family coverage as warning only (Root-only legal),
   duplicate familyKey root as error (diff 19/28)
6. question list shows family badges and the family navigation jumps (diff 20)
"""

from __future__ import annotations

from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "content-prep-studio" / "dist" / "content-prep.html"


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

        # 1/2) 设为母题：自动生成 familyKey，编辑区可见
        page.click('button[data-tab="questions"]')
        page.wait_for_timeout(200)
        page.click("#btnNewQuestion")
        page.wait_for_timeout(200)
        page.select_option("#qfRole", "root")
        page.wait_for_timeout(200)
        family = page.evaluate("() => questionFamily(currentQuestion())")
        assert family["role"] == "root" and family["relationToRoot"] == "root"
        assert family["familyKey"].startswith("FAMILY-"), family
        assert family["qualityConfirmed"] is False

        # 列表徽章 + 覆盖提示（Root-only 只 warn 不 error）
        badges = page.locator("#questionList .family-badge").count()
        assert badges >= 1, "题目列表应显示家族徽章"
        warns = page.evaluate("() => runValidation().issues.filter(x => x.message.includes('最低配置未达标')).length")
        assert warns == 1, "Root-only 应有一条最低覆盖 warn"
        errors_before = page.evaluate("() => runValidation().metrics.errors")

        # 3) 从母题创建成员：默认等价 A 级、未确认
        page.click("#btnCreateFamilyMember")
        page.wait_for_timeout(300)
        member = page.evaluate("() => questionFamily(currentQuestion())")
        assert member["role"] == "member"
        assert member["relationToRoot"] == "equivalent"
        assert member["equivalenceGrade"] == "A"
        assert member["qualityConfirmed"] is False
        root_id = page.evaluate("() => { const m = currentQuestion(); const f = questionFamily(m); return f.rootQuestionId; }")
        assert root_id, "成员应绑定母题"

        # 4) 教师勾选质量确认
        page.check("#qfConfirmed")
        page.wait_for_timeout(150)
        confirmed = page.evaluate("() => questionFamily(currentQuestion()).qualityConfirmed")
        assert confirmed is True, "教师可以人工确认质量"

        # 家族导航跳回母题
        page.click("#btnGoFamilyRoot")
        page.wait_for_timeout(200)
        assert page.evaluate("() => currentQuestion().id") == root_id

        # 5) 重复母题同 familyKey → 校验中心 error
        dup_key = page.evaluate("() => questionFamily(currentQuestion()).familyKey")
        page.click("#btnNewQuestion")
        page.wait_for_timeout(200)
        page.evaluate(f"() => {{ const q = currentQuestion(); q.metadata.questionFamily = {{schemaVersion:1, role:'root', familyKey:{dup_key!r}}}; renderQuestionFamilyEditor(); }}")
        page.wait_for_timeout(150)
        dup_errors = page.evaluate("() => runValidation().issues.filter(x => x.code === undefined && x.message.includes('家族代号重复')).length")
        assert dup_errors >= 1, "重复 familyKey 母题必须是 error"
        assert page.evaluate("() => runValidation().metrics.errors") > errors_before

        # 6) 外部导入强制归零（走 stampImportedQuestions 入口语义）
        forced = page.evaluate("""() => {
          const q = currentQuestion();
          q.metadata.questionFamily.qualityConfirmed = true;
          forceExternalFamilyUnconfirmed([q]);
          return questionFamily(q).qualityConfirmed;
        }""")
        assert forced is False, "外部导入一律强制 false"

        browser.close()
    print("v90-p4529 question family browser: passed")


if __name__ == "__main__":
    run()
