"""五角色缺陷回归：覆盖 2026-07-21 问题记录中的 15 项问题。"""

from __future__ import annotations

import argparse
import os
import time
from uuid import uuid4

from playwright.sync_api import Browser, BrowserContext, Page, sync_playwright


BASE = os.environ.get("E2E_BASE_URL", "http://127.0.0.1:5173").rstrip("/")
PASSWORD = "111111"
ACCOUNTS = {
    "admin": "全测管理员0721",
    "teacher": "全测教师0721",
    "student_basic": "全测学生基础0721",
    "student_advanced": "全测学生进阶0721",
    "viewer": "全测游客0721",
}
ACCOUNT_ROLES = {
    ACCOUNTS["admin"]: "admin",
    ACCOUNTS["teacher"]: "teacher",
    ACCOUNTS["student_basic"]: "student",
    ACCOUNTS["student_advanced"]: "student",
    ACCOUNTS["viewer"]: "viewer",
}


def login(context: BrowserContext, username: str, password: str = PASSWORD) -> None:
    response = context.request.post(
        f"{BASE}/api/v1/auth/login",
        data={"username": username, "password": password},
    )
    assert response.ok, (username, response.status, response.text())


def context_for(browser: Browser, username: str, *, viewport: dict | None = None) -> BrowserContext:
    context = browser.new_context(viewport=viewport or {"width": 1440, "height": 1000})
    login(context, username)
    return context


def ensure_test_accounts(browser: Browser) -> None:
    """Make the five requested regression accounts reproducible on every release candidate."""
    context = browser.new_context()
    try:
        users_response = None
        for username, password in (
            (ACCOUNTS["admin"], PASSWORD),
            ("佩奇007", PASSWORD),
            ("admin", "admin123"),
        ):
            login_response = context.request.post(
                f"{BASE}/api/v1/auth/login",
                data={"username": username, "password": password},
            )
            if not login_response.ok:
                continue
            candidate = context.request.get(f"{BASE}/api/v1/users?page_size=200")
            if candidate.ok:
                users_response = candidate
                break
        assert users_response is not None, "找不到可用的管理员账号，无法准备五角色回归数据"
        existing = {user["username"]: user for user in users_response.json()["users"]}
        for username, role in ACCOUNT_ROLES.items():
            if username not in existing:
                created = context.request.post(
                    f"{BASE}/api/v1/users",
                    data={
                        "username": username,
                        "password": PASSWORD,
                        "role": role,
                        "status": "active",
                        "display_name": username,
                    },
                )
                assert created.ok, (username, created.status, created.text())
            else:
                updated = context.request.put(
                    f"{BASE}/api/v1/users/{username}",
                    data={"role": role, "status": "active"},
                )
                assert updated.ok, (username, updated.status, updated.text())
                reset = context.request.post(
                    f"{BASE}/api/v1/users/{username}/reset-password",
                    data={"new_password": PASSWORD},
                )
                assert reset.ok, (username, reset.status, reset.text())
    finally:
        context.close()


def runtime_snapshot(context: BrowserContext) -> dict:
    response = context.request.get(f"{BASE}/api/v1/runtime/state")
    assert response.ok, (response.status, response.text())
    return response.json()


def restore_runtime(context: BrowserContext, snapshot: dict, *, page: str, namespace: str) -> None:
    current = runtime_snapshot(context)
    storage = dict(snapshot.get("storage") or {})
    key = "kg_default_entry_mode_v1"
    storage.setdefault(key, "learning")
    response = context.request.put(
        f"{BASE}/api/v1/runtime/state",
        data={
            "page": page,
            "namespace": namespace,
            "operation": "setItem",
            "key": key,
            "value": storage[key],
            "storage": storage,
            "snapshotMode": "full",
            "requestId": f"e2e-restore-{uuid4().hex}",
            "revision": current["revision"],
        },
    )
    assert response.ok, (response.status, response.text())


def flush(page: Page) -> None:
    page.wait_for_timeout(700)
    page.evaluate("() => window.KGServerStateStorage?.flush?.()")


def boxes_intersect(first: dict, second: dict) -> bool:
    return not (
        first["x"] + first["width"] <= second["x"]
        or second["x"] + second["width"] <= first["x"]
        or first["y"] + first["height"] <= second["y"]
        or second["y"] + second["height"] <= first["y"]
    )


