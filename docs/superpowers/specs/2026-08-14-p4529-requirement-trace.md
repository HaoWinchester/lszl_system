# P4.5.29 Prep Studio 服务器整合 · Requirement Trace

依据：`修改需求/P4.5.29_服务器整合_实施冻结版_Implementation_Baseline_v1_待ActiveAudit.xlsx` 的「Prep Studio差异」页 + `docs/superpowers/specs/2026-08-14-content-prep-p4529-server-integration-design.md`。

规则：任何一项无测试证据不得标记完成。状态取值 `DONE / PARTIAL / MISSING / PROTECT`（对齐冻结表 Phase 0B 语义）。

| # | 能力 | 状态 | UI 控件 | 领域函数/实现 | API | 正向测试 | 负向测试 | 恢复测试 |
|---|---|---|---|---|---|---|---|---|
| 1 | 联想入口手动输入模糊搜索 | DONE | 关键词浮窗 `#floatRecallSearch` | `recallSearchNodes`/`fuzzySubsequenceMatch`/`recallFilteredOptions`（10-state-domain.js） | GET /api/v1/content-prep/recall-library | tests/test_recall_binding.js（中文/英文/Alias/ID/子序列命中） | 同上（无匹配提示） | 同上（清空恢复全量下拉） |
| 2 | 按中文名/英文名/Alias/Recall ID 搜索 | DONE | 同上 | 同上 | 同上 | 同上 | 同上 | 同上 |
| 3 | Recall 可空，仅无效 ID 报错 | DONE | 关键词浮窗联想下拉 | 校验逻辑（10-state-domain.js）；后端校验 | POST /content-prep/drafts/sync（服务器校验） | tests/test_recall_binding.js（空值合法） | 同上（非空缺失 ID 为 error） | backend/tests/test_content_prep_recall_binding.py |
| 4 | 关键词位置题干/选项来源隔离重算 | DONE | — | `recomputeKeywordLocations`（10-state-domain.js） | — | tests/test_recall_binding.js（来源隔离） | 同上（跨来源不串位） | 同上 |
| 5 | 同词跨来源独立 clue | DONE | — | 同上 | — | tests/test_recall_binding.js | 同上 | 同上 |
| 6 | 双原则包格式 kg-v1 / pmp-v1 | DONE | `#filePrincipleCardBundle` | `canonicalPrincipleDomain`（14-principle-bundle-domain.js） | GET/PUT /content-prep/shared-content | tests/test_principle_bundle_domain.js + v90-p4529-principle-safe-merge-browser.py（双格式） | 同上（未知 format 拒绝且状态不变） | 同上（合并保留现有） |
| 7 | 旧原则库/旧归纳卡 JSON 单独迁移 | DONE | `#filePrincipleCardBundle` | `canonicalPrincipleDomain`（legacy-* 分支） | 同上 | tests/test_principle_bundle_domain.js（legacy-principle-library / legacy-synthesis-presets） | 同上（非对象/缺 items 拒绝） | 浏览器 E2E（旧库合并不清归纳卡） |
| 8 | 原则与归纳卡安全合并 | DONE | `#filePrincipleCardBundle` 冲突 confirm 流程 | `planPrincipleMerge`/`applyPrincipleMergePlan`（14-principle-bundle-domain.js） | POST/PUT/DELETE /content-prep/principles（删除引用阻断 409 PRINCIPLE_IN_USE） | tests/test_principle_bundle_domain.js（Added/Unchanged/Conflict 三分类） | 同上（同 ID 改名/同名不同 ID/preset 改绑默认不覆盖）+ backend/tests/test_content_prep_shared_content.py（403/409） | 同上（take-incoming 显式裁决才覆盖）+ v90-p4529-principle-safe-merge-browser.py |
| 9 | Subject Facets 系统 | DONE | base 页 `#subjectFacetManager`（含"从服务器拉取/推送到服务器"） | `facetSchemaForSubject`/`facetCatalog`/`facetIdFor` + 46-server-p45-adapter.js | GET/PUT /content-prep/subject-facets | v90-p4529-facet-binding-browser.py（服务器加载） | 同上（409 revision 冲突拒绝覆盖并刷新最新） | 同上（conflict 后 UI 提示重新确认） |
| 10 | Facet Registry 导入/编辑/校验/导出 | DONE | `#fileFacetSchema` 导入 / `#btnExportCurrentFacetSchema` 导出 / 管理器展示维度取值 | `normalizeFacetSchema`/`importFacetSchema`（12-p45-authoring-domain.js） | 同上（推送带历史 ID 保护） | tests/test_p45_facets.js（导入按 subjectId 替换）+ 浏览器 E2E（pmp-facet-schema-v1 导入） | 同上（缺 schemaId/subjectId/dimensions 报错） | 同上 |
| 11 | 题目绑定 Subject Facets | DONE | 题目编辑区 `#questionFacetBindingPanel` 复选 + 清除未知引用 | `normalizeQuestionFacets`/`selectedFacetsFromIds` | — | tests/test_p45_facets.js（稳定 facetId 绑定/去重） | 同上（未知引用 error 阻断） | 浏览器 E2E（清除后错误恢复） |
| 12 | Question Family v1 | DONE | 题目编辑区 `#questionFamilyPanel` | `normalizeQuestionFamily`/`questionFamily`/`resolveQuestionFamilies`（12-p45-authoring-domain.js） | —（元数据随批次同步） | tests/test_p45_family.js（三角色归一） | 同上（角色非法归 standalone） | v90-p4529-question-family-browser.py |
| 13 | 母题/成员/独立题角色 | DONE | `#qfRole` 角色选择 | 同上 + `makeQuestionFamilyRoot`/`makeQuestionStandalone`/`makeQuestionFamilyMember` | — | tests/test_p45_family.js（角色绑定） | 同上 | 同上 |
| 14 | 等价/拆解/扩展家族关系 | DONE | `#qfRelation`/`#qfVariant` | `normalizeFamilyRelation`/`normalizeFamilyVariantType` | POST /content-prep/batches（FAMILY_MEMBER_RELATION_INVALID 阻断） | tests/test_p45_family.js（关系归一） | backend/tests/test_content_prep_question_family.py（非法关系 422） | 同上 |
| 15 | A/B/C 等价等级、diagnosticTarget、L1-L4 | DONE | `#qfGrade`/`#qfTarget`/`#qfLevel` | `normalizeEquivalenceGrade`/`normalizeDiagnosticTarget`/difficultyLevel 1–4 clamp | 同上（FAMILY_LEVEL_INVALID） | tests/test_p45_family.js | 同上（层级越界阻断） | 同上 |
| 16 | 用途多选 + 人工质量确认 | DONE | `[data-qf-purpose]` 多选 + `#qfConfirmed` | `normalizeFamilyPurposes`/`forceExternalFamilyUnconfirmed`（stampImportedQuestions 强制 false） | POST /content-prep/batches（外部批次强制归零） | tests/test_p45_family.js（外部归零） | backend/tests/test_content_prep_question_family.py（true→false） | 同上 |
| 17 | 从母题创建家族成员 | DONE | `#btnCreateFamilyMember` | `makeQuestionFamilyMember` + `QuestionService.duplicatePayload` | — | v90-p4529-question-family-browser.py（默认等价 A 级未确认） | — | — |
| 18 | 家族 JSON 模板 + AI 提示词 | DONE | `#btnDownloadFamilyTemplate`/`#btnDownloadFamilyAiPrompt` | QUESTION_FAMILY_TEMPLATE/QUESTION_FAMILY_AI_PROMPT（00-core-bootstrap.js） | — | 模板下载含 6 题最低覆盖结构 | — | — |
| 19 | 家族最低覆盖检查 | DONE | 家族面板就绪提示条 | `familyCoverageFor`（coverage/complete/ready） | —（Root-only 合法） | tests/test_p45_family.js（Root-only 只 warn；补齐 complete；确认 ready） | 同上 | v90-p4529-question-family-browser.py（Root-only warn 不增 error） |
| 20 | 家族导航/页签/视觉识别 | DONE | 列表 `【母题】/【成员·A】` 徽章 + `#btnGoFamilyRoot`/成员链接 | renderQuestionListOnly + renderQuestionFamilyEditor | — | v90-p4529-question-family-browser.py（徽章+跳转） | — | — |
| 21 | 三档难度与 L1-L4 分离 | DONE | 编辑器 `#difficulty` 三档下拉（简单/中等/困难） | `normalizeQuestionDifficulty`（前端）+ `normalize_difficulty`（backend question_content_service） | POST /content-prep/batches（归一后入库） | tests/test_p45_difficulty_tags.js + backend test_question_content_service.py（12 组别名参数化） | 同上（旧“基础”/L1–L4 误写只迁移不报错） | v90-p4529-difficulty-global-tags-browser.py（旧题库导入迁移） |
| 22 | Workspace 自动保存（映射共享草稿） | MISSING(G5) | | | | | | |
| 23 | 自动恢复上次工作区（从数据库） | MISSING(G5) | | | | | | |
| 24 | 手动保存/恢复/删除 Workspace | MISSING(G5) | `#btnQuickSaveWorkspace`/`#btnSaveWorkspaceLocal`（待接 syncWorkspaceToServer） | | | new-legacy/tests/content-prep-question-bank-integration.test.js（RED 已就位） | | |
| 25 | Workspace 保存范围（题库/知识树/Recall/原则/归纳卡/标签/位置） | PARTIAL(G5) | | WorkspaceService.currentPayload | | | | |
| 26 | Global Tag 语义 ID global/... + 兼容旧 ID | DONE | 标签管理器（槽位显示 global/...） | TAG_SLOT_SEMANTIC_MAP 升级 global-semantic-v1 / schemaVersion 3（00+10） | PUT /shared-content（tagConfig 内部 global 单真源） | tests/test_p45_difficulty_tags.js + tests/test_tag_migration.js（往返） | 同上（未知槽位原样保留不猜） | v90-p4529-difficulty-global-tags-browser.py（导出回退数字槽位） |
| 27 | 完整内容包携带 Facet Registry | DONE | — | completeBundlePayload 输出 subjectFacetRegistry（10-state-domain.js） | — | v90-p4529-facet-binding-browser.py（导出含 schema 快照） | 同上 | 同上 |
| 28 | 校验中心 Family 校验 | DONE | 校验中心 family 行（object=题目 ID） | `validateQuestionFamily` + `validateFamilyStructure` 接入 runValidation | POST /content-prep/batches（FAMILY_DUPLICATE_ROOT/FAMILY_MEMBER_ROOT_MISSING 硬 Gate） | tests/test_p45_family.js（孤儿成员 error/重复母题 error） | backend/tests/test_content_prep_question_family.py（422 阻断含跨 Bank 形态） | v90-p4529-question-family-browser.py（清除引用后恢复） |
| 29 | 校验中心 Facet 校验 | DONE | 校验中心 `#validationRows`（object=题目 ID 定位）+ 编辑区红色提示 | `validateQuestionFacets`（12-p45-authoring-domain.js）接入 runValidation | — | tests/test_p45_facets.js（无效 error/deprecated warning/有效无问题） | 同上 | 浏览器 E2E（清除未知引用后错误恢复） |
| 30 | 校验结果题目定位/跳转 | MISSING(G7) | | | | | | |
| 31 | 导出 programCompatibility 分层契约 | MISSING(G6) | | | | | | |
| 32 | deepRecallKeywordRevealPolicy=click-to-reveal-all-keywords | MISSING(G6) | | | | | | |
| 33 | 核心关键词仅用于重叠匹配优先级 | MISSING(G6) | | | | | | |
| 34 | Recall=optional-existing-id-only | PARTIAL(G6) | | 行为已实现（差异 3），policy 字段输出待 G6 | | | | |
| 35 | keywordLocationPolicy=source-isolated-derived | PARTIAL(G6) | | 行为已实现（差异 4），policy 字段输出待 G6 | | | | |
| 36 | 顶部版本分离 Product Release / Prep Build / Authoring Contract | MISSING(G6) | | | | | | |
| 37 | 显示当前 Product Release 与已测试 Contract | MISSING(G6) | | | | | | |
| 38 | 粘性题目预览/家族页签 | PARTIAL(G7) | 题目编辑区家族面板已加（G3）；粘性布局待 G7 | renderQuestionFamilyEditor | — | — | — | — |
| 39 | Delete 快捷删题 + 输入态保护 | MISSING(G7) | | | | | | |
| 40 | External AI Contract 覆盖 Family/Facet/Keyword v2 | MISSING(G3/G6) | | COMPLETE_AI_PROMPT 已含 external-ai-question-authoring-v1 雏形（P4.5.28 单文件） | | | | |
