# new-legacy 变更记录（审计用）

按版本号倒序记录每次迭代的更新内容。每次功能合并/发布时同步更新本文件并随发布一起提交。
（本文件自 v9.0-p4.1.90 起补录；更早历史见 git log。）

## 进行中（feat/runtime-state-to-domain-apis 分支 · 2026-08-19，未发布）

- **单机版功能回补第 2 轮：题目编辑体验三件套（2026-08-21，v9.0-p4.1.126）**：新增 `content-prep-studio/src/js/21-question-edit-extras.js` 并接入 20-page-runtime——①公共标签专用编辑器（勾选式 catalog 同步 q.tags 与结构化 tagPaths，未归类标签可删，tagCatalogEntries/semanticTagSlot/effectiveTagGroups 全部复用 B 版实现）；②辅助知识点关联编辑（knowledgeTreeMatches 搜索 + relatedNodeSelect 下拉 + chips 移除，写 metadata.knowledge.relatedNodeIds）；③粘性浮动题目预览（questionPreviewFloat 可拖拽/resize、Esc 关闭、双击题目列表打开，renderPreview 双目标渲染）与题目列表顶部收起（btnToggleQuestionListTop/top-collapsed）。样式随 app.css，模板接入 questionListCard 结构。浏览器 E2E：24 个标签勾选位、316 个辅助知识点可选、双击开浮窗、收起生效，0 页面错误。第 3 轮（开发日志/审计导入等小件）待做。

- **单机版功能回补第 1 轮：题目补充（Supplement）模块移植（2026-08-21，v9.0-p4.1.125）**：新增 `content-prep-studio/src/js/17-question-supplement.js`——补录模板导出（`pmp-question-supplement-v1` 契约与单机版 P4.5.29 逐行一致，模板互通）、按 Question ID 合并（fill-empty / overwrite 双策略、锁定字段保护、UNION 数组路径、supplementHistory 落戳最近 50 条）、合并明细报告面板、supplement-import 审计事件；UI（补录 filebox + 策略下拉）与样式（.supplement-box/.supplement-report）随模板与 app.css 落地。合并后经 normalizeQuestion/recomputeKeywordLocations/syncQuestionPrinciples 走 B 版规范化（principleIds 按服务器原则注册表过滤属预期）。浏览器 E2E：60 题题库导入 → 模板导出 60 → 3 题补录 3/3 匹配更新、非空冲突保留本机、历史落戳正确。前后端测试全绿（前端 188/190，2 项为已知本机环境失败）。单机版差异分析与补齐计划见本轮对话记录；后续第 2 轮（标签编辑器/知识点关联 UI/浮动预览）、第 3 轮（小件收尾）待做。

- **runtime 通用 KV 退役一次性切换（2026-08-20，设计 §11）**：业务数据已全部走领域 API（dev 库 runtime_states 仅剩 65 个已处置键：设备偏好/一次性标记/旧镜像/测试内容），本切换关闭旧通道——①前端 `server-state-bootstrap.js` 转本地模式（`REMOTE_SYNC=false`）：初始化仍 GET bootstrap 一次做下拉迁移（老用户服务器侧偏好落到本机 localStorage，之后服务器只读不动），所有读写只走浏览器，PUT/beacon 不再发出，保存事件直接报"已保存"；`clear()` 保留 browserOnlyKeys（含认证会话）。②后端新增 `RUNTIME_SYNC_DISABLED`（默认 true）：PUT/POST /runtime/state 变为 drain——鉴权后回当前 revision/contentRevision 的成功响应但不落库（旧缓存页无保存失败提示）；GET bootstrap 保留只读供下拉迁移与旧页兼容。③测试：新增 drain 行为测试（写入被接收即弃、revision 不动、旧值不被覆盖）；conftest 显式 `RUNTIME_SYNC_DISABLED=false` 保持既有持久化测试原语义；runtime 相关 81 项全绿。浏览器遍历 9 页：偏好写入只落本机（native=bilingual）服务器保持旧值（zh）、登录/退出正常、0 页面错误。**已知既有问题（与本次无关，stash 基线复现）**：test_question_import 2 项（banks questions 空校验）、test_question_pool_cleanup 6 项（POSIX symlink/inode 语义）、test_question_api_compatibility 并发用例本机 Windows 死锁，均待单独处理。账本第 3 轮处置见 `docs/runtime-ledger-disposition-proposal-2026-08-20.md`（0 unknown，drop-check 绿灯但未执行 DDL）。