def graph_regression(browser: Browser) -> None:
    username = ACCOUNTS["student_advanced"]
    context = context_for(browser, username)
    snapshot = runtime_snapshot(context)
    marker = f"回归图谱-{int(time.time())}"
    first_title = f"节点甲-{uuid4().hex[:6]}"
    second_title = f"节点乙-{uuid4().hex[:6]}"
    page = context.new_page()
    try:
        page.goto(f"{BASE}/files", wait_until="networkidle")
        page.locator("#fmNewFileBtn").click()
        page.locator("#fmModalName").fill(marker)
        page.locator("#fmModalSubmit").click()
        page.wait_for_url("**/index.html?mode=free", timeout=15_000)
        page.locator(".app").wait_for(state="visible")

        active_title = page.locator(".graph-file-tab.is-active .graph-file-tab-title")
        assert active_title.inner_text() == marker
        assert page.locator(".knowledge-card").count() == 0

        # P2-01：取消新节点必须丢弃草稿。
        page.locator("#addBtn").click()
        page.locator("#nodeModal.show").wait_for(state="visible")
        assert page.locator(".knowledge-card").count() == 1
        page.locator("#cancelNodeBtn").click()
        assert page.locator(".knowledge-card").count() == 0

        # P2-02：连续从同一入口创建的节点不能完全重叠。
        for title in (first_title, second_title):
            page.locator("#addBtn").click()
            page.locator("#nodeModal.show").wait_for(state="visible")
            page.locator("#nTitle").fill(title)
            page.locator("#saveNodeBtn").click()
        cards = page.locator(".knowledge-card")
        assert cards.count() == 2
        first_box = cards.nth(0).bounding_box()
        second_box = cards.nth(1).bounding_box()
        assert first_box and second_box
        assert (first_box["x"], first_box["y"]) != (second_box["x"], second_box["y"])

        # P2-03：重复连线只能提示已存在，不能删除原关系。
        cards.nth(0).dblclick()
        cards.nth(1).click()
        assert page.locator("#edgeGroup [data-link-id]").count() == 1
        cards.nth(0).dblclick()
        cards.nth(1).click()
        duplicate_probe = page.evaluate(
            """() => ({
              edgeDom: document.querySelectorAll('#edgeGroup [data-link-id]').length,
              status: document.querySelector('#status')?.textContent || '',
              selectedCards: [...document.querySelectorAll('.knowledge-card.active')].map(card => card.dataset.nodeId),
              fileLinks: window.KGGraphFileStore?.getCurrentFile?.()?.graphData?.links?.length ?? null,
              stateLinks: eval('state.links.length'),
              stateNodes: eval('state.nodes.length'),
              largeMode: eval('isLargeGraphMode()'),
              overviewEnabled: eval('largeGraphOverviewEnabled')
            })"""
        )
        assert duplicate_probe["edgeDom"] == 1, duplicate_probe
        assert "已有关系线" in page.locator("#status").inner_text()

        # P1-01：刷新和新浏览器上下文后仍能恢复节点、位置和关系。
        flush(page)
        saved_probe = page.evaluate(
            """() => {
              const file = window.KGGraphFileStore?.getCurrentFile?.();
              return {
                currentId: file?.id || '',
                titles: (file?.graphData?.nodes || []).map(node => node.title),
                links: (file?.graphData?.links || []).length,
                stateTitles: eval('state.nodes.map(node => node.title)'),
                stateLinks: eval('state.links.length')
              };
            }"""
        )
        server_probe = [
            value
            for value in runtime_snapshot(context)["storage"].values()
            if marker in value or first_title in value or second_title in value
        ]
        assert first_title in saved_probe["titles"] and second_title in saved_probe["titles"], saved_probe
        assert saved_probe["links"] == 1, saved_probe
        assert any(first_title in value and second_title in value for value in server_probe), server_probe
        page.reload(wait_until="networkidle")
        reloaded_titles = page.locator(".knowledge-card .node-title").all_inner_texts()
        assert first_title in reloaded_titles and second_title in reloaded_titles, (reloaded_titles, saved_probe)
        assert page.evaluate("() => window.KGGraphFileStore.getCurrentFile().graphData.links.length") == 1
        page.get_by_text(first_title, exact=True).click()
        assert page.locator("#edgeGroup [data-link-id]").count() == 1

        fresh = context_for(browser, username)
        try:
            fresh_page = fresh.new_page()
            fresh_page.goto(f"{BASE}/graph", wait_until="networkidle")
            assert fresh_page.get_by_text(first_title, exact=True).count() == 1
            assert fresh_page.get_by_text(second_title, exact=True).count() == 1
            fresh_page.get_by_text(first_title, exact=True).click()
            assert fresh_page.locator("#edgeGroup [data-link-id]").count() == 1
        finally:
            fresh.close()
    finally:
        page.close()
        restore_runtime(context, snapshot, page="index.html", namespace="files")
        context.close()


