# Lucide 图标系统与业务页面专业化设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将非图谱页面统一为专业运营台，并以 Lucide 取代操作性手写 SVG 和符号图标，修复图标对齐。

**Architecture:** `AppIcon` 是唯一操作图标入口；设计令牌控制尺寸与居中；路由样式只处理布局和信息层级。图谱 iframe 与文件封面/回忆关系图等业务内容 SVG 保留不动。

**Tech Stack:** React、TypeScript、Vite、lucide-react、CSS、Node test runner、Playwright。

---

### Task 1: 建立 Lucide 图标契约

**Files:**
- Create: `frontend/src/components/AppIcon.tsx`
- Modify: `frontend/src/styles/design-system.css`
- Modify: `frontend/scripts/design-contract.test.mjs`

- [x] **Step 1: 写失败测试**

在 `design-contract.test.mjs` 断言 `AppIcon.tsx` 存在、从 `lucide-react` 导入，并含 `add`、`back`、`search`、`settings`、`refresh`、`grid`、`list`、`more`、`delete`、`upload`、`download`、`folder`、`user`、`logout`、`close`、`zoomIn`、`zoomOut`。同时断言 `design-system.css` 含 `--kg-icon-compact`、`--kg-icon-default`、`--kg-icon-prominent`。

- [x] **Step 2: 运行失败测试**

运行：`cd frontend && pnpm test:design`

预期：因组件与令牌尚不存在而失败。

- [x] **Step 3: 实现最小图标组件**

`AppIcon.tsx` 从 `lucide-react` 导入所需图标，创建 `satisfies Record<string, LucideIcon>` 的语义映射，导出 `AppIconName` 和接受 `name`、`size`、`label` 的组件。未知图标不得静默回退。`design-system.css` 添加 16/18/20px 令牌，以及 `.kg-icon`、`.kg-icon-button` 的 `display:block`、`inline-flex`、`align-items:center`、`justify-content:center`、`line-height:0`、`flex:0 0 auto` 规则。

- [x] **Step 4: 运行通过测试**

运行：`cd frontend && pnpm test:design && pnpm exec tsc -b`

预期：测试与类型检查通过。

- [x] **Step 5: 提交**

运行：`git add frontend/src/components/AppIcon.tsx frontend/src/styles/design-system.css frontend/scripts/design-contract.test.mjs && git commit -m "feat: add shared Lucide icon contract"`

### Task 2: 文件管理操作图标与工作台

**Files:**
- Modify: `frontend/src/routes/Files.tsx`
- Modify: `frontend/src/styles/file-manager.css`
- Modify: `frontend/scripts/design-contract.test.mjs`

- [x] **Step 1: 写失败测试**

新增断言：`Files.tsx` 导入 `AppIcon`，只保留一个 `<svg`（`FileCover`），且不存在 `<button ...><svg`。断言须允许封面知识网络，不允许操作图标手写 SVG。

- [x] **Step 2: 运行失败测试**

运行：`cd frontend && pnpm test:design`

预期：当前文件管理的控制 SVG 触发失败。

- [x] **Step 3: 替换控制图标**

新建、返回、搜索、收藏、视图切换、刷新、主题、账户菜单、导入、空状态和文件夹操作改为 `AppIcon`。每个图标按钮保留原有 `aria-label`、`title`、点击事件和文本；`FileCover` 不改。

- [x] **Step 4: 收敛文件工作台**

在 `file-manager.css` 使用 64–68px 顶栏、32px 图标控制、8px 圆角、1px 边界、有限阴影。删除只为装饰存在的渐变/大阴影，但保留深色模式变量和所有文件管理状态。

- [x] **Step 5: 验证并提交**

运行：`cd frontend && pnpm test:design && pnpm exec tsc -b && pnpm build`

运行：`git add frontend/src/routes/Files.tsx frontend/src/styles/file-manager.css frontend/scripts/design-contract.test.mjs && git commit -m "refactor: unify file manager controls with Lucide"`

### Task 3: 学习工作区图标与版式

**Files:**
- Modify: `frontend/src/routes/QuestionBank.tsx`
- Modify: `frontend/src/routes/Training.tsx`
- Modify: `frontend/src/routes/Recall.tsx`
- Modify: `frontend/src/styles/question-bank-admin.css`
- Modify: `frontend/src/styles/question-training.css`
- Modify: `frontend/src/styles/knowledge-recall.css`
- Modify: `frontend/src/styles/boardmix-overrides.css`
- Modify: `frontend/scripts/design-contract.test.mjs`

- [x] **Step 1: 写失败测试**

断言三个路由均导入 `AppIcon`，并且 `Recall.tsx` 只保留 `<svg className="kr-edges">` 一项内容 SVG。

