# 教师与管理端 Runtime State 全量 API 化及彻底退役设计

**日期：** 2026-08-29

**状态：** 已批准，待书面复核

**目标分支：** `codex/runtime-retirement-api-cutover`

**集成目标：** `uat`

**部署目标：** 测试环境

**明确禁止：** 本轮不得合入 `main`，不得部署生产环境

## 1. 背景

当前学员主链路已经不再加载通用 Runtime，但 12 个教师或管理页面仍由发布同步层注入
`server-state-bootstrap.js`。该脚本会替换 `window.localStorage`，登录后通过
`/api/v1/runtime/state` 读取和回写账号级 `runtime_states.storage` 与共享
`shared_runtime_states`，形成整包 JSON 传输、跨领域 revision 冲突和第二权威源。

2026-08-21 曾执行过一次前端本地模式和后端写入 drain，但因教师试卷草稿、分类尚未迁入
领域 API，当天回滚。2026-08-24 以后试卷草稿、分类、导入和组卷已经进入关系型 API，
原回滚注释已经过时；其他教师内容、课程和兼容投影仍需逐项迁移，不能只切换两个布尔值。

当前明确加载 Runtime 的页面为：

- `admin-console.html`
- `admin-operations.html`
- `admin-settings.html`
- `admin-subjects.html`
- `content-center.html`
- `content-prep.html`
- `course-admin.html`
- `paper-management.html`
- `question-bank.html`
- `system-settings.html`
- `teacher-workbench.html`
- `user-management.html`

本设计的最终目标不是把 Runtime 改名，而是让所有业务数据通过职责明确的领域 API 和关系表
持久化，设备级 UI 偏好只保留在浏览器原生 `localStorage`，并在 UAT 中完整删除 Runtime
路由、代码和数据库表。

## 2. 已确认决策

1. 最终删除 `runtime_states`、`shared_runtime_states` 及相关模型、服务、路由、迁移接口和前端 shim。
2. 领域表与 Runtime 内容冲突时，领域表是唯一权威；Runtime 只补齐领域表中缺失的数据。
3. 冲突不得自动覆盖，必须记录 owner、源键、目标资源、规范化哈希和原因，并阻止删表。
4. 采用两阶段发布：先完成 API 切流并冻结旧表，再经过验收后执行不可逆删表。
5. 两个阶段都只进入 `uat` 和测试环境；本轮不得合入 `main`。
6. UAT 第二阶段实际执行删表。执行前必须生成可恢复备份并通过 `drop-check`。

## 3. 目标与成功标准

### 3.1 业务目标

- 12 个教师或管理页面的业务读取、创建、修改、发布、撤回和删除全部进入领域 API。
- 页面刷新、重新登录和独立浏览器上下文均能读取数据库中的最新结果。
- API 失败时保留可恢复编辑状态，不回退到 Runtime、业务 `localStorage` 或演示数据。
- admin、teacher、student、viewer 和未登录用户继续遵守现有权限边界。

### 3.2 Runtime 退役目标

- active UAT release 不包含或注入 `server-state-bootstrap.js`。
- 所有页面和身份的 Network 中 `/api/v1/runtime/*` 请求数为零。
- `window.localStorage` 保持浏览器原生存储，不存在 `KGServerStateStorage` 或
  `KGServerStateBootstrap`。
- 生产代码不再 import `RuntimeState`、`SharedRuntimeState`，不再查询两张旧表。
- 删除旧 Runtime 路由、service、schema、页面允许列表、迁移 API/CLI 和只为旧通道存在的测试。
- UAT Alembic 删除 `runtime_states`、`shared_runtime_states`；完成审计后清理 Runtime 专用迁移账本。

### 3.3 数据安全目标

- 迁移前备份包含表结构、行数据和校验信息，保存于部署备份目录，不提交仓库。
- 所有可识别业务键都有 `migrate`、`verified-duplicate`、`keep-local` 或 `drop` 处置。
- `drop-check` 中 unknown、parse error、hash mismatch 和 unresolved conflict 必须全部为零。
- 删表后领域表记录数、规范化哈希和主要页面读取结果与删表前验证快照一致。

