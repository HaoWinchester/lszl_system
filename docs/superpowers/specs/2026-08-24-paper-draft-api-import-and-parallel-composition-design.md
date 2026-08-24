# 试卷草稿 API、试卷导入与平行组卷设计

**日期：** 2026-08-24
**状态：** 已批准
**目标分支：** `codex/paper-draft-api-composition`

## 1. 背景

当前 `paper-management.html` 的试卷草稿与分类仍通过通用 runtime state 保存，虽然系统已经具备关系型 `exam_papers`、`paper_questions`、试卷发布版本以及部分试卷 CRUD/组卷接口，但现有接口尚不能完整承载：

- 试卷草稿全部字段、有序题目引用和分值；
- 试卷分类；
- `kg-paper-package-v1` 试卷数据包的预检与导入；
- 同一批次 A/B/C 多套平行卷；
- 每套卷独立题量、配额平衡和跨卷题目不重复；
- 预检、用户选择、幂等提交和事务回滚。

本功能将试卷草稿收口到领域 API 和 PostgreSQL。题库数据包与试卷数据包继续保持两个独立入口：题库数据包负责创建题库和题目，试卷数据包只引用已经存在的 `bankId + questionId`。

Paper Studio 仅作为组卷算法规则的参考，不复用它的存储、页面、导入导出或运行时实现。

## 2. 目标与成功标准

完成时必须满足：

1. `paper-management.html` 的试卷、题目引用和分类只通过领域 API 读写。
2. 刷新页面后草稿、题目顺序、分值、分类和发布关联均从数据库恢复。
3. 能预检并导入 `kg-paper-package-v1`，按 JSON 原始 `order` 创建题目引用。
4. 导入不会复制题目正文；所有引用必须指向当前系统中真实存在且题库归属正确的题目。
5. 能一次预检并生成 A/B/C 多套试卷，每套题量独立配置，批次内题目不重复。
6. `exam-domain` 硬配额必须满足；`performance-domain` 只作为软目标且不能破坏硬配额。
7. 库存不足在预检阶段发现，不产生试卷写入；用户可以取消全部或只提交可行试卷。
8. 正式创建所选试卷使用单个数据库事务；任何技术失败或并发变化都整体回滚。
9. 重复提交不会重复创建试卷。
10. 管理员与教师保持共享管理语义，并通过 `revision` 防止并发覆盖。
11. 现有 runtime 草稿和分类可一次性、幂等迁移，迁移后不再双写或回退。

## 3. 范围边界

### 3.1 本期范围

- 补齐试卷草稿、分类和有序题目引用的数据模型、service、schema 与 API。
- JSON 试卷数据包预检、冲突处理和事务导入。
- A/B/C 平行组卷预检、配额计算、跨卷去重和批量创建。
- `paper-management.html` 的导入试卷、组卷、预检和错误提示界面。
- 当前 runtime 草稿与分类的一次性迁移和前端切流。
- 后端、前端适配器、浏览器和发布验证。

### 3.2 不在本期范围

- 从试卷数据包导入题目正文。
- 复用 Paper Studio 的存储、页面或审计格式。
- 把 `metadata.knowledge.primaryNodeId` 新增为第三层配额。
- 跨历史批次永久禁止题目复用。题目不重复规则只约束同一次 A/B/C 组卷批次。
- 自动发布生成的试卷。导入和组卷均先创建草稿。
- 改写 `legacy/` 原版源文件。

## 4. 数据模型

### 4.1 复用并扩展 `exam_papers`

继续使用现有试卷草稿主表，不建立第二套 v2 草稿表。补齐以下字段：

- `category_id`：可空，关联试卷分类；
- `access_policy`：JSONB，保存草稿访问策略；
- `enabled_modes`：JSONB 数组；
- `mode_config_version`：可空字符串；
- `purpose`：可空字符串；
- `archived_at`、`restored_at`、`withdrawn_at`：兼容现有草稿生命周期；
- `published_release_id`、`published_version`：保留当前发布关联；
- `generation_batch_id`：可空，关联平行组卷批次；
- `variant_code`：可空，如 `A`、`B`、`C`；
- `generation_config`：JSONB，冻结本次组卷的筛选条件、配额与随机种子；
- `import_metadata`：JSONB，记录数据包 schema、producer、exportedAt、来源 paper ID 和来源时间；
- `revision`：继续作为乐观锁；
- 现有 `created_by`、`updated_by`、时间字段继续用于共享编辑审计。