- [x] **Step 2: 运行失败测试**

运行：`cd frontend && pnpm test:design`

预期：学习路由尚未统一入口而失败。

- [x] **Step 3: 替换操作图标**

返回、关闭、导入/导出、新建、删除、下拉、缩放和空状态操作改为 `AppIcon`。文本标签页、题号、难度和答案不替换为图标；回忆关系边 SVG 保留；所有事件处理不变。

- [x] **Step 4: 重排专业学习工作区**

题库使用“标题栏 / 科目上下文 / 三栏工作区”；训练采用“题干优先、工具退后”；回忆保留画布、把缩放和工具收敛为标准工具条。统一白底、1px 边界、8px 圆角和蓝色选中态，移除紫色/渐变装饰。

- [x] **Step 5: 验证并提交**

运行：`cd frontend && pnpm test:design && pnpm exec tsc -b && pnpm build`

运行：`git add frontend/src/routes/QuestionBank.tsx frontend/src/routes/Training.tsx frontend/src/routes/Recall.tsx frontend/src/styles/question-bank-admin.css frontend/src/styles/question-training.css frontend/src/styles/knowledge-recall.css frontend/src/styles/boardmix-overrides.css frontend/scripts/design-contract.test.mjs && git commit -m "refactor: polish study workspaces and controls"`

### Task 4: 管理、会员、登录图标与版式

**Files:**
- Modify: `frontend/src/routes/Users.tsx`
- Modify: `frontend/src/routes/Settings.tsx`
- Modify: `frontend/src/routes/Member.tsx`
- Modify: `frontend/src/routes/Login.tsx`
- Modify: `frontend/src/styles/user-management.css`
- Modify: `frontend/src/styles/system-settings.css`
- Modify: `frontend/src/styles/subscription.css`
- Modify: `frontend/src/styles/user-center.css`
- Modify: `frontend/src/styles/boardmix-overrides.css`
- Modify: `frontend/scripts/design-contract.test.mjs`

- [x] **Step 1: 写失败测试**

断言 `Users.tsx`、`Settings.tsx`、`Member.tsx`、`Login.tsx` 都导入 `AppIcon`。断言 `boardmix-overrides.css` 不含 `linear-gradient`。

- [x] **Step 2: 运行失败测试**

运行：`cd frontend && pnpm test:design`

预期：路由未统一入口而失败。

- [x] **Step 3: 替换与保留可读性**

返回、新建、导入/导出、状态、保存、关闭和权益操作使用 `AppIcon`。高风险表格行操作保留文字，不变为无说明图标；所有图标按钮维持 `aria-label` 和 `title`。

- [x] **Step 4: 重构专业管理版式**

用户与设置页采用标题栏、紧凑数据摘要、编辑主区、辅助说明区；会员与登录页突出单一任务，移除渐变顶条和冗余卡片。保留提交、校验、角色限制和订阅 API。

- [x] **Step 5: 验证并提交**

运行：`cd frontend && pnpm test:design && pnpm exec tsc -b && pnpm build`

运行：`git add frontend/src/routes/Users.tsx frontend/src/routes/Settings.tsx frontend/src/routes/Member.tsx frontend/src/routes/Login.tsx frontend/src/styles/user-management.css frontend/src/styles/system-settings.css frontend/src/styles/subscription.css frontend/src/styles/user-center.css frontend/src/styles/boardmix-overrides.css frontend/scripts/design-contract.test.mjs && git commit -m "refactor: polish admin and member workspace UI"`

### Task 5: 全量交互与视觉回归

**Files:**
- Modify: `frontend/scripts/design-contract.test.mjs`（仅出现可复发问题时）
- Verify: `.superpowers/capture-routes.py`（本地过程文件，不提交）

- [x] **Step 1: 执行图标豁免检查**

运行：`cd frontend && pnpm test:design`

预期：所有操作图标走 `AppIcon`，仅 `Files.tsx` 的 `FileCover` 和 `Recall.tsx` 的 `kr-edges` 保留内容 SVG。

- [x] **Step 2: 执行构建和接口回归**

运行：`cd frontend && pnpm exec tsc -b && pnpm build && cd ../backend && .venv/bin/python -m pytest tests/ -q`

预期：类型检查、构建与后端测试通过。

- [x] **Step 3: 执行真实登录态截图**

运行：`python3 .superpowers/capture-routes.py`

检查首页图谱、文件、题库、训练、回忆、用户、设置、会员和登录：图标完整且居中，无裁切；主要按钮、导航、折叠、缩放、创建/删除/导入导出仍绑定原事件；浏览器控制台无错误。

- [x] **Step 4: 提交仅有的回归修复**

若本任务产生代码差异，运行：`git add frontend && git commit -m "test: verify unified icon and workspace UI"`

