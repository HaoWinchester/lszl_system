# v9.0 升级功能差异清单

> 对比基准：`new-legacy/`（中台 v8.6.29，CHANGELOG 实际停在 v8.6.1）→ `updata-legacy/`（上游 v9.0-p3.5.3）。
> 跨越 **v8.6.2 教师工作流（P0/P1/P2/P2.1/P2.2）+ v9.0（P0/P2/P3.x）** 两大阶段。两套版本号体系，差异以文件/功能 diff 为准。

## 概览

| 维度 | v8.6.29（现有） | v9.0-p3.5.3（updata） |
|---|---|---|
| HTML 页面 | 12 个 | 21 个（+9） |
| `src/*.js` | ~70 个 | ~94 个（+24） |
| `src/` 子目录 | 无 | `admin/` `canvas/` `cards/` |
| 独立模块目录 | 无 | `question-studio/` |
| `schemas/*.json` | 1 个 | 10 个 |
| localStorage 业务键 | ~45 | +37 |
| 管理后台 | 单页散落 | 八模块统一顶栏 |
| 试卷管理 | 题库内标签栏 | 独立页 + 发布链路 |
| 知识树 | 内嵌 | 版本化 + 引用保护 + 审计 |

---

## 一、教师工作台与三步工作流（v8.6.2 P0/P2）

- 教师首页重构为 **「管理题目 → 配置训练 → 设置课程」三步工作流**，统一教师工作台顶栏、导航、流程提示、视觉规范。
- 教师工作台不再默认暴露活动、Schema、学习任务、试卷等底层对象；旧录入中心、内容中心、高级题库工具收纳到「高级工具与兼容入口」。
- 页面：`teacher-workbench.html`（新）。存储键：`kg_teacher_workbench_subject_v1`。

## 二、题库与录题（v8.6.2 P2 + v9.0 P3.3/P3.4）

- 题库新增**默认简化模式**：只显示题库、题目列表、完整原题；高级能力（关键词、知识点、推理、组卷）收进「高级工具」，不删数据。
- 题目管理新增「**快捷粘贴 / 手动填写**」双入口；快捷粘贴支持 A/B/C/D、答案、解析格式，先解析预览校验再写入。
- **批量粘贴多题**：逐题展示解析状态，支持只导入有效题目、跳过重复题；ID 冲突时生成新 ID 不覆盖原题。
- **教师双语快捷录题**（P2.1）：标准双语单题/示例/批量/仅中文模板，中英文题干、A-D 选项、答案、双语解析、`中文|English->回忆入口` 关键词映射；模板下载/复制/示例查看，教师无需填内部 ID。
- **题目录入与分类交互**（P3.3 系列）：正式题目录入、批量录题默认分类、批量粘贴解析导航、批量完整预览、全宽工作区。
- **标签名称维护**（P3.3.4）：标签弹窗「管理标签」入口，双击预设标签原地改名，同步该用户全部正式题目并兼容旧模板/旧备份。
- **题目归属、批量移动与安全删除**（P3.4）：
  - 当前页复选 + 批量操作栏（默认最多 20 题）；批量改主要知识点、移入待分类、增删普通标签。
  - **安全删除**：正常题库/新组卷/默认候选隐藏，已有试卷、课程、历史答题仍可按原 ID 使用；「已删除题目」可恢复；永久删除逐题检查试卷/课程/答题/成绩/统计引用。
  - 分类、标签、删除、恢复、永久删除全部写操作记录（操作者、时间、批次号）。
  - 学员端默认题集不显示已删除题、不展示知识树/分类。
- 存储：`kg_question_banks_published_v1`、`kg_question_classification_collapsed_v1`、`kg_question_library_workspace_layout_v1`、`kg_question_tag_names_v1`、`kg_taxonomy_*`。

## 三、训练配置（v8.6.2 P2）

- 桌面端**左右工作区**：左侧题目定位 + 当前原题预览，右侧关键词、知识联想入口、科目共享联想库；窄屏自动单列。
- 节点配置与学员预览：单节点可视化编辑、候选增删、拖动/按钮排序、前 4 项实时预览。
- 科目级知识联想节点新增中文/English 名称、提问、提示字段（不改稳定节点 ID）；TXT/JSON 批量维护保留。

## 四、课程管理（v8.6.2 P2 + v9.0 P3）

