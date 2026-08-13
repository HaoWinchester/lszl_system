# 幻谱 PMP 官网首页实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `/` 改造成面向 PMP 备考学员的「幻谱」产品官网，并通过 `/graph` 直达现有知识图谱软件。

**Architecture:** 官网作为 `new-legacy` release 内的独立 `landing.html` 发布，CSS、JavaScript 和真实产品截图全部自包含且不污染现有业务页。FastAPI 根路由直接返回 active release 的官网文件，`/index.html`、`workbench.html`、`/graph` 和 `/login` 保持兼容；正式发布继续经过候选文件数与关键页面门禁。

**Tech Stack:** 语义化 HTML、原生 CSS、原生 JavaScript、Python Playwright、Node.js `assert`、FastAPI/TestClient、现有 `manage-new-legacy.js` 发布器。

## Global Constraints

- 不修改 `legacy/` 源文件，不改变现有业务数据、权限、API 或数据库结构。
- 品牌名固定为「幻谱」，首要人群固定为 PMP 备考学员。
- 主 CTA 统一指向 `/graph`，登录统一指向 `/login`。
- 首版不展示价格、会员套餐、虚构用户数、通过率、评价或合作机构。
- 产品展示使用当前系统的真实界面截图，不出现敏感账号和个人数据。
- 不使用外部 CDN、外部字体、前端框架或新的运行依赖。
- 所有页面状态只存在当前页面生命周期，不写浏览器持久化。
- 新页面随 active release 正式同步和发布；候选 site 文件数不得小于当前 active site。

## 文件结构

- `new-legacy/landing.html`：官网语义结构、真实链接、可访问状态和静态回退内容。
- `new-legacy/styles/landing.css`：`.landing-page` 命名空间下的视觉、响应式和 reduced-motion 样式。
- `new-legacy/src/landing.js`：移动导航、产品标签、FAQ、滚动状态和渐入增强。
- `new-legacy/assets/landing/*.png`：四个当前系统真实界面截图。
- `new-legacy/tests/landing-page-contract.test.js`：页面内容、资源、链接和禁用项静态契约。
- `new-legacy/tests/landing-page-browser.py`：桌面/移动交互、键盘、失败恢复和视觉冒烟。
- `frontend/scripts/new-legacy-contract.json`：将官网及资源加入必需发布文件。
- `backend/app/web/routes.py`：根路由与候选根预览返回官网。
- `backend/tests/test_web_runtime.py`：官网、缺失资源、稳定入口与旧页面兼容测试。
- `frontend/scripts/manage-new-legacy.js`：把官网加入候选关键文件门禁。
- `frontend/scripts/new-legacy-release.test.mjs`：发布器拒绝缺失官网的候选版本。
- `frontend/scripts/validate-new-legacy-release.sh`：候选版本执行官网契约和浏览器验收。

---

### Task 1: 官网静态契约与视觉页面

**Files:**
- Create: `new-legacy/tests/landing-page-contract.test.js`
- Create: `new-legacy/landing.html`
- Create: `new-legacy/styles/landing.css`
- Create: `new-legacy/src/landing.js`（先为空的增强入口）
- Create: `new-legacy/assets/landing/graph.png`
- Create: `new-legacy/assets/landing/practice.png`
- Create: `new-legacy/assets/landing/workspace.png`
- Create: `new-legacy/assets/landing/recall.png`
- Modify: `frontend/scripts/new-legacy-contract.json`

**Interfaces:**
- Consumes: `/graph`、`/login` 和四个既有产品页面 URL。
- Produces: `landing.html` 中的 `[data-landing-nav-toggle]`、`[data-product-tab]`、`[data-product-panel]`、`[data-faq-trigger]`，供 Task 2 的脚本和浏览器测试使用。

- [x] **Step 1: 写静态失败测试**

测试读取真实源文件，断言品牌、区块、所有 CTA、登录、四个产品标签/截图/替代文本、FAQ、无外部依赖、无价格和虚构数据，并断言 release contract 要求官网资源。

```js
assert.match(html, /<h1[^>]*>\s*把零散考点[\s\S]*会生长的图谱/)
assert.equal([...html.matchAll(/href="\/graph"/g)].length >= 3, true)
assert.match(html, /data-product="graph"/)
assert.match(html, /assets\/landing\/graph\.png/)
assert.doesNotMatch(html, /价格|套餐|通过率|1000万|客户评价/)
assert.ok(contract.requiredPages.includes('landing.html'))
```

- [x] **Step 2: 运行测试并确认因官网缺失而失败**

