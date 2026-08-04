# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## 项目结构（重构后）

本仓库已从纯前端重构为**前后端分离**，原版代码移至 `legacy/`：

| 目录 | 内容 | 运行 |
|---|---|---|
| `legacy/` | **原版纯前端**（HTML + 原生 JS + CSS，localStorage）；**图谱编辑器 iframe 直接承载其引擎**（见前端架构），其余页面对照还原 | `cd legacy && python3 serve.py`（占 8000） |
| `backend/` | **新后端**：FastAPI + PostgreSQL + Alembic | `cd backend && source .venv/bin/activate && uvicorn app.main:app --reload --port 8000` |
| `frontend/` | **新前端**：Vite + React + TypeScript | `cd frontend && pnpm dev`（5173，proxy `/api`→8000） |
| `docs/` | 文档，`功能基线-重构参考.md` 是重构基线与 SQL 建模依据 | — |

默认管理员 `admin / admin123`（启动时自动 seed）。PostgreSQL 走本地 `/tmp` Unix socket，库名 `kg_graph_dev`。

## ⚠️ 硬约束：UI 必须和 legacy 原版一模一样

### 用户批准的学习端局部例外（2026-08-04）

`practice-mode.html`、`question-training.html`、`question-workspace.html`、`knowledge-recall.html` 的非画板区域允许使用 Focus / Vega 兼容皮肤和本地 Lucide SVG；页面排版、业务行为及 `.qt-canvas-shell`、`.qw-canvas-shell`、`.kr-viewport` 全部后代仍必须保持不变。实施依据见 `docs/superpowers/specs/2026-08-04-learning-focus-vega-ui-skin-design.md`。

**这是用户明确且反复强调的要求。** 每个页面都要和 `legacy/` 里对应的原版 HTML **视觉一模一样**：

- **复用原版 CSS**：`legacy/styles/*.css` 已复制到 `frontend/src/styles/`，`main.tsx` 统一 import。
- **用原版 className + DOM 结构**：还原页面时必须读 `legacy/<page>.html` 的 DOM 骨架，用**同名 className** 重建 React 组件，让原 CSS 生效。绝不要自己另写一套内联样式。
- 各页面对应的原版类名速查：
  - 首页图谱编辑器 → `.app/.graph-file-tabbar/.stage/.canvas-toolbar-*/.floating-toolbox/.world/.knowledge-card/.canvas-zoom-dock`（卡牌是 div 不是 svg）
  - 文件管理 → `.fm-app/.fm-sidebar/.fm-main/.fm-file-grid/.fm-file-card`
  - 题库 → `.qb-app/.qb-layout/.qb-workspace-card/.qb-annotation-card/.qb-inspector`
  - 训练 → `.question-training-app/.qt-topbar/.q-tabs/.q-panel/.q-question-layout`
  - 回忆 → `.kr-app/.kr-topbar/.kr-viewport/.kr-world/.kr-question-card/.kr-node-layer`
  - 用户管理 → `.um-app/.um-topbar/.um-layout` ｜ 系统设置 → `.ss-app/.ss-layout/.ss-sidebar`
- **改某页前先读 `legacy/<page>.html`**，必要时用 Playwright 截图 `legacy` vs `frontend` 对比验证。

## 后端架构（backend/app）

分层：`api/v1/<域>.py`（路由）→ `services/<域>_service.py`（业务）→ `models/*.py`（SQLAlchemy ORM）+ `schemas/`（Pydantic）+ `core/`（config/auth/security）+ `db/`（engine/session）。