- 课程设置**五步引导**：课程信息 → 学习顺序 → 选择内容 → 检查预览 → 发布；默认隐藏知识树/学习任务/试卷/导出/底层内容中心。
- 三栏对齐：左课程结构、中当前项编辑、右题目与训练内容库。结构三级显示序号（01 / 01.01 / 01.01.01），默认只展开当前阶段/章节。
- **批量工具**：三套内置学习模板（应用到当前章节/阶段/全部空章节，仅补缺不覆盖）；复制章节或阶段 1～20 份（新 ID，可选保留题目/训练引用）；按文本大纲追加结构（`# 阶段`/`## 章节`/`- 步骤|类型`）。
- **最近编辑面板**（每课程最近 30 条，可跳回对应项）、**课程检查面板**（结构错误/待配置/发布提醒，按类型筛选跳转）。
- 界面术语：「部分/节点/活动」→「章节/学习步骤/题目与训练内容」（底层稳定 ID 与引用不变）。
- 页面：`course-admin.html`（新）。存储：`kg_course_admin_workspace_v862_p1`、`kg_course_admin_recent_v862_p2`、`kg_course_config_drafts_v1`、`kg_course_config_releases_v1`、`kg_course_config_active_release_v1`、`kg_learning_tasks_v1`。

## 五、试卷管理（v9.0 P3.5 / P3.5.1 / P3.5.2 / p3.5.3）

- **「试卷管理」拆为独立页** `paper-management.html`，不再作为题库/课程内的标签栏；旧 `course-admin.html?view=papers` 自动跳转。
- 从正式题库按科目、题库、关键词筛选，当前页复选后批量加入试卷。
- 题目预览：复选框、全选、批量移除（只删试卷引用，不删题库原题）；锚定列表项的非模态悬浮卡片，双击关闭、单击切换。
- **发布链路**：发布时生成**不可变版本 + 题目快照**，教师继续编辑草稿不影响学员当前版本；发布范围可选深度回忆 / 多题画布 / 单题深学，三模式读统一发布目录。
- **学员账号可读取教师发布的试卷**，不依赖教师私有本地键（跨账号，见「已知限制」）。
- 列表：分类目录、未分类、自定义分类、关键词搜索、状态筛选、18 张/页分页；当前页批量选择/批量移动分类/批量归档/安全删除草稿；删除分类只移入「未分类」。
- 双栏可拖拽分栏、区域放大/收起、题目双击预览、精确编辑跳转。
- 存储：`kg_assessment_papers_v1`、`kg_exam_papers_published_v1`、`kg_exam_paper_release_history_v1`、`kg_exam_paper_categories_v1__`、`kg_paper_workspace_layout_v1`。

## 六、内容中心与知识树 / 分类法（v9.0 P0/P2/P3.1/P3.2）

- **v9.0-P0 底座**：管理端页面壳层、内容仓库契约与本地仓库实现；拆出科目、知识树、活动、课程、发布领域服务；引用索引、写入事务、自动快照、失败回滚、权限、审计；`window.KGLearningContent` 作为旧页面兼容门面转发到 v9 服务。
- **知识树版本化**（P2.1/P2.2）：最大深度 9 层；版本列表（查看/编辑/发布为当前/切换当前/复制为新草稿）；发布记录；单科目唯一当前版本约束。
- **安全归档/删除**（P2.2）：当前知识树禁删（先切换其他版本）；历史已发布版本「先归档、后永久删除」；草稿可直接删；归档版/草稿在有活动或课程引用时禁删；归档版可恢复为历史已发布版本（恢复后不自动成为当前）。知识树级引用索引、删除记录、自动事务快照、审计。
- **内容中心**：按知识树版本打开；草稿可编辑、已发布只读；导入成功后直接进入新草稿编辑。
- **科目与知识树统一工作区**（P3.2）：科目新增/编辑/排序/停用/恢复/空科目永久删除；科目编号稳定；科目级引用检查（知识树/题目/课程/试卷/学习任务存在时阻止永久删除）；停用科目不改已有数据。
- 页面：`content-center.html`（新）、`admin-subjects.html`（新）。存储：`kg_content_subjects_v1`、`kg_content_taxonomies_v1`、`kg_content_activity_overrides_v1`、`kg_content_organization_migration_v1`、`kg_taxonomy_deletion_records_v1`、`kg_taxonomy_import_records_v1`、`kg_taxonomy_release_records_v1`、`kg_activity_collections_v1`、`kg_activity_tags_v1`。

## 七、多题归纳画布（v8.6.2 P2.2 系列）

