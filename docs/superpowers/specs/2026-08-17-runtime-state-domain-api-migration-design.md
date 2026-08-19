# Runtime State 全量迁移至领域 API 设计

**日期：** 2026-08-17  
**状态：** 已批准  
**目标分支：** `feat/runtime-state-to-domain-apis`

## 1. 背景与目标

当前 new-legacy 站点通过 `server-state-bootstrap.js` 替换浏览器 `localStorage`，登录后请求 `/api/v1/runtime/state`，把用户 `runtime_states.storage` 与 `shared_runtime_states` 合并为整包 JSON 下发。练题页面仅发布试卷当前快照就约 7.65 MB 文本，发布历史约 8.02 MB；后端还会先读取全部共享状态再按页面过滤。该机制导致首屏延迟、主线程 JSON 解析和深拷贝、整值写回、跨领域 revision 冲突及双重权威源。

本项目将一次性切换到领域 API：所有业务数据由明确的关系模型、service 和 API 持久化，前端不再请求或写入通用 runtime state。纯设备级 UI 偏好继续保存在浏览器原生 `localStorage`；短期导航状态使用 `sessionStorage` 或内存。

## 2. 成功标准

完成时必须同时满足：

1. 产品页面 Network 中不存在 `/api/v1/runtime/state` 请求。
2. 前端源代码不存在业务用途的 `KGServerStateStorage`、`KGServerStateBootstrap` 或 runtime key fallback。
3. `server-state-bootstrap.js` 不再注入产品页面，也不再替换 `window.localStorage`。
4. 除一次性迁移代码外，后端业务代码不 import `RuntimeState` 或 `SharedRuntimeState`。
5. 发布试卷、课程、教学内容、公告、反馈、工作区、学习记录等均有正式领域表和 API。
6. 列表接口只返回摘要；题目正文、图谱正文、workspace 正文和发布快照按 ID 请求并分页或限量。
7. 首个可用题目的响应不依赖题库全量、试卷发布历史或全局 shared 数据。
8. 历史数据迁移具备幂等标记、数量核对和失败回滚；迁移核验通过后删除 runtime 路由与两张旧表。
9. 全部后端测试、前端 Node 测试、类型/契约测试和逐页浏览器回归通过。

## 3. 范围边界

### 3.1 必须通过 API 的业务数据

- 用户、角色、权限、审计日志、系统配置、微信配置、订阅、订单、兑换码。
- 图谱文件索引、正文、当前文件、目录和标签。
- 题库、题目、试卷草稿、试卷发布版本、发布历史与冻结题目快照。
- 原则、归纳预设、标签配置、科目、分类树、活动集合、活动标签、内容覆盖、联想库及内容发布审计。
- 课程草稿、课程发布版本、当前发布版本、学习任务和评估试卷映射。
- 练题 session、answer、attempt、错题、验证、事件和历史。
- 多题工作区、个人归纳卡、深度回忆进度与快照、引导学习进度。
- 公告、反馈、回复、消息和已读回执。
- 登录入口原子 claim。

### 3.2 保留在原生 localStorage 的设备级 UI 偏好

主题、字号、面板折叠、分栏比例、工具位置、最近颜色、侧栏状态、排序方式、画布视口偏好、当前设备的最近选择等。它们必须经 UI preference 白名单 wrapper 访问，不得通过服务端 runtime 同步。

### 3.3 保留在 sessionStorage 或内存的短期状态

跨页路由 context、训练入口参数、当前临时预览、页内 tab、尚未提交的瞬时选择和一次性导航 claim token。Question Studio 的正式草稿和备份属于业务数据，不能留在浏览器。

## 4. 目标架构

```text
new-legacy page
  -> domain adapter / repository
  -> /api/v1/<domain>
  -> api/v1 route
  -> domain service
  -> normalized PostgreSQL models
```

每个领域 adapter 只负责一个稳定 API 合约，不建立新的通用 KV API，也不把 API 返回数据写回 localStorage。需要兼容旧同步消费者的页面在初始化阶段显式 await adapter ready，随后只读 adapter 内存缓存；所有写操作返回 Promise 并由页面呈现保存中、失败和冲突状态。