- **认证**：`bcrypt` 密码（不用 passlib，避开 Py3.11 兼容坑）+ `starlette SessionMiddleware`（itsdangerous 签名 cookie）。依赖：`get_current_user` / `require_role(*roles)`（`core/auth.py`）。登录成功/失败/登出都写 `user_admin_logs`（含 client_ip/user_agent）。
- **业务域 service**：`user_service` / `file_service` / `question_service` / `training_service` / `subscription_service` / `system_service`。写操作后 `commit` + 对外返回前 `refresh`（见下坑）。
- **数据按 owner 隔离**：所有业务表带 `owner_id`/`username` 外键到 `users.username`，查询都加 owner 过滤；权限靠 `require_role` + owner 双重保证。
- **Alembic（async）**：`alembic init -t async`，`env.py` 运行期注入 `DATABASE_URL`，`target_metadata = Base.metadata`。新增模型后在 `models/__init__.py` import，再 `alembic revision --autogenerate`。
- **关键坑（已踩过）**：
  - PG 连接串：`postgresql+asyncpg://menghao@/kg_graph_dev?host=/tmp`（库前单 `/`，host 走 query；本地不监听 TCP）。`session.py` 还兜底 `connect_args={"host":"/tmp"}`。
  - **SQLAlchemy async：写操作 `commit` 后访问 ORM 属性必须先 `await db.refresh(obj)`**，否则触发 `MissingGreenlet`（lazy reload 在同步路径）。所有 service 的写方法都已 refresh，新增的也要。
  - **TestClient + asyncpg 共享连接冲突** → engine 用 `poolclass=NullPool`（`db/session.py`）。
  - 跨表 FK 同事务 INSERT 顺序：先 `add` 父表 + `await db.flush()`，再 add 子表（如 `create_file` 先 flush graph_files 再写 file_contents）。

## 前端架构（frontend/src）

- **路由**（`App.tsx` + `components/RequireAuth.tsx`）：`/` 图谱、`/files`、`/question-bank`、`/training`、`/recall`、`/users`(admin)、`/settings`(admin)、`/member`、`/login`。未登录跳 `/login`，`roles` 参数做角色守卫。
- **API 层**（`api/*.ts`）：axios 实例 `baseURL='/api/v1'`，走 Vite proxy。每个域一个文件（auth/users/files/questions/training/subscriptions/system），含 TS 类型。
- **状态**（`store/auth.ts`）：zustand 存当前用户 + `init/login/logout/register`。
- **样式**：`main.tsx` 统一 import 全部 `styles/*.css`；页面组件用原版 className（见上方硬约束）。
- **类型检查**：`cd frontend && pnpm exec tsc -b`（严格模式，noUnusedLocals）。
- **图谱编辑器（`/`）= iframe 承载 legacy 原版引擎**（非 React 重写）：`GraphEditor.tsx` 只是 iframe 外壳，加载 `/legacy/workbench.html`（原版 `index.html` 派生，由 `scripts/copy-legacy.js` 生成到 `public/legacy/`），通过 `scripts/legacy-assets/bridge.js` 把原版的 `KGGraphFileStore`/认证/导航桥接到后端 `filesApi` 与 React 路由。这样连线、平滑档位缩放、选中边环形样式面板、大图模式等全部原版功能与原版完全一致（postMessage 协议见 `src/iframe/graphBridge.ts`）。**铁律：不改 `legacy/` 源文件**——只在 `public/legacy/` 派生 + 加 bridge.js。改图谱行为优先改 `bridge.js` 或 `GraphEditor.tsx`，不要动 `legacy/src/`。

## 数据模型（PostgreSQL，Alembic 管理）

users / role_themes / system_settings(KV) / user_admin_logs / folders / graph_files(索引) / file_contents(正文，与 graph_files 1:1) / tags / file_tags / current_files / question_banks / questions(clues/concepts/reasoning 为 JSONB) / exam_papers / paper_questions / training_progress / recall_progress / subscriptions / subscription_orders / subscription_redeem_codes。

图谱文件沿用 legacy v2 设计：**轻量索引（graph_files）+ 独立正文（file_contents）分离**，列表只读索引，打开才读正文。

## 角色与订阅边界

- 角色：`admin`/`teacher`/`student`/`viewer`（权限矩阵在 `core/permissions.py`）。
- 订阅只对 `student` 生效；admin/teacher 绕过；viewer/guest 不进订阅。套餐：`free/monthly/quarterly/half_year/lifetime`。