- 纳入统一**文件管理**：文件管理支持知识图谱/多题画布切换；页签栏（活动页签、关闭不删除、双击改名、拖拽排序、+ 新建、横向滚动）；画布列表可重开关闭页签；持久化 `reorderWorkspaces()`。
- 当前画布文件名单击行内编辑 + 云朵保存状态图标（saved/dirty/saving/error、Ctrl/Command+S）。
- 多选悬浮菜单：多卡对齐/分组/归纳/连线/颜色/删除；8 个通用 SVG 对齐分布图标；「局部整理」只整理框选卡片并支持撤销。
- 单选卡牌四点连接，拖到另一卡即建关系（默认无文字）；卡牌/关系线支持 Delete/Backspace + 撤销。
- 全局搜索面板（搜题目卡/归纳卡/正文/标签并聚焦）；右上「单题深学」靶心入口；可折叠缩略图（视野框拖动）；布局诊断用实际渲染几何。
- 存储：`kg_multi_workspace_closed_tabs_v1__`。

## 八、单题深学（v8.6.2 P2.2 系列）

- 全屏画布；五步进度（只显示标题提示）；题目库全高最高层抽屉；缩放/继续/缩略图底部同线；点击缩放百分比恢复 100%。
- 当前题目重置图标；完成卡牌纯绿色标题栏 + 强化完成态。
- Aa 点击循环字号；中文/中英对照切换（读 P2.1 双语字段）。
- 多题→单题携带 `questionId`/`bankId`/`paperId` 稳定 deep link，QuestionNavigator 可跨已发布试卷打开选中题目。

## 九、深度回忆（v8.6.2 P2.2 系列）

- 统一 64px 桌面顶栏（标题/返回/语言切换/导航/视图菜单）；「题目库」移到画布左上角，题集选择/搜索/未探索·已探索筛选，统一抽屉尺寸。
- 上一题/下一题；画布右上「重置本题知识点」；知识卡选中后 Delete 删除 + 双击删除（360ms 轻量冒烟动画）；点击缩放百分比恢复 100% 并原题居中。
- 五种主题限定到 `#krViewport`，平台顶栏不依赖主题覆盖。
- **进度升级为「账号＋题库＋题目」三级隔离**，受控迁移 v1 旧进度，修复跨账号/同题号跨题库串数据。
- 关键词解析只用当前题声明的线索/概念；题源读取缓存；搜索/进度保存防抖。
- 纯数据图模型（节点去重/边校验/层级重算/删除修复/连接合法性）。
- 存储：`kg_deep_recall_progress_v2__`、`kg_deep_recall_current_question_v2__`、`kg_deep_recall_explored_v2__`、`kg_deep_recall_legacy_owner_v1`、`kg_recall_association_library_v1__`。

## 十、学习路径（v8.6.2 P2.2.30）

- 学习模式由横向轨道改为**纵向 S 曲线**，正式节点保持原顺序连续排列，适合滚轮/触控上下滑动。
- 自由练习入口不再占正式节点槽位，改为在目标进度附近的候选节点中选 S 曲线转折点，放到曲线对侧空白区（第 3～5、第 8～10 节点区间）。
- 独立路径布局模块（节点坐标、平滑 SVG 曲线、入口锚点评分、人工锚点覆盖）；当前位置定位、阶段滚动位置保存、自由练习返回上下文全部支持纵向 `scrollTop`。
- 存储：`kg_guided_path_scroll_v3__`、`kg_guided_practice_return_v1`。

## 十一、管理后台信息架构（v9.0 P3.1 / P3.1.1 / P3.3.5）

- **重构为八个一级业务入口**（总览、科目与知识树、题库工具、试卷管理、课程、用户管理、操作记录、系统设置与诊断）；管理端首页从知识树发布页调整为**业务总览**。
- 新增**操作记录页**和**系统设置与诊断页**。
- 八模块统一**顶部导航**（桌面与移动端不再切换为左侧主导航）；移除重复「管理后台」入口，保留「总览」为唯一首页。
- **后台常驻顶栏**：八项导航滚动常驻；总览/科目与知识树/操作记录/系统设置右上角统一账号胶囊（用户中心/后台帮助中心/退出登录）。
- 页面：`admin-console.html`、`admin-operations.html`、`admin-settings.html`、`admin-subjects.html`（均新）。
- 存储：`kg_admin_audit_log_v1`、`kg_admin_settings_v1`、`kg_admin_transaction_snapshots_v1`、`kg_wechat_login_pending_v1`。

## 十二、底层重构与性能（v9.0 P0 + v8.6.2 P2.2.27）