权威源码层级：

- 产品业务模块：`new-legacy/src/` 与对应 HTML。
- 部署适配器：`frontend/scripts/new-legacy-assets/`。
- 注入和结构 patch：`frontend/scripts/sync-new-legacy.js`。
- 生成物 `frontend/public/new-legacy/` 和 active release 禁止手改。

## 5. 后端领域设计

### 5.1 直接复用现有关系模型/API

- Files：`graph_files/file_contents/folders/tags/file_tags/current_files` 与 `/files`。
- Users/System/Subscription：现有 `/users`、`/auth`、`/system`、`/subscriptions`。
- Question bank：`question_banks/questions` 与 `/questions`、`/question-catalog`。
- Learning：现有 training、recall、practice、events、workspaces、personal cards API。
- Guided progress：现有 `/guided-learning` 学习进度 API。
- Principle/preset/tag config：现有 content-prep 关系表与 API，删除 shared projection。

### 5.2 新增或补齐模型/API

#### 发布试卷

新增：

- `paper_releases`：release id、paper id、version、状态、访问级别、启用模式、发布时间、撤回时间、元数据。
- `paper_release_questions`：release id、序号、bank/question id、冻结 `snapshot` JSONB。

API：

- 教师发布/撤回和发布历史。
- 学员轻量 catalog。
- 按 release 获取题目，支持 `limit`、顺序和随机种子；不得返回其他 release。
- 权限检查直接查询 release，不再解析 shared JSON。

#### Engagement

新增 `announcements`、`announcement_audiences`、`feedbacks`、`feedback_replies`、`message_receipts`、`feedback_receipts`。保留现有 `/engagement` API 合约，替换 service 内部存储。

#### 教学内容

新增或规范化 `content_subjects`、`content_taxonomies`、`taxonomy_nodes`、`activity_collections`、`activity_tags`、`activity_overrides`、`recall_association_libraries`，以及 taxonomy import/release/delete audit 表。`content-prep` API 继续作为边界，但不得读写 SharedRuntimeState。

#### 课程管理

新增 `course_drafts`、`course_releases`、active release 引用、`learning_tasks` 及必要 assignment。评估试卷映射到正式 `exam_papers`，不建立第二套试卷正文模型。

#### 练题恢复数据

扩展现有 session/event/attempt 模型，使 active attempt、作答恢复和历史均能通过 API 查询；禁止整数组覆盖。

#### 管理设置与审计快照

`kg_admin_settings_v1` 映射到带 schema 白名单的 `system_settings` API。仍有业务用途的 transaction snapshot 使用独立不可变审计表；无消费者时迁移报告明确标记废弃，不创建无用模型。

#### 登录入口 claim

新增带 owner/session digest 唯一约束的 claim 表，端点迁至 `/auth/learning-entry-claim`，保证原子消费。

### 5.3 禁止通用 preferences API

用户已确认纯 UI 偏好保留在浏览器，因此不新增服务端 `user_preferences` 通用 KV 表。业务草稿不得伪装成偏好写入 localStorage。

## 6. 前端切换设计

1. 移除全局 localStorage shim，恢复浏览器原生实现。
2. 建立 UI preference wrapper，白名单限制纯 UI 键；测试发现业务键写入时直接失败。
3. 图谱 `KGGraphFileStore` 改由 files adapter 初始化、打开和保存；autosave 直接调用文件正文 API。
4. 发布试卷 repository 改为：先取轻量 catalog，点击开始时只请求目标 release 和本次题数；不再加载发布历史和全部快照。
5. Canvas workspace store 改用 `/workspaces`，以 workspace id 读写正文和 revision。
6. Practice、recall、guided learning、engagement、system adapter 删除 runtime fallback 和回写。
7. 管理端题库、课程、内容中心、原则配置切换到对应 CRUD/publish API。
8. Question Studio 草稿与备份改用后端 draft API；本地只保存 UI 选择。
9. 删除所有显式 `flush()`、`refresh()`、pagehide beacon 和 runtime revision 冲突逻辑。
10. `direct-system-adapter.js` 清除同步 XHR，所有预载使用并发 fetch；失败不能冻结主线程。

