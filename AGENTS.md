# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## 任务执行铁律（强制执行）

- 接到任务先判断真正要解决的问题和最短可靠路径。
- 优先复用现有文件，能局部修改就不要整套重写。
- 修改前先检查相关文件，不要猜目录结构。
- 只在当前工作区内写入，不安装无关依赖。
- 完成后运行现有检查，并说明已验证和未验证的部分。

## 项目结构（当前）

当前产品由 FastAPI 后端和原生 HTML/CSS/JavaScript 前端组成。FastAPI 同源提供 API 与 active release 静态页面；仓库中不再保留 React/Vite/iframe 前端或旧版 `legacy/` 工作副本。

| 目录 | 内容 | 运行/用途 |
|---|---|---|
| `backend/` | FastAPI + PostgreSQL + Alembic | `cd frontend && pnpm dev` 会迁移数据库并在 5173 启动 FastAPI |
| `new-legacy/` | 当前权威前端源：HTML、CSS、原生 JavaScript 与测试 | 所有前端业务修改先落在这里 |
| `frontend/` | 同步、适配器、契约测试与不可变 release 管理工具 | `pnpm sync:new-legacy` / `pnpm test` / `../manage-new-legacy` |
| `frontend/public/new-legacy/` | 从源和适配器生成的同步产物 | 构建/测试产物，不是生产 active release |
| `frontend/new-legacy-releases/` | 本地不可变 release；`current.json` 指向生产实际使用版本 | FastAPI 按 `current.json` 同源直出 |
| `docs/` | 架构、迁移、发布与历史设计文档 | 历史设计记录只作背景，不代表当前运行链路 |

默认管理员 `admin / admin123`（启动时自动 seed）。PostgreSQL 走本地 `/tmp` Unix socket，库名 `kg_graph_dev`。

## 前端修改硬约束

- `new-legacy/` 是当前前端权威源；不要把 `frontend/public/new-legacy/` 或 active release site 当作手工编辑源。
- 正式发布必须走 `node frontend/scripts/manage-new-legacy.js update new-legacy --skip-browser`，由脚本同步、构建、验证并 promote；禁止手工复制覆盖 release site。
- 页面已有 DOM、class、画布结构和业务行为默认保持兼容；涉及视觉或交互调整时，以当前设计规格和契约测试为准。
- 跨页面公共行为必须落入 `new-legacy/src/` 下职责明确的共享模块或 `frontend/scripts/new-legacy-assets/` 适配层，禁止在多个页面复制变体实现。
- `frontend/public/new-legacy/`、manifest、sync report 和 seed 版本等生成产物在正式发布时必须与源修改一起提交。

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

## 前端架构与发布链路

- **权威源**：`new-legacy/` 中的页面、样式、业务模块和前端测试。
- **同步层**：`frontend/scripts/sync-new-legacy.js` 将权威源同步到 `frontend/public/new-legacy/`，并组合 `frontend/scripts/new-legacy-assets/` 中的服务端适配器。
- **运行层**：后端读取 `frontend/new-legacy-releases/current.json`，提供对应 `<version>/site`；开发环境同样由 FastAPI 在 5173 端口同源提供页面和 `/api/v1`。
- **认证与持久化**：页面通过同步层注入的服务端适配模块访问 FastAPI；权限和数据隔离仍必须由后端再次校验。
- **图谱编辑器**：直接运行 active release 中的原生页面和模块，不存在 React 外壳或 iframe bridge。

## 数据模型（PostgreSQL，Alembic 管理）

users / role_themes / system_settings(KV) / user_admin_logs / folders / graph_files(索引) / file_contents(正文，与 graph_files 1:1) / tags / file_tags / current_files / question_banks / questions(clues/concepts/reasoning 为 JSONB) / exam_papers / paper_questions / training_progress / recall_progress / subscriptions / subscription_orders / subscription_redeem_codes。

图谱文件采用**轻量索引（graph_files）+ 独立正文（file_contents）分离**，列表只读索引，打开才读正文。

## 角色与订阅边界

- 角色：`admin`/`teacher`/`student`/`viewer`（权限矩阵在 `core/permissions.py`）。
- 订阅只对 `student` 生效；admin/teacher 绕过；viewer/guest 不进订阅。套餐：`free/monthly/quarterly/half_year/lifetime`。

## 验证