## 4. 非目标

- 不创建新的通用 KV、preferences 或整包 JSON API。
- 不重写现有页面视觉、DOM、class 或无关交互。
- 不恢复已退役的学员引导学习功能。
- 不把纯设备偏好同步到服务器。
- 不在本轮合入 `main`、部署生产或删除生产数据库表。

## 5. 目标架构

### 5.1 数据流

```text
教师/管理页面
  -> 公共 domain-api-client
  -> 领域适配器
  -> FastAPI api/v1/<domain>.py
  -> services/<domain>_service.py
  -> PostgreSQL 关系表
```

`domain-api-client` 统一处理认证 Cookie、JSON 编解码、错误结构、超时、revision、取消和重试。
各领域适配器只负责旧页面模型与 API DTO 的转换，不复制请求实现，不保存业务数据。

### 5.2 数据归属

| 业务域 | 目标权威源 | 迁移方式 |
|---|---|---|
| 用户、角色、状态、用户日志 | `users`、`role_themes`、`user_admin_logs` 与 Users/System API | 复用现有 API，移除本地镜像写入 |
| 订阅、订单、兑换码、套餐 | subscriptions 关系表与 API | 复用现有 API，只保留页面内存展示态 |
| 题库、题目、标签配置 | questions/content-prep 关系表与 API | 移除旧题库键扫描和 Runtime 迁移入口 |
| 试卷草稿、分类、发布历史 | papers/paper-releases 关系表与 API | 复用现有 PaperDraft/PaperRelease 适配器 |
| 科目、知识树、活动、联想库 | teaching-content 关系表与 Content Prep API | 页面直接读取 API，删除 SharedRuntimeState 投影 |
| 原则与归纳预设 | `principles`、`synthesis_presets` 与 Content Prep API | 页面直接读取 API，删除投影行写入 |
| 反馈、公告、消息与回执 | engagement 关系表与 API | 移除共享 Runtime 兼容读取 |
| 课程草稿、发布版本、学习任务 | 新增课程管理关系模型与 typed API | 从 Runtime 缺失补齐后完全切流 |
| 教学内容 revision | 独立关系型版本记录 | 替代 `kg_teaching_content_revision_v1` 共享键 |
| 布局、折叠、最近选择、主题外观 | 浏览器原生 `localStorage` | 不迁服务器，不跨设备同步 |
| 一次性标记、测试内容、旧镜像 | 无 | 审计后丢弃 |

### 5.3 课程管理领域

新增职责明确的课程管理模型和服务，承接现有 `kg_course_config_drafts_v1`、
`kg_course_config_releases_v1`、`kg_course_config_active_release_v1` 和
`kg_learning_tasks_v1`：

- 课程草稿保存结构、节点配置、活动引用、owner、revision 和审计时间。
- 发布版本是不可变快照，记录版本号、发布者、发布时间和来源草稿 revision。
- 当前发布关系引用一个已发布版本，不在草稿 JSON 中用布尔字段模拟。
- 学习任务引用课程发布版本和受众范围，具备独立生命周期与 revision。
- API 提供列表、详情、创建、更新、发布、撤回、归档和任务 CRUD，不提供任意 key/value 写入。

### 5.4 教学内容 revision

现有 `teaching_content_revision_service` 的锁顺序和冲突语义保留，但存储迁移到专用关系记录。
所有题目、试卷、原则、知识树、联想库、课程和清理操作继续通过同一个版本服务递增；
`/api/v1/question-catalog/revision` 保持前端兼容，不再依赖 SharedRuntimeState。

## 6. 前端改造

### 6.1 公共入口

- 新增公共 `domain-api-client`，由同步层统一注入需要 API 的页面。
- 扩展现有 direct adapters，禁止在多个页面复制请求、错误解析或 revision 重试逻辑。
- `server-state-bootstrap.js` 第一阶段不再注入，第二阶段从源、同步脚本、manifest 和 release 删除。
- `window.localStorage` 不再被覆盖；认证继续使用现有原生存储/服务端 session 边界。

