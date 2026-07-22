# 全站控件几何审计与统一账号菜单 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除全站可见控件中同一语义被拆组、文字或图标未在自身命中区域水平/垂直居中、窄屏越界和固定层遮挡的问题，并使其可自动回归。

**Architecture:** 账号区采用首页已有的单一账号菜单语义，三张独立学习页只保留一个账号入口并将登录/退出作为菜单项。新增 Playwright 几何审计：在 390×844、944×768、1440×900 三档读取可见控件与其可见文字/图标的边界框，按明确白名单排除列表项与刻意左对齐的内容；失败时输出页面、选择器和中心偏差，截图用于复核。

**Tech Stack:** 静态 HTML/CSS/原生 JavaScript、Node `node:test` 契约测试、Python Playwright、现有 FastAPI 集成页面与 new-legacy 发布流程。

---

### Task 1: 先锁定账号区和几何规则的失败用例

**Files:**
- Modify: `frontend/scripts/ui-polish-contract.test.mjs`
- Create: `frontend/e2e/ui_geometry_audit.py`
- Test: `frontend/scripts/ui-polish-contract.test.mjs`

- [ ] **Step 1: 写入账号区静态契约测试**

```js
test('standalone learning headers use one account menu instead of a detached logout button', () => {
  for (const page of ['learning-path.html', 'question-training.html', 'question-workspace.html']) {
    const markup = source(`new-legacy/${page}`)
    assert.match(markup, /class="account-menu-shell"/)
    assert.match(markup, /data-account-menu-trigger="true"/)
    assert.match(markup, /class="account-hidden-trigger" hidden id="authLogoutBtn"/)
    assert.doesNotMatch(markup, /class="auth-logout-btn" id="authLogoutBtn"[^>]*style="display:none"/)
  }
})
```

- [ ] **Step 2: 执行测试并确认当前实现因三个页面没有账号菜单而失败**

Run: `node --test frontend/scripts/ui-polish-contract.test.mjs`

Expected: `standalone learning headers use one account menu...` fails; existing tests remain green.

- [ ] **Step 3: 创建几何审计的最小可执行脚本**

```python
PAGES = [
    ("index", "/index.html?mode=free"),
    ("learning-path", "/learning-path.html"),
    ("question-training", "/question-training.html"),
    ("question-workspace", "/question-workspace.html"),
    ("file-manager", "/file-manager.html"),
    ("question-bank", "/question-bank.html"),
    ("knowledge-recall", "/knowledge-recall.html"),
    ("user-management", "/user-management.html"),
    ("system-settings", "/system-settings.html"),
]
VIEWPORTS = {"mobile": {"width": 390, "height": 844}, "mid": {"width": 944, "height": 768}, "desktop": {"width": 1440, "height": 900}}
CENTERED = "button:not([data-geometry-align='start']), .auth-status, .qt-nav-btn, .um-nav-btn, .qw-tool-btn, .qw-overlay-right button, .fm-avatar"
EXCLUDED = "[role='menuitem'], .account-menu-item, .fm-account-menu > *, .qw-question-item, .qt-question-list-item, [data-geometry-align='start']"
```

脚本对 `CENTERED` 的可见元素执行浏览器内计算：以 `Range.selectNodeContents(control)` 得到文字/内联图标的联合盒；若内容盒不为空且不在 `EXCLUDED` 内，要求 `abs(contentCenterX-controlCenterX) <= 2` 且 `abs(contentCenterY-controlCenterY) <= 2`。失败时将 `page/viewport/selector/centerDelta/controlRect/contentRect` 写入 JSON 并截图。

- [ ] **Step 4: 运行几何审计，保存首轮基线缺陷**

Run: `E2E_BASE_URL=http://127.0.0.1:5173 python3 frontend/e2e/ui_geometry_audit.py --output /tmp/ui-geometry-before`

Expected: 脚本打印所有被审计控件及失败的中心偏差；当前失败作为后续修复清单，不修改阈值来掩盖失败。

- [ ] **Step 5: 提交测试与审计基础设施**

```bash
git add frontend/scripts/ui-polish-contract.test.mjs frontend/e2e/ui_geometry_audit.py
git commit -m "test: add UI geometry audit coverage"
```

### Task 2: 将账号状态和登录/退出统一为单一菜单

**Files:**
- Modify: `new-legacy/src/41-account-menu.js`
- Modify: `new-legacy/styles/account-menu.css`
- Modify: `new-legacy/learning-path.html`
- Modify: `new-legacy/question-training.html`
- Modify: `new-legacy/question-workspace.html`
- Test: `frontend/scripts/ui-polish-contract.test.mjs`

- [ ] **Step 1: 扩展账号菜单控制器为页面无关的挂载器**

