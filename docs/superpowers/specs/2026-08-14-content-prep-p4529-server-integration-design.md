# Content Prep Studio P4.5.29 服务器整合设计

日期：2026-08-14
状态：方案 A（模块化移植）已获用户确认

## 背景

实施冻结表 `P4.5.29_服务器整合_实施冻结版_Implementation_Baseline_v1_待ActiveAudit.xlsx` 的 `Prep Studio差异` 页列出 40 项能力。当前 active release 为 `v9.0-p4.1.72`，其 Content Prep 主体仍是模块化的 v0.4.0 服务器版。关键词/Recall 第 1–5 项已经补齐，但用户提供的 `PMP_Content_Prep_Studio_V9.0-P4.5.29.html` 中 Question Family、Subject Facet、原则双格式、契约与版本治理等业务能力尚未完整迁入服务器版。

用户确认采用方案 A：以 V9.0-P4.5.29 单文件的业务界面和 40 项能力为功能参考，逐项迁入当前模块化源码，同时完整保留服务器题库、数据库共享草稿、Question Lock/Lease/Heartbeat、Question Revision、Teaching Content Revision、RBAC、审计和原子同步。

## 目标

- 关闭 `Prep Studio差异` 页 40 项能力差异，并为每项建立源码和自动化测试证据。
- 保持 V9 单文件的业务 UI、中文文案、Family/Facet 编辑体验和校验定位体验。
- 业务数据以 PostgreSQL 和服务器 API 为正式真源；浏览器只保存主题、设备标识等非业务偏好。
- 共享草稿承载未发布的完整工作区，正式内容只通过第七步原子同步写入主程序。
- Family、Facet、Global Tag、Keyword、Recall、Principle、Reasoning 和双语字段往返不丢失。
- 为 External AI、Prep、Server 建立相同的机器可执行 Authoring Contract 和兼容信息结构。
- active release 发布过程不回退现有 866 文件和服务器功能。

## 非目标

- 不用 V9 单文件整体覆盖 `dist/content-prep.html`。
- 不删除或绕开 `35-server-catalog-service.js`、`36-server-draft-service.js`、`37-shared-draft-ui.js`、`45-server-events.js`。
- 不把 IndexedDB、localStorage 或 Device ID 恢复为题库、Family、Facet、原则或 Workspace 的正式真源。
- 不重写主程序视觉皮肤；只补齐消费 Prep 新字段所需的兼容逻辑。
- 不在导入时自动创建 Recall、Facet、Global Tag、Knowledge 或 Principle 稳定 ID。

## 方案选择

### 方案 A：模块化移植（采用）

从 V9 单文件提取纯领域能力和业务 UI，放入当前模块化构建；服务器专属适配器继续负责数据库、并发和发布。

优点：单一状态流、可逐组测试、服务器协作零退化、后续维护边界清楚。代价：需要为 V9 单文件的全局函数建立模块边界，并补充服务器 API 契约。

### 方案 B：整体替换单文件（拒绝）

直接用 V9 单文件替换当前构建产物。该方案会移除服务器 DOM 锚点和适配器，使 Workspace 回退 IndexedDB，并丢失 Lock、Heartbeat、Revision、RBAC、远程刷新和原子同步。

### 方案 C：新旧页面并行桥接（拒绝）

保留服务器版，同时 iframe/新路由运行 V9 页面。该方案会形成本地 state 与服务器 shared draft 双真源，Family/Facet/Principle 的合并与冲突处理不可解释。

## 总体架构

```text
V9 业务 UI
  ↓
P4.5 Authoring Domain
  ├─ Family normalize / resolve / validate / coverage
  ├─ Facet registry / binding / validate
  ├─ Principle bundle canonicalize / safe merge
  ├─ Difficulty + Global Tag migration
  └─ Compatibility / contract export
  ↓
数据库共享草稿（完整工作区 + draft revision）
  ↓ 第七步显式同步
服务器 Validate → Lock/Revision → Atomic Commit → Audit
  ↓
正式 Question Catalog / Shared Content / Runtime Consumers
```

### 前端模块边界

保持现有 `build.py` 单文件构建形式，并增加职责单一的模块：

- `12-p45-authoring-domain.js`：Family、Facet、难度、Global Tag 的纯 normalize/migrate/validate 函数。
- `14-principle-bundle-domain.js`：两种原则包输入归一、冲突分类和安全合并计划。
- `22-p45-authoring-ui.js`：Family 页签、Family 编辑器、Facet 管理器、题目 Facet 编辑器、校验跳转。
- `32-p45-contract-service.js`：完整包、题库、Workspace 和 `programCompatibility` 的契约化导入导出。
- `38-shared-draft-autosave.js`：数据库共享草稿的防抖自动保存、恢复提示、失败重试和 revision 冲突处理。
- `46-server-p45-adapter.js`：Subject Facet、Principle safe merge、机器契约和 Build Metadata 的服务器调用。

