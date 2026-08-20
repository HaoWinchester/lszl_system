# runtime 迁移账本 unknown 处置提案（2026-08-20）

开发库 `runtime_migration_items` 中 65 个去重 pending 键（`disposition=unknown`）的处置提案。
依据：`docs/superpowers/specs/2026-08-17-runtime-state-domain-api-migration-design.md` §3.2（设备级偏好留本地）、§5.3（禁通用 preferences API）；
`frontend/scripts/new-legacy-contract.json` 的 `runtimeStorage` 白名单。

处置枚举：`keep-local`（设备级，留在浏览器不迁移）/ `drop`（一次性标记或已退役副本）/ `migrate`（已有领域 API 承接，需 verify 后 drop）/ `manual`（真实内容，人工逐项决定）。

## A. keep-local —— 设备级 UI 偏好（契约 exactKeys 已登记，设计 §3.2 明确不迁移）共 14

| 键 | 说明 |
|---|---|
| kg_default_entry_mode_v1 | 默认进入模式 |
| kg_question_language_mode_v1 | 做题语言模式 |
| kg_global_shortcuts_position_v1 | 快捷键悬浮位置 |
| kg_deep_recall_theme_v1 | 深度回忆主题 |
| kg_multi_question_highlight_color_v1__admin | 高亮色 |
| kg_multi_question_analysis_sections_v1__admin | 解析面板显示项 |
| kg_multi_question_paper_selection_v1__admin | 试卷选择记忆 |
| kg_multi_question_release_selection_v1__admin | 发布选择记忆 |
| kg_question_library_workspace_layout_v1 | 题库工作区布局 |
| kg_teacher_workbench_subject_v1 | 教师工作台科目记忆 |
| kg_canvas_view_preferences_v1 | 画布视口偏好（设计 §5.2 明确留本地） |
| 通用知识点关系图谱工具_新手引导已看_v1 | 引导已看标记 |
| kg_course_admin_workspace_v862_p1 | 课程管理工作区布局 |
| kg_canvas_workspace_catalog_v2__admin / __guest（2 键） | 画布目录折叠等 UI 状态 |

## B. drop —— 一次性标记 / 已完成的迁移标记，无留存价值 共 16

| 键 | 说明 |
|---|---|
| kg_learning_entry_chooser_consumed_v1__<hash>（9 键） | 学习入口选择一次性消费标记 |
| kg_graph_file_migration_v2 / kg_graph_recent_opened_migration_v1 / kg_content_organization_migration_v1 | 历史迁移完成标记 |
| kg_deep_recall_theme_platform_migrated_v1 | 主题迁移标记 |
| kg_teacher_shared_runtime_promotion_v1 | 教师共享提升一次性标记 |
| kg_subscription_plan_model_v2_migrated | 套餐模型迁移标记 |

## C. migrate —— 已有领域 API 承接，runtime 副本 verify 后退役 共 20

| 键 | 承接 API |
|---|---|
| kg_graph_file_index_v2 / kg_graph_folders_v1 / kg_graph_file_tags_v2 / kg_graph_current_file_v2 | files API（图谱文件后端权威） |
| kg_local_users_v1 / kg_role_themes_v1 / kg_student_subscriptions_v1 / kg_wechat_login_config_v1 | users / subscriptions / system API |
| kg_exam_papers_v1__teacher_shared / kg_exam_current_v1__user__admin | paper-releases / questions API |
| kg_recall_association_library_v1__subject__PMP / kg_recall_association_management_v1__subject__PMP | content-prep shared-content API |
| kg_content_subjects_v1 / kg_taxonomy_import_records_v1 / kg_taxonomy_release_records_v1 / kg_teaching_content_revision_v1 | 教学内容域（taxonomy 已迁入库） |
| kg_principle_repository_v1 / kg_synthesis_preset_repository_v1 / kg_activity_collections_v1 / kg_learning_tasks_v1 | 教学内容域（原则/归纳预设/活动/任务） |
| kg_learning_sessions_v2__admin | learning events / practice session API |
| kg_admin_audit_log_v1 / kg_admin_transaction_snapshots_v1 | system 审计域（user_admin_logs 表已承接） |

## D. manual —— 真实用户内容，需人工决定（本机 dev 库均为测试数据，建议 drop；生产库必须单独跑、逐项确认）共 15

| 键 | 内容 |
|---|---|
| kg_graph_file_content_v2__%E4%BD%A9%E5%A5%87007__graph_*（4 键） | 用户「佩琪007」的图谱正文 |
| kg_graph_file_content_v2__admin__graph_*（4 键） | admin 的图谱正文 |
| kg_graph_file_content_v2__guest__graph_*（1 键） | 游客画布正文 |
| 通用知识点关系图谱工具_多科目重点聚焦版_v2__user__admin | admin 的多科目聚焦库内容 |
| kg_canvas_workspace_v1__admin__pmp-pattern-workspace / __guest__（2 键） | 画布工作区（pmp-pattern 工作区内容） |
| kg_guided_learning_progress_v2__admin__pmp-change-response-demo-v3 | demo 学习进度 |

## 统计与执行

A 14 + B 16 + C 20 + D 15 = 65。执行方式：账本 disposition 逐键落库（`app/cli/runtime_domain_migration`）；C 类先跑 `verify` 再标 `drop-after-verify`；D 类 dev 库经确认后 drop，生产库上线切换前单独重跑 scan→人工确认→处置。