### 6.2 页面批次

1. 系统与账号：`user-management`、`system-settings`、`admin-settings`。
2. 题库与试卷：`question-bank`、`paper-management`。
3. 教学内容：`admin-subjects`、`content-prep`、`content-center`。
4. 课程与任务：`course-admin`、`teacher-workbench`。
5. 后台运营：`admin-console`、`admin-operations`。

每个页面完成后立即从前后端 Runtime 允许列表移除并运行定向浏览器验证。禁止等到最后一次性
删除允许列表，否则无法定位遗留依赖。

### 6.3 本地偏好

允许保留的本地数据必须满足：只影响当前设备展示；丢失后可使用默认值恢复；不改变业务记录、
权限、订阅、发布内容或跨用户状态。所有本地键集中登记在公共设备偏好模块，业务模块不得直接
构造新的持久化键。

## 7. 后端改造

- API 路由只做参数、权限和响应编排；业务逻辑进入 service。
- 新增课程管理模型、schema、service、API 和 Alembic migration。
- 将教学内容 revision 从 SharedRuntimeState 移入专用关系记录。
- 将 `teaching_content_projection_service` 的前端投影职责删除；保留其中仍有价值的验证、合并和
  引用检查逻辑，迁入职责明确的领域服务。
- 将 question cleanup/reference 等服务对 SharedRuntimeState 的扫描改为查询正式领域表。
- 将 question/paper/files Runtime migration API 和 CLI 纳入第一阶段迁移工具，第二阶段删除。
- 所有 async 写操作遵守 `flush` 父记录、`commit` 后 `refresh` 的现有纪律。
- 权限继续由 `require_role`、owner 和资源状态共同保证，不依赖前端隐藏控件。

## 8. 迁移、冲突与回滚

### 8.1 迁移流程

```text
backup -> scan -> migrate -> verify -> page cutover -> freeze -> drop-check -> UAT drop
```

- `scan` 枚举两个 Runtime 表全部键和 owner，生成规范化源哈希及目标映射。
- `migrate` 只补齐目标领域表不存在的记录；已有领域记录不更新。
- `verify` 对源与目标生成规范化业务哈希，区分已迁移、已验证副本、可丢弃和冲突。
- `freeze` 使旧 PUT/POST 进入 drain，GET 只用于紧急回滚；新页面不得请求这些接口。
- `drop-check` 要求未知键、解析错误、哈希不一致、未解决冲突和 Runtime 网络请求均为零。

### 8.2 冲突策略

- 领域表已有资源时以领域表为权威。
- Runtime 内容不覆盖目标，只在报告中记录源/目标哈希、owner、资源 ID 和差异原因。
- 同一源记录重复运行迁移必须幂等，不产生第二份目标记录。
- 任何真实业务冲突必须通过明确处置后才能删表，不允许用“测试数据”推测跳过生产内容。

### 8.3 备份与恢复

- UAT 删表前使用数据库原生工具导出旧表结构与数据，记录备份文件校验和。
- 备份文件位于受控部署备份目录，不写入仓库、不打印业务正文到日志。
- 第一阶段失败时回滚 active release，并显式恢复 Runtime 写开关。
- 第二阶段删表后若需恢复，先执行逆向建表 migration，再从已校验备份恢复；不得通过旧 release
  自动重建空表。

## 9. API 错误语义

- `400/422`：请求结构或业务校验错误，页面保留编辑内容并定位字段。
- `401`：会话失效，显示登录恢复入口，不提交匿名业务副本。
- `403`：角色或 owner 不允许，不使用空数据伪装成功。
- `404`：资源已删除或不可见，返回列表并提示刷新。
- `409`：revision 冲突，获取最新资源后允许用户确认并重试。
- `5xx/网络超时`：显示具体失败和重试入口，禁止写入 Runtime 或业务 localStorage 兜底。