Run: `node new-legacy/tests/landing-page-contract.test.js`

Expected: FAIL，原因是 `new-legacy/landing.html` 不存在。

- [x] **Step 3: 实现页面与独立样式**

按设计文档完成导航、首屏知识网络、三项痛点、四步闭环、真实产品展示、学习方法、四个 FAQ、终态 CTA 和页脚。所有产品截图来源于当前系统真实页面，截图旁明确说明当前能力；`landing.js` 此时只保留注释或空 IIFE，不实现交互。

- [x] **Step 4: 更新 release contract 并运行静态测试**

Run: `node new-legacy/tests/landing-page-contract.test.js`

Expected: PASS，输出 `landing-page-contract-ok`。

### Task 2: 真实交互、响应式与失败恢复

**Files:**
- Create: `new-legacy/tests/landing-page-browser.py`
- Modify: `new-legacy/src/landing.js`
- Modify: `new-legacy/styles/landing.css`

**Interfaces:**
- Consumes: Task 1 提供的 `data-*` 选择器。
- Produces: `setMenu(open: boolean)`、`selectProduct(tab: HTMLElement, focus?: boolean)`、`setFaq(trigger: HTMLElement, expanded: boolean)` 的页面内行为；不暴露全局业务对象。

- [x] **Step 1: 写浏览器失败测试**

用 Playwright 直接加载 `landing.html` 和本地资源，验证：

```python
page.locator('[data-product-tab="workspace"]').click()
assert page.locator('[data-product-tab="workspace"]').get_attribute('aria-selected') == 'true'
assert page.locator('[data-product-panel="workspace"]').is_visible()
page.locator('[data-faq-trigger]').first.click()
assert page.locator('[data-faq-trigger]').first.get_attribute('aria-expanded') == 'true'
page.set_viewport_size({'width': 390, 'height': 844})
page.locator('[data-landing-nav-toggle]').click()
assert page.locator('[data-landing-nav]').is_visible()
```

再覆盖产品标签方向键、重复点击、`Escape` 关闭菜单、截图 `error` 事件后的文字回退、reduced-motion 以及 390px 无水平滚动。

- [x] **Step 2: 运行测试并确认因交互未实现而失败**

Run: `python3 new-legacy/tests/landing-page-browser.py`

Expected: FAIL，首个产品标签点击后 `aria-selected` 仍未更新。

- [x] **Step 3: 实现最小交互增强**

实现移动菜单、标签鼠标/键盘切换、FAQ 展开收起、图片失败回退、滚动吸顶状态和 IntersectionObserver 渐入。脚本失败或禁用时链接、正文、截图说明和 FAQ 答案仍可访问。

- [x] **Step 4: 运行浏览器测试并检查页面截图**

Run: `python3 new-legacy/tests/landing-page-browser.py`

Expected: PASS，生成桌面和 390px 验收截图到临时目录，不在仓库遗留测试产物。

### Task 3: FastAPI 根路由与兼容入口

**Files:**
- Modify: `backend/tests/test_web_runtime.py`
- Modify: `backend/app/web/routes.py`

**Interfaces:**
- Consumes: active/preview `WebRelease.site / 'landing.html'`。
- Produces: `/` 返回 200 官网；`/__preview/{version}/` 返回候选官网；官网缺失时 `/` 返回 503；既有别名不变。

- [x] **Step 1: 把旧根跳转测试改为官网行为测试**

```python
def test_root_serves_public_landing_page(monkeypatch, tmp_path):
    site = tmp_path / "site"
    site.mkdir()
    (site / "landing.html").write_text("<title>幻谱｜PMP 知识图谱学习平台</title>", encoding="utf-8")
    monkeypatch.setattr(routes, "_release_or_503", lambda: WebRelease("test", site, "hash"))
    with TestClient(app) as client:
        response = client.get("/?auth=login&stage=foundation", follow_redirects=False)
    assert response.status_code == 200
    assert "幻谱" in response.text
    assert "__KG_DIRECT_BOOTSTRAP__" not in response.text
```

增加缺失 `landing.html` 返回 503，以及 `/graph`、`/login`、`/index.html`、`workbench.html` 兼容断言。

- [x] **Step 2: 运行后端测试并确认旧 307 行为导致失败**

Run: `cd backend && .venv/bin/python -m pytest tests/test_web_runtime.py -q`

Expected: FAIL，根路由返回 307 而不是 200。

- [x] **Step 3: 实现根路由与 preview 根路由**