字段默认值必须兼容已有行，Alembic 升级不得破坏现有草稿和发布记录。

### 4.2 扩展 `paper_questions`

继续以 `paper_id + question_id` 表达正式引用，新增或规范：

- `order_index`：从零或一开始由内部合约统一，API 对外明确使用从一开始的 `order`；
- `score`：数值型，默认 1；
- 唯一约束：同一试卷内 `question_id` 不重复；
- 唯一约束：同一试卷内 `order_index` 不重复。

`bankId` 不重复存储，通过 `questions.bank_id` 获得。普通草稿 API 使用当前系统返回的内部 bank/question ID；试卷数据包中的 ID 则按第 6.2 节的外部身份解析规则转换为内部主键后保存。

### 4.3 新增试卷分类

新增 `paper_categories`：

- `id`、`name`、`description`、`order_index`；
- `created_by`、`updated_by`、`created_at`、`updated_at`；
- `revision`；
- 可选归档时间。

分类与试卷采用受控删除：存在试卷引用时不能物理删除；可归档或先移动试卷。

### 4.4 新增平行组卷批次

新增 `paper_generation_batches`：

- `id`；
- `idempotency_key`，在调用者范围内唯一；
- `created_by`、`created_at`；
- `subject`；
- `bank_ids`，保存当前系统内部题库 ID；
- `filter_config`；
- `quota_config`；
- `random_seed`；
- `requested_variants`；
- `created_paper_ids`；
- `status`，正式事务成功后为 `created`。

预检不写此表。只有用户确认正式创建且事务成功时，批次和试卷一起提交。

### 4.5 导入操作幂等记录

新增 `paper_import_operations`，以 `actor_username + idempotency_key` 唯一，记录请求 hash、冲突动作、结果 paper ID 和完成时间。并发提交使用公共幂等锁工具；不得在 paper service 中复制现有 content-prep 的 advisory-lock 实现。

## 5. 试卷草稿 API

在现有 `/api/v1/papers` 边界内补齐强类型 schema：

- `GET /papers`：分页返回摘要，可按状态、分类、科目和关键字筛选；
- `POST /papers`：创建草稿，可同时提交有序题目引用；
- `GET /papers/{paper_id}`：返回草稿全部字段和按顺序排列的引用；
- `PUT /papers/{paper_id}`：要求 `revision`，更新元数据和配置；
- `PUT /papers/{paper_id}/questions`：要求 `revision`，原子替换有序引用；
- `DELETE /papers/{paper_id}`：只允许未发布草稿，或采用现有归档规则；
- 分类 CRUD：`/paper-categories`。

写请求对每个引用校验：

1. `bankId` 和 `questionId` 均非空；
2. 题目存在且生命周期允许被试卷引用；
3. 题目实际 `bank_id` 与请求的内部题库 ID 一致；
4. 同卷引用和顺序无重复；
5. 顺序连续；
6. `total_count` 与引用数量一致；
7. `score` 合法。

管理员和教师读取同一共享集合；学生和 viewer 不允许进入草稿管理写接口。更新 revision 不一致返回 409，并携带当前 revision，前端提示重新加载。

## 6. JSON 试卷导入

### 6.1 支持的输入

本期支持：

- `schema = "kg-paper-package-v1"`；
- `schemaVersion = 1`；
- `paper.questions[]` 每项包含 `bankId`、`questionId`、`order`、`score`。

验证样本：`测试数据/PMP 模拟卷 05_PAPER_V9.0-P4.5.29.json`。该样本实际包含 99 条唯一题目引用，顺序 1 至 99；文件名为“模拟卷 05”，但包内 `paper.name` 为“PMP 模拟卷 04”。

导入以 JSON 内部字段为权威。文件名和内部名称不一致时，预检返回 warning，不自动改名。

### 6.2 预检接口

`POST /papers/import/preflight`