现有文件职责保持：

- `10-state-domain.js` 继续管理顶层 state 与旧数据兼容入口，但不承载全部新领域实现。
- `20-page-runtime.js` 调用新 UI 模块，不复制 Family/Facet 领域算法。
- `35/36/37/45` 保留题库、草稿、锁、远程 revision 和服务器刷新逻辑。
- `index.template.html` 采用 V9 的业务 DOM 和文案，同时保留服务器题库、锁状态、共享草稿 Gate 和第七步同步 DOM。

## 数据所有权

### 服务器权威字段

- `serverRevision`
- `serverContentHash`
- `serverExportSnapshot`
- `contentRevision`
- `draftRevision`
- `lockToken`
- `clientInstanceId`
- idempotency key / upload fingerprint
- owner / collaborator / RBAC / audit metadata

上述字段不得由导入 JSON 覆盖，也不得进入业务 canonical hash。

### Authoring Payload 字段

- `metadata.questionFamily`
- `metadata.subjectFacets`
- `metadata.tagPaths`
- `metadata.knowledge`
- `metadata.principleIds`
- `metadata.stemPrincipleIds`
- `metadata.optionPrincipleMap`
- `clues` 与 Keyword v2 派生视图
- `reasoningSteps`、`keyPath`、`translations`
- 三档 `difficulty` 与独立 `questionFamily.difficultyLevel`

这些字段进入共享草稿、正式题目和 canonical question hash，并在导入、编辑、导出、服务器重读后保持一致。

### 浏览器可保存字段

- 主题和纯显示偏好
- Device ID
- 当前打开页签等会话级 UI 状态

浏览器不得持久化正式题库、完整 Workspace、Facet Registry、原则库或 Family Registry。

## 七个实施组

### 已完成基线：关键词与 Recall（差异 1–5）

- 保留已经进入 active release 的中文、英文、Alias、Recall ID 模糊搜索。
- 保留 Recall 可空、非空失效 ID 阻断、题干/选项来源隔离重算和同词跨来源独立 clue。
- 后续 Family/Facet/UI 迁移不得覆盖 `test_recall_binding.js`、服务器 Recall 引用校验和 Deep Recall 端到端链路。
- 全量发布前重新执行该组的单元、后端和浏览器回归，确认新 UI 仍使用相同稳定 ID 契约。

### G1：原则包兼容、迁移和安全合并（差异 6–8）

- 输入兼容 `kg-principle-card-bundle-v1` 与 `pmp-principle-preset-bundle-v1`。
- 兼容旧原则库 JSON 和旧归纳卡 JSON 单独导入，先归一为同一 Principle Domain。
- 生成 `Added / Unchanged / Conflict` 合并计划。
- 同 ID 不同名称、不同 ID 同规范化名称、Preset ID 改绑 Principle 均进入显式 Review。
- 默认不覆盖、不删除服务器已有原则或卡片。
- 用户解决冲突后由服务器在单事务中合并，并更新投影与 Teaching Content Revision。
- 原则删除继续执行引用扫描；存在题目引用时阻断，确保零悬空引用。

### G2：Subject Facet 全链路（差异 9–11、27、29）

- Prep 从 `/api/v1/content-prep/subject-facets` 加载服务器 Schema。
- 支持导入、编辑、校验和导出 `pmp-facet-schema-v1`。
- Schema ID、dimension ID、facet value ID 稳定；历史使用过的 ID 不可硬删除或改写。
- 题目保存 `metadata.subjectFacets`，只允许引用当前或兼容历史 Schema 中的真实 ID。
- 完整内容包携带 Registry Snapshot/Reference，普通题库只携带题目绑定。
- 无效 Facet 在编辑区和校验中心可定位，并阻止正式同步。
- Schema revision 冲突时拒绝覆盖，刷新服务器最新版后重新应用教师修改。

### G3：Question Family v1（差异 12–20、28、38，以及 40 的 Family 部分）

- 支持 `root`、`member`、`standalone` 三种角色。
- 支持 `equivalent`、`decomposed`、`extension` 等关系和变体类型。
- 支持 A/B/C 等价等级、`diagnosticTarget`、独立 L1–L4、用途多选和教师 `qualityConfirmed`。
- 外部导入一律强制 `qualityConfirmed=false`；只有教师操作可以设为 true。
- 支持从母题创建成员、Family 页签导航、列表视觉识别和 Family 最低覆盖检查。
- Root-only 批次合法；覆盖不足只标记“未达到诊断就绪”，不作为导入错误。
- 同一 Bank 内解析 Family；跨 Bank 引用和重复 Root 为错误。
- Family 校验进入校验中心和服务器发布前硬 Gate。