控制器以 `.account-menu-shell` 为根，而不是依赖首页专有 ID；每个根读取 `data-account-menu-trigger`、`[data-account-menu-action='session']` 和其内部菜单。登录态的 session 项显示“退出登录”，访客态显示“登录”。点击动作的唯一入口是已有隐藏代理：

```js
function runSessionAction(shell) {
  const loggedIn = isLoggedIn()
  close(shell)
  const proxy = document.getElementById(loggedIn ? 'authLogoutBtn' : 'authLoginBtn')
  if (proxy) proxy.click()
}
```

首页保留用户中心、帮助和会员条目；独立学习页只渲染 session 菜单项，避免引入不存在的业务入口。所有已打开菜单在 `kg-auth-session-change`、window blur、resize、orientationchange 和外部点击时关闭。

- [ ] **Step 2: 将三个独立页改为相同的账号菜单标记**

每页把可见的 `authStatus + authLoginBtn + authLogoutBtn` 替换为：

```html
<div class="account-menu-shell account-menu-shell--standalone">
  <button class="auth-status account-menu-trigger" id="authStatus" type="button"
    data-account-menu-trigger="true" aria-haspopup="menu" aria-controls="accountMenu" aria-expanded="false">
    <span class="role-dot"></span><span class="auth-status-label">访客只读</span>
  </button>
  <div class="account-menu" id="accountMenu" role="menu" aria-label="账号菜单" hidden>
    <button class="account-menu-item account-menu-session" data-account-menu-action="session" role="menuitem" type="button"><span data-mobile-label="登录">登录</span></button>
  </div>
</div>
<button class="account-hidden-trigger" hidden id="authLoginBtn" type="button">登录</button>
<button class="account-hidden-trigger" hidden id="authLogoutBtn" type="button">退出登录</button>
```

三个页面都加载 `styles/account-menu.css` 和 `src/41-account-menu.js`；脚本顺序位于认证运行时之后，保证代理已经绑定。

- [ ] **Step 3: 添加账号菜单的页面布局规则**

```css
.account-menu-shell--standalone{position:relative;display:inline-flex;align-items:center;flex:0 0 auto}
.account-menu-shell--standalone .account-menu{right:0}
@media (max-width:850px),(pointer:coarse),(hover:none){
  .account-menu-shell--standalone .account-menu{position:absolute;top:calc(100% + 8px);right:0}
}
```

在学习路径、单题深学和多题归纳的对应顶栏规则中，让账号入口 `flex:0 0 auto`、`white-space:nowrap`；隐藏或横向滚动低优先级项，绝不压缩文字为逐字换行。

- [ ] **Step 4: 运行契约测试并确认通过**

Run: `node --test frontend/scripts/ui-polish-contract.test.mjs`

Expected: 所有静态 UI 规则通过，包括新的账号菜单用例。

- [ ] **Step 5: 提交账号区改造**

```bash
git add new-legacy/src/41-account-menu.js new-legacy/styles/account-menu.css new-legacy/learning-path.html new-legacy/question-training.html new-legacy/question-workspace.html frontend/scripts/ui-polish-contract.test.mjs
git commit -m "fix: unify standalone account actions"
```

### Task 3: 依据几何审计修复全站控件内部对齐

**Files:**
- Modify: `new-legacy/styles/account-menu.css`
- Modify: `new-legacy/styles/file-manager.css`
- Modify: `new-legacy/styles/global-shortcuts.css`
- Modify: `new-legacy/styles/guided-learning-path.css`
- Modify: `new-legacy/styles/knowledge-recall.css`
- Modify: `new-legacy/styles/main.css`
- Modify: `new-legacy/styles/question-bank-admin.css`
- Modify: `new-legacy/styles/question-training.css`
- Modify: `new-legacy/styles/question-workspace.css`
- Modify: `new-legacy/styles/system-settings.css`
- Modify: `new-legacy/styles/user-center.css`
- Modify: `new-legacy/styles/user-management.css`
- Modify: `docs/2026-07-22-ui-polish-audit.md`
- Test: `frontend/e2e/ui_geometry_audit.py`

- [ ] **Step 1: 逐页读取首轮 JSON 与截图，按规则分组**

每项只归入一个类别：`content-center`（文字/图标在按钮内偏移）、`semantic-cluster`（同一对象被拆组）、`boundary`（越界/关闭键）、`wrap`（逐字换行）、`overlay`（浮层遮挡）。不把列表项、表格单元格和明确 `data-geometry-align="start"` 的条目误报为居中控件；每个白名单项必须记录选择器和左对齐的业务理由。

- [ ] **Step 2: 对每个 content-center 项使用显式布局修复**

```css
/* 图标或单一文字按钮：只应用到审计报告中标为 content-center 的实际选择器。 */
.audit-confirmed-icon-control{display:grid;place-items:center;padding:0}
/* 图标 + 文本按钮：同样只应用到报告中的实际选择器。 */
.audit-confirmed-label-control{display:inline-flex;align-items:center;justify-content:center;gap:8px;text-align:center}
/* 明确业务上左对齐的菜单或列表行必须显式标注。 */
.audit-confirmed-start-row{justify-content:flex-start;text-align:left}
```