根路由用 `FileResponse` 返回 active release 的 `landing.html`，设置 `no-cache` 与 `nosniff`；捕获官网资源缺失并转换为 503。preview 根路由改为返回候选 `landing.html`，不注入业务 bootstrap。

- [x] **Step 4: 运行聚焦后端测试**

Run: `cd backend && .venv/bin/python -m pytest tests/test_web_runtime.py tests/test_web_page_access.py -q`

Expected: PASS。

### Task 4: 发布门禁与候选版本验收

**Files:**
- Modify: `frontend/scripts/new-legacy-release.test.mjs`
- Modify: `frontend/scripts/manage-new-legacy.js`
- Modify: `frontend/scripts/validate-new-legacy-release.sh`

**Interfaces:**
- Consumes: Task 1 的官网文件和 Task 2 的测试脚本。
- Produces: 候选 site 缺少 `landing.html`、`styles/landing.css`、`src/landing.js` 或首张真实截图时拒绝 promote。

- [x] **Step 1: 写发布门禁失败测试**

基于真实 `new-legacy` 复制候选源，删除 `landing.html`，断言 `manage-new-legacy.js update` 非零退出、active pointer 不变、错误包含缺失官网文件。

```js
rmSync(resolve(next, 'landing.html'))
const result = run(root, 'update', next)
assert.notEqual(result.status, 0)
assert.match(result.stderr, /候选 site 缺少关键文件.*landing\.html/s)
assert.equal(readFileSync(resolve(root, 'current.json'), 'utf8'), before)
```

- [x] **Step 2: 运行测试并确认候选门禁未列出官网时失败**

Run: `cd frontend && node --test scripts/new-legacy-release.test.mjs`

Expected: 新增测试 FAIL，错误不满足官网关键文件门禁契约。

- [x] **Step 3: 扩展关键文件门禁和验证脚本**

把 `landing.html`、`styles/landing.css`、`src/landing.js`、`assets/landing/graph.png` 加入 `criticalSiteFiles`。候选验证脚本执行静态官网契约和 Playwright 官网测试。

- [x] **Step 4: 运行发布器和前端测试**

Run: `cd frontend && pnpm test`

Expected: 全部 Node 测试 PASS。

### Task 5: 版本发布与全链路验证

**Files:**
- Modify: `new-legacy/VERSION`（实际发布为 `v9.0-p4.1.51`）
- Generated: `frontend/public/new-legacy/`
- Generated: `frontend/new-legacy-releases/v9.0-p4.1.51/`
- Modify: `frontend/new-legacy-releases/current.json`
- Modify: `frontend/new-legacy-manifest.json`
- Modify: `frontend/new-legacy-sync-report.json`

**Interfaces:**
- Consumes: Tasks 1–4 的全部页面、路由和门禁。
- Produces: active release `v9.0-p4.1.42`，根地址可实际打开官网。

- [x] **Step 1: 同步前先核对 active 与工作源**

Run:

```bash
diff -qr frontend/new-legacy-releases/v9.0-p4.1.41/source new-legacy
find frontend/new-legacy-releases/v9.0-p4.1.41/site -type f | wc -l
find new-legacy -type f | wc -l
```

Expected: 除本功能新增文件和版本号外无未知差异；新源文件数不少于 active source。

- [x] **Step 2: 运行聚焦与全量验证**

Run:

```bash
node new-legacy/tests/landing-page-contract.test.js
python3 new-legacy/tests/landing-page-browser.py
cd backend && .venv/bin/python -m pytest tests/test_web_runtime.py tests/test_web_page_access.py -q
cd frontend && pnpm test
```

Expected: 全部退出码为 0。

- [x] **Step 3: 通过正式发布器构建和 promote**

Run: `node frontend/scripts/manage-new-legacy.js update new-legacy --skip-browser`

Expected: 候选文件数不少于 active，关键官网与业务文件齐全，`current.json` 指向 `v9.0-p4.1.51`。

- [x] **Step 4: 对 active release 做最终浏览器验收**

启动 FastAPI 后访问 `/`，完成桌面与手机控制矩阵，并实际验证 `/graph`、`/login`、`/index.html`、`workbench.html`、`practice-mode.html`、`question-workspace.html`、`knowledge-recall.html`。检查浏览器控制台无错误。

- [x] **Step 5: 清理测试产物并审计差异**

Run:

```bash
git diff --check
git status --short
git diff --name-only
```

只保留本功能源码、测试、路由、发布门禁和正式 release 产物；不得删除或提交用户已有的无关工作区改动。