写操作成功后的 UI 状态必须来自服务端响应或重新读取。取消和失败不得清除尚未提交的表单内容。

## 10. 测试设计

### 10.1 TDD 与静态契约

- 每个生产改动先增加会失败的测试并确认 RED，再写最小实现至 GREEN。
- 新增全仓退役契约：生产代码不得出现 Runtime endpoint、模型 import、表名、shim、允许列表或
  `KGServerStateStorage`；历史文档和旧 Alembic migration 可进入明确白名单。
- 新增业务存储契约：教师/管理业务数据不得写 `localStorage`、`sessionStorage`、IndexedDB 或新的
  通用 JSON 容器。
- 新增迁移幂等、领域优先、冲突阻断、备份门禁和 drop-check 测试。

### 10.2 后端验证

- 各领域 API 的成功、校验失败、权限拒绝、owner 隔离、404 和 revision 409。
- 迁移前后记录数与规范化哈希。
- Runtime freeze 后 revision 不增长。
- Alembic 升级可删除旧表；测试数据库从空库可直接升级到最终 schema。
- 运行 `cd backend && .venv/bin/python -m pytest tests/ -q`。

### 10.3 前端与浏览器验证

对 12 页逐一执行：

- admin、teacher 正常访问；student、viewer、访客走预期拒绝或跳转。
- 列表读取、创建、编辑、保存、刷新恢复、发布/撤回、删除/取消。
- 空数据、非法输入、401、403、409、网络失败和重试。
- 登录、退出、重新登录及第二浏览器上下文读取已保存数据。
- 捕获 Network 和 console，断言 `/api/v1/runtime/*` 为 0、页面错误为 0。
- 检查 `window.localStorage` 为原生对象，`KGServerStateStorage` 不存在。
- 检查数据库领域表发生预期变化，旧 Runtime revision 在第一阶段冻结后不再变化。

运行前端全量 `cd frontend && pnpm test`、定向设计契约和对应浏览器专项测试。

### 10.4 发布候选验证

- 正式发布必须运行 `node frontend/scripts/manage-new-legacy.js update new-legacy --skip-browser`。
- 候选 site 文件数不得少于 active site，关键管理页面必须存在。
- 删除 `server-state-bootstrap.js` 时以无可执行代码的 `runtime-retirement.json` 退役标记补齐
  release 文件数，避免绕过或削弱现有防回退门禁；标记只记录 schema、退役版本和状态。
- 抽查 source、public、candidate 和 active release 的 Runtime 依赖均为零。
- promote 后重新遍历 12 页，不能只验证源或 `frontend/public/new-legacy`。

## 11. UAT 发布流程

### 第一阶段：API 切流与冻结

1. 功能分支完成迁移代码和页面切流。
2. 运行全量自动测试、12 页浏览器验证和迁移 verify。
3. 合入 `uat`，使用 `http://127.0.0.1:7897` 代理推送并核对远端引用。
4. 部署测试环境，确认新 release 无 Runtime 请求，旧表只读保留。

### 第二阶段：UAT 彻底退役

1. 生成旧表备份和校验和。
2. 再次运行 drop-check，所有阻断项必须为零。
3. 执行 Alembic 删除旧表，部署不含 Runtime 代码的最终 UAT release。
4. 再跑 API、数据库、12 页浏览器和 active release 验证。
5. 停止，不合入 `main`，等待用户在测试环境验收。

只有用户后续明确批准，才单独制定 main/生产合入与生产数据迁移计划。

## 12. 完成定义

本轮只有同时满足以下条件才可报告完成：

- 12 页全部使用领域 API 且正负流程通过。
- UAT active release 的 Runtime 网络请求为零。
- UAT 数据库已删除两个 Runtime 表和 Runtime 专用迁移账本。
- 全量后端、前端、设计契约、浏览器遍历和 Alembic 验证通过。
- 迁移审计报告无 unknown、parse error、hash mismatch 或 unresolved conflict。
- 变更已进入并推送 `uat`，测试环境部署完成且远端引用已核对。
- `main` 与生产环境未发生变更。