禁止用 `position:relative; top/left` 或任意像素位移校正内容；这些会在字体、翻译和不同宽度下重新偏移。每次只修一类选择器，并重新运行审计确认该偏差消失。

- [ ] **Step 3: 将确认的问题与修复写入审计记录**

对每个页面写明视口、选择器、根因、修复选择器和复测结果；不把“未复现”写成已修复。

- [ ] **Step 4: 重新运行三档几何审计并要求零失败**

Run: `E2E_BASE_URL=http://127.0.0.1:5173 python3 frontend/e2e/ui_geometry_audit.py --output /tmp/ui-geometry-after`

Expected: 9 页 × 3 视口没有未白名单的 `content-center`、`boundary`、`wrap` 或 `overlay` 失败。

- [ ] **Step 5: 提交由审计确认的样式修复和记录**

```bash
git add new-legacy/styles docs/2026-07-22-ui-polish-audit.md frontend/e2e/ui_geometry_audit.py
git commit -m "fix: align UI control content consistently"
```

### Task 4: 用真实认证、视觉对比与发布门禁验收

**Files:**
- Modify: `frontend/public/new-legacy/VERSION`
- Modify: `frontend/public/new-legacy/manifest.json`
- Modify: `frontend/public/new-legacy/learning-path.html`
- Modify: `frontend/public/new-legacy/question-training.html`
- Modify: `frontend/public/new-legacy/question-workspace.html`
- Modify: `frontend/public/new-legacy/src/41-account-menu.js`
- Modify: `frontend/public/new-legacy/styles/account-menu.css`
- Modify: `frontend/public/new-legacy/styles/file-manager.css`
- Modify: `frontend/public/new-legacy/styles/global-shortcuts.css`
- Modify: `frontend/public/new-legacy/styles/guided-learning-path.css`
- Modify: `frontend/public/new-legacy/styles/knowledge-recall.css`
- Modify: `frontend/public/new-legacy/styles/main.css`
- Modify: `frontend/public/new-legacy/styles/question-bank-admin.css`
- Modify: `frontend/public/new-legacy/styles/question-training.css`
- Modify: `frontend/public/new-legacy/styles/question-workspace.css`
- Modify: `frontend/public/new-legacy/styles/system-settings.css`
- Modify: `frontend/public/new-legacy/styles/user-center.css`
- Modify: `frontend/public/new-legacy/styles/user-management.css`
- Modify: `frontend/new-legacy-manifest.json`
- Modify: `frontend/new-legacy-sync-report.json`
- Modify: `backend/app/seed/guided_course_v8_6_0.json`
- Test: `frontend/scripts/ui-polish-contract.test.mjs`, `frontend/scripts/direct-runtime.test.mjs`, `frontend/scripts/wechat-login-contract.test.mjs`, `frontend/e2e/ui_geometry_audit.py`

- [ ] **Step 1: 在真实远程认证页面回归账号菜单**

在学习路径、单题深学、多题归纳分别验证：访客单一账号入口 → 菜单登录 → 登录后显示名称与角色 → 菜单退出 → 页面刷新为访客态。退出必须不再留下用户名。

- [ ] **Step 2: 执行完整静态与运行时回归**

Run:

```bash
node --check new-legacy/src/41-account-menu.js
node --test frontend/scripts/ui-polish-contract.test.mjs frontend/scripts/direct-runtime.test.mjs frontend/scripts/wechat-login-contract.test.mjs
E2E_BASE_URL=http://127.0.0.1:5173 python3 frontend/e2e/ui_geometry_audit.py --output /tmp/ui-geometry-final
git diff --check
```

Expected: 所有 Node 测试通过、几何审计零失败、diff 无空白错误。

- [ ] **Step 3: 生成候选版本并运行发布验证**

```bash
./manage-new-legacy update ./new-legacy
./manage-new-legacy status
```

Expected: `current.json` 指向新版本且候选验证成功。

- [ ] **Step 4: 部署并在线复核三档截图**

```bash
./deploy/update.sh
```

在线复核要记录 390px、944px、1440px 的截图，并确认账号菜单、顶栏按钮文字/图标中心点与抽屉关闭键均没有回归。

- [ ] **Step 5: 提交发布产物并报告剩余项**

```bash
git add backend/app/seed/guided_course_v8_6_0.json frontend/new-legacy-manifest.json frontend/new-legacy-sync-report.json frontend/public/new-legacy
git commit -m "chore: publish UI geometry audit release"
```

最终报告必须列出：审计页数、三个视口、修复的每一类项、测试命令及通过数，以及任何明确白名单的左对齐列表项。