输入为 `{fileName, package}`，其中 `fileName` 只用于预览提示，`package` 是试卷包。接口不创建或修改试卷，返回：

- schema 和版本校验结果；
- 试卷摘要、题量、来源题库摘要；
- 文件名与内部名称差异；
- 顺序缺口、重复顺序、重复引用；
- 缺失题库、缺失题目、题库归属不一致、安全删除题目；
- `totalCount` 与引用数量差异；
- 同 ID 草稿或发布记录冲突；
- 是否允许 `create`、`copy` 或 `replace_draft`；
- 用于确认请求的规范化 payload hash。

`sourceBanks` 仅用于展示和辅助诊断。实际导入范围由 `paper.questions` 中的引用决定。

试卷包中的 `bankId`、`questionId` 是题库数据包的外部稳定身份，不假定等于数据库主键：

1. 先以 `QuestionBank.source_id = bankId` 查找；兼容旧数据时才回退到 `QuestionBank.id = bankId`；
2. 在已解析题库内以 `Question.source_id = questionId` 查找；兼容旧数据时才回退到 `Question.id = questionId`；
3. 找不到时返回缺失引用；
4. 在当前共享管理目录中命中多个同源题库时返回歧义冲突，禁止任意挑选；
5. 最终只把解析后的内部 `Question.id` 写入 `paper_questions`。

`programCompatibility` 与目标版本不一致时返回 warning；只要 schema 合约受支持就不以页面版本号作为唯一拒绝条件。

### 6.3 确认导入接口

`POST /papers/import`

请求包含：

- 原始试卷包；
- 预检 hash；
- `conflict_action`：`create`、`copy` 或 `replace_draft`；
- `expected_revision`：覆盖草稿时必填；
- `idempotency_key`。

行为：

- `create`：原 ID 不存在时保留包内 ID；
- `copy`：后端生成新 ID，并保留来源 ID 到导入元数据；
- `replace_draft`：只允许覆盖未发布草稿，且 revision 必须匹配；
- 已发布试卷禁止覆盖；
- 无论数据包携带何种历史状态，导入结果均为草稿，不自动创建发布版本；
- 数据包中的创建、更新和发布时间写入 `import_metadata`，系统审计时间使用真实导入时间；
- 不存在的 `categoryId` 返回 warning 并暂不绑定分类，原值保留在 `import_metadata`；
- 重新执行所有题目存在性和归属校验；
- 单事务写入试卷和全部有序引用；
- 任何校验或写入失败均不保留半成品；
- 同一幂等键重复提交返回第一次成功结果。

## 7. 平行组卷规则

### 7.1 请求模型

每个批次支持一个或多个变体，本期 UI 默认 A/B/C：

```json
{
  "subject": "PMP",
  "bankIds": ["b_internal_x", "b_internal_y"],
  "filters": {},
  "variants": [
    {"code": "A", "name": "PMP 模拟卷 A", "totalCount": 60},
    {"code": "B", "name": "PMP 模拟卷 B", "totalCount": 50},
    {"code": "C", "name": "PMP 模拟卷 C", "totalCount": 40}
  ],
  "hardQuota": {
    "dimensionId": "exam-domain",
    "weights": {"people": 42, "process": 50, "business-environment": 8}
  },
  "softQuota": {
    "dimensionId": "performance-domain",
    "weights": {}
  },
  "randomSeed": "server-or-user-seed"
}
```

一键组卷使用 PMP 默认硬配额 42% / 50% / 8% 和系统默认软目标；自定义组卷允许分别调整变体题量、候选题库、筛选条件和允许开放的配额配置。

### 7.2 配额换算

每套卷独立使用最大余数法：

1. 计算 `totalCount * weight / weightSum`；
2. 先取各项整数部分；
3. 剩余名额按小数余数从大到小分配；
4. 稳定并列顺序由维度配置顺序决定；
5. 最终各项之和必须严格等于该卷 `totalCount`。

因此 A/B/C 题量不同时仍共享同一比例模板，但得到各自准确的整数配额。

### 7.3 候选池与分类