- v9.0-P0 领域服务化（科目/知识树/活动/课程/发布）+ 引用索引/事务/快照/回滚/权限/审计。
- 独立纯数据图模型；深度回忆存储服务与题源缓存服务拆分；控制器渐进式重构。
- 关键词正则一次编译、事件委托、Map 查找、防抖，降低重复闭包与线性查找。
- 知识图谱与多题画布关系线点击热区改为非缩放描边，100%/200%/400% 固定屏幕宽度。
- 全局快捷栏缩小为纯图标栏，「考题训练」改名「多题归纳」。

---

## 新增页面清单（+9）

| 页面 | 功能 |
|---|---|
| `paper-management.html` | 试卷管理（独立页 + 发布链路） |
| `course-admin.html` | 课程管理（五步 + 批量） |
| `content-center.html` | 内容中心（知识树版本） |
| `teacher-workbench.html` | 教师工作台（三步工作流） |
| `admin-console.html` | 管理后台总览 |
| `admin-operations.html` | 操作记录 |
| `admin-settings.html` | 系统设置与诊断 |
| `admin-subjects.html` | 科目与知识树 |
| `multi-question-help.html` | 多题归纳帮助 |

## 新增 `src/` 模块（代表性）

`91-content-center-app.js` `91-course-admin-app.js` `91-knowledge-tree-index.js` `91-learning-content-core.js` `91-teacher-workbench-app.js` `92-workspace-panel-manager.js` `93-assessment-config-app.js` `93-content-organization-app.js` `94-practice-navigation.js` `95-recall-association-library.js` `96-recall-question-source.js` `97-recall-storage.js` `97-teacher-course-workflow.js` `97-teacher-question-workflow.js` `98-question-classification.js` `98-recall-graph-model.js` `98-teacher-workflow-p2-services.js` `99-embedded-workspace.js` `99-learning-practice-shell.js` `99-workspace-placement.js` `78-multi-question-workspace-tabs.js` `79-multi-question-workspace-filebar.js` `80-file-manager-workspace-library.js` `09-graph-connector-drag-controller.js` `86-free-mode-language.js` `89-guided-learning-path-layout.js`，以及子目录 `src/admin/` `src/canvas/` `src/cards/` 和独立模块 `question-studio/`。

## 新增存储键清单（37，接入时需登记到契约 + 后端白名单）

**exact（30）**：`kg_activity_collections_v1` `kg_activity_tags_v1` `kg_admin_audit_log_v1` `kg_admin_settings_v1` `kg_admin_transaction_snapshots_v1` `kg_assessment_papers_v1` `kg_content_activity_overrides_v1` `kg_content_organization_migration_v1` `kg_content_subjects_v1` `kg_content_taxonomies_v1` `kg_course_admin_recent_v862_p2` `kg_course_admin_workspace_v862_p1` `kg_course_config_active_release_v1` `kg_course_config_drafts_v1` `kg_course_config_releases_v1` `kg_deep_recall_legacy_owner_v1` `kg_exam_paper_release_history_v1` `kg_exam_papers_published_v1` `kg_guided_practice_return_v1` `kg_learning_tasks_v1` `kg_paper_workspace_layout_v1` `kg_question_banks_published_v1` `kg_question_classification_collapsed_v1` `kg_question_library_workspace_layout_v1` `kg_question_tag_names_v1` `kg_taxonomy_deletion_records_v1` `kg_taxonomy_import_records_v1` `kg_taxonomy_release_records_v1` `kg_teacher_workbench_subject_v1` `kg_wechat_login_pending_v1`

**prefix（7，per-key 带 `__`）**：`kg_deep_recall_current_question_v2__` `kg_deep_recall_explored_v2__` `kg_deep_recall_progress_v2__` `kg_exam_paper_categories_v1__` `kg_guided_path_scroll_v3__` `kg_multi_workspace_closed_tabs_v1__` `kg_recall_association_library_v1__`

---

## 已知限制：教师→学员跨账号共享

v9 的「学员读取教师发布的试卷/课程/学习任务」用前端 `published` 键 + `scope()`（`user__<name>` / `public`）实现（见 `src/96-recall-question-source.js` 等）。但后端 `runtime_state` **按 owner 隔离**、`get_state` 只读本人。因此本次接入后，教师写到自己 owner 的 `published` 键**学员账号读不到**——跨账号共享只在同账号/同浏览器内有效（换设备可同步自己）。真跨账号需后端新增共享读路径/共享 owner，留作后续单独立项。

涉及跨账号的键：`kg_question_banks_published_v1`、`kg_exam_papers_published_v1`、`kg_course_config_releases_v1`、`kg_learning_tasks_v1`、`kg_content_subjects_v1`、`kg_content_taxonomies_v1` 等。