## 7. 数据迁移

新增 Alembic 表结构后提供一次性迁移 service/CLI：

1. 读取 `runtime_states` 和 `shared_runtime_states`，按已冻结 key 映射导入领域表。
2. 每类迁移记录 source key、owner、对象数量、目标数量、内容 hash、状态和错误。
3. 使用 upsert 或唯一键保证重复执行幂等。
4. 对已有关系表优先比对，不用 runtime 旧副本覆盖更新的数据。
5. 发布试卷迁移必须保留 release id、version、访问策略、启用模式、题目顺序和冻结快照。
6. 无业务价值的 UI/临时键不导入服务端。
7. 切流前生成 dry-run 报告；切流后运行一致性核对。
8. 只有所有 required key 完成且数量/hash 校验通过，才允许 drop runtime 表。

一次性迁移代码可在删表后保留一个归档版本，但不得进入常规请求链路。

## 8. 错误处理与并发

- API 401/403 进入登录或权限状态，不显示空数据伪装成功。
- 409 返回当前 revision 和可重载提示；不能回退到 runtime。
- 列表和详情各自有 loading/error/empty 状态；详情请求失败不清空已加载 catalog。
- 写操作使用领域级 revision/updated_at，而非全用户全局 revision。
- 发布、撤回、课程切换和 taxonomy 发布在数据库事务中完成。
- 大正文保存采用内容大小限制；必要时使用 PATCH 或独立正文端点。

## 9. 性能门禁

- `/practice-mode.html` 不得请求大于 1 MB 的单个 JSON 响应；默认练题详情只返回选择题数及必要上下文。
- 所有 catalog API 分页或具备明确上限。
- 禁止同步 XHR。
- 浏览器测试记录首题可交互时间、接口数量和响应大小；本地标准数据集下首题目标低于 500 ms（不含首次登录交互）。
- 静态检查禁止 `/api/v1/runtime/state`、`KGServerStateStorage` 和业务 runtime key 新增。
- 后端查询不得先读取全领域数据后在 Python 过滤当前资源。

## 10. 测试与验收

### 后端

- 新模型、CRUD、权限、owner 隔离、发布事务、分页、迁移幂等和 hash 核对测试。
- 原有 service 切换后的契约测试。
- 静态测试断言业务服务不 import runtime models。
- Alembic upgrade/downgrade 与干净数据库 seed。

### 前端

- 每个 adapter 的 payload、401、403、404、409、500 测试。
- 业务 repository 不访问 localStorage 的测试。
- UI preference 白名单测试。
- sync 注入顺序、目标页面和 runtime bootstrap 零注入测试。

### 浏览器

逐页验证访客、student、teacher、admin：登录、退出、切换账号、列表、详情、一次写操作、刷新恢复、权限和错误状态。所有页面捕获 Network 与 console，断言 runtime 请求为零。认证/权限/导航必须遍历所有带账号菜单页面。

### 发布

先运行 sync 和完整 validator。正式发布前核对 source、public、candidate、active 文件数和关键页面；只通过 `manage-new-legacy.js update new-legacy` 构建和 promote，不直接修改 active site。

## 11. 一次性切换与回滚

虽然代码按依赖顺序实现和测试，但只在所有领域完成后整体启用。切换提交包括：关系模型、迁移、API、前端 adapters、移除 bootstrap 注入和禁用 runtime route。

回滚只能回滚应用版本和数据库迁移；切换前必须保留 runtime 表快照。新写入不再双写 runtime，因此切换后不能依赖旧 runtime 数据进行长期双轨回滚。发布验证失败时在 promote 前终止；生产切换后若必须回滚，应使用数据库备份和明确的数据反向迁移，而不是重新打开通用 runtime 写入口。

## 12. 完成定义

- 所有成功标准均有自动化证据。
- runtime 历史数据迁移报告无 required failure。
- 源、sync 产物和候选 release 一致。
- 工作树中不包含手改 active release。
- 功能分支验证完成后向用户报告；只有获得明确授权才提交、合并 main、推送、发布和删除分支。