候选池为：指定内部题库 ID 中的有效题目，应用科目、题型、难度等当前筛选条件后所得集合。组卷分类读取 `questions.metadata.subjectFacets`，兼容 facet 的 `dimensionId/valueId` 以及标准 `facetId` 路径表达。

- `exam-domain` 使用规范值 `people`、`process`、`business-environment`；旧值 `environment` 归一为 `business-environment`，不能重复计算；
- 缺少 `exam-domain` 分类的题目不进入硬配额候选池，并在预检中单独统计；
- `performance-domain` 支持现有别名规范化，例如 financial → finance、resources → resource、stakeholders → stakeholder；
- 同一道题可以同时贡献一个硬维度和一个软维度计数，但总题量只计算一次。

### 7.4 选题顺序

组卷过程使用确定性随机种子，以便预检和确认可重现：

1. 以 `SHA-256(seed + bank_id + question_id)` 生成稳定排序键，对候选池做可重现打散；
2. 按 A、B、C 请求顺序处理变体；
3. 优先选择能补足当前硬配额缺口的题目；
4. 在不破坏硬配额时，以软配额缺口作为加分项；
5. 某题被任一变体选中后，立即加入批次已用集合；
6. 后续变体不能再次选择相同 `question_id`；
7. 最终按生成顺序形成 1..N 的题目顺序。

硬配额不可跨领域借题。软目标为 best-effort，结果必须返回目标值、实际值和偏差。

## 8. 预检、部分可行与事务创建

### 8.1 组卷预检

`POST /papers/composition/preflight`

预检不写数据库，返回：

- 规范化请求和随机种子；
- 总候选数量、未分类数量；
- 每个硬/软维度的库存；
- 每套卷的目标配额、预计引用、实际配额和偏差；
- 每套卷 `feasible` 状态和具体缺口；
- 批次内重复检查结果；
- 可提交的变体集合；
- 规范化计划 hash。

预检按完整批次顺序计算。若前一套卷占用题目导致后一套不可行，结果必须反映真实顺序，不能为各套卷独立计算后错误声称全部可行。

### 8.2 用户选择

- 全部可行：默认提交全部。
- 存在不可行变体：页面不自动写入，提供“全部取消”和“只生成可行试卷”。
- 选择只生成可行试卷时，前端以所选变体重新调用预检，避免直接复用删除变体前的旧分配结果。

### 8.3 正式创建

`POST /papers/composition/batches`

请求包含最终预检配置、计划 hash、选择的变体和幂等键。后端在单事务中：

1. 重新读取和校验所有题目；
2. 使用相同种子重算计划并核对 hash；
3. 校验题目未删除、归属未变化、配额仍满足且跨卷无重复；
4. 创建批次；
5. 创建所有选中试卷草稿；
6. 批量创建全部题目引用；
7. 提交事务。

任何技术错误、并发删除、计划变化或约束失败都回滚所选批次全部写入。系统不支持在正式事务失败后只留下部分成功试卷。

## 9. 页面设计

`paper-management.html` 保持现有页面结构和视觉风格，新增两个主入口。

### 9.1 导入试卷

流程：选择 JSON → 调用预检 → 展示摘要和错误/警告 → 选择冲突策略 → 确认导入 → 刷新 API 列表。

预览至少显示：

- 内部试卷名称、ID、科目、题量和状态；
- 实际引用题库数量；
- 缺失题库/题目及归属错误；
- 顺序和重复问题；
- 文件名与内部名称差异；
- 同 ID 冲突及可执行操作。

### 9.2 组卷

组卷弹窗提供：

- 一键组卷和自定义组卷；
- A/B/C 启用开关、名称和独立题量；
- 候选题库与当前筛选条件；
- 默认或自定义配额；
- 预检结果表，展示每套卷可行性、硬配额和软目标偏差；
- 库存不足时的取消或重新预检可行集合；
- 正式创建期间禁止重复提交。

弹窗输入和预览可以保存在页内内存中作为瞬时交互状态，但不得作为业务持久化或刷新恢复来源。

### 9.3 公共 API 适配器

试卷列表、详情、保存、分类、导入和组卷统一放入公共 paper API adapter/repository。页面不得复制 fetch、冲突处理或响应规范化逻辑。发布接口继续走现有 release adapter，但草稿与发布的映射由公共试卷领域模块统一维护。