## 验证

- 后端：`cd backend && .venv/bin/python -m pytest tests/ -q`（冒烟测试：health/认证/文件/题库/试卷）。
- 前端类型：`cd frontend && pnpm exec tsc -b`。
- 浏览器对比 legacy：用 Playwright 同时截图 `frontend` 页面和 `legacy/*.html`，逐页比对（脚本见会话历史，或用 `mcp__4_5v_mcp__analyze_image` 确认布局）。

## 已知简化项（功能层面）

- **图谱编辑器（`/`）已是原版完整功能**（iframe 承载 legacy 引擎，含艾宾浩斯闪卡、学习包 ZIP 导入导出、大图模式、搜索定位、撤销/复制粘贴等全部原版功能），不再简化。
- 其余页面（文件管理 `/files`、题库、训练、回忆、用户管理、系统设置）仍为 React 重写，UI 用原 className 对齐，部分高级功能（推理图谱自动生成、深度回忆寻宝地图等）待补全。

## legacy 原版架构（仅参考，勿在新代码沿用）

`legacy/` 是非 ES Module 的纯前端：`<script defer>` 按序加载 + 全局变量通信（`KGAuthCore`/`KGRolePermissions`/`KGSubscription`/`KGGraphFileStore` 挂 window），数据存 localStorage（key 见 `docs/功能基线-重构参考.md` 的迁移映射表）。新项目不要沿用这套全局变量模式，用 backend API + React 组件化。读 legacy 只为：① 还原 UI（className/DOM）；② 理解数据模型与业务规则。

## 发布与验证纪律（事故教训，强制执行）

后端实际 serve 的是 **active release**（`frontend/new-legacy-releases/<version>/site`，由 `current.json` 指定），**不是** sync 产物（`frontend/public/new-legacy/`），**也不是**源（`new-legacy/`）。三者内容可能脱节。以下纪律是用两次生产事故换来的，必须遵守：

### 1. 发布前硬校验，防内容回退
- 发布前**必须**核对：`find <待发布 site> -type f | wc -l` 与当前 active release site 文件数对齐；抽查关键页面（如 v9 的 `admin-console.html`）存在。
- **版本号"最新" ≠ 内容最新**：版本号只是标识，内容取决于 source。源（`new-legacy/`）可能比 active release 旧。
- 文件数对不上**绝对不发**。改源后正式发布走 `node frontend/scripts/manage-new-legacy.js update new-legacy --skip-browser`（内部 sync + 重建 site + promote），不要手 cp 覆盖 release site。

### 2. 跨页面 bug 必须遍历验证，防漏页
- 改认证/登录/权限/导航等跨页面逻辑，**必须遍历所有相关页**验证：用 agent-browser 循环每页（`hasAuthModal` / `authOpen` / 点登录 / 点退出），不能只在顺手测过的页面通过就宣布完成。
- **"登录后跳转一致" ≠ "登录功能一致"**：先确认每页"能不能登录/退出"，再谈跳转。

### 3. 信息不全用命令拿证据，不要用假设填充
- 看到版本号/路径就脑补"两套体系"，是事故之源。任何"应该是…"的判断，先跑一条命令（`ls` / `find` / `grep` / `curl`）拿证据再动手。

### 事故案例（别再犯）
- **发布回退**：曾基于旧源（new-legacy v8.6.29，146 文件）发布 v9.0-p4.1.2，把生产 v9 内容（597 文件、含 admin-console 等新页面）回退掉。根因：没核对源 vs active release 文件数，凭"版本号体系"假设行事。
- **漏页**：曾修 `isLoggedIn` 后只在 training/workspace/index 验证退出，漏掉 `knowledge-recall.html` 有账号菜单但缺 `authModal` DOM + `standalone-auth-dialog.js`（点登录无反应）。根因：没遍历所有做题页测登录/退出，把"跳转一致"当成了"功能一致"。