def question_regression(browser: Browser) -> None:
    username = ACCOUNTS["teacher"]
    context = context_for(browser, username)
    snapshot = runtime_snapshot(context)
    token = uuid4().hex[:8]
    bank_name = f"回归题库-{token}"
    question_title = f"回归当前题-{token}"
    question_stem = f"这是用于验证跨页训练和深度回忆的题干-{token}"
    paper_name = f"回归发布试卷-{token}"
    page = context.new_page()
    try:
        page.goto(f"{BASE}/question-bank", wait_until="networkidle")
        page.locator("#qbAddBankBtn").click()
        page.locator("#bankName").fill(bank_name)
        page.locator("#qbSaveBankBtn").click()
        page.locator("#qbAddQuestionBtn").click()
        page.locator('[data-main-tab="base"]').click()
        page.locator("#qbQuestionBaseCard").wait_for(state="visible")

        # P2-04：空题干、空选项不能保存，并允许修正后重试。
        page.locator("#questionStemInput").fill("")
        page.locator("#qbOptionsEditor .option-text").evaluate_all(
            "inputs => inputs.forEach(input => { input.value = ''; input.dispatchEvent(new Event('input', {bubbles:true})); })"
        )
        page.locator("#qbSaveQuestionBtn").click()
        assert "请先填写题干" in page.locator("#qbToast").inner_text()
        page.locator("#questionStemInput").fill(question_stem)
        page.locator("#qbSaveQuestionBtn").click()
        assert "至少填写两个非空选项" in page.locator("#qbToast").inner_text()

        page.locator("#questionTitleInput").fill(question_title)
        page.locator("#questionDomainInput").fill("回归领域")
        options = page.locator("#qbOptionsEditor .option-text")
        assert options.count() >= 2
        options.nth(0).fill("正确选项")
        options.nth(1).fill("干扰选项")
        page.locator('input[name="correctOption"]').first.check()
        page.locator("#qbSaveQuestionBtn").click()
        flush(page)

        # P1-05：当前编辑题必须传入深度回忆，而不是回退到内置题。
        with page.expect_popup() as popup_info:
            page.locator("#qbPreviewRecallBtn").click()
        recall = popup_info.value
        try:
            recall.wait_for_load_state("networkidle")
            body = recall.locator("body").inner_text()
            assert question_title in body or question_stem in body, body[:3000]
        finally:
            recall.close()

        # P1-04：发布试卷后训练页必须能读取。
        page.locator('[data-main-tab="papers"]').click()
        page.locator("#qbAddPaperBtn").click()
        page.locator("#paperNameInput").fill(paper_name)
        page.locator("#paperTotalInput").fill("1")
        page.locator("#qbAutoQuotaBtn").click()
        page.locator("#qbBuildPaperBtn").click()
        assert "1 题" in page.locator("#qbPaperQuestionCount").inner_text()
        page.locator("#qbPublishPaperBtn").click()
        assert "已发布：前端可见" in page.locator("#qbPaperMeta").inner_text()
        flush(page)

        # P1-03：关闭浏览器上下文并重新登录后，题库和题目仍存在。
        fresh = context_for(browser, username)
        try:
            fresh_page = fresh.new_page()
            fresh_page.goto(f"{BASE}/question-bank", wait_until="networkidle")
            bank = fresh_page.locator(".qb-bank-list-card", has_text=bank_name)
            bank.wait_for(state="visible")
            bank.click()
            question = fresh_page.locator(".qb-list-item.question", has_text=question_title)
            question.wait_for(state="visible")

            fresh_page.goto(f"{BASE}/training", wait_until="networkidle")
            options_text = fresh_page.locator("#qtPublishedPaperSelect option").all_inner_texts()
            assert any(paper_name in text for text in options_text), options_text

            # P1-06：1440×1000 下快捷栏不能覆盖训练主操作停靠区。
            shortcuts = fresh_page.locator(".kg-global-shortcuts")
            dock = fresh_page.locator(".qt-guided-dock")
            shortcuts.wait_for(state="visible")
            dock.wait_for(state="visible")
            shortcuts_box = shortcuts.bounding_box()
            dock_box = dock.bounding_box()
            assert shortcuts_box and dock_box
            assert not boxes_intersect(shortcuts_box, dock_box), (shortcuts_box, dock_box)
        finally:
            fresh.close()

        persisted = runtime_snapshot(context)["storage"]
        assert any(bank_name in value and question_title in value for value in persisted.values())
        assert any(paper_name in value for value in persisted.values())
    finally:
        page.close()
        restore_runtime(context, snapshot, page="question-bank.html", namespace="questions")
        context.close()