- **P4.6 第 2 轮 R2-2/R2-3：迁移遗留收口 + 发布大键全量退场**：
  - taxonomy 迁移支持多科目源（按 subjectId 分组，dev 库 5 科目/6 taxonomy/333 节点全部落库）；发布历史键迁移成功（6 条历史版本，superseded 状态正确）。
  - verify 修复：历史条目与当前目录键重叠的 release（教师重发同版本）改由目录条目权威校验，历史侧只比对"仅存在于历史"的部分；`_read_teaching_canonical` 适配新归一化结构。四个领域键（发布目录/发布历史/taxonomy/联想库）全部 verified；剩余 48 项 pending 为设计内 unknown 处置（等第 3 轮显式决策后 drop）。
  - questions namespace（题库管理页）剔除最后两个发布大键——至此**所有 namespace 的 bootstrap 均不再下发 `kg_exam_papers_published_v1`/`kg_exam_paper_release_history_v1`**；65 的试卷列表本就来自教师共享试卷键，发布目录改由 API 提供。浏览器遍历 question-bank/paper-management 无报错。
  - 性能门禁更新：新增"无任何 namespace 下发发布大键"断言；后端 19 项相关测试全绿。

- **P4.6 第 2 轮 R2-1：教师发布/撤回切换 paper-releases API**（打通"教师发布 → 学员立即可见"闭环）：
  - 后端新增 `POST /paper-releases/publish-payload`（按载荷发布：复用迁移同款归一化校验，发布者以登录账号为准，先 supersede 同试卷旧 active 再插入，避开"每试卷仅一个 active"部分唯一索引）与 `POST /paper-releases/papers/{id}/withdraw-all`（按试卷下架全部 active 版本）。
  - 65-question-bank-admin 的 `publishPaperRelease`/`withdrawPaperRelease` 改为 API 权威 + 旧 runtime 目录尽力双写（供未切换的管理视图过渡）；发布/撤回成功后广播 `kg:paper-release-published`，paper-release-adapter 收到后自动重载学员目录。5 处调用点（发布/取消发布/归档/删除/批量归档）异步化，失败给出明确 toast 且不再落旧目录。
  - 测试：后端 `test_paper_release_publish_payload.py` 4 项（发布/重复 409/缺快照 422/新旧版本 supersede/撤回后学员不可见）；浏览器端到端验证发布→学员目录可见→撤回全通。

- **P4.6 第 1 轮性能优化：练题链路发布试卷切换到细粒度 API**（解决线上整包拉取 7.65MB `kg_exam_papers_published_v1` 导致的卡顿）：
  - 新增 `paper-release-adapter.js`（注入 practice-mode/question-workspace/knowledge-recall/index 四页，先于 59-repository）：轻量目录 `GET /paper-releases/catalog` 分页预取（KB 级），题目按 release `GET /paper-releases/{id}/questions` 分页取冻结快照（服务端单响应 1MB 上限）；载入完成沿用 `kg:published-papers-changed`/`kg-app-storage-change` 旧失效协议广播，页面既有监听器直接复用；401 派发 `kg:auth-required`。
  - `59-published-paper-repository.js` 重写为 v3：目录接口同步读 adapter 缓存，`resolvePublishedPaper`/`listPublishedPapers`/`findQuestion`/`listCollections` 改异步按 release 解析；新增同步 `peekResolved`/`findQuestionCached`/`prefetchMissing` 供深度同步的旧消费者（60-question-bank）过渡使用；不再读取 runtime localStorage 键。
  - 消费方异步化：59a-resolver 转发层 async；practice-mode `startPractice` await 解析；workspace `loadPublishedPapers`/`buildQuestionList` 缓存化 + `rebuildQuestionSources`；深度回忆 96 源改缓存 + 异步 `rebuild`（新增 `kg:recall-source-updated` 事件驱动 86 页重渲染），`loadQuestion`/`activate`/`switchQuestion` await；60-question-bank 三处 repo 调用改同步 peek + 后台预取。
  - 后端 bootstrap 减重：practice/workspace/recall namespace 剔除 `kg_exam_papers_published_v1`/`kg_exam_paper_release_history_v1`（题库管理页 questions namespace 暂保留，第 2 轮切换）。
  - 性能门禁测试：后端 `test_paper_release_perf_gate.py`（4 项：学习 namespace 不下发大键、bootstrap 载荷无发布快照、管理页保留断言、catalog 分页 + 1MB 上限）；前端 `paper-release-adapter.test.mjs`（11 项：分页模式、不写 localStorage、事件协议、repo 不读 runtime 键、四页注入恰一次）。
  - 顺带修复：direct-admin-adapter `refreshed()` 分页 `...result` 覆盖新建用户回归（a3dd91f 引入）；practice-learning-contract/recall-p45-contract 3 处 P4.5.37 后过时断言对齐（answer 签名、防抖 1200ms、flashKrOption 闪烁标记）。
  - 浏览器遍历验证（Playwright，8011 静态 + API 代理）中发现并修复：① catalog `allowed_roles=[]`（不限制）被 contains 过滤掉 → 服务端补空数组放行；② 深度回忆 96 源 `rebuild()` 并发守卫返回空缓存 → 改为复用重建 Promise；③ 86 `loadQuestion` 列表为空时未等 rebuild → 显式 await；④ 深度回忆会话/进度请求未带 releaseId，服务端按题库查不到冻结快照 404 → 99-adapter 与 86 补传 releaseId。四页终验：practice 卡片渲染 + 开始练习按 release 取题、workspace 44 选项、recall 真实题干 1/60 + 21 关键词 + 进度 saved、bootstrap 载荷均无发布大键。
  - 迁移工具链修复：alembic e5b9c3d7a120 置 NULL 先于改 nullable 的顺序 bug；runtime_domain_migration 失败分支 rollback 后访问过期 ORM 属性触发 MissingGreenlet（记录 id + 重查剩余条目）；teaching 映射器 `updated_by='shared'` 违反 users 外键（shared 归 None）。开发库已实跑迁移：2 个 active release（各 60 题）入 paper_releases；遗留 known-issue：`kg_content_taxonomies_v1`（多科目源）与 `kg_exam_paper_release_history_v1`（autoflush 连带）两键迁移失败，属第 2 轮教学内容域收口范围。