## 10. runtime 数据迁移与切流

扩展现有试卷迁移能力，提供 dry-run 和 apply：

1. 扫描当前共享试卷草稿、分类和题目引用；
2. 映射全部可承载字段，保留 paper ID、category、order、score、状态、发布时间和发布关联；
3. 对每条题目引用校验关系题库；
4. 生成来源数、目标数、缺失引用和冲突报告；
5. apply 使用事务和幂等键，重复执行不会产生重复行；
6. 已有关系数据优先，不使用旧 runtime 数据静默覆盖更新版本；
7. 核验通过后，将 `paper-management.html` 切换为只读写领域 API；
8. 不双写，不提供 runtime fallback。

历史 runtime 内容可以保留到项目整体 runtime 迁移完成，但不再进入试卷日常请求链路。

## 11. 错误、权限与并发

- 400：schema、字段、顺序、分值或请求配置非法；
- 403：角色无权限；
- 404：草稿、题库或题目不存在；
- 409：paper ID、revision、幂等键或预检计划冲突；
- 422：引用缺失、题库归属错误、硬配额或库存不可满足；
- 500：事务失败，响应不得伪装成部分成功。

管理员和教师共享试卷管理数据，但每次写入记录操作者。覆盖草稿、替换题目列表、导入覆盖和批次创建必须在 service 层实现事务；API 路由只负责参数、权限和响应编排。

## 12. 测试策略

### 12.1 后端单元与 API 测试

- 最大余数法：不同总题量、并列余数和权重归一化；
- 硬配额、软目标、别名规范化和未分类排除；
- A/B/C 不同题量及批次内零重复；
- 顺序处理导致的真实容量不足；
- 固定种子可重现；
- 试卷 CRUD、分类、revision 冲突和共享权限；
- 99 条试卷包顺序、分值和引用保持；
- schema 错误、缺题、归属错误、重复引用和题量不一致；
- create/copy/replace_draft 及已发布禁止覆盖；
- 幂等提交；
- 用户选择可行试卷后重新预检；
- 批次中途故障时批次、试卷和引用全部回滚；
- runtime 迁移 dry-run、apply、幂等与冲突报告。

### 12.2 前端测试

- 公共 adapter 的请求和 400/403/409/422/500 处理；
- 页面不再调用试卷 runtime state；
- 导入预检、名称差异、缺失引用和冲突策略；
- 一键/自定义组卷、独立题量、预检结果和部分可行选择；
- 正式提交按钮防重复；
- 刷新后从 API 恢复数据。

### 12.3 浏览器与发布验证

- teacher/admin 登录、导入、组卷、编辑、刷新、发布和撤回；
- student/viewer 权限拒绝；
- 网络请求中试卷草稿不存在 runtime state 读写；
- console 无错误，失败提示包含可操作信息；
- 正式发布前核对 candidate 与 active release 文件数量及关键页面；
- 只通过 `manage-new-legacy.js update new-legacy --skip-browser` 构建和 promote，不手改生成物或 active release。

## 13. 实施顺序

1. 以失败测试冻结草稿、导入和组卷合约。
2. Alembic 与模型扩展。
3. 公共配额/组卷算法 service。
4. 草稿、分类、导入和批次 API。
5. 一次性迁移与核验。
6. 前端公共 paper adapter。
7. `paper-management.html` 导入和组卷 UI。
8. 删除试卷 runtime 读写与 fallback。
9. 后端、前端、浏览器和发布验证。

## 14. 完成定义

- 本文成功标准全部有自动化或浏览器证据。
- 样本试卷包能在题库数据齐备后成功导入为 99 条有序引用。
- A/B/C 在不同题量下满足硬配额并且批次内题目不重复。
- 预检库存不足不会写入；正式创建失败不会留下部分试卷。
- 试卷管理刷新后数据完整，且不依赖 runtime state。
- 迁移报告数量一致或所有差异均被明确处理。
- source、sync 产物、candidate 和 active release 一致。
- 功能完成后合入 `main`、推送远端并清理功能分支。