def role_and_settings_regression(browser: Browser) -> None:
    # P1-07：只有 student 进入套餐选择；其他角色只看身份摘要。
    role_expectations = {
        ACCOUNTS["admin"]: False,
        ACCOUNTS["teacher"]: False,
        ACCOUNTS["student_basic"]: True,
        ACCOUNTS["student_advanced"]: True,
        ACCOUNTS["viewer"]: False,
    }
    for username, should_show_plans in role_expectations.items():
        context = context_for(browser, username)
        try:
            page = context.new_page()
            page.goto(f"{BASE}/member", wait_until="networkidle")
            if should_show_plans:
                page.locator(".user-subscription-detail-backdrop.show").wait_for(state="visible")
                assert page.locator(".kg-subscription-purchase-card").count() >= 1
            else:
                page.locator(".user-center-backdrop.show").wait_for(state="visible")
                assert page.locator(".kg-subscription-purchase-card").count() == 0
                assert page.locator("#upgradeMemberBtn").is_hidden()
        finally:
            context.close()

    # P2-06：设置页必须读取归一化接口，保存主题必须 PUT 到同一接口。
    context = context_for(browser, ACCOUNTS["admin"])
    page = context.new_page()
    requested: list[str] = []
    page.on("request", lambda request: requested.append(request.url))
    try:
        page.goto(f"{BASE}/settings", wait_until="networkidle")
        for endpoint in ("themes", "wechat-config", "wechat-pay-config", "subscription-plans"):
            assert any(f"/api/v1/system/{endpoint}" in url for url in requested), (endpoint, requested)
        with page.expect_response(
            lambda response: "/api/v1/system/themes/admin" in response.url
            and response.request.method == "PUT"
        ) as response_info:
            page.locator('[data-save-theme="admin"]').click()
        assert response_info.value.ok

        # P3-01：运行页和动态弹窗资源不再声称是 localStorage/纯前端架构。
        resources = [
            "/index.html?mode=free",
            "/question-training.html",
            "/user-management.html",
            "/system-settings.html",
            "/src/33-user-center.js",
            "/src/35-user-management.js",
            "/src/36-system-settings.js",
        ]
        combined = "\n".join(context.request.get(BASE + path).text() for path in resources)
        for stale in (
            "账号和数据保存在本浏览器 localStorage",
            "管理本浏览器中的账号资料",
            "当前纯前端版本暂未接入支付",
            "当前纯前端版本暂不接真实支付",
            "正式收费时应由后端保存价格、订单和订阅状态",
            "本浏览器 localStorage",
        ):
            assert stale not in combined, stale
        assert "数据已同步至服务器" in combined
    finally:
        page.close()
        context.close()


def user_admin_regression(browser: Browser) -> None:
    # P1-08 / P2-05：复制显示名带“副本”；导入必须显式提供可登录初始密码。
    context = context_for(browser, ACCOUNTS["admin"])
    token = uuid4().hex[:8]
    source = f"回归复制源{token}"
    copied = f"回归复制副本{token}"
    imported = f"回归导入{token}"
    try:
        created = context.request.post(
            f"{BASE}/api/v1/users",
            data={
                "username": source,
                "password": PASSWORD,
                "role": "student",
                "display_name": "回归深度用户",
            },
        )
        assert created.ok, created.text()
        duplicate = context.request.post(
            f"{BASE}/api/v1/users/{source}/duplicate",
            data={"new_username": copied, "new_password": PASSWORD},
        )
        assert duplicate.ok, duplicate.text()
        assert duplicate.json()["user"]["display_name"] == "回归深度用户 副本"

        exported = context.request.get(f"{BASE}/api/v1/users/export?usernames={source}")
        serialized = exported.text().lower()
        assert all(secret not in serialized for secret in ("password", "hash", "salt"))

        missing_password = context.request.post(
            f"{BASE}/api/v1/users/import",
            data={"users": [{"username": imported, "role": "student"}]},
        )
        assert missing_password.status == 422

        imported_response = context.request.post(
            f"{BASE}/api/v1/users/import",
            data={
                "initial_password": "112233",
                "users": [{"username": imported, "role": "student", "display_name": "可登录导入账号"}],
            },
        )
        assert imported_response.ok, imported_response.text()
        imported_context = browser.new_context()
        try:
            login(imported_context, imported, "112233")
        finally:
            imported_context.close()
    finally:
        for username in (source, copied, imported):
            context.request.delete(f"{BASE}/api/v1/users/{username}")
        context.close()


GROUPS = {
    "graph": graph_regression,
    "questions": question_regression,
    "roles": role_and_settings_regression,
    "admin": user_admin_regression,
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--group", choices=["all", *GROUPS], default="all")
    args = parser.parse_args()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            ensure_test_accounts(browser)
            selected = GROUPS.items() if args.group == "all" else [(args.group, GROUPS[args.group])]
            for name, regression in selected:
                print(f"full-role: {name} start", flush=True)
                regression(browser)
                print(f"full-role: {name} PASS", flush=True)
        finally:
            browser.close()
    print("full-role: ALL PASS", flush=True)


if __name__ == "__main__":
    main()