- 恢复页面内联 `window.__KG_DIRECT_BOOTSTRAP__` 会话元数据注入（a3dd91f 移除导致后端 test_web_runtime 3 项、e2e 与 content-prep 版本读取全部失效）：`html.py` 重新注入轻量元数据（authUser/loginSessionId/revision/contentRevision，**不内联 storage**，MB 级试卷键仍走 bootstrap API），content-prep 页保持例外（缓存 + /me 水合）。前端 `server-state-bootstrap.js` 消费注入 payload 初始化 entry 并在 `/me` 校正时保留服务端注入的 revision。
- 修复 practice-mode namespace 回归：`PAGE_NAMESPACES` 误加 `practice` 与前端派发 `page` 不一致，导致做题页 runtime 保存被 422 拒绝；移除该条目恢复默认 `page`。
- 用户管理页账号镜像 `_seed_users` 改为全量账号（原先只装 owner+admin，旧 UI 首屏缺 teacher/student/viewer）。
- runtime domain migration 账本收口：unknown 处置项保持 `pending` 等待显式决策（不再 scan 即 failed）；`migrate`/`verify` 报告全链路保留 `source_snapshot_payload`（drop 门禁在运行时表清空后仍可回验快照）；scan 报告补 `source_snapshot_hash`。
- 测试对齐现架构：direct-runtime/online-qa/wechat-pay/new-legacy-sync 共 14 处过时断言更新（`__KG_DIRECT_BOOTSTRAP__` 消费、snapshotMode `merge` 协议、direct-entry 事件化登录、tour/support 版本读取、preview 不再注入 runtime flush、isAuthenticated 同步化、Windows 路径分隔符）；sync 错误消息改用归一化路径。前端 113 项 + 权益适配器 + 2 项集成测试全绿。

## v9.0-p4.1.101（2026-08-16 · P4.5.37）

- 多题画布空白处右键菜单与首页/深度回忆为同一组件（此前已具备），菜单项文案"刷新"统一改为"文字高清"（三页一致）。
- 作答机制重构：本地判题即时反馈 + 异步队列同步——点击选项后立即按发布快照判题闪烁/选中/完成标记（不再等待服务端往返）；服务端记录（错题本/进度）进入队列：空闲 2.5s 批量按序提交、pagehide/beforeunload/页面隐藏时 flush（keepalive 请求可存活于卸载）、失败保留"作答尚未保存"+重试并自动重试。
- 深度回忆：进度保存防抖 420→1200ms（降低高频写库）；右上角保存状态提醒默认隐藏，仅失败/冲突时显示（保留重试入口）。

## v9.0-p4.1.100（2026-08-16 · P4.5.36）

- 解析面板内滚轮改为滚动面板内容（原先会触发画布缩放）：多题画布 `wheel` 守卫放行 `.qw-analysis-panel`，深度回忆同步修正，两页行为一致。