- 后端：`cd backend && .venv/bin/python -m pytest tests/ -q`。
- 前端同步/发布契约：`cd frontend && pnpm test`。
- 定向设计契约：`cd frontend && pnpm test:design`；涉及特定域时再运行相应专项契约和浏览器测试。
- 发布候选：必须经过 `manage-new-legacy.js update` 内置的文件数量、关键页面、API 和视觉校验后才能 promote。

## 发布与验证纪律（事故教训，强制执行）

后端实际 serve 的是 **active release**（`frontend/new-legacy-releases/<version>/site`，由 `current.json` 指定），**不是** sync 产物（`frontend/public/new-legacy/`），**也不是**源（`new-legacy/`）。三者内容可能脱节。以下纪律是用两次生产事故换来的，必须遵守：

### 0. 正式环境发布前必须备份
- 每次部署正式环境，在任何代码同步、镜像重建、容器重启或数据库迁移之前，必须先备份正式环境当前代码和 PostgreSQL 数据库，并生成记录备份时间、目录、代码包和数据库 dump 路径的 manifest。
- 必须确认代码归档与数据库 dump 均已成功生成且非空；备份或校验失败时立即中止发布，禁止先上线后补备份。
- 正式发布结果必须记录本次远端备份目录。不得在发布过程中删除既有正式备份，也不得在日志或交接文档中输出数据库内容、密码或密钥。

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

## 公共模块与远程推送纪律（强制执行）

### 1. Git 推送必须使用代理
- 向远程仓库执行 `git push` 时，必须使用当前系统代理 `http://127.0.0.1:7897`，例如：`git -c http.proxy=http://127.0.0.1:7897 push origin <branch>`。
- 代理只作用于当前命令，不修改全局 Git 配置；推送后必须用远程引用或 `git ls-remote` 核对目标分支确已更新。

### 2. 通用能力必须统一放入公共模块
- 开发过程中，只要某项能力具有跨页面、跨组件、跨路由或跨业务流程复用价值，就必须先抽取到职责明确的公共模块，再由各调用方统一调用；禁止在多个页面或文件中复制、变体粘贴同一实现。
- 前端公共能力应放入 `new-legacy/src/` 的共享模块或 `frontend/scripts/new-legacy-assets/` 适配层；后端公共能力应放入 `services/`、`core/` 或职责明确的公共工具模块，API 路由只负责参数、权限和响应编排。
- 修改通用能力时必须先查找现有公共实现并在原模块扩展；确需新增公共模块时，要同时迁移现有重复调用点，并为公共入口补充覆盖主要调用方的测试。

## 独立判断与意见反馈纪律（强制执行）

- 对用户提出的想法、判断或方案，必须先独立分析目标、事实依据、风险、成本和替代方案，不能为了迎合用户而默认赞同或反复附和。
- 判断合理时要说明支持它的具体依据；判断存在问题时要明确指出原因、证据和可能后果，并给出更稳妥的建议，而不是无依据地顺从执行。
- 信息不足时应先用命令、代码、文档或其他可靠来源查证；无法确认时必须如实说明不确定性，不能把用户偏好包装成技术事实或最终结论。

## 功能分支收尾纪律（强制执行）

- `main` 与 `uat` 是永久集成分支，不是功能分支。无论本地还是远端，**绝对禁止删除、重命名、强制覆盖或在分支清理中移除 `main`/`uat`**。
- 执行任何分支或工作树清理前，必须先解析准确分支名并显式排除 `main`、`uat`；发现任一永久分支缺失时，应先从可验证的正确提交恢复并核对，再继续集成或清理。
- 自动化测试、代码检查和智能体浏览器测试仅属于开发自检，**不等于 UAT 业务验收**；UAT 验收必须由用户本人执行并明确给出通过结论。
- 每个功能开发完成并通过开发自检后，必须先合入 `uat`、推送并部署到 UAT 环境，然后停止在 UAT 阶段等待用户验收；未经用户明确表示“验收通过”或“可以合入 main”，禁止合入或推送 `main`。
- 用户明确确认 UAT 验收通过后，才可将已经验收的内容合入 `main` 并推送远端；不要用自动化测试通过、部署成功或智能体自行检查替代用户确认。
- 合入 `main` 成功后再删除对应的本地/远端功能分支并移除对应工作树；最终核对仓库至少保留 `main` 与 `uat` 两个永久分支（托管工具创建的临时 detached 工作树除外）。
- 不得为清理分支丢弃尚未合入的有效修改；发现脏工作树时，先审计并把有效内容纳入 `uat`，待用户验收通过后再纳入 `main`。