### G4：难度与 Global Tag（差异 21、26）

- 正式普通难度统一为 `简单 / 中等 / 困难`，Runtime 映射 `easy / medium / hard`。
- 旧 `基础` 只在导入迁移时兼容为 `简单`。
- Family `difficultyLevel` 始终为 1–4，禁止写回普通 `difficulty`。
- Global Tag 使用 `global/...` 稳定语义 ID。
- 兼容现有 `usage/...`、`quality/...`、`source/...` 和旧数字槽位，只在导入层迁移，不在保存后保留双真源。
- Knowledge、Subject Facet、Global Tag 三层分类独立保存和筛选。

### G5：Workspace 服务器化体验（差异 22–25）

- V9 的自动保存、恢复、手动保存和删除体验映射到数据库共享草稿。
- 编辑后防抖自动保存；页面刷新或重新登录后从数据库恢复。
- 自动保存失败保留 dirty 状态，展示可重试错误，不显示虚假成功。
- Draft revision 冲突时禁止静默覆盖，允许刷新、复制冲突草稿或放弃本地未保存编辑。
- Workspace 保存题库、知识树、Recall、原则、归纳卡、Global Tag、Facet Registry、Family 和当前编辑位置。
- Workspace 文件导入导出继续作为人工备份格式，但不成为服务器正式源。

### G6：契约与版本治理（差异 31–37、40）

- 建立仓库级 `/contracts` 与 `/registries` 机器真源。
- 提供 Question、Question Bank、Question Family、Principle、Principle Bundle、Keyword v2、Recall Binding 和 `programCompatibility` Schema。
- manifest 分离 `Product Release`、`Server Build`、`Prep Build`、`Authoring Contract`、`Registry Version/Hash`。
- 页面头部同时显示 Product Release、Prep Build 和 Authoring Contract，不把 P4.5.29 当作唯一跨系统版本号。
- 导出 `programCompatibility` 包含：
  - `authoringContract`
  - `contractSnapshot`
  - `registryManifest`
  - `testedAgainstProductRelease`
  - `serverBuildEvidence`
  - `policies.keywordLocation`
  - `policies.recallBinding`
  - `policies.deepRecallReveal`
- 明确输出 `source-isolated-derived`、`optional-existing-id-only` 和 `click-to-reveal-all-keywords`。
- 完整 External AI 模板覆盖 Family、Facet、Keyword v2、Reasoning、Principle 和 Source Facts 保护。

### G7：校验定位与编辑 UX（差异 30、38–39）

- 校验项带 `questionId` 和字段路径，可跳转题目、Family 页签或 Facet 编辑区。
- 题目预览和 Family 页签保持粘性布局。
- Delete 快捷键只在非输入态删除当前题目；输入框、textarea、select、contenteditable 获得焦点时不得触发。
- 所有新增按钮、页签、搜索框、选择器和上传入口必须有真实业务结果，并覆盖成功、失败和恢复路径。

## 导入、编辑与同步数据流

### 导入

1. 识别 Complete Bundle、Question Bank、Quick Text、Principle Bundle、Facet Schema 或 Workspace Backup。
2. 按机器 Contract 校验结构。
3. 归一难度、Global Tag、Family、Facet、Keyword、Principle 和兼容字段。
4. 生成可见的迁移/冲突报告，不静默猜测受控 ID。
5. 将结果写入当前数据库共享草稿。
6. 不在导入阶段直接修改正式题库或正式 Registry。

### 编辑

1. 打开已存在服务器题目时申请 Lock，并启动 Heartbeat。
2. UI 只修改共享草稿 Authoring Payload。
3. 切题释放旧 Lock；失锁后题目进入只读或冲突复制流程。
4. 自动保存携带 draft revision；失败不清除 dirty 状态。

### 正式同步

1. 校验草稿 revision、用户 RBAC、题目 Lock 和 base revision。
2. 校验 Family、Facet、Tag、Knowledge、Recall、Principle 和 Source Facts。
3. 生成逐题 Added/Updated/Unchanged/Removed-from-source 摘要。
4. Removed-from-source 默认保留，删除需要独立确认与权限。
5. 在单事务内写 Registry/Shared Content、题目、Revision 和审计。
6. 任一步失败整批回滚并保留草稿。
7. 成功后删除共享草稿，刷新正式题库和全局 Content Revision。

## 错误与恢复