## v9.0-p4.1.99（2026-08-16 · P4.5.35）

- 取消作答提交期间的字母按钮禁用（禁用触发 `:disabled cursor:wait` 漏斗光标）：与深度回忆一致全程 `pointer` 可交互，防重复由 `submitPracticeAnswer` 的 pending promise 去重保证。
- 解析面板新增"原则解析"段与"显示内容"勾选项（共 7 项）：显示题目关联原则（正确选项 `optionPrincipleMap` 优先、`principleIds` 兜底）的做题原则——原则名 + 启用中预设归纳卡内容。

## v9.0-p4.1.98（2026-08-16 · P4.5.34）

- 多题画布题目卡新增试卷内题号徽标（`paperIndex+1/N`，与深度回忆同款圆角矩形样式）。
- 取消作答时"正在保存作答…"常驻提示（防重复禁用与失败重试保留）。
- 解析按钮贴题目卡右下角；`positionAnalysisPanels` 视口感知：右侧放不下自动翻左侧，修复"显示内容"按钮定位到屏幕外点不到。
- 框选生成归纳卡不再弹编辑弹窗，直接创建并聚焦。
- 归纳卡"练习+星级"按钮整组居中，练习按钮加宽（min-width 148px）。
- 归纳卡内容规则：正确选项原则一致之外放宽为所选题目 `principleIds` 交集命中预设即带入；预设默认以"我的归纳卡"复制落地（编辑只写个人卡不回写后台），个人卡服务不可用降级为只读系统卡；无共同原则生成空白卡。

## v9.0-p4.1.97（2026-08-15 · 远端并行合入）

- Prep Studio 核心关键词缺少解题作用降级为提醒 + 主知识点搜索过滤（feat/prep-studio-core-kw-validation）。

## v9.0-p4.1.95（2026-08-15 · P4.5.33）

- 修复解析面板"点复选框整个下拉菜单消失"：勾选后只刷新内容区（`refreshKrAnalysisPanelContents`，不重建 details）；点击下拉外部才收起。
- 解析内容映射增强：知识点在 concepts 为空时按关键词 `recallNodeId` 从联想库自动解析（零额外录入）；核心关键词优先显示 `isCore` 标记项；选项提示为错误项 `trap` 解释。
- 题目序号徽标改圆角矩形底纹完整覆盖 n/N；换专属类名 `kr-question-order-badge`（避免与题目库抽屉既有类名冲突被压扁）。

## v9.0-p4.1.94（2026-08-15 · P4.5.32 + 远端进展合并）

- 深度回忆：取消选项作答选中视觉（点击只闪对错，闪烁后恢复原色，与多题画布共用 question-workspace.css 单一来源）。
- 修复解析面板"显示内容"点击无效（面板溢出视口 → 视口感知定位右侧放不下翻左侧；画布 pan 守卫放行面板内交互）；解析按钮移至题目卡右下角。
- 初始载入始终聚焦题目卡（居中）；题目卡显示本试卷内序号徽标；切题/初始时题目卡从左上滑入缓停动画（cubic-bezier(.22,1,.36,1)，reduced-motion 降级）。
- （远端并行）关键词联想四层兜底匹配、画布进入居中、核心理由降级提醒。

## v9.0-p4.1.92（2026-08-15 · P4.5.31）

- 联想库发布/预览接通服务器：修复深度回忆关键词卡牌只显示 recallNodeId 的根因——管理台"发布"与内容中心"保存"原先只写浏览器 localStorage，从未到达服务器 SharedRuntimeState，而深度回忆会话只读服务器快照。
- `KGRecallAssociationLibrary` 新增 `readServer`/`writeServer`（GET/PUT /content-prep/shared-content，乐观锁 + 409 冲突识别）；管理台空本地时回填服务器库；教师草稿预览本地无库时从服务器兜底。
- 数据侧：PMP 科目级联想库 471 节点/2840 边经 API 写入服务器。

## v9.0-p4.1.91（2026-08-15 · P4.5.30）

- 深度回忆选项与解析对齐多题画布：kr 页整文件引入 question-workspace.css 作为样式单一来源；选项改 `qw-card-option-key` 字母按钮结构（单击 230ms 延迟判题绿/红闪 560/430ms、双击正确项常绿、作答状态随进度持久化），判题仍走本地。
- 关键词 token 左右 padding 归零（与相邻文字间距一致，高亮贴合文字宽度）。
- 题目卡底部新增解析按钮与 `qw-analysis-panel` 解析面板，显示内容勾选偏好与多题画布共用同一 localStorage key（两页互通）。
