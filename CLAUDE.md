# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目结构（重构后）

本仓库已从纯前端重构为**前后端分离**，原版代码移至 `legacy/`：

| 目录 | 内容 | 运行 |
|---|---|---|
| `legacy/` | **原版纯前端**（HTML + 原生 JS + CSS，localStorage），仅作参考与样式来源 | `cd legacy && python3 serve.py`（占 8000） |
| `backend/` | **新后端**：FastAPI + PostgreSQL + Alembic | `cd backend && source .venv/bin/activate && uvicorn app.main:app --reload --port 8000` |
| `frontend/` | **新前端**：Vite + React + TypeScript | `cd frontend && pnpm dev`（5173，proxy `/api`→8000） |
| `docs/` | 文档，`功能基线-重构参考.md` 是重构基线与 SQL 建模依据 | — |

默认管理员 `admin / admin123`（启动时自动 seed）。PostgreSQL 走本地 `/tmp` Unix socket，库名 `kg_graph_dev`。

## ⚠️ 硬约束：UI 必须和 legacy 原版一模一样

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

## 已知简化项（功能层面，UI 布局已对齐 legacy）

艾宾浩斯闪卡、学习包 ZIP 导入导出、推理图谱自动生成、深度回忆完整寻宝地图交互——这些 legacy 高级功能在 frontend 是简化版，UI 框架已用原 className 对齐，功能待补全。

## legacy 原版架构（仅参考，勿在新代码沿用）

`legacy/` 是非 ES Module 的纯前端：`<script defer>` 按序加载 + 全局变量通信（`KGAuthCore`/`KGRolePermissions`/`KGSubscription`/`KGGraphFileStore` 挂 window），数据存 localStorage（key 见 `docs/功能基线-重构参考.md` 的迁移映射表）。新项目不要沿用这套全局变量模式，用 backend API + React 组件化。读 legacy 只为：① 还原 UI（className/DOM）；② 理解数据模型与业务规则。
