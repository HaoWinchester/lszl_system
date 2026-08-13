# 后台全局快捷栏常驻 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让现有全局快捷悬浮栏在全部 12 个后台页面常驻，同时维持角色权限、交互和非后台页面边界。

**Architecture:** 源页面继续显式装载现有 `global-shortcuts.css` 与 `39-global-shortcuts.js`，不改快捷栏实现本身。新增一个静态契约测试枚举后台页面并校验依赖和加载顺序，再新增浏览器测试使用真实页面验证唯一实例、展开、角色入口与跳转。

**Tech Stack:** 静态 HTML、原生 JavaScript/CSS、Node.js `node:test`、Python Playwright。

## Global Constraints

- 源文件只改 `new-legacy/`；不手工修改 active release。
- 全部带 `.admin-context-nav` 的 12 个后台页面必须装载快捷栏。
- 登录页和学员端页面不得因本次改动新增快捷栏覆盖。
- 认证脚本必须先于角色权限脚本，角色权限脚本必须先于快捷栏脚本。
- 保留现有视觉、默认折叠、展开、排布、拖拽、位置记忆和权限过滤行为。
- 工作区中与本需求无关的既有改动不得被覆盖、清理或混入提交。

---

### Task 1: 建立后台页面装载契约

**Files:**
- Create: `new-legacy/tests/admin-global-shortcuts-coverage.test.js`
- Modify: `new-legacy/admin-console.html`
- Modify: `new-legacy/admin-operations.html`
- Modify: `new-legacy/admin-settings.html`
- Modify: `new-legacy/admin-subjects.html`
- Modify: `new-legacy/course-admin.html`
- Modify: `new-legacy/feedback-management.html`
- Modify: `new-legacy/message-management.html`
- Modify: `new-legacy/paper-management.html`
- Modify: `new-legacy/teacher-workbench.html`
- Existing compliant pages: `new-legacy/question-bank.html`, `new-legacy/system-settings.html`, `new-legacy/user-management.html`

**Interfaces:**
- Consumes: `.admin-context-nav`, `styles/global-shortcuts.css`, `src/29-auth-core.js`, `src/34-role-permissions.js`, `src/39-global-shortcuts.js`.
- Produces: 每个后台页面一致且有序的快捷栏运行时依赖。

- [ ] **Step 1: 写失败的静态契约测试**

测试必须从 `new-legacy/*.html` 发现所有包含 `.admin-context-nav` 的页面，断言发现集合恰好为 12 个；逐页断言 CSS、认证、角色权限和快捷栏脚本各出现一次，且三个脚本按认证、权限、快捷栏排序。另断言选定的非后台页 `practice-mode.html` 与 `knowledge-recall.html` 不因本变更新增后台导航。

- [ ] **Step 2: 运行测试并确认按预期失败**

Run: `node --test new-legacy/tests/admin-global-shortcuts-coverage.test.js`

Expected: FAIL，指出当前 9 个后台页面缺少快捷栏依赖。

- [ ] **Step 3: 最小化补齐页面依赖**

在缺少的后台页面 `<head>` 中加入一次：

```html
<link rel="stylesheet" href="styles/global-shortcuts.css" />
```

在认证脚本之后补齐角色权限脚本，并在页面业务脚本之后、`</body>` 之前加入快捷栏脚本：

```html
<script src="src/34-role-permissions.js"></script>
<script defer src="src/39-global-shortcuts.js"></script>
```

已存在的引用不得重复添加。

- [ ] **Step 4: 运行静态契约并确认通过**

Run: `node --test new-legacy/tests/admin-global-shortcuts-coverage.test.js`

Expected: PASS，1 个测试文件、0 个失败。

- [ ] **Step 5: 检查差异**

Run: `git diff --check -- new-legacy/*.html new-legacy/tests/admin-global-shortcuts-coverage.test.js`

Expected: exit 0。

### Task 2: 验证逐页真实交互和角色边界

**Files:**
- Create: `new-legacy/tests/admin-global-shortcuts-browser.py`
- Test: `new-legacy/tests/admin-global-shortcuts-coverage.test.js`

**Interfaces:**
- Consumes: Task 1 产出的 12 个可直接打开的后台页面。
- Produces: 可回归的逐页浏览器行为证明。

- [ ] **Step 1: 写浏览器回归测试**

测试启动 `new-legacy/serve.py` 或复用可用静态服务，以管理员会话打开 12 个页面。每页断言 `#kgGlobalShortcuts` 数量为 1、可见且带 `is-collapsed`；点击 `#kgGlobalShortcutsToggle` 后断言展开，并出现首页、教师工作台、用户管理和系统设置入口。在总览页点击教师工作台入口并断言 URL 到达 `teacher-workbench.html`。再以教师会话验证用户管理和系统设置入口不显示。

- [ ] **Step 2: 运行浏览器测试**

Run: `new-legacy/.venv/bin/python new-legacy/tests/admin-global-shortcuts-browser.py`；若该解释器不存在，则使用项目已配置且带 Playwright 的 Python。

Expected: PASS，12 个后台页面均通过；管理员跳转和教师权限边界通过。

- [ ] **Step 3: 运行现有快捷栏回归**

Run: `node --test new-legacy/tests/v862-p2210-compact-global-shortcuts.test.js new-legacy/tests/global-shortcut-tooltip-speed.test.js new-legacy/tests/v90-p402-navigation-role-danger.test.js`

Expected: PASS，0 个失败。

- [ ] **Step 4: 运行前端类型与发布校验的安全子集**

Run: `cd frontend && pnpm exec tsc -b`

Run: `node --test frontend/scripts/new-legacy-release.test.mjs`

Expected: 两条命令均 exit 0。

### Task 3: 同步产物并做发布前防回退检查

**Files:**
- Modify through official script: `frontend/public/new-legacy/**`
- Modify through official script: `frontend/new-legacy-manifest.json`
- Modify through official script: `frontend/new-legacy-sync-report.json`

**Interfaces:**
- Consumes: 已验证的 `new-legacy/` 源文件。
- Produces: 与源一致的同步产物；除非能隔离现有无关改动，否则不 promote 新 active release。

- [ ] **Step 1: 核对 active release 内容基线**

读取 `frontend/new-legacy-releases/current.json`，对 active site 执行文件计数并检查 `admin-console.html`、12 个后台页面、`styles/global-shortcuts.css` 和 `src/39-global-shortcuts.js` 存在。

- [ ] **Step 2: 判断正式 update 是否会混入无关改动**

比较当前 `new-legacy/` 工作区改动与本任务文件。如果官方 update 会把其他未提交功能一并发布，则只运行官方 sync/校验路径中不会 promote 的安全步骤，并在交付中明确未发布原因；不得手工复制覆盖 release site。

- [ ] **Step 3: 重新运行完整本任务验证**

Run: `node --test new-legacy/tests/admin-global-shortcuts-coverage.test.js`

Run: 浏览器逐页测试命令。

Run: `cd frontend && pnpm exec tsc -b`

Expected: 全部 exit 0。

- [ ] **Step 4: 仅提交本任务文件**

显式暂存设计、计划、测试和本任务修改的源页面；不得使用 `git add .`。提交前用 `git diff --cached --name-only` 确认没有其他任务文件。