- Schema 不兼容：显示固定错误码和字段路径，不做 best-effort 猜测。
- 受控 ID 不存在：阻止同步；允许清空可选 Recall，其他受控字段必须重新选择。
- Principle 冲突：显示冲突双方和稳定 ID；解决前不提交。
- Facet revision 冲突：刷新最新 Schema，并要求重新确认编辑结果。
- Family 关系错误：定位题目和 Family 字段；Root-only 只给 readiness 提示。
- Lock/Lease 过期：拒绝正式同步，重新获取编辑权后再保存。
- Question/Draft/Content Revision 冲突：旧 Stage 失效，重新加载、重新生成摘要、再次确认。
- 网络失败：草稿和 dirty 状态保留；重复提交沿用稳定幂等键。
- 自动保存失败：允许手动重试、导出备份或安全退出，不显示已保存。

## 测试设计

### Requirement Trace

为 40 项差异维护一张机器可读的 trace，至少记录：差异编号、UI 控件、领域函数、API、正向测试、负向测试、恢复测试和 active release 证据。任何一项无测试不得标记完成。

### 前端单元测试

- Family normalize、root/member/standalone、familyKey、coverage 和非法关系。
- Facet Schema 导入、稳定 ID、deprecated 值和无效绑定。
- 两种原则包 canonical 结果等价；ID/名称冲突不静默覆盖。
- 三档难度与 L1–L4 分离；旧 `基础` 迁移。
- `global/...` 与旧 Tag ID 迁移。
- 完整包/题库/Workspace/Quick Text 的字段往返。
- 版本和 policy 输出结构。
- Delete 快捷键输入态保护。

每个新增行为严格执行 RED → GREEN → REFACTOR，并记录测试先失败的原因。

### 后端测试

- Facet Schema CRUD、revision conflict、历史 ID 保护和题目引用校验。
- Principle 双格式、安全合并、冲突 Review、引用保护和原子事务。
- Family Root-only 正例、完整 Family 正例、非法关系反例和外部 `qualityConfirmed=true` 强制拒绝/归零。
- 共享草稿自动保存与 draft revision 冲突。
- Lock/Lease/Heartbeat、Question Revision 和 Content Revision。
- 同步事务失败全回滚。
- Removed-from-source 默认保留和独立删除权限。
- RBAC：无 update/delete/publish 权限的用户被服务器阻断。

### 浏览器 E2E

- 扫描全部可见 button/a/input/textarea/select，确认均有真实交互。
- Family 创建、成员添加、关系编辑、质量确认、覆盖校验、导航和删除。
- Facet Registry 导入、编辑、题目绑定、错误定位和服务器重读。
- 两种原则包导入、冲突处理、删除引用阻断。
- 自动保存、刷新恢复、网络失败重试和两个浏览器 draft revision 冲突。
- 两浏览器题目 Lock、Heartbeat、失锁只读和重新获取。
- 完整包导入 → 草稿保存 → 正式同步 → 刷新重读 → 主程序消费。
- normal/core 首屏视觉一致且点击后揭示，无加载闪现。
- 所有功能至少有一个正向、负向和恢复场景。

### 全量 Gate

- Content Prep Node/Python 测试。
- Backend 全量 pytest。
- Frontend contract tests。
- Content Prep 浏览器控制矩阵和端到端测试。
- active release 页面和源构建 hash 对齐。
- 候选 release site 文件数不得低于当前 active release 的 866 个文件；关键页面和服务器脚本必须存在。

## 发布策略

- 只修改 `new-legacy/` 正式源、backend 和机器契约，不直接编辑 active release site。
- 每个实施组完成后独立提交并通过任务级代理评审。
- 全部组通过后执行完整构建和回归。
- 使用 `node frontend/scripts/manage-new-legacy.js update new-legacy --skip-browser` 生成候选并提升 active release。
- 发布后复测 `/content-prep`、题库、训练、Deep Recall 和管理员相关页面。
- 功能完成后合入并推送 `main`，删除临时功能分支和工作树，最终只保留 `main`。

## 完成标准

- `Prep Studio差异` 40 项全部映射到实现文件、API 和自动化测试。
- V9 Family、Facet、原则包、难度、Tag、Workspace、契约和 UX 能力在服务器版可见且可操作。
- 所有业务数据可在数据库共享草稿中保存、刷新恢复并正式同步。
- 两账号协作、Lock/Lease、Revision、RBAC、审计和事务能力零退化。
- 完整包往返无 Family、Facet、Keyword、Principle、Reasoning 或双语字段丢失。
- 所有 P0 Gate 与相关 P1/P2 Prep 功能测试通过。
- active release 内容完整、文件数校验通过，并完成浏览器正向、负向和恢复验收。
